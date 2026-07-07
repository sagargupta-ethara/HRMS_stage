"""
Advanced OCR engine for Aadhaar card extraction.

Pipeline (per image):
  1. Preprocess into 4 variants: original, grayscale, CLAHE+adaptive-threshold, CLAHE+Otsu
  2. Run each variant through 3 Tesseract PSM modes (4, 6, 11) → 12 passes total
  3. Score each pass (useful chars + line count + confidence + keyword bonus − noise penalty)
  4. Select the best-scoring pass as the canonical text
  5. Merge all pass texts for maximum extraction coverage
  6. Verhoeff checksum scoring (advisory only — no numbers are discarded on checksum failure)
  7. Frequency-ranked candidate selection (checksum hint > count > unmasked)

NOTE: UIDAI has not publicly documented the Aadhaar checksum algorithm. The Verhoeff
check is used as a ranking hint only; a number that fails it is still returned as-is
rather than discarded, to avoid rejecting legitimately scanned Aadhaar numbers.

This engine is safe for concurrent use: all functions are pure / stateless.
Heavy lifting (OpenCV, Tesseract) is imported lazily so the module can be
imported even on machines without those packages.
"""

from __future__ import annotations

import os
import re
from typing import Any

# ── Verhoeff tables ───────────────────────────────────────────────────────────

_D = [
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
    [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
    [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
    [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
    [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
    [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
    [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
    [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
    [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
]

_P = [
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
    [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
    [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
    [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
    [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
    [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
    [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
]

# ── Constants ─────────────────────────────────────────────────────────────────

MAX_IMAGE_SIDE = 2200
OCR_LANGUAGE = "eng+hin"   # Tesseract language; falls back gracefully
OCR_DPI_HINT = 220         # only used as metadata, not for rendering


def _bounded_int_env(name: str, default: int, *, minimum: int, maximum: int) -> int:
    try:
        value = int(os.getenv(name, str(default)))
    except (TypeError, ValueError):
        return default
    return max(minimum, min(maximum, value))


# Tesseract is OpenMP-enabled and otherwise uses all cores per subprocess. Keep
# OCR as a bounded background task instead of letting one upload saturate the host.
TESSERACT_THREAD_LIMIT = _bounded_int_env("TESSERACT_THREAD_LIMIT", 1, minimum=1, maximum=4)
TESSERACT_PASS_TIMEOUT_SECONDS = _bounded_int_env(
    "TESSERACT_PASS_TIMEOUT_SECONDS", 7, minimum=2, maximum=30
)
TESSERACT_MAX_PASSES = _bounded_int_env("TESSERACT_MAX_PASSES", 4, minimum=1, maximum=12)
TESSERACT_NICE = _bounded_int_env("TESSERACT_NICE", 5, minimum=0, maximum=19)

os.environ.setdefault("OMP_THREAD_LIMIT", str(TESSERACT_THREAD_LIMIT))
os.environ.setdefault("OMP_NUM_THREADS", str(TESSERACT_THREAD_LIMIT))

# (pass_name, tesseract_config)
_PSM_PASSES = [
    ("psm6", "--oem 1 --psm 6 -c preserve_interword_spaces=1"),
    ("psm4", "--oem 1 --psm 4 -c preserve_interword_spaces=1"),
    ("psm11", "--oem 1 --psm 11 -c preserve_interword_spaces=1"),
]

_AADHAAR_KEYWORDS = frozenset(
    ["government", "india", "dob", "male", "female", "aadhaar", "uidai"]
)

# ── Utility ───────────────────────────────────────────────────────────────────


def _normalize_spaces(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip()


def is_valid_verhoeff(number: str) -> bool:
    """Return True if the 12-digit string satisfies the Verhoeff checksum."""
    digits = re.sub(r"\D", "", number)
    if len(digits) != 12:
        return False
    checksum = 0
    for idx, digit in enumerate(reversed(digits)):
        checksum = _D[checksum][_P[idx % 8][int(digit)]]
    return checksum == 0


# ── Image preprocessing ───────────────────────────────────────────────────────


def _limit_image_size(image: Any, max_side: int = MAX_IMAGE_SIDE) -> Any:
    """Downscale if the longest dimension exceeds max_side."""
    import cv2

    h, w = image.shape[:2]
    largest = max(h, w)
    if largest <= max_side:
        return image
    scale = max_side / float(largest)
    new_w = max(1, int(w * scale))
    new_h = max(1, int(h * scale))
    return cv2.resize(image, (new_w, new_h), interpolation=cv2.INTER_AREA)


def _preprocess_variants(image: Any) -> list[tuple[str, Any]]:
    """
    Return four image variants that maximise Tesseract accuracy on Aadhaar cards:
      - original  : resized BGR image (Tesseract handles colour fine)
      - gray       : plain grayscale
      - adaptive   : CLAHE + denoising + adaptive Gaussian threshold (best for scans)
      - otsu       : CLAHE + denoising + Otsu global threshold
    """
    import cv2

    base = _limit_image_size(image)
    gray = cv2.cvtColor(base, cv2.COLOR_BGR2GRAY)

    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8)).apply(gray)
    denoised = cv2.fastNlMeansDenoising(clahe, None, 10, 7, 21)

    adaptive = cv2.adaptiveThreshold(
        denoised, 255,
        cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY, 31, 11,
    )
    _, otsu = cv2.threshold(denoised, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)

    return [
        ("original", base),
        ("adaptive_threshold", adaptive),
        ("gray", gray),
        ("otsu", otsu),
    ]


# ── Tesseract runner ──────────────────────────────────────────────────────────


def _parse_confidence(value: Any) -> float | None:
    try:
        conf = float(value)
    except (TypeError, ValueError):
        return None
    return round(conf, 2) if conf >= 0 else None


def _build_lines(tsv_data: dict) -> list[dict]:
    """Group TSV word rows into logical lines sorted by position."""
    grouped: dict[tuple, dict] = {}
    for idx, raw_text in enumerate(tsv_data["text"]):
        text = _normalize_spaces(raw_text)
        if not text:
            continue
        key = (
            tsv_data["block_num"][idx],
            tsv_data["par_num"][idx],
            tsv_data["line_num"][idx],
        )
        left = int(tsv_data["left"][idx])
        top = int(tsv_data["top"][idx])
        width = int(tsv_data["width"][idx])
        height = int(tsv_data["height"][idx])
        conf = _parse_confidence(tsv_data["conf"][idx])

        line = grouped.setdefault(
            key,
            {"words": [], "confidences": [], "lefts": [], "tops": [],
             "rights": [], "bottoms": []},
        )
        line["words"].append(text)
        line["lefts"].append(left)
        line["tops"].append(top)
        line["rights"].append(left + width)
        line["bottoms"].append(top + height)
        if conf is not None:
            line["confidences"].append(conf)

    results: list[dict] = []
    for line in grouped.values():
        avg_conf: float | None = None
        if line["confidences"]:
            avg_conf = round(sum(line["confidences"]) / len(line["confidences"]), 2)
        results.append(
            {
                "text": " ".join(line["words"]),
                "confidence": avg_conf,
                "bbox": {
                    "x": min(line["lefts"]),
                    "y": min(line["tops"]),
                    "width": max(line["rights"]) - min(line["lefts"]),
                    "height": max(line["bottoms"]) - min(line["tops"]),
                },
            }
        )

    results.sort(key=lambda r: (r["bbox"]["y"], r["bbox"]["x"]))
    return results


def _run_tesseract_pass(image: Any, config: str, language: str = OCR_LANGUAGE) -> dict:
    """Run one Tesseract pass and return structured result dict."""
    import pytesseract
    from pytesseract import Output

    # Try the configured language; fall back to eng-only if unavailable
    try:
        tsv_data = pytesseract.image_to_data(
            image,
            lang=language,
            config=config,
            output_type=Output.DICT,
            timeout=TESSERACT_PASS_TIMEOUT_SECONDS,
            nice=TESSERACT_NICE,
        )
    except RuntimeError as exc:
        if "timeout" in str(exc).lower():
            raise
        tsv_data = pytesseract.image_to_data(
            image,
            lang="eng",
            config=config,
            output_type=Output.DICT,
            timeout=TESSERACT_PASS_TIMEOUT_SECONDS,
            nice=TESSERACT_NICE,
        )

    lines = _build_lines(tsv_data)
    text = "\n".join(ln["text"] for ln in lines)
    confs = [ln["confidence"] for ln in lines if ln["confidence"] is not None]
    avg_conf = round(sum(confs) / len(confs), 2) if confs else None

    return {
        "text": text,
        "lines": lines,
        "line_count": len(lines),
        "word_count": sum(len(ln["text"].split()) for ln in lines),
        "char_count": sum(len(ln["text"]) for ln in lines),
        "average_confidence": avg_conf,
    }


# ── Scoring ───────────────────────────────────────────────────────────────────


def _score_result(result: dict) -> float:
    """Higher = better OCR result for Aadhaar cards."""
    text = result["text"]
    confidence = result.get("average_confidence") or 0
    useful = len(re.findall(r"[A-Za-z0-9]", text))
    noisy = len(re.findall(r"[^A-Za-z0-9\s:/\-]", text))
    lower = text.lower()
    keyword_bonus = sum(20 for kw in _AADHAAR_KEYWORDS if kw in lower)
    return (
        useful
        + result["line_count"] * 15
        + confidence * 6
        + keyword_bonus
        - noisy * 3
    )


def _has_primary_aadhaar_signal(text: str) -> bool:
    lower = text.lower()
    return bool(_AADHAAR_RE.search(text)) and any(
        signal in lower
        for signal in (
            "aadhaar",
            "uidai",
            "government",
            "dob",
            "date of birth",
            "year of birth",
            "male",
            "female",
        )
    )


# ── Aadhaar candidate selection ───────────────────────────────────────────────

_AADHAAR_RE = re.compile(
    r"\b(?:\d{4}[\s\-\.]{0,2}\d{4}[\s\-\.]{0,2}\d{4}"
    r"|[Xx]{4}[\s\-\.]{0,2}[Xx]{4}[\s\-\.]{0,2}\d{4})\b"
)


def _format_aadhaar(raw: str) -> str:
    cleaned = re.sub(r"[^0-9Xx]", "", raw)
    if len(cleaned) != 12:
        return _normalize_spaces(raw)
    return " ".join(cleaned[i : i + 4] for i in range(0, 12, 4)).upper()


def choose_aadhaar_candidate(lines: list[str]) -> dict | None:
    candidates: dict[str, dict] = {}
    for line in lines:
        for match in _AADHAAR_RE.finditer(line):
            formatted = _format_aadhaar(match.group(0))
            is_masked = "X" in formatted
            is_valid = None if is_masked else is_valid_verhoeff(formatted)
            entry = candidates.setdefault(
                formatted,
                {
                    "value": formatted,
                    "count": 0,
                    "is_masked": is_masked,
                    "is_valid_checksum": is_valid,
                    "supporting_lines": [],
                },
            )
            entry["count"] += 1
            if line not in entry["supporting_lines"]:
                entry["supporting_lines"].append(line)

    if not candidates:
        return None

    ranked = sorted(
        candidates.values(),
        key=lambda c: (
            1 if c["is_valid_checksum"] is True else 0,
            c["count"],
            1 if not c["is_masked"] else 0,
        ),
        reverse=True,
    )
    return ranked[0]


# ── Name extraction ───────────────────────────────────────────────────────────

_NAME_BLACKLIST = frozenset(
    [
        "government", "india", "aadhaar", "dob", "d0b", "male", "female",
        "transgender", "address", "uidai", "year of birth", "vid", "help",
    ]
)
_NAME_ANCHORS = ("dob", "d0b", "year of birth", "male", "female", "transgender")


def extract_name_candidates(lines: list[str]) -> list[dict]:
    """Return candidate name dicts sorted by plausibility (best first)."""
    candidates: list[dict] = []

    for idx, original in enumerate(lines):
        cleaned = _normalize_spaces(re.sub(r"[^A-Za-z.\-'\s]", " ", original))
        if len(cleaned) < 3:
            continue
        lower = cleaned.lower()
        if any(bw in lower for bw in _NAME_BLACKLIST):
            continue
        words = cleaned.split()
        if not 1 <= len(words) <= 4:
            continue
        if not any(ch.isalpha() for ch in cleaned):
            continue
        long_words = [w for w in words if len(w) >= 2]
        if not long_words:
            continue

        score = len(words)
        if len(long_words) >= 2:
            score += 3
        if all(w.isupper() or w[:1].isupper() for w in words):
            score += 2
        if any(len(w) == 1 for w in words):
            score -= 2
        if re.search(r"(.)\1{2,}", cleaned):
            score -= 3
        if idx + 1 < len(lines):
            nxt = lines[idx + 1].lower()
            if any(a in nxt for a in _NAME_ANCHORS):
                score += 4
        if idx + 2 < len(lines):
            nxt2 = lines[idx + 2].lower()
            if any(a in nxt2 for a in _NAME_ANCHORS):
                score += 2

        candidates.append({"value": cleaned, "score": score, "source_line": original})

    candidates.sort(key=lambda c: (-c["score"], len(c["value"])))

    deduplicated: list[dict] = []
    seen: set[str] = set()
    for c in candidates:
        key = c["value"].lower()
        if key not in seen:
            seen.add(key)
            deduplicated.append(c)
    return deduplicated


# ── Address extraction ────────────────────────────────────────────────────────


def extract_address_lines(lines: list[str]) -> list[str]:
    """Extract address lines following an 'address' keyword."""
    result: list[str] = []
    collecting = False
    for line in lines:
        lower = line.lower()
        if "address" in lower:
            collecting = True
            continue
        if not collecting:
            continue
        if (
            "uidai" in lower
            or "government" in lower
            or "aadhaar" in lower
            or re.search(r"\b\d{4}\s?\d{4}\s?\d{4}\b", line)
        ):
            break
        cleaned = _normalize_spaces(line)
        if cleaned:
            result.append(cleaned)
        if len(result) >= 5:
            break
    return result


# ── Main image OCR entry point ────────────────────────────────────────────────


def ocr_image_bytes(image_bytes: bytes) -> dict:
    """
    Full OCR pipeline on raw image bytes (JPEG/PNG/WEBP/BMP).

    Returns:
        best_result   – highest-scoring single pass result
        pass_summaries – list of per-pass metadata dicts
        all_texts      – list of all non-empty pass texts (for maximum coverage)
        all_lines      – merged line list across all passes
    """
    import cv2
    import numpy as np

    nparr = np.frombuffer(image_bytes, dtype=np.uint8)
    image = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    if image is None:
        return {
            "best_result": {"text": "", "lines": [], "score": 0,
                            "line_count": 0, "word_count": 0, "average_confidence": None,
                            "variant": "original", "ocr_mode": "psm6"},
            "pass_summaries": [],
            "all_texts": [],
            "all_lines": [],
        }

    return ocr_image_array(image)


def ocr_image_array(image: Any) -> dict:
    """Run the full multi-variant × multi-PSM pipeline on an OpenCV image array."""
    pass_summaries: list[dict] = []
    best_result: dict | None = None
    all_texts: list[str] = []
    all_lines: list[dict] = []
    passes_run = 0

    for variant_name, variant_img in _preprocess_variants(image):
        for pass_name, config in _PSM_PASSES:
            if passes_run >= TESSERACT_MAX_PASSES:
                break
            passes_run += 1
            try:
                result = _run_tesseract_pass(variant_img, config)
            except Exception:
                continue

            result["variant"] = variant_name
            result["ocr_mode"] = pass_name
            result["score"] = round(_score_result(result), 2)

            pass_summaries.append(
                {
                    "variant": variant_name,
                    "ocr_mode": pass_name,
                    "score": result["score"],
                    "line_count": result["line_count"],
                    "word_count": result["word_count"],
                    "average_confidence": result["average_confidence"],
                }
            )

            if result["text"]:
                all_texts.append(result["text"])
                all_lines.extend(result["lines"])

            if best_result is None or result["score"] > best_result["score"]:
                best_result = result

            if result["text"] and _has_primary_aadhaar_signal("\n".join(all_texts)):
                break
        if passes_run >= TESSERACT_MAX_PASSES or _has_primary_aadhaar_signal("\n".join(all_texts)):
            break

    if best_result is None:
        best_result = {
            "text": "", "lines": [], "score": 0,
            "line_count": 0, "word_count": 0, "average_confidence": None,
            "variant": "original", "ocr_mode": "psm6",
        }

    return {
        "best_result": best_result,
        "pass_summaries": pass_summaries,
        "all_texts": all_texts,
        "all_lines": all_lines,
    }


# ── High-level Aadhaar extractor ──────────────────────────────────────────────


def extract_aadhaar_from_image_bytes(image_bytes: bytes) -> dict:
    """
    Run the full OCR pipeline on image bytes and return:
      {
        aadhaarNumber, dateOfBirth, yearOfBirth, gender, postalCode,
        name, nameCandidates, addressLines,
        ocrStatus, message, passSummaries, extractedLines
      }
    """
    ocr = ocr_image_bytes(image_bytes)
    return _build_aadhaar_result(ocr)


def _build_aadhaar_result(ocr: dict) -> dict:
    """Derive Aadhaar fields from an ocr() result dict."""
    best = ocr["best_result"]
    all_texts: list[str] = ocr["all_texts"]
    all_lines_raw: list[dict] = ocr["all_lines"]

    # Unique, non-empty lines from all passes (preserve order, deduplicate)
    seen_lines: set[str] = set()
    merged_lines: list[str] = []
    for ln in all_lines_raw:
        text = _normalize_spaces(ln.get("text", ""))
        if text and text not in seen_lines:
            seen_lines.add(text)
            merged_lines.append(text)

    # Also include lines from the best pass (ensures primary pass is represented)
    for ln in best.get("lines", []):
        text = _normalize_spaces(ln.get("text", ""))
        if text and text not in seen_lines:
            seen_lines.add(text)
            merged_lines.append(text)

    combined_text = "\n".join(all_texts)

    # ── Aadhaar number ────────────────────────────────────────────────────────
    aadhaar_candidate = choose_aadhaar_candidate(merged_lines)
    aadhaar_number: str | None = None
    aadhaar_is_masked: bool | None = None
    aadhaar_checksum_valid: bool | None = None
    if aadhaar_candidate:
        aadhaar_number = aadhaar_candidate["value"]
        aadhaar_is_masked = aadhaar_candidate["is_masked"]
        aadhaar_checksum_valid = aadhaar_candidate["is_valid_checksum"]

    # ── Date of birth ─────────────────────────────────────────────────────────
    date_of_birth = _extract_dob(merged_lines, combined_text)
    year_of_birth: str | None = None
    if date_of_birth and len(date_of_birth) >= 4:
        year_of_birth = date_of_birth[-4:]

    # ── Gender ────────────────────────────────────────────────────────────────
    gender = _extract_gender(merged_lines)

    # ── Postal code ───────────────────────────────────────────────────────────
    postal_match = re.search(r"\b\d{6}\b", combined_text)
    postal_code = postal_match.group(0) if postal_match else None

    # ── Name ─────────────────────────────────────────────────────────────────
    name_candidates = extract_name_candidates(merged_lines)
    names = [c["value"] for c in name_candidates[:5]]
    primary_name = names[0] if names else None

    # ── Address ───────────────────────────────────────────────────────────────
    address_lines = extract_address_lines(merged_lines)

    # ── Aadhaar document detection ────────────────────────────────────────────
    lower_combined = combined_text.lower()
    signal_count = sum(
        [
            bool(re.search(r"\b(aadhaar|uidai)\b", lower_combined)),
            bool(re.search(r"\bgovernment\s+of\s+india\b", lower_combined)),
            bool(re.search(r"\b(?:dob|d0b|year of birth)\b", lower_combined)),
            bool(re.search(r"\b(?:male|female|transgender)\b", lower_combined)),
            bool(aadhaar_number),
        ]
    )
    document_type = "aadhaar" if signal_count >= 2 else "unknown"

    extracted = bool(aadhaar_number or date_of_birth)
    ocr_status = "extracted" if extracted else "needs_review"
    message = (
        "Aadhaar details extracted successfully."
        if extracted
        else (
            "Could not auto-extract Aadhaar details. "
            "Please enter your Aadhaar number and date of birth manually — "
            "the uploaded document will be reviewed."
        )
    )

    return {
        "documentType": document_type,
        "aadhaarNumber": aadhaar_number,
        "aadhaarIsMasked": aadhaar_is_masked,
        "aadhaarChecksumValid": aadhaar_checksum_valid,
        "dateOfBirth": date_of_birth,
        "yearOfBirth": year_of_birth,
        "gender": gender,
        "postalCode": postal_code,
        "name": primary_name,
        "nameCandidates": names,
        "addressLines": address_lines,
        "ocrStatus": ocr_status,
        "message": message,
        "passSummaries": ocr["pass_summaries"],
    }


# ── DOB helpers ───────────────────────────────────────────────────────────────

_DOB_LABELED = re.compile(
    r"(?:"
    r"(?:date\s*of\s*birth|d\s*\.?\s*[o0]\s*\.?\s*b\.?|birth\s*date)"
    r"\s*[:\-]?\s*"
    r"([0-9OoIl|SsBbZz]{1,2}[/\-\.\s]+[0-9OoIl|SsBbZz]{1,2}[/\-\.\s]+[0-9OoIl|SsBbZz]{4}"
    r"|[0-9OoIl|SsBbZz]{4}[/\-\.\s]+[0-9OoIl|SsBbZz]{1,2}[/\-\.\s]+[0-9OoIl|SsBbZz]{1,2}"
    r"|\d{1,2}[\s\-](?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[\s\-]\d{4}"
    r")"
    r"|(?:year\s*of\s*birth|yob)\s*[:\-]?\s*([0-9OoIl|SsBbZz]{4})"
    r")",
    re.IGNORECASE,
)
_DOB_STANDALONE = re.compile(
    r"\b([0-9OoIl|SsBbZz]{1,2})[/\-\.\s]+([0-9OoIl|SsBbZz]{1,2})[/\-\.\s]+([0-9OoIl|SsBbZz]{4})\b"
)
_MONTH_MAP = {
    "jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6,
    "jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12,
}
_OCR_DATE_DIGIT_TRANS = str.maketrans({
    "O": "0",
    "o": "0",
    "I": "1",
    "l": "1",
    "|": "1",
    "S": "5",
    "s": "5",
    "B": "8",
    "b": "8",
    "Z": "2",
    "z": "2",
})


def _normalize_ocr_date_digits(value: str) -> str:
    return value.translate(_OCR_DATE_DIGIT_TRANS)


def _parse_date_parts(day: int, month: int, year: int) -> str | None:
    if not (1900 < year < 2030 and 1 <= month <= 12 and 1 <= day <= 31):
        return None
    try:
        from datetime import date
        return date(year, month, day).isoformat()
    except ValueError:
        return None


def _extract_dob(lines: list[str], combined_text: str) -> str | None:
    # Pass 1: labeled pattern on per-line and combined text
    for text in [*lines, combined_text]:
        m = _DOB_LABELED.search(text)
        if not m:
            continue
        # Year-of-birth only group(2)
        if m.lastindex and m.lastindex >= 2 and m.group(2):
            year = int(_normalize_ocr_date_digits(m.group(2)))
            if 1900 < year < 2025:
                return f"{year}-01-01"
            continue
        raw = m.group(1)
        if not raw:
            continue
        named = re.match(r"(\d{1,2})[\s\-]([a-z]+)[\s\-](\d{4})", raw, re.IGNORECASE)
        if named:
            mon = named.group(2).lower()[:3]
            if mon in _MONTH_MAP:
                result = _parse_date_parts(int(named.group(1)), _MONTH_MAP[mon], int(named.group(3)))
                if result:
                    return result
        raw_clean = _normalize_ocr_date_digits(raw)
        raw_clean = re.sub(r"[.\-\s]+", "/", raw_clean)
        raw_clean = re.sub(r"/+", "/", raw_clean).strip("/")
        parts = raw_clean.split("/")
        if len(parts) == 3:
            try:
                p0, p1, p2 = int(parts[0]), int(parts[1]), int(parts[2])
                result = _parse_date_parts(p2, p1, p0) if p0 > 31 else _parse_date_parts(p0, p1, p2)
                if result:
                    return result
            except ValueError:
                pass

    # Pass 2: standalone DD/MM/YYYY in plausible birth-year range
    for m in _DOB_STANDALONE.finditer(combined_text):
        day = int(_normalize_ocr_date_digits(m.group(1)))
        month = int(_normalize_ocr_date_digits(m.group(2)))
        year = int(_normalize_ocr_date_digits(m.group(3)))
        if 1940 <= year <= 2010 and 1 <= month <= 12 and 1 <= day <= 31:
            result = _parse_date_parts(day, month, year)
            if result:
                return result
    return None


def _extract_gender(lines: list[str]) -> str | None:
    for line in lines:
        m = re.search(r"\b(MALE|FEMALE|TRANSGENDER)\b", line, re.IGNORECASE)
        if m:
            return m.group(1).title()
    return None


# ── PDF page → image → OCR ────────────────────────────────────────────────────


def ocr_pdf_bytes(pdf_bytes: bytes, *, dpi: int = 220) -> dict:
    """
    Convert each PDF page to an image and run the full OCR pipeline.
    Returns aggregated best_result plus per-page data.
    Falls back gracefully if pdf2image/poppler is not available.
    """
    try:
        from pdf2image import convert_from_bytes  # type: ignore[import-untyped]
    except ImportError:
        return {
            "best_result": {"text": "", "lines": [], "score": 0,
                            "line_count": 0, "word_count": 0,
                            "average_confidence": None,
                            "variant": "original", "ocr_mode": "psm6"},
            "pass_summaries": [],
            "all_texts": [],
            "all_lines": [],
            "pages": [],
        }

    import cv2
    import numpy as np

    try:
        pil_pages = convert_from_bytes(pdf_bytes, dpi=dpi, thread_count=1)
    except Exception:
        return {
            "best_result": {"text": "", "lines": [], "score": 0,
                            "line_count": 0, "word_count": 0,
                            "average_confidence": None,
                            "variant": "original", "ocr_mode": "psm6"},
            "pass_summaries": [],
            "all_texts": [],
            "all_lines": [],
            "pages": [],
        }

    all_texts: list[str] = []
    all_lines: list[dict] = []
    all_summaries: list[dict] = []
    best_result: dict | None = None
    pages: list[dict] = []

    for page_num, pil_page in enumerate(pil_pages, start=1):
        arr = np.array(pil_page)
        img_bgr = cv2.cvtColor(arr, cv2.COLOR_RGB2BGR)
        page_ocr = ocr_image_array(img_bgr)

        all_texts.extend(page_ocr["all_texts"])
        all_lines.extend(page_ocr["all_lines"])
        all_summaries.extend(page_ocr["pass_summaries"])

        page_best = page_ocr["best_result"]
        pages.append({"page": page_num, **page_best})

        if best_result is None or page_best.get("score", 0) > best_result.get("score", 0):
            best_result = page_best

    if best_result is None:
        best_result = {
            "text": "", "lines": [], "score": 0,
            "line_count": 0, "word_count": 0, "average_confidence": None,
            "variant": "original", "ocr_mode": "psm6",
        }

    return {
        "best_result": best_result,
        "pass_summaries": all_summaries,
        "all_texts": all_texts,
        "all_lines": all_lines,
        "pages": pages,
    }


def is_available() -> bool:
    """Return True if cv2, numpy, and pytesseract are importable."""
    try:
        import cv2  # noqa: F401
        import numpy  # noqa: F401
        import pytesseract  # noqa: F401
        return True
    except ImportError:
        return False

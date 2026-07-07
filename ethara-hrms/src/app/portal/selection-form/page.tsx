"use client";

import { useEffect, useRef, useState, type ElementType } from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  Building2,
  Check,
  CheckCircle2,
  ClipboardCheck,
  FileText,
  GraduationCap,
  Landmark,
  Loader2,
  Lock,
  MapPin,
  Upload,
  UserRound,
  Users,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { candidatesApi, documentsApi, selectionFormsApi, type CandidateSelectionFormRecord } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { cn, formatLabel } from "@/lib/utils";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { resolveEmployeeGenderLabel } from "@/lib/employee-profile-options";
import { PageHeader } from "@/components/shared/page-header";
import { DatePicker } from "@/components/ui/date-picker";
import type { CandidatePortalOverview } from "@/types";

const EVALUATION_PASSED_STAGES = [
  "evaluation_passed",
  "selection_form_sent",
  "selection_form_submitted",
  "selection_form_validated",
  "contract_sent",
  "contract_signed",
  "induction_completed",
  "it_email_created",
  "welcome_mail_sent",
  "statutory_forms_sent",
  "statutory_forms_submitted",
  "compliance_verified",
  "onboarding_completed",
];

type OcrStatus = "idle" | "extracting" | "passed" | "partial" | "needs_review" | "failed";
type DocumentVerificationHint = { status: OcrStatus; message: string };

type ChequeOcrResult = {
  accountNumber?: string | null;
  ifscCode?: string | null;
  accountHolderName?: string | null;
  bankName?: string | null;
  ocrStatus?: string;
  message?: string;
};

type PanOcrResult = {
  panNumber?: string | null;
  ocrStatus?: string;
  message?: string;
};

type AadhaarOcrResult = {
  aadhaarNumber?: string | null;
  dateOfBirth?: string | null;
  cardHolderName?: string | null;
  name?: string | null;
  ocrStatus?: string;
  message?: string;
};

type AddressOcrResult = {
  address?: string | null;
  addressLines?: string[];
  postalCode?: string | null;
  ocrStatus?: string;
  message?: string;
};

type FileUpload = {
  file: File | null;
  name: string;
  required: boolean;
  savedName?: string | null;
  savedUrl?: string | null;
  savedDocumentId?: string | null;
  savedMimeType?: string | null;
  savedAvailable?: boolean;
};
type DocKey =
  | "passport_size_photo"
  | "marksheet_10th" | "marksheet_12th" | "graduation" | "post_graduation"
  | "certifications" | "experience_letter_1" | "experience_letter_2"
  | "relieving_letter" | "payslips" | "cancelled_cheque" | "pan_doc"
  | "aadhaar_doc" | "current_address_proof" | "permanent_address_proof";

type Reference = { name: string; email: string; phone: string; linkedin: string };

type UploadedSelectionDocument = {
  id?: string | null;
  fileName?: string | null;
  fileUrl?: string | null;
  mimeType?: string | null;
};

const SELECTION_FORM_DOCUMENT_TYPE_PREFIX = "selection_form_";

const emptyRef = (): Reference => ({ name: "", email: "", phone: "", linkedin: "" });

const DEFAULT_FORM_STATE = {
  fullName: "",
  email: "",
  contactNumber: "",
  dateOfBirth: "",
  experienceType: "fresher",
  qualification: "",
  fatherName: "",
  motherName: "",
  spouseName: "",
  spouseOccupation: "",
  kidsCount: "",
  gender: "male",
  languagesKnown: "",
  maritalStatus: "unmarried",
  anniversaryDate: "",
  pan: "",
  aadhaarNumber: "",
  hasUanNumber: "",
  uanNumber: "",
  currentAddress: "",
  permanentAddress: "",
  emergencyContactName: "",
  emergencyContactPhone: "",
  emergencyContactRelation: "",
  employerName1: "",
  designation1: "",
  employmentPeriod1: "",
  employerName2: "",
  designation2: "",
  employmentPeriod2: "",
  hasSavingsAccount: "",
  hasSalaryAccount: "",
  bankName: "HDFC Bank",
  accountHolderName: "",
  accountNumber: "",
  ifsc: "",
};
type SelectionFormState = typeof DEFAULT_FORM_STATE;

function buildCandidateSelectionDefaults(
  application: CandidatePortalOverview["currentApplication"]
): Partial<SelectionFormState> {
  if (!application) {
    return {};
  }

  return {
    fullName: application.fullName || "",
    email: application.personalEmail || "",
    contactNumber: application.phone || "",
    dateOfBirth: application.dateOfBirth || "",
    experienceType: application.experienceType || DEFAULT_FORM_STATE.experienceType,
    gender: application.gender || DEFAULT_FORM_STATE.gender,
    maritalStatus: application.maritalStatus || DEFAULT_FORM_STATE.maritalStatus,
    accountHolderName: application.fullName || "",
  };
}

const createInitialDocs = (): Record<DocKey, FileUpload> => ({
  passport_size_photo: { file: null, name: "Passport Size Photo", required: true, savedName: null },
  marksheet_10th: { file: null, name: "10th Mark Sheet / Certificate", required: true, savedName: null },
  marksheet_12th: { file: null, name: "12th Mark Sheet / Certificate", required: true, savedName: null },
  graduation: { file: null, name: "Graduation Certificate", required: true, savedName: null },
  post_graduation: { file: null, name: "Post-Graduation Documents", required: false, savedName: null },
  certifications: { file: null, name: "Certifications (if any)", required: false, savedName: null },
  experience_letter_1: { file: null, name: "Experience Letter (Employer 1)", required: false, savedName: null },
  experience_letter_2: { file: null, name: "Experience Letter (Employer 2)", required: false, savedName: null },
  relieving_letter: { file: null, name: "Relieving Letter", required: false, savedName: null },
  payslips: { file: null, name: "Last 3 Payslips", required: false, savedName: null },
  cancelled_cheque: { file: null, name: "Cancelled Cheque", required: true, savedName: null },
  pan_doc: { file: null, name: "PAN Card Copy", required: true, savedName: null },
  aadhaar_doc: { file: null, name: "Aadhaar Card Copy", required: true, savedName: null },
  current_address_proof: { file: null, name: "Current Address Proof", required: false, savedName: null },
  permanent_address_proof: { file: null, name: "Permanent Address Proof", required: true, savedName: null },
});

const getSelectionFormDraftKey = (candidateId: string) => `candidate-selection-form:${candidateId}`;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function getStoredDocument(value: unknown): Partial<FileUpload> {
  if (typeof value === "string") {
    return { savedName: value || null, savedAvailable: false };
  }
  if (!isRecord(value)) return { savedName: null };
  return {
    savedName: asString(value.fileName) || asString(value.file_name) || asString(value.name) || null,
    savedUrl: asString(value.fileUrl) || asString(value.file_url) || null,
    savedDocumentId: asString(value.documentId) || asString(value.document_id) || asString(value.id) || null,
    savedMimeType: asString(value.mimeType) || asString(value.mime_type) || null,
    savedAvailable: typeof value.fileAvailable === "boolean" ? value.fileAvailable : undefined,
  };
}

function hasStoredSelectionFile(doc: FileUpload): boolean {
  if (doc.file) return true;
  if (doc.savedAvailable === false) return false;
  return Boolean(doc.savedDocumentId || doc.savedUrl || doc.savedName);
}

function buildUploadedDocumentsPayload(docs: Record<DocKey, FileUpload>) {
  const documentsUploaded: Record<string, unknown> = {};
  Object.entries(docs).forEach(([key, value]) => {
    const fileName = value.savedName ?? value.file?.name ?? "";
    if (!fileName) return;
    documentsUploaded[key] = {
      fileName,
      documentId: value.savedDocumentId ?? null,
      fileUrl: value.savedUrl ?? null,
      mimeType: value.savedMimeType ?? value.file?.type ?? null,
      fileAvailable: Boolean(value.savedDocumentId || value.savedUrl),
    };
  });
  return documentsUploaded;
}

function normalizePhoneDigits(value: unknown): string {
  return asString(value).replace(/\D/g, "").slice(0, 10);
}

function normalizeReference(value: unknown): Reference {
  if (!isRecord(value)) return emptyRef();
  return {
    name: asString(value.name),
    email: asString(value.email),
    phone: normalizePhoneDigits(value.phone),
    linkedin: asString(value.linkedin),
  };
}

function ensureTwoReferences(value: unknown): Reference[] {
  const refs = Array.isArray(value) ? value.slice(0, 2).map(normalizeReference) : [];
  while (refs.length < 2) refs.push(emptyRef());
  return refs;
}

function buildSelectionFormPayload(
  form: SelectionFormState,
  docs: Record<DocKey, FileUpload>,
  references: Reference[],
  isExperienced: boolean,
  isMarried: boolean
) {
  const hasUanNumber = form.hasUanNumber === "yes";
  const hasHdfcSalaryAccount = form.hasSavingsAccount === "yes" && form.hasSalaryAccount === "yes";
  const normalizedUan = hasUanNumber ? form.uanNumber.replace(/\D/g, "") : "";

  return {
    basicDetails: {
      fullName: form.fullName,
      email: form.email,
      contactNumber: normalizePhoneDigits(form.contactNumber),
      dateOfBirth: form.dateOfBirth,
      experienceType: form.experienceType,
      qualification: form.qualification,
    },
    personalDetails: {
      fatherName: form.fatherName,
      motherName: form.motherName,
      gender: form.gender,
      maritalStatus: form.maritalStatus,
      languagesKnown: form.languagesKnown,
      pan: form.pan.toUpperCase(),
      aadhaarNumber: form.aadhaarNumber.replace(/\D/g, ""),
      hasUanNumber: form.hasUanNumber,
      uanNumber: normalizedUan,
      ...(isMarried ? {
        spouseName: form.spouseName,
        spouseOccupation: form.spouseOccupation,
        kidsCount: form.kidsCount,
        anniversaryDate: form.anniversaryDate,
      } : {}),
    },
    identityDetails: {
      aadhaarNumber: form.aadhaarNumber.replace(/\D/g, ""),
      panNumber: form.pan.toUpperCase(),
      hasUanNumber: form.hasUanNumber,
      uanNumber: normalizedUan,
    },
    addressDetails: {
      currentAddress: form.currentAddress,
      permanentAddress: form.permanentAddress,
    },
    emergencyContact: {
      name: form.emergencyContactName,
      phone: normalizePhoneDigits(form.emergencyContactPhone),
      relation: form.emergencyContactRelation,
    },
    professionalDetails: isExperienced ? {
      employer1: { name: form.employerName1, designation: form.designation1, period: form.employmentPeriod1 },
      employer2: form.employerName2 ? { name: form.employerName2, designation: form.designation2, period: form.employmentPeriod2 } : null,
    } : null,
    references: isExperienced ? references.map((ref) => ({
      ...ref,
      phone: normalizePhoneDigits(ref.phone),
    })) : [],
    bankDetails: {
      hasSavingsAccount: form.hasSavingsAccount,
      hasSalaryAccount: form.hasSalaryAccount,
      salaryAccountInstruction:
        hasHdfcSalaryAccount ? "ready_for_salary_eligibility_validation" : "open_or_convert_hdfc_salary_account",
      bankName: hasHdfcSalaryAccount ? form.bankName : "",
      accountHolderName: hasHdfcSalaryAccount ? form.accountHolderName : "",
      accountNumber: hasHdfcSalaryAccount ? form.accountNumber : "",
      ifsc: hasHdfcSalaryAccount ? form.ifsc.toUpperCase() : "",
    },
    documentsUploaded: buildUploadedDocumentsPayload(docs),
  };
}

// Government IDs (Aadhaar / PAN) must never be persisted to localStorage — they
// stay in component state (memory) for the active session only. The cached draft
// blanks them so a shared or re-opened browser can't recover them; the candidate
// re-enters these fields when resuming an unsaved draft.
function stripSensitiveDraftFields(
  payload: ReturnType<typeof buildSelectionFormPayload>
): ReturnType<typeof buildSelectionFormPayload> {
  return {
    ...payload,
    personalDetails: { ...payload.personalDetails, pan: "", aadhaarNumber: "" },
    identityDetails: { ...payload.identityDetails, panNumber: "", aadhaarNumber: "" },
  };
}

const FIELD_VALIDATORS: Record<string, (v: string) => string> = {
  email: (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? "" : "Invalid email format",
  phone: (v) => /^[6-9]\d{9}$/.test(v.replace(/\s/g, "")) ? "" : "Enter a valid 10-digit mobile number",
  contactNumber: (v) => /^[6-9]\d{9}$/.test(v.replace(/\s/g, "")) ? "" : "Enter a valid 10-digit mobile number",
  emergencyContactPhone: (v) => /^[6-9]\d{9}$/.test(v.replace(/\s/g, "")) ? "" : "Enter a valid 10-digit mobile number",
  pan: (v) => /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/.test(v.toUpperCase()) ? "" : "Invalid PAN format (e.g. ABCDE1234F)",
  aadhaar: (v) => /^\d{12}$/.test(v.replace(/\D/g, "")) ? "" : "Aadhaar number must be 12 digits",
  aadhaarNumber: (v) => /^\d{12}$/.test(v.replace(/\D/g, "")) ? "" : "Aadhaar number must be 12 digits",
  uan: (v) => /^10\d{10}$/.test(v.replace(/\D/g, "")) ? "" : "UAN must be 12 digits and start with 10",
  uanNumber: (v) => /^10\d{10}$/.test(v.replace(/\D/g, "")) ? "" : "UAN must be 12 digits and start with 10",
  ifsc: (v) => /^[A-Z]{4}0[A-Z0-9]{6}$/.test(v.toUpperCase()) ? "" : "Invalid IFSC code (e.g. HDFC0001234)",
  accountNumber: (v) => /^\d{9,18}$/.test(v) ? "" : "Account number must be 9–18 digits",
  account_number: (v) => /^\d{9,18}$/.test(v) ? "" : "Account number must be 9–18 digits",
};

function validate(key: string, value: string): string {
  if (!value.trim()) return "This field is required";
  return FIELD_VALIDATORS[key]?.(value) ?? "";
}

const MAX_FILE = 10 * 1024 * 1024;
const ALLOWED_DOC_TYPES = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]);
function validateFile(file: File): string | null {
  if (!ALLOWED_DOC_TYPES.has(file.type)) return "Only PDF, JPG, PNG, or WEBP allowed";
  if (file.size > MAX_FILE) return "File must be under 10 MB";
  if (file.size === 0) return "File appears empty";
  return null;
}

const STEPS: Array<{ key: string; label: string; icon: ElementType }> = [
  { key: "basic", label: "Employment", icon: Building2 },
  { key: "education", label: "Education", icon: GraduationCap },
  { key: "professional", label: "Professional", icon: FileText },
  { key: "personal", label: "Family", icon: UserRound },
  { key: "references", label: "References", icon: Users },
  { key: "bank", label: "Bank", icon: Landmark },
  { key: "address", label: "Address", icon: MapPin },
];

export default function SelectionFormPage() {
  const { user } = useAuth();
  const router = useRouter();
  const [overview, setOverview] = useState<CandidatePortalOverview | null>(null);
  const [isLoadingOverview, setIsLoadingOverview] = useState(true);
  const [hasHydratedState, setHasHydratedState] = useState(false);
  const [step, setStep] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [submitMessageType, setSubmitMessageType] = useState<"error" | "info">("error");
  const [selectionFormRecord, setSelectionFormRecord] = useState<CandidateSelectionFormRecord | null>(null);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const [form, setForm] = useState(DEFAULT_FORM_STATE);
  const [docs, setDocs] = useState<Record<DocKey, FileUpload>>(createInitialDocs);

  const [references, setReferences] = useState<Reference[]>([emptyRef(), emptyRef()]);

  const [chequeOcrStatus, setChequeOcrStatus] = useState<OcrStatus>("idle");
  const [chequeOcrMessage, setChequeOcrMessage] = useState("");
  const [chequeExtracted, setChequeExtracted] = useState<ChequeOcrResult | null>(null);
  const [panOcrStatus, setPanOcrStatus] = useState<OcrStatus>("idle");
  const [panOcrMessage, setPanOcrMessage] = useState("");
  const [aadhaarOcrStatus, setAadhaarOcrStatus] = useState<OcrStatus>("idle");
  const [aadhaarOcrMessage, setAadhaarOcrMessage] = useState("");
  const documentVerifyReqRef = useRef<Record<string, number>>({});
  const [documentVerify, setDocumentVerify] = useState<Record<string, DocumentVerificationHint>>({});
  const [addressOcrStatus, setAddressOcrStatus] = useState<Record<"current_address_proof" | "permanent_address_proof", OcrStatus>>({
    current_address_proof: "idle",
    permanent_address_proof: "idle",
  });
  const [addressOcrMessage, setAddressOcrMessage] = useState<Record<"current_address_proof" | "permanent_address_proof", string>>({
    current_address_proof: "",
    permanent_address_proof: "",
  });

  const isExperienced = form.experienceType === "experienced";
  const isMarried = form.maritalStatus === "married";
  const hasUanNumber = form.hasUanNumber;
  const hasSavingsAccount = form.hasSavingsAccount;
  const hasSalaryAccount = form.hasSalaryAccount;
  const hasHdfcSalaryAccount = hasSavingsAccount === "yes" && hasSalaryAccount === "yes";
  const stage = overview?.currentApplication?.currentStage ?? "";
  const canAccess = EVALUATION_PASSED_STAGES.includes(stage);
  const isAlreadySubmitted = stage === "selection_form_submitted" || stage === "selection_form_validated";
  const candidateId = overview?.currentApplication?.id ?? "";
  const verificationStatus = selectionFormRecord?.verificationStatus ?? "";
  const verificationMessage = selectionFormRecord?.verificationMessage ?? "";
  const isVerificationWaiting = ["queued", "processing"].includes(verificationStatus);

  const hydrateSelectionForm = (
    record: CandidateSelectionFormRecord | null | undefined,
    defaults: Partial<SelectionFormState> = {}
  ) => {
    if (!record?.formData || !isRecord(record.formData)) return false;

    const basicDetails = isRecord(record.formData.basicDetails) ? record.formData.basicDetails : {};
    const personalDetails = isRecord(record.formData.personalDetails) ? record.formData.personalDetails : {};
    const identityDetails = isRecord(record.formData.identityDetails) ? record.formData.identityDetails : {};
    const addressDetails = isRecord(record.formData.addressDetails) ? record.formData.addressDetails : {};
    const emergencyContact = isRecord(record.formData.emergencyContact) ? record.formData.emergencyContact : {};
    const professionalDetails = isRecord(record.formData.professionalDetails) ? record.formData.professionalDetails : {};
    const employer1 = isRecord(professionalDetails.employer1) ? professionalDetails.employer1 : {};
    const employer2 = isRecord(professionalDetails.employer2) ? professionalDetails.employer2 : {};
    const bankDetails = isRecord(record.formData.bankDetails) ? record.formData.bankDetails : {};
    const documentsUploaded = isRecord(record.formData.documentsUploaded) ? record.formData.documentsUploaded : {};
    const savedUanNumber = asString(identityDetails.uanNumber) || asString(personalDetails.uanNumber);
    const savedAccountNumber = asString(bankDetails.accountNumber);

    setForm((prev) => ({
      ...prev,
      ...defaults,
      fullName: asString(basicDetails.fullName) || defaults.fullName || prev.fullName,
      email: asString(basicDetails.email) || defaults.email || prev.email,
      contactNumber: normalizePhoneDigits(basicDetails.contactNumber) || defaults.contactNumber || prev.contactNumber,
      dateOfBirth: asString(basicDetails.dateOfBirth) || defaults.dateOfBirth || prev.dateOfBirth,
      experienceType: asString(basicDetails.experienceType) || defaults.experienceType || prev.experienceType,
      qualification: asString(basicDetails.qualification),
      fatherName: asString(personalDetails.fatherName),
      motherName: asString(personalDetails.motherName),
      spouseName: asString(personalDetails.spouseName),
      spouseOccupation: asString(personalDetails.spouseOccupation),
      kidsCount: asString(personalDetails.kidsCount),
      gender: asString(personalDetails.gender) || defaults.gender || prev.gender,
      languagesKnown: asString(personalDetails.languagesKnown),
      maritalStatus: asString(personalDetails.maritalStatus) || prev.maritalStatus,
      anniversaryDate: asString(personalDetails.anniversaryDate),
      pan: (asString(identityDetails.panNumber) || asString(personalDetails.pan)).toUpperCase(),
      aadhaarNumber: asString(identityDetails.aadhaarNumber) || asString(personalDetails.aadhaarNumber),
      hasUanNumber: asString(identityDetails.hasUanNumber) || asString(personalDetails.hasUanNumber) || (savedUanNumber ? "yes" : prev.hasUanNumber),
      uanNumber: savedUanNumber,
      currentAddress: asString(addressDetails.currentAddress),
      permanentAddress: asString(addressDetails.permanentAddress),
      emergencyContactName: asString(emergencyContact.name),
      emergencyContactPhone: normalizePhoneDigits(emergencyContact.phone),
      emergencyContactRelation: asString(emergencyContact.relation),
      employerName1: asString(employer1.name),
      designation1: asString(employer1.designation),
      employmentPeriod1: asString(employer1.period),
      employerName2: asString(employer2.name),
      designation2: asString(employer2.designation),
      employmentPeriod2: asString(employer2.period),
      hasSavingsAccount: asString(bankDetails.hasSavingsAccount) || (savedAccountNumber ? "yes" : prev.hasSavingsAccount),
      hasSalaryAccount: asString(bankDetails.hasSalaryAccount) || (savedAccountNumber ? "yes" : prev.hasSalaryAccount),
      bankName: asString(bankDetails.bankName) || prev.bankName,
      accountHolderName: asString(bankDetails.accountHolderName) || defaults.accountHolderName || prev.accountHolderName,
      accountNumber: savedAccountNumber,
      ifsc: asString(bankDetails.ifsc).toUpperCase(),
    }));

    setReferences(ensureTwoReferences(record.formData.references));
    setDocs((prev) => {
      const next = { ...prev };
      (Object.keys(next) as DocKey[]).forEach((key) => {
        const storedDocument = getStoredDocument(documentsUploaded[key]);
        next[key] = {
          ...next[key],
          file: null,
          savedName: storedDocument.savedName ?? null,
          savedUrl: storedDocument.savedUrl ?? null,
          savedDocumentId: storedDocument.savedDocumentId ?? null,
          savedMimeType: storedDocument.savedMimeType ?? null,
          savedAvailable: storedDocument.savedAvailable,
        };
      });
      return next;
    });

    return true;
  };

  useEffect(() => {
    let isMounted = true;

    const loadSelectionForm = async () => {
      try {
        const data = await candidatesApi.me();
        if (!isMounted) return;

        setOverview(data);
        const selectionDefaults = buildCandidateSelectionDefaults(data?.currentApplication);
        setForm((prev) => ({ ...prev, ...selectionDefaults }));

        const currentCandidateId = data?.currentApplication?.id;
        let didHydrate = false;

        if (currentCandidateId) {
          try {
            const savedSelectionForm = await selectionFormsApi.get(currentCandidateId);
            if (!isMounted) return;
            setSelectionFormRecord(savedSelectionForm);
            didHydrate = hydrateSelectionForm(savedSelectionForm, selectionDefaults);
          } catch {}

          if (!didHydrate && typeof window !== "undefined") {
            const draftKey = getSelectionFormDraftKey(currentCandidateId);
            const savedDraft = window.localStorage.getItem(draftKey);
            if (savedDraft) {
              try {
                didHydrate = hydrateSelectionForm(
                  JSON.parse(savedDraft) as CandidateSelectionFormRecord,
                  selectionDefaults
                );
              } catch {
                window.localStorage.removeItem(draftKey);
              }
            }
          }
        }
      } catch {}
      finally {
        if (isMounted) {
          setHasHydratedState(true);
          setIsLoadingOverview(false);
        }
      }
    };

    loadSelectionForm();
    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (!hasHydratedState || !candidateId || typeof window === "undefined") return;

    const draftKey = getSelectionFormDraftKey(candidateId);
    if (isAlreadySubmitted) {
      window.localStorage.removeItem(draftKey);
      return;
    }

    const draftFormData = buildSelectionFormPayload(form, docs, references, isExperienced, isMarried);
    window.localStorage.setItem(
      draftKey,
      JSON.stringify({
        candidateId,
        formData: stripSensitiveDraftFields(draftFormData),
      } satisfies CandidateSelectionFormRecord)
    );
  }, [candidateId, docs, form, hasHydratedState, isAlreadySubmitted, isExperienced, isMarried, references]);

  const updateField = (key: keyof typeof form, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    if (touched[key]) {
      setFieldErrors((prev) => ({ ...prev, [key]: validate(key, value) }));
    }
  };

  const touchField = (key: string, value: string) => {
    setTouched((prev) => ({ ...prev, [key]: true }));
    setFieldErrors((prev) => ({ ...prev, [key]: validate(key, value) }));
  };

  const clearDocumentError = (key: DocKey) => {
    setFieldErrors((prev) => ({ ...prev, [`doc_${key}`]: "" }));
  };

  const clearDocumentVerification = (key: DocKey) => {
    setDocumentVerify((prev) => ({ ...prev, [key]: { status: "idle", message: "" } }));
  };

  const verifySelectionDocumentFile = async (key: DocKey, file: File) => {
    if (!candidateId) return;
    const requestId = (documentVerifyReqRef.current[key] ?? 0) + 1;
    documentVerifyReqRef.current[key] = requestId;
    setDocumentVerify((prev) => ({
      ...prev,
      [key]: { status: "extracting", message: "Checking document..." },
    }));
    try {
      const result = await selectionFormsApi.verifyDocument(candidateId, key, file);
      if (documentVerifyReqRef.current[key] !== requestId) return;
      if (!result.message) {
        clearDocumentVerification(key);
        return;
      }
      setDocumentVerify((prev) => ({
        ...prev,
        [key]: {
          status: result.ocrStatus === "extracted" ? "passed" : "needs_review",
          message: result.message,
        },
      }));
    } catch {
      if (documentVerifyReqRef.current[key] !== requestId) return;
      clearDocumentVerification(key);
    }
  };

  const handleDocUpload = (key: DocKey, file: File | null) => {
    if (key === "cancelled_cheque") {
      void handleChequeUpload(file);
      return;
    }
    if (key === "pan_doc") {
      void handlePanUpload(file);
      return;
    }
    if (key === "aadhaar_doc") {
      void handleAadhaarUpload(file);
      return;
    }
    if (key === "current_address_proof" || key === "permanent_address_proof") {
      void handleAddressUpload(key, file);
      return;
    }
    if (!file) {
      if (fileInputRefs.current[key]) fileInputRefs.current[key]!.value = "";
      clearDocumentVerification(key);
      setDocs((prev) => ({ ...prev, [key]: { ...prev[key], file: null, savedName: null, savedUrl: null, savedDocumentId: null, savedMimeType: null, savedAvailable: undefined } }));
      return;
    }
    const err = validateFile(file);
    if (err) { toast.error(err); return; }
    clearDocumentError(key);
    void verifySelectionDocumentFile(key, file);
    setDocs((prev) => ({ ...prev, [key]: { ...prev[key], file, savedName: file.name, savedUrl: null, savedDocumentId: null, savedMimeType: file.type || null, savedAvailable: undefined } }));
  };

  const handleChequeUpload = async (file: File | null) => {
    setChequeOcrMessage("");
    setChequeExtracted(null);
    if (!file) {
      if (fileInputRefs.current.cancelled_cheque) fileInputRefs.current.cancelled_cheque.value = "";
      setDocs((prev) => ({ ...prev, cancelled_cheque: { ...prev.cancelled_cheque, file: null, savedName: null, savedUrl: null, savedDocumentId: null, savedMimeType: null, savedAvailable: undefined } }));
      setChequeOcrStatus("idle");
      return;
    }
    const err = validateFile(file);
    if (err) {
      toast.error(err);
      setChequeOcrStatus("failed");
      setChequeOcrMessage(err);
      return;
    }
    clearDocumentError("cancelled_cheque");
    setDocs((prev) => ({ ...prev, cancelled_cheque: { ...prev.cancelled_cheque, file, savedName: file.name, savedUrl: null, savedDocumentId: null, savedMimeType: file.type || null, savedAvailable: undefined } }));
    setChequeOcrStatus("extracting");
    try {
      const payload = new FormData();
      payload.append("cancelledCheque", file);
      const raw = await candidatesApi.extractCheque(payload);
      const result = raw as ChequeOcrResult;
      const status = result.ocrStatus ?? "needs_review";
      setChequeExtracted(result);

      if (status === "extracted") {
        setChequeOcrStatus("passed");
        setChequeOcrMessage(result.message || "Bank details extracted from cancelled cheque.");
        setForm((prev) => ({
          ...prev,
          accountNumber: result.accountNumber?.replace(/\D/g, "") || prev.accountNumber,
          ifsc: result.ifscCode?.toUpperCase().replace(/\s/g, "").slice(0, 11) || prev.ifsc,
          accountHolderName: result.accountHolderName || prev.accountHolderName,
          bankName: result.bankName || prev.bankName,
        }));
      } else if (status === "partial") {
        setChequeOcrStatus("partial");
        setChequeOcrMessage(result.message || "Partial extraction — please verify and complete the fields below.");
        setForm((prev) => ({
          ...prev,
          accountNumber: result.accountNumber?.replace(/\D/g, "") || prev.accountNumber,
          ifsc: result.ifscCode?.toUpperCase().replace(/\s/g, "").slice(0, 11) || prev.ifsc,
          accountHolderName: result.accountHolderName || prev.accountHolderName,
          bankName: result.bankName || prev.bankName,
        }));
      } else {
        setChequeOcrStatus("needs_review");
        setChequeOcrMessage(result.message || "Could not read the cheque automatically. Please enter your details manually.");
      }
    } catch {
      setChequeOcrStatus("needs_review");
      setChequeOcrMessage("Could not read the cheque automatically. Please enter your details manually.");
    }
  };

  const handlePanUpload = async (file: File | null) => {
    setPanOcrMessage("");
    if (!file) {
      if (fileInputRefs.current.pan_doc) fileInputRefs.current.pan_doc.value = "";
      setDocs((prev) => ({ ...prev, pan_doc: { ...prev.pan_doc, file: null, savedName: null, savedUrl: null, savedDocumentId: null, savedMimeType: null, savedAvailable: undefined } }));
      setPanOcrStatus("idle");
      return;
    }
    const err = validateFile(file);
    if (err) {
      toast.error(err);
      setPanOcrStatus("failed");
      setPanOcrMessage(err);
      return;
    }
    clearDocumentError("pan_doc");
    setDocs((prev) => ({ ...prev, pan_doc: { ...prev.pan_doc, file, savedName: file.name, savedUrl: null, savedDocumentId: null, savedMimeType: file.type || null, savedAvailable: undefined } }));
    setPanOcrStatus("extracting");
    try {
      const payload = new FormData();
      payload.append("panCard", file);
      const result = (await candidatesApi.extractPan(payload)) as PanOcrResult;
      if (result.ocrStatus === "extracted" && result.panNumber) {
        setPanOcrStatus("passed");
        setPanOcrMessage(result.message || "PAN number extracted from document.");
        updateField("pan", result.panNumber.toUpperCase());
      } else {
        setPanOcrStatus("needs_review");
        setPanOcrMessage(result.message || "Could not read the PAN automatically. Please enter it manually.");
      }
    } catch {
      setPanOcrStatus("needs_review");
      setPanOcrMessage("Could not read the PAN automatically. Please enter it manually.");
    }
  };

  const handleAadhaarUpload = async (file: File | null) => {
    setAadhaarOcrMessage("");
    if (!file) {
      if (fileInputRefs.current.aadhaar_doc) fileInputRefs.current.aadhaar_doc.value = "";
      setDocs((prev) => ({ ...prev, aadhaar_doc: { ...prev.aadhaar_doc, file: null, savedName: null, savedUrl: null, savedDocumentId: null, savedMimeType: null, savedAvailable: undefined } }));
      setAadhaarOcrStatus("idle");
      return;
    }
    const err = validateFile(file);
    if (err) {
      toast.error(err);
      setAadhaarOcrStatus("failed");
      setAadhaarOcrMessage(err);
      return;
    }
    clearDocumentError("aadhaar_doc");
    setDocs((prev) => ({ ...prev, aadhaar_doc: { ...prev.aadhaar_doc, file, savedName: file.name, savedUrl: null, savedDocumentId: null, savedMimeType: file.type || null, savedAvailable: undefined } }));
    setAadhaarOcrStatus("extracting");

    let result: AadhaarOcrResult | undefined;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const payload = new FormData();
      payload.append("aadhaarCard", file);
      try {
        result = (await candidatesApi.extractAadhaar(payload)) as AadhaarOcrResult;
        break;
      } catch (uploadError: unknown) {
        const isNetworkError = !(uploadError as { response?: unknown })?.response;
        if (!isNetworkError || attempt === 2) break;
        await new Promise((resolve) => setTimeout(resolve, 800 * (attempt + 1)));
      }
    }

    if (!result) {
      setAadhaarOcrStatus("needs_review");
      setAadhaarOcrMessage(
        "Aadhaar OCR is taking longer than expected. The document has been saved; please review the fields below or try the upload again.",
      );
      return;
    }

    const aadhaarNumber = result.aadhaarNumber?.replace(/\D/g, "").slice(0, 12) || "";
    const extractedName = result.cardHolderName || result.name || "";
    const hasReadableDetails = Boolean(aadhaarNumber || result.dateOfBirth || extractedName);

    if (hasReadableDetails) {
      setForm((prev) => ({
        ...prev,
        aadhaarNumber: aadhaarNumber || prev.aadhaarNumber,
        dateOfBirth: result.dateOfBirth || prev.dateOfBirth,
        fullName: extractedName || prev.fullName,
      }));
    }

    if (aadhaarNumber.length === 12) {
      setAadhaarOcrStatus("passed");
      setAadhaarOcrMessage(result.message || "Aadhaar details extracted from document.");
    } else if (hasReadableDetails || result.ocrStatus === "extracted" || result.ocrStatus === "partial") {
      setAadhaarOcrStatus("partial");
      setAadhaarOcrMessage("Partial Aadhaar details were extracted. Please review and complete the missing fields below.");
    } else {
      setAadhaarOcrStatus("needs_review");
      setAadhaarOcrMessage("Aadhaar document uploaded. Please review the details below or try a clearer front-side image.");
    }
  };

  const handleAddressUpload = async (
    key: "current_address_proof" | "permanent_address_proof",
    file: File | null,
  ) => {
    setAddressOcrMessage((prev) => ({ ...prev, [key]: "" }));
    if (!file) {
      if (fileInputRefs.current[key]) fileInputRefs.current[key]!.value = "";
      setDocs((prev) => ({ ...prev, [key]: { ...prev[key], file: null, savedName: null, savedUrl: null, savedDocumentId: null, savedMimeType: null, savedAvailable: undefined } }));
      setAddressOcrStatus((prev) => ({ ...prev, [key]: "idle" }));
      return;
    }
    const err = validateFile(file);
    if (err) {
      toast.error(err);
      setAddressOcrStatus((prev) => ({ ...prev, [key]: "failed" }));
      setAddressOcrMessage((prev) => ({ ...prev, [key]: err }));
      return;
    }
    clearDocumentError(key);
    setDocs((prev) => ({ ...prev, [key]: { ...prev[key], file, savedName: file.name, savedUrl: null, savedDocumentId: null, savedMimeType: file.type || null, savedAvailable: undefined } }));
    setAddressOcrStatus((prev) => ({ ...prev, [key]: "extracting" }));
    try {
      const payload = new FormData();
      payload.append("addressProof", file);
      const result = (await candidatesApi.extractAddress(payload)) as AddressOcrResult;
      if (result.ocrStatus === "extracted" && result.address) {
        setAddressOcrStatus((prev) => ({ ...prev, [key]: "passed" }));
        setAddressOcrMessage((prev) => ({ ...prev, [key]: result.message || "Address extracted from document." }));
        if (key === "current_address_proof") {
          setForm((prev) => ({ ...prev, currentAddress: result.address || "" }));
        } else {
          setForm((prev) => ({ ...prev, permanentAddress: result.address || "" }));
        }
      } else {
        setAddressOcrStatus((prev) => ({ ...prev, [key]: "needs_review" }));
        setAddressOcrMessage((prev) => ({
          ...prev,
          [key]: result.message || "Could not read the address automatically. Please enter it manually.",
        }));
      }
    } catch {
      setAddressOcrStatus((prev) => ({ ...prev, [key]: "needs_review" }));
      setAddressOcrMessage((prev) => ({
        ...prev,
        [key]: "Could not read the address automatically. Please enter it manually.",
      }));
    }
  };

  const updateReference = (idx: number, field: keyof Reference, value: string) => {
    const nextValue = field === "phone" ? normalizePhoneDigits(value) : value;
    setReferences((prev) => prev.map((r, i) => i === idx ? { ...r, [field]: nextValue } : r));
  };

  const validateStep = (stepIdx: number): boolean => {
    const newErrors: Record<string, string> = {};
    const require = (key: string, value: string, validator?: string) => {
      newErrors[key] = validate(validator ?? key, value);
    };
    const requireDoc = (key: DocKey) => {
      newErrors[`doc_${key}`] = hasStoredSelectionFile(docs[key]) ? "" : "This document is required";
    };
    const stepKey = STEPS[stepIdx]?.key;

    if (stepKey === "basic") {
      require("fullName", form.fullName);
      require("email", form.email, "email");
      require("contactNumber", form.contactNumber, "phone");
      require("dateOfBirth", form.dateOfBirth);
      require("experienceType", form.experienceType);
      require("qualification", form.qualification);
    } else if (stepKey === "education") {
      const requiredDocs: DocKey[] = ["passport_size_photo", "marksheet_10th", "marksheet_12th", "graduation", "pan_doc", "aadhaar_doc"];
      if (isExperienced) requiredDocs.push("experience_letter_1", "relieving_letter", "payslips");
      requiredDocs.forEach(requireDoc);
    } else if (stepKey === "professional" && isExperienced) {
      require("employerName1", form.employerName1, "employerName1");
      require("designation1", form.designation1, "designation1");
      require("employmentPeriod1", form.employmentPeriod1, "employmentPeriod1");
    } else if (stepKey === "personal") {
      require("fatherName", form.fatherName);
      require("motherName", form.motherName);
      require("aadhaarNumber", form.aadhaarNumber, "aadhaar");
      require("pan", form.pan, "pan");
      require("hasUanNumber", form.hasUanNumber);
      if (form.hasUanNumber === "yes") {
        require("uanNumber", form.uanNumber, "uan");
      }
      require("emergencyContactName", form.emergencyContactName);
      require("emergencyContactPhone", form.emergencyContactPhone, "phone");
      require("emergencyContactRelation", form.emergencyContactRelation);
      if (isMarried) {
        require("spouseName", form.spouseName);
        require("anniversaryDate", form.anniversaryDate);
      }
    } else if (stepKey === "references" && isExperienced) {
      references.forEach((ref, i) => {
        newErrors[`ref_${i}_name`] = ref.name.trim() ? "" : "Name is required";
        newErrors[`ref_${i}_email`] =
          ref.email.trim() && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ref.email) ? "" : "Valid email required";
        newErrors[`ref_${i}_phone`] =
          ref.phone.trim() && /^[6-9]\d{9}$/.test(ref.phone.replace(/\s/g, "")) ? "" : "Valid phone required";
      });
    } else if (stepKey === "bank") {
      // Bank details are OPTIONAL on the candidate form (HR collects/validates them later
      // via penny drop). Only check the format of whatever the candidate chose to fill in,
      // and clear any stale "required" errors from previous validation runs.
      ["hasSavingsAccount", "hasSalaryAccount", "doc_cancelled_cheque", "bankName", "accountHolderName"].forEach((key) => {
        newErrors[key] = "";
      });
      newErrors.accountNumber = form.accountNumber.trim() ? FIELD_VALIDATORS.account_number(form.accountNumber) : "";
      newErrors.ifsc = form.ifsc.trim() ? FIELD_VALIDATORS.ifsc(form.ifsc) : "";
    } else if (stepKey === "address") {
      require("currentAddress", form.currentAddress);
      require("permanentAddress", form.permanentAddress);
      requireDoc("permanent_address_proof");
    }

    const hasErrors = Object.values(newErrors).some(Boolean);
    setFieldErrors((prev) => ({ ...prev, ...newErrors }));
    const newTouched: Record<string, boolean> = {};
    Object.keys(newErrors).forEach((k) => { newTouched[k] = true; });
    setTouched((prev) => ({ ...prev, ...newTouched }));
    return !hasErrors;
  };

  const shouldSkipStep = (index: number) =>
    !isExperienced && ["professional", "references"].includes(STEPS[index]?.key ?? "");

  const findNextStep = (from: number) => {
    let next = from + 1;
    while (next < STEPS.length && shouldSkipStep(next)) next += 1;
    return Math.min(next, STEPS.length - 1);
  };

  const validateBeforeStep = (targetStep: number): boolean => {
    for (let i = 0; i < targetStep; i += 1) {
      if (shouldSkipStep(i)) continue;
      if (!validateStep(i)) {
        setStep(i);
        toast.error("Please complete this section before continuing.");
        return false;
      }
    }
    return true;
  };

  const handleStepSelect = (targetStep: number) => {
    if (shouldSkipStep(targetStep)) return;
    if (targetStep <= step) {
      setStep(targetStep);
      return;
    }
    if (validateBeforeStep(targetStep)) setStep(targetStep);
  };

  const handleNext = () => {
    const next = findNextStep(step);
    if (validateBeforeStep(next)) setStep(next);
  };

  const handleBack = () => {
    let previous = step - 1;
    while (previous > 0 && shouldSkipStep(previous)) previous -= 1;
    setStep(Math.max(previous, 0));
  };

  const uploadPendingSelectionDocuments = async (): Promise<Record<DocKey, FileUpload>> => {
    let nextDocs: Record<DocKey, FileUpload> = { ...docs };
    const pendingDocuments = Object.entries(docs).filter((entry): entry is [DocKey, FileUpload] => {
      const [, doc] = entry as [DocKey, FileUpload];
      return Boolean(doc.file);
    });

    for (const [key, doc] of pendingDocuments) {
      const file = doc.file;
      if (!file) continue;
      const uploaded = await documentsApi.upload(
        candidateId,
        file,
        `${SELECTION_FORM_DOCUMENT_TYPE_PREFIX}${key}`,
      ) as UploadedSelectionDocument;
      nextDocs = {
        ...nextDocs,
        [key]: {
          ...doc,
          file: null,
          savedName: uploaded.fileName || file.name,
          savedUrl: uploaded.fileUrl || null,
          savedDocumentId: uploaded.id || null,
          savedMimeType: uploaded.mimeType || file.type || null,
          savedAvailable: true,
        },
      };
      setDocs(nextDocs);
    }

    return nextDocs;
  };

  const handleSubmit = async () => {
    for (let i = 0; i <= STEPS.length - 1; i++) {
      if (!validateStep(i)) {
        setStep(i);
        toast.error("Some required fields are missing. Please review all sections.");
        return;
      }
    }

    if (!candidateId) { toast.error("Candidate session not found. Please refresh."); return; }

    setIsSubmitting(true);
    setSubmitError("");
    setSubmitMessageType("error");
    try {
      const docsForSubmission = await uploadPendingSelectionDocuments();
      const submitted = await selectionFormsApi.submit(
        candidateId,
        buildSelectionFormPayload(form, docsForSubmission, references, isExperienced, isMarried),
      );
      setSelectionFormRecord(submitted);
      if (typeof window !== "undefined") {
        window.localStorage.removeItem(getSelectionFormDraftKey(candidateId));
      }
      toast.success("Selection form submitted. Document checks are queued.");
      setTimeout(() => router.push("/portal/dashboard"), 1500);
    } catch (err: unknown) {
      const apiErr = err as {
        code?: string;
        message?: string;
        response?: { status?: number; data?: { detail?: string } };
      };
      // The submit may have actually gone through even though the request errored out — a mobile
      // network drop mid-request, or a duplicate re-submit. Before alarming the candidate, confirm
      // the server's state: if the form is recorded as submitted, treat this as a clean success.
      if (candidateId) {
        try {
          const latest = await selectionFormsApi.get(candidateId);
          if (latest?.submittedAt) {
            setSelectionFormRecord(latest);
            if (typeof window !== "undefined") {
              window.localStorage.removeItem(getSelectionFormDraftKey(candidateId));
            }
            toast.success("Selection form submitted. Document checks are queued.");
            setTimeout(() => router.push("/portal/dashboard"), 1500);
            return;
          }
        } catch {
          // Still unreachable (genuinely offline) — fall through to the guidance message below.
        }
      }
      const isTimeout =
        apiErr?.code === "ECONNABORTED" ||
        /timeout|timed out/i.test(apiErr?.message || "");
      const isAlreadyQueued = apiErr?.response?.status === 409;
      const msg =
        apiErr?.response?.data?.detail ||
        (isTimeout || isAlreadyQueued
          ? "Your form is still processing document checks. Please wait a moment before trying again."
          : "We could not confirm the submission yet. Please wait a moment and check your dashboard before submitting again.");
      setSubmitError(msg);
      if (isTimeout || isAlreadyQueued) {
        setSubmitMessageType("info");
        toast.info(msg);
        setTimeout(() => router.push("/portal/dashboard"), 2500);
      } else {
        setSubmitMessageType("error");
        toast.error(msg);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoadingOverview) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!canAccess) {
    return (
      <div className="mx-auto max-w-5xl space-y-6 overflow-x-hidden animate-fade-in">
        <PageHeader
          icon={ClipboardCheck}
          title="Selection Form"
          description="Complete the mandatory details and upload each supporting document."
        />
        <div className="rounded-xl border-0 bg-card p-8 text-center shadow-sm space-y-4">
          <div className="h-14 w-14 rounded-full bg-muted/40 flex items-center justify-center mx-auto">
            <Lock className="h-6 w-6 text-muted-foreground" />
          </div>
          <div>
            <p className="font-semibold text-lg">Selection Form not yet available</p>
            <p className="text-sm text-muted-foreground mt-2">
              This form becomes available once you have passed the evaluation stage.
              Your application is currently at: <strong>{formatLabel(stage)}</strong>
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (isAlreadySubmitted) {
    return (
      <div className="mx-auto max-w-5xl space-y-6 overflow-x-hidden animate-fade-in">
        <PageHeader icon={ClipboardCheck} title="Selection Form" />
        <div className="rounded-xl border border-success/30 bg-success/5 p-8 text-center shadow-sm space-y-4">
          <div className="h-14 w-14 rounded-full bg-success/20 flex items-center justify-center mx-auto">
            {isVerificationWaiting ? (
              <Loader2 className="h-6 w-6 animate-spin text-success" />
            ) : (
              <CheckCircle2 className="h-6 w-6 text-success" />
            )}
          </div>
          <div>
            <p className="font-semibold text-lg text-success">Selection Form Submitted</p>
            <p className="text-sm text-muted-foreground mt-2">
              {stage === "selection_form_validated"
                ? "Your selection form has been validated by HR."
                : verificationMessage || "Your selection form is queued for document checks. Please wait while HR completes validation."}
            </p>
          </div>
          {isVerificationWaiting && (
            <div className="rounded-xl border border-primary/30 bg-primary/10 px-4 py-3 text-sm text-primary font-medium">
              Document verification is in queue. Please wait and do not submit again.
            </div>
          )}
          {stage === "selection_form_validated" && (
            <div className="rounded-xl border border-success/30 bg-success/10 px-4 py-3 text-sm text-success font-medium">
              Form validated by HR - proceeding to next stage
            </div>
          )}
        </div>
        <div className="rounded-xl border-0 bg-card p-6 shadow-sm space-y-5">
          <div>
            <h2 className="text-base font-semibold">Saved Form Details</h2>
            <p className="text-sm text-muted-foreground">Your submitted selection form remains visible here after refresh.</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Full Name</p>
              <p className="mt-1 text-sm text-foreground">{form.fullName || "Not provided"}</p>
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Email</p>
              <p className="mt-1 text-sm text-foreground">{form.email || "Not provided"}</p>
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Contact Number</p>
              <p className="mt-1 text-sm text-foreground">{form.contactNumber || "Not provided"}</p>
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Date of Birth</p>
              <p className="mt-1 text-sm text-foreground">{form.dateOfBirth || "Not provided"}</p>
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Experience Type</p>
              <p className="mt-1 text-sm text-foreground">{form.experienceType ? formatLabel(form.experienceType) : "Not provided"}</p>
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Highest Qualification</p>
              <p className="mt-1 text-sm text-foreground">{form.qualification || "Not provided"}</p>
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Father&apos;s Name</p>
              <p className="mt-1 text-sm text-foreground">{form.fatherName || "Not provided"}</p>
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Mother&apos;s Name</p>
              <p className="mt-1 text-sm text-foreground">{form.motherName || "Not provided"}</p>
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">PAN Number</p>
              <p className="mt-1 text-sm text-foreground">{form.pan || "Not provided"}</p>
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Aadhaar Number</p>
              <p className="mt-1 text-sm text-foreground">{form.aadhaarNumber || "Not provided"}</p>
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">UAN Number</p>
              <p className="mt-1 text-sm text-foreground">{form.uanNumber || "Not provided"}</p>
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Bank Name</p>
              <p className="mt-1 text-sm text-foreground">{form.bankName || "Not provided"}</p>
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Account Holder Name</p>
              <p className="mt-1 text-sm text-foreground">{form.accountHolderName || "Not provided"}</p>
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Account Number</p>
              <p className="mt-1 text-sm text-foreground">{form.accountNumber || "Not provided"}</p>
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">IFSC Code</p>
              <p className="mt-1 text-sm text-foreground">{form.ifsc || "Not provided"}</p>
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Languages Known</p>
              <p className="mt-1 text-sm text-foreground">{form.languagesKnown || "Not provided"}</p>
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Emergency Contact</p>
              <p className="mt-1 text-sm text-foreground">
                {form.emergencyContactName
                  ? `${form.emergencyContactName}${form.emergencyContactRelation ? ` (${form.emergencyContactRelation})` : ""}${form.emergencyContactPhone ? ` · ${form.emergencyContactPhone}` : ""}`
                  : "Not provided"}
              </p>
            </div>
            <div className="sm:col-span-2">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Current Address</p>
              <p className="mt-1 text-sm text-foreground">{form.currentAddress || "Not provided"}</p>
            </div>
            <div className="sm:col-span-2">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Permanent Address</p>
              <p className="mt-1 text-sm text-foreground">{form.permanentAddress || "Not provided"}</p>
            </div>
          </div>
          {isExperienced && (
            <div className="space-y-3">
              <h3 className="text-sm font-semibold">Professional Details</h3>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Employer 1</p>
                  <p className="mt-1 text-sm text-foreground">{form.employerName1 || "Not provided"}</p>
                </div>
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Designation 1</p>
                  <p className="mt-1 text-sm text-foreground">{form.designation1 || "Not provided"}</p>
                </div>
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Employment Period 1</p>
                  <p className="mt-1 text-sm text-foreground">{form.employmentPeriod1 || "Not provided"}</p>
                </div>
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Employer 2</p>
                  <p className="mt-1 text-sm text-foreground">{form.employerName2 || "Not provided"}</p>
                </div>
              </div>
            </div>
          )}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold">Uploaded Documents</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              {(Object.entries(docs) as [DocKey, FileUpload][]).map(([key, value]) => (
                <div key={key} className="rounded-xl border border-border bg-muted/10 px-3 py-2 text-sm">
                  <p className="font-medium text-foreground">{value.name}</p>
                  <p className="mt-1 text-muted-foreground">{value.savedName || value.file?.name || "Not provided"}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  const renderFieldError = (field: string) => (
    touched[field] && fieldErrors[field] ? (
      <p className="text-xs flex items-center gap-1 mt-1" style={{ color: "#f87171" }}>
        <AlertCircle className="h-3 w-3" /> {fieldErrors[field]}
      </p>
    ) : null
  );

  const inputClass = (field: string) => cn(
    "h-10 w-full rounded-lg px-3 py-2 text-sm transition-colors focus:outline-none",
    touched[field] && fieldErrors[field]
      ? "border border-red-400/60 bg-red-500/5"
      : "border border-input bg-input/30 focus:border-primary"
  );

  const labelClass = "block mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground";

  const renderDocField = (docKey: DocKey) => {
    const doc = docs[docKey];
    const errorKey = `doc_${docKey}`;
    const hasErr = touched[errorKey] && fieldErrors[errorKey];
    const displayName = doc.file?.name ?? doc.savedName ?? "";
    const hasStoredFile = hasStoredSelectionFile(doc);
    const verifyHint: DocumentVerificationHint = documentVerify[docKey] ?? { status: "idle", message: "" };
    const docOcrStatus =
      docKey === "pan_doc"
        ? panOcrStatus
        : docKey === "aadhaar_doc"
          ? aadhaarOcrStatus
          : docKey === "current_address_proof" || docKey === "permanent_address_proof"
            ? addressOcrStatus[docKey]
            : verifyHint.status;
    const docOcrMessage =
      docKey === "pan_doc"
        ? panOcrMessage
        : docKey === "aadhaar_doc"
          ? aadhaarOcrMessage
          : docKey === "current_address_proof" || docKey === "permanent_address_proof"
            ? addressOcrMessage[docKey]
            : verifyHint.message;
    return (
      <div>
        <label className={labelClass}>
          {doc.name}
          {doc.required && <span className="ml-1 text-destructive">*</span>}
        </label>
        <label
          className={cn(
            "flex h-10 cursor-pointer items-center gap-2 rounded-xl border px-3 text-sm transition-all duration-200",
            hasStoredFile
              ? "border-success/40 bg-success/5 text-success"
              : hasErr
              ? "border-red-400/60 bg-red-500/5 text-muted-foreground"
              : displayName
              ? "border-amber-500/40 bg-amber-500/5 text-amber-400"
              : "border-border bg-input/30 text-muted-foreground hover:border-primary/40"
          )}
        >
          {docOcrStatus === "extracting"
            ? <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
            : hasStoredFile ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <Upload className="h-4 w-4 shrink-0 text-muted-foreground" />}
          <span className="truncate">{docOcrStatus === "extracting" ? "Reading document..." : displayName ? `${displayName}${hasStoredFile ? "" : " - upload again"}` : "Click to upload"}</span>
          {displayName && (
            <button
              type="button"
              onClick={(e) => { e.preventDefault(); handleDocUpload(docKey, null); }}
              className="ml-auto shrink-0 text-muted-foreground hover:text-destructive"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
          <input
            type="file"
            accept={docKey === "passport_size_photo" ? ".jpg,.jpeg,.png,.webp" : ".pdf,.jpg,.jpeg,.png,.webp"}
            className="hidden"
            ref={(el) => { fileInputRefs.current[docKey] = el; }}
            onChange={(e) => handleDocUpload(docKey, e.target.files?.[0] ?? null)}
          />
        </label>
        {hasErr && (
          <p className="text-xs flex items-center gap-1 mt-1" style={{ color: "#f87171" }}>
            <AlertCircle className="h-3 w-3" /> {fieldErrors[errorKey]}
          </p>
        )}
        {docOcrMessage && (
          <p
            className="text-xs flex items-center gap-1 mt-1"
            style={{
              color: docOcrStatus === "passed"
                ? "#86efac"
                : docOcrStatus === "failed"
                  ? "#f87171"
                  : "#fcd34d",
            }}
          >
            {docOcrStatus === "passed" ? <CheckCircle2 className="h-3 w-3" /> : <AlertCircle className="h-3 w-3" />}
            {docOcrMessage}
          </p>
        )}
      </div>
    );
  };

  const currentStep = STEPS[step] ?? STEPS[0];

  return (
    <div className="mx-auto max-w-5xl space-y-6 overflow-x-hidden animate-fade-in">
      <PageHeader
        icon={ClipboardCheck}
        title="Selection Form"
        description="Complete the mandatory details and upload each supporting document."
      />

      <div className="rounded-xl border-0 bg-card p-5 shadow-sm">
        <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
          <div className="min-w-0">
            <h2 className="text-base font-semibold">{currentStep.label}</h2>
            <p className="text-sm text-muted-foreground">
              Step {step + 1} of {STEPS.length}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <span className="rounded-full border border-border px-3 py-1 text-xs font-medium text-muted-foreground">
              Draft
            </span>
            {user?.name && (
              <span className="max-w-[220px] truncate text-xs text-muted-foreground">
                {user.name}
              </span>
            )}
          </div>
        </div>

        <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-7">
          {STEPS.map((s, i) => {
          const skip = shouldSkipStep(i);
          const Icon = s.icon;
          return (
            <button
              key={s.key}
              type="button"
              onClick={() => handleStepSelect(i)}
              className={cn(
                "flex h-10 min-w-0 items-center gap-2 rounded-lg border px-3 text-left text-xs font-medium transition-colors",
                i === step
                  ? "border-primary bg-primary/10 text-primary"
                  : i < step
                    ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-300"
                    : "border-border bg-muted/20 text-muted-foreground hover:bg-muted/40",
                skip && "cursor-not-allowed opacity-45 hover:bg-muted/20",
              )}
              disabled={skip}
            >
              {i < step ? (
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
              ) : (
                <Icon className="h-3.5 w-3.5 shrink-0" />
              )}
              <span className="truncate">{s.label}</span>
            </button>
          );
        })}
        </div>
      </div>

      <div className="rounded-xl border-0 bg-card p-6 shadow-sm space-y-5">

        {step === 0 && (
          <>
            <h2 className="text-sm font-semibold">Employment</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className={labelClass}>Full Name *</label>
                <input className={inputClass("fullName")} value={form.fullName} onChange={(e) => updateField("fullName", e.target.value)} onBlur={() => touchField("fullName", form.fullName)} placeholder="As per official documents" />
                {renderFieldError("fullName")}
              </div>
              <div>
                <label className={labelClass}>Email ID *</label>
                <input type="email" className={inputClass("email")} value={form.email} onChange={(e) => updateField("email", e.target.value)} onBlur={() => touchField("email", form.email)} placeholder="personal@example.com" />
                {renderFieldError("email")}
              </div>
              <div>
                <label className={labelClass}>Contact Number *</label>
                <input
                  type="tel"
                  inputMode="numeric"
                  maxLength={10}
                  className={inputClass("contactNumber")}
                  value={form.contactNumber}
                  onChange={(e) => updateField("contactNumber", e.target.value.replace(/\D/g, "").slice(0, 10))}
                  onBlur={() => touchField("contactNumber", form.contactNumber)}
                  placeholder="9876543210"
                />
                {renderFieldError("contactNumber")}
              </div>
              <div>
                <label className={labelClass}>Date of Birth *</label>
                <DatePicker
                  className={inputClass("dateOfBirth")}
                  value={form.dateOfBirth}
                  onChange={(v) => updateField("dateOfBirth", v)}
                  onBlur={() => touchField("dateOfBirth", form.dateOfBirth)}
                />
                {renderFieldError("dateOfBirth")}
              </div>
              <div>
                <label className={labelClass}>Experience Type *</label>
                <Select value={form.experienceType} onValueChange={(v) => updateField("experienceType", v ?? "")}>
                  <SelectTrigger className={inputClass("experienceType")}>
                    <SelectValue placeholder="Select experience type">
                      {(v) => ({ fresher: "Fresher", experienced: "Experienced" } as Record<string, string>)[v as string] ?? "Select experience type"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="fresher">Fresher</SelectItem>
                    <SelectItem value="experienced">Experienced</SelectItem>
                  </SelectContent>
                </Select>
                {renderFieldError("experienceType")}
              </div>
              <div>
                <label className={labelClass}>Highest Qualification *</label>
                <input className={inputClass("qualification")} value={form.qualification} onChange={(e) => updateField("qualification", e.target.value)} onBlur={() => touchField("qualification", form.qualification)} placeholder="e.g. B.Tech, MBA" />
                {renderFieldError("qualification")}
              </div>
            </div>
            {!isExperienced && (
              <div className="rounded-xl border border-info/25 bg-info/5 px-4 py-3 text-sm text-info flex items-start gap-2">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                Professional references and employment details are not required for Fresher candidates.
              </div>
            )}
          </>
        )}

        {step === 1 && (
          <>
            <h2 className="text-sm font-semibold">Education</h2>
            <p className="text-sm text-muted-foreground">Upload clear, legible copies. PDF or image, max 10 MB each.</p>
            <h3 className="text-sm font-semibold">Photograph</h3>
            <p className="text-xs text-muted-foreground">Recent passport-size photograph with a plain background. Image only (JPG, PNG, or WEBP).</p>
            <div className="grid gap-4 sm:grid-cols-2">
              {renderDocField("passport_size_photo")}
            </div>
            <div className="h-px bg-border" />
            <div className="grid gap-4 sm:grid-cols-2">
              {renderDocField("marksheet_10th")}
              {renderDocField("marksheet_12th")}
              {renderDocField("graduation")}
              {renderDocField("post_graduation")}
              {renderDocField("certifications")}
            </div>
            {isExperienced && (
              <>
                <div className="h-px bg-border" />
                <h3 className="text-sm font-semibold">Employment Documents</h3>
                <div className="grid gap-4 sm:grid-cols-2">
                  {renderDocField("experience_letter_1")}
                  {renderDocField("experience_letter_2")}
                  {renderDocField("relieving_letter")}
                  {renderDocField("payslips")}
                </div>
              </>
            )}
            <div className="h-px bg-border" />
            <h3 className="text-sm font-semibold">Identity Documents</h3>
            <div className="grid gap-4 sm:grid-cols-2">
              {renderDocField("aadhaar_doc")}
              {renderDocField("pan_doc")}
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <h2 className="text-sm font-semibold">Professional</h2>
            {!isExperienced ? (
              <div className="rounded-xl border border-muted bg-muted/20 px-4 py-8 text-center text-sm text-muted-foreground">
                <Lock className="h-8 w-8 mx-auto mb-3 opacity-30" />
                Professional details are only required for Experienced candidates.
                Your experience type is set to <strong>Fresher</strong>.
              </div>
            ) : (
              <>
                <div>
                  <p className="text-sm font-medium mb-3">Employer 1 (Most Recent) *</p>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <label className={labelClass}>Employer Name *</label>
                      <input className={inputClass("employerName1")} value={form.employerName1} onChange={(e) => updateField("employerName1", e.target.value)} onBlur={() => touchField("employerName1", form.employerName1)} placeholder="Company name" />
                      {renderFieldError("employerName1")}
                    </div>
                    <div>
                      <label className={labelClass}>Designation *</label>
                      <input className={inputClass("designation1")} value={form.designation1} onChange={(e) => updateField("designation1", e.target.value)} onBlur={() => touchField("designation1", form.designation1)} placeholder="e.g. Software Engineer" />
                      {renderFieldError("designation1")}
                    </div>
                    <div>
                      <label className={labelClass}>Employment Period *</label>
                      <input className={inputClass("employmentPeriod1")} value={form.employmentPeriod1} onChange={(e) => updateField("employmentPeriod1", e.target.value)} onBlur={() => touchField("employmentPeriod1", form.employmentPeriod1)} placeholder="e.g. Jan 2021 – Mar 2024" />
                      {renderFieldError("employmentPeriod1")}
                    </div>
                  </div>
                </div>
                <div className="h-px bg-border" />
                <div>
                  <p className="text-sm font-medium mb-3">Employer 2 (Previous)</p>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <label className={labelClass}>Employer Name</label>
                      <input className={inputClass("employerName2")} value={form.employerName2} onChange={(e) => updateField("employerName2", e.target.value)} placeholder="Company name (optional)" />
                    </div>
                    <div>
                      <label className={labelClass}>Designation</label>
                      <input className={inputClass("designation2")} value={form.designation2} onChange={(e) => updateField("designation2", e.target.value)} placeholder="Role (optional)" />
                    </div>
                    <div>
                      <label className={labelClass}>Employment Period</label>
                      <input className={inputClass("employmentPeriod2")} value={form.employmentPeriod2} onChange={(e) => updateField("employmentPeriod2", e.target.value)} placeholder="e.g. Jun 2018 – Dec 2020" />
                    </div>
                  </div>
                </div>
              </>
            )}
          </>
        )}

        {step === 3 && (
          <>
            <h2 className="text-sm font-semibold">Family</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className={labelClass}>Father&apos;s Name *</label>
                <input className={inputClass("fatherName")} value={form.fatherName} onChange={(e) => updateField("fatherName", e.target.value)} onBlur={() => touchField("fatherName", form.fatherName)} placeholder="Father's full name" />
                {renderFieldError("fatherName")}
              </div>
              <div>
                <label className={labelClass}>Mother&apos;s Name *</label>
                <input className={inputClass("motherName")} value={form.motherName} onChange={(e) => updateField("motherName", e.target.value)} onBlur={() => touchField("motherName", form.motherName)} placeholder="Mother's full name" />
                {renderFieldError("motherName")}
              </div>
              <div>
                <label className={labelClass}>Gender *</label>
                <Select value={form.gender} onValueChange={(v) => updateField("gender", v ?? "")}>
                  <SelectTrigger className={inputClass("gender")}>
                    <SelectValue placeholder="Select gender">
                      {(v) => resolveEmployeeGenderLabel(v as string) || "Select gender"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="male">Male</SelectItem>
                    <SelectItem value="female">Female</SelectItem>
                    <SelectItem value="non_binary">Non-binary</SelectItem>
                    <SelectItem value="prefer_not_to_say">Prefer not to say</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className={labelClass}>Marital Status *</label>
                <Select value={form.maritalStatus} onValueChange={(v) => updateField("maritalStatus", v ?? "")}>
                  <SelectTrigger className={inputClass("maritalStatus")}>
                    <SelectValue placeholder="Select marital status">
                      {(v) => ({ unmarried: "Unmarried", married: "Married" } as Record<string, string>)[v as string] ?? "Select marital status"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="unmarried">Unmarried</SelectItem>
                    <SelectItem value="married">Married</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {isMarried && (
                <>
                  <div>
                    <label className={labelClass}>Spouse Name *</label>
                    <input className={inputClass("spouseName")} value={form.spouseName} onChange={(e) => updateField("spouseName", e.target.value)} onBlur={() => touchField("spouseName", form.spouseName)} placeholder="Spouse's full name" />
                    {renderFieldError("spouseName")}
                  </div>
                  <div>
                    <label className={labelClass}>Spouse Occupation</label>
                    <input className={inputClass("spouseOccupation")} value={form.spouseOccupation} onChange={(e) => updateField("spouseOccupation", e.target.value)} placeholder="e.g. Software Engineer" />
                  </div>
                  <div>
                    <label className={labelClass}>Anniversary Date *</label>
                    <DatePicker className={inputClass("anniversaryDate")} value={form.anniversaryDate} onChange={(v) => updateField("anniversaryDate", v)} onBlur={() => touchField("anniversaryDate", form.anniversaryDate)} />
                    {renderFieldError("anniversaryDate")}
                  </div>
                  <div>
                    <label className={labelClass}>Number of Kids</label>
                    <input type="number" min="0" max="10" className={inputClass("kidsCount")} value={form.kidsCount} onChange={(e) => updateField("kidsCount", e.target.value)} placeholder="0" />
                  </div>
                </>
              )}
              <div>
                <label className={labelClass}>Aadhaar Number *</label>
                <input
                  className={inputClass("aadhaarNumber")}
                  value={form.aadhaarNumber}
                  onChange={(e) => updateField("aadhaarNumber", e.target.value.replace(/\D/g, "").slice(0, 12))}
                  onBlur={() => touchField("aadhaarNumber", form.aadhaarNumber)}
                  placeholder="12-digit Aadhaar number"
                  maxLength={12}
                />
                {renderFieldError("aadhaarNumber")}
              </div>
              <div>
                <label className={labelClass}>PAN Number *</label>
                <input className={inputClass("pan")} value={form.pan} onChange={(e) => updateField("pan", e.target.value.toUpperCase())} onBlur={() => touchField("pan", form.pan)} placeholder="ABCDE1234F" maxLength={10} />
                {renderFieldError("pan")}
              </div>
              <div>
                <label className={labelClass}>Do you have UAN number? *</label>
                <Select value={hasUanNumber} onValueChange={(v) => updateField("hasUanNumber", v ?? "")}>
                  <SelectTrigger className={inputClass("hasUanNumber")}>
                    <SelectValue placeholder="Select yes or no" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="yes">Yes</SelectItem>
                    <SelectItem value="no">No</SelectItem>
                  </SelectContent>
                </Select>
                {renderFieldError("hasUanNumber")}
              </div>
              {hasUanNumber === "yes" ? (
                <div>
                  <label className={labelClass}>UAN Number *</label>
                  <input
                    className={inputClass("uanNumber")}
                    value={form.uanNumber}
                    onChange={(e) => updateField("uanNumber", e.target.value.replace(/\D/g, "").slice(0, 12))}
                    onBlur={() => touchField("uanNumber", form.uanNumber)}
                    placeholder="12-digit UAN starting with 10"
                    maxLength={12}
                  />
                  {renderFieldError("uanNumber")}
                </div>
              ) : hasUanNumber === "no" ? (
                <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-200">
                  Apply for your UAN number and provide it as soon as possible. You can continue this form now.
                </div>
              ) : null}
              <div className="sm:col-span-2">
                <label className={labelClass}>Languages Known</label>
                <input className={inputClass("languagesKnown")} value={form.languagesKnown} onChange={(e) => updateField("languagesKnown", e.target.value)} placeholder="e.g. English, Hindi, Tamil" />
              </div>
              <div>
                <label className={labelClass}>Emergency Contact Name *</label>
                <input
                  className={inputClass("emergencyContactName")}
                  value={form.emergencyContactName}
                  onChange={(e) => updateField("emergencyContactName", e.target.value)}
                  onBlur={() => touchField("emergencyContactName", form.emergencyContactName)}
                  placeholder="Full name"
                />
                {renderFieldError("emergencyContactName")}
              </div>
              <div>
                <label className={labelClass}>Emergency Contact Phone *</label>
                <input
                  type="tel"
                  inputMode="numeric"
                  maxLength={10}
                  className={inputClass("emergencyContactPhone")}
                  value={form.emergencyContactPhone}
                  onChange={(e) => updateField("emergencyContactPhone", e.target.value.replace(/\D/g, "").slice(0, 10))}
                  onBlur={() => touchField("emergencyContactPhone", form.emergencyContactPhone)}
                  placeholder="9876543210"
                />
                {renderFieldError("emergencyContactPhone")}
              </div>
              <div>
                <label className={labelClass}>Emergency Contact Relation *</label>
                <input
                  className={inputClass("emergencyContactRelation")}
                  value={form.emergencyContactRelation}
                  onChange={(e) => updateField("emergencyContactRelation", e.target.value)}
                  onBlur={() => touchField("emergencyContactRelation", form.emergencyContactRelation)}
                  placeholder="e.g. Parent, Spouse"
                />
                {renderFieldError("emergencyContactRelation")}
              </div>
            </div>
          </>
        )}

        {step === 4 && (
          <>
            <h2 className="text-sm font-semibold">References</h2>
            {!isExperienced ? (
              <div className="rounded-xl border border-muted bg-muted/20 px-4 py-8 text-center text-sm text-muted-foreground">
                <Lock className="h-8 w-8 mx-auto mb-3 opacity-30" />
                Professional references are not required for Fresher candidates.
              </div>
            ) : (
              <div className="space-y-6">
                <p className="text-sm text-muted-foreground">Provide 2 professional references who can vouch for your work experience.</p>
                {references.map((ref, idx) => (
                  <div key={idx} className="rounded-xl border border-border p-4 space-y-4">
                    <p className="text-sm font-medium">Reference {idx + 1}</p>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div>
                        <label className={labelClass}>Full Name *</label>
                        <input className={inputClass(`ref_${idx}_name`)} value={ref.name} onChange={(e) => updateReference(idx, "name", e.target.value)} placeholder="Reference's full name" />
                        {touched[`ref_${idx}_name`] && fieldErrors[`ref_${idx}_name`] && (
                          <p className="text-xs mt-1" style={{ color: "#f87171" }}>{fieldErrors[`ref_${idx}_name`]}</p>
                        )}
                      </div>
                      <div>
                        <label className={labelClass}>Email ID *</label>
                        <input type="email" className={inputClass(`ref_${idx}_email`)} value={ref.email} onChange={(e) => updateReference(idx, "email", e.target.value)} placeholder="reference@company.com" />
                        {touched[`ref_${idx}_email`] && fieldErrors[`ref_${idx}_email`] && (
                          <p className="text-xs mt-1" style={{ color: "#f87171" }}>{fieldErrors[`ref_${idx}_email`]}</p>
                        )}
                      </div>
                      <div>
                        <label className={labelClass}>Phone Number *</label>
                        <input
                          type="tel"
                          inputMode="numeric"
                          pattern="[0-9]{10}"
                          maxLength={10}
                          className={inputClass(`ref_${idx}_phone`)}
                          value={ref.phone}
                          onChange={(e) => updateReference(idx, "phone", e.target.value)}
                          placeholder="9876543210"
                        />
                        {touched[`ref_${idx}_phone`] && fieldErrors[`ref_${idx}_phone`] && (
                          <p className="text-xs mt-1" style={{ color: "#f87171" }}>{fieldErrors[`ref_${idx}_phone`]}</p>
                        )}
                      </div>
                      <div>
                        <label className={labelClass}>LinkedIn Profile</label>
                        <input className={inputClass(`ref_${idx}_linkedin`)} value={ref.linkedin} onChange={(e) => updateReference(idx, "linkedin", e.target.value)} placeholder="linkedin.com/in/..." />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {step === 5 && (
          <>
            <h2 className="text-sm font-semibold">Bank</h2>
            <p className="text-sm text-muted-foreground">
              This section is optional — you can submit the form without bank details and share them with HR later.
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className={labelClass}>Do you have a savings account?</label>
                <Select value={hasSavingsAccount} onValueChange={(v) => updateField("hasSavingsAccount", v ?? "")}>
                  <SelectTrigger className={inputClass("hasSavingsAccount")}>
                    <SelectValue placeholder="Select yes or no" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="yes">Yes</SelectItem>
                    <SelectItem value="no">No</SelectItem>
                  </SelectContent>
                </Select>
                {renderFieldError("hasSavingsAccount")}
              </div>

              {hasSavingsAccount === "yes" && (
                <div>
                  <label className={labelClass}>Do you have a salary account?</label>
                  <Select value={hasSalaryAccount} onValueChange={(v) => updateField("hasSalaryAccount", v ?? "")}>
                    <SelectTrigger className={inputClass("hasSalaryAccount")}>
                      <SelectValue placeholder="Select yes or no" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="yes">Yes</SelectItem>
                      <SelectItem value="no">No</SelectItem>
                    </SelectContent>
                  </Select>
                  {renderFieldError("hasSalaryAccount")}
                </div>
              )}
            </div>

            {hasSavingsAccount === "no" && (
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-200">
                Open an HDFC salary account. You can continue this form now, but until the salary account is opened you are not eligible for Salary Eligibility Validation.
              </div>
            )}

            {hasSavingsAccount === "yes" && hasSalaryAccount === "no" && (
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-200">
                Change your savings account to an HDFC salary account. You can continue this form now, but until the salary account is converted you are not eligible for Salary Eligibility Validation.
              </div>
            )}

            {hasHdfcSalaryAccount && (
              <>
                <p className="text-sm text-muted-foreground">Upload your cancelled cheque. We will extract and fill the details automatically.</p>

                <div>
                  <label className={labelClass}>
                    Cancelled Cheque
                    <span className="ml-1 text-xs font-normal text-muted-foreground">(optional)</span>
                  </label>
                  <label
                    className={cn(
                      "flex h-10 cursor-pointer items-center gap-2 rounded-xl border px-3 text-sm transition-all duration-200",
                      chequeOcrStatus === "passed"
                        ? "border-green-500/40 bg-green-500/5 text-green-400"
                        : chequeOcrStatus === "partial" || chequeOcrStatus === "needs_review"
                        ? "border-amber-500/40 bg-amber-500/5 text-amber-400"
                        : chequeOcrStatus === "failed"
                        ? "border-red-400/60 bg-red-500/5 text-red-400"
                        : touched["doc_cancelled_cheque"] && fieldErrors["doc_cancelled_cheque"]
                        ? "border-red-400/60 bg-red-500/5 text-muted-foreground"
                        : "border-border bg-input/30 text-muted-foreground hover:border-primary/40"
                    )}
                  >
                    {chequeOcrStatus === "extracting"
                      ? <Loader2 className="h-4 w-4 animate-spin shrink-0" />
                      : chequeOcrStatus === "passed"
                      ? <CheckCircle2 className="h-4 w-4 shrink-0" />
                      : chequeOcrStatus === "partial" || chequeOcrStatus === "needs_review"
                      ? <AlertCircle className="h-4 w-4 shrink-0" />
                      : docs.cancelled_cheque.file || docs.cancelled_cheque.savedName
                      ? <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />
                      : <Upload className="h-4 w-4 shrink-0" />}
                    <span className="truncate flex-1">
                      {chequeOcrStatus === "extracting"
                        ? "Reading cheque details..."
                        : docs.cancelled_cheque.file?.name || docs.cancelled_cheque.savedName || "Click to upload"}
                    </span>
                    {(docs.cancelled_cheque.file || docs.cancelled_cheque.savedName) && chequeOcrStatus !== "extracting" && (
                      <button
                        type="button"
                        onClick={(e) => { e.preventDefault(); handleChequeUpload(null); }}
                        className="ml-auto shrink-0 text-muted-foreground hover:text-destructive"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                    <input
                      type="file"
                      accept=".pdf,.jpg,.jpeg,.png,.webp"
                      className="hidden"
                      ref={(el) => { fileInputRefs.current.cancelled_cheque = el; }}
                      onChange={(e) => void handleChequeUpload(e.target.files?.[0] ?? null)}
                    />
                  </label>
                  {touched["doc_cancelled_cheque"] && fieldErrors["doc_cancelled_cheque"] && chequeOcrStatus === "idle" && (
                    <p className="text-xs flex items-center gap-1 mt-1" style={{ color: "#f87171" }}>
                      <AlertCircle className="h-3 w-3" /> {fieldErrors["doc_cancelled_cheque"]}
                    </p>
                  )}
                </div>

                {chequeExtracted && (chequeOcrStatus === "passed" || chequeOcrStatus === "partial") && (
                  <div className="rounded-xl p-4 space-y-3" style={{ background: "rgba(144,141,206,0.07)", border: "1px solid rgba(144,141,206,0.18)" }}>
                    <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "rgba(237,0,237,0.75)" }}>
                      {chequeOcrStatus === "passed" ? "Extracted from cheque - fields auto-filled below" : "Partially extracted - complete missing fields below"}
                    </p>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      {[
                        { label: "Account Number", value: chequeExtracted.accountNumber },
                        { label: "IFSC Code", value: chequeExtracted.ifscCode },
                        { label: "Account Holder", value: chequeExtracted.accountHolderName },
                        { label: "Bank Name", value: chequeExtracted.bankName },
                      ].map(({ label, value }) => (
                        <div key={label} className="rounded-lg p-3" style={{ background: "rgba(144,141,206,0.08)", border: "1px solid rgba(144,141,206,0.15)" }}>
                          <p className="text-xs mb-1" style={{ color: "rgba(197,203,232,0.50)" }}>{label}</p>
                          {value ? (
                            <div className="flex items-center gap-1.5">
                              <p className="font-mono text-xs font-semibold truncate" style={{ color: "#C5CBE8" }}>{value}</p>
                              <span className="inline-flex items-center justify-center h-4 w-4 rounded-full shrink-0" style={{ background: "rgba(34,197,94,0.15)" }}><Check className="h-2.5 w-2.5" style={{ color: "#86efac" }} /></span>
                            </div>
                          ) : (
                            <p className="text-xs" style={{ color: "rgba(252,211,77,0.80)" }}>Enter below</p>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {chequeOcrStatus !== "idle" && chequeOcrStatus !== "extracting" && (
                  <div
                    className="flex items-start gap-2 rounded-xl p-3 text-sm"
                    style={
                      chequeOcrStatus === "passed"
                        ? { background: "rgba(34,197,94,0.08)", border: "1px solid rgba(34,197,94,0.22)", color: "rgba(134,239,172,0.90)" }
                        : chequeOcrStatus === "partial" || chequeOcrStatus === "needs_review"
                        ? { background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.22)", color: "rgba(252,211,77,0.90)" }
                        : { background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.22)", color: "rgba(252,165,165,0.90)" }
                    }
                  >
                    {chequeOcrStatus === "passed"
                      ? <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" style={{ color: "#22c55e" }} />
                      : <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" style={{ color: chequeOcrStatus === "failed" ? "#ef4444" : "#f59e0b" }} />}
                    <span>{chequeOcrMessage}</span>
                  </div>
                )}

                <div className="h-px bg-border" />

                <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className={labelClass}>Bank Name</label>
                <input className={inputClass("bankName")} value={form.bankName} onChange={(e) => updateField("bankName", e.target.value)} onBlur={() => touchField("bankName", form.bankName)} placeholder="e.g. HDFC Bank" />
                {renderFieldError("bankName")}
              </div>
              <div>
                <label className={labelClass}>
                  Account Holder Name
                  {chequeOcrStatus === "passed" && chequeExtracted?.accountHolderName && (
                    <span className="ml-2 text-xs font-normal" style={{ color: "#86efac" }}>(auto-filled)</span>
                  )}
                </label>
                <input className={inputClass("accountHolderName")} value={form.accountHolderName} onChange={(e) => updateField("accountHolderName", e.target.value)} onBlur={() => touchField("accountHolderName", form.accountHolderName)} placeholder="As per bank records" />
                {renderFieldError("accountHolderName")}
              </div>
              <div>
                <label className={labelClass}>
                  Account Number
                  {(chequeOcrStatus === "passed" || chequeOcrStatus === "partial") && chequeExtracted?.accountNumber && (
                    <span className="ml-2 text-xs font-normal" style={{ color: "#86efac" }}>(auto-filled)</span>
                  )}
                </label>
                <input className={inputClass("accountNumber")} value={form.accountNumber} onChange={(e) => updateField("accountNumber", e.target.value.replace(/\D/g, ""))} onBlur={() => touchField("accountNumber", form.accountNumber)} placeholder="9-18 digit account number" maxLength={18} />
                {renderFieldError("accountNumber")}
              </div>
              <div>
                <label className={labelClass}>
                  IFSC Code
                  {(chequeOcrStatus === "passed" || chequeOcrStatus === "partial") && chequeExtracted?.ifscCode && (
                    <span className="ml-2 text-xs font-normal" style={{ color: "#86efac" }}>(auto-filled)</span>
                  )}
                </label>
                <input className={inputClass("ifsc")} value={form.ifsc} onChange={(e) => updateField("ifsc", e.target.value.toUpperCase())} onBlur={() => touchField("ifsc", form.ifsc)} placeholder="e.g. HDFC0001234" maxLength={11} />
                {renderFieldError("ifsc")}
              </div>
                </div>
              </>
            )}
          </>
        )}

        {step === 6 && (
          <>
            <h2 className="text-sm font-semibold">Address</h2>
            <p className="text-sm text-muted-foreground">
              Upload address proofs to auto-fill the address where possible, then review the details before submitting.
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              {renderDocField("current_address_proof")}
              {renderDocField("permanent_address_proof")}
            </div>
            <div className="h-px bg-border" />
            <div className="grid gap-4">
              <div>
                <label className={labelClass}>Current Address *</label>
                <textarea
                  className={cn(inputClass("currentAddress"), "h-auto min-h-24 py-2")}
                  value={form.currentAddress}
                  onChange={(e) => updateField("currentAddress", e.target.value)}
                  onBlur={() => touchField("currentAddress", form.currentAddress)}
                  placeholder="House number, street, area, city, state, PIN code"
                />
                {renderFieldError("currentAddress")}
              </div>
              <div>
                <label className={labelClass}>Permanent Address *</label>
                <textarea
                  className={cn(inputClass("permanentAddress"), "h-auto min-h-24 py-2")}
                  value={form.permanentAddress}
                  onChange={(e) => updateField("permanentAddress", e.target.value)}
                  onBlur={() => touchField("permanentAddress", form.permanentAddress)}
                  placeholder="House number, street, area, city, state, PIN code"
                />
                {renderFieldError("permanentAddress")}
              </div>
            </div>
          </>
        )}
      </div>

      {submitError && (
        <div
          className={cn(
            "rounded-xl border px-4 py-3 flex items-start gap-2 text-sm",
            submitMessageType === "info"
              ? "border-primary/30 bg-primary/5 text-foreground"
              : "border-destructive/30 bg-destructive/5 text-destructive",
          )}
        >
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
          {submitError}
        </div>
      )}

      <div className="flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-muted-foreground">
          HR and Admin will review the latest submitted selection form.
        </p>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
        <button
          type="button"
          onClick={handleBack}
          disabled={step === 0}
          className="h-10 rounded-full border border-border px-5 text-sm font-medium text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
        >
          Previous
        </button>
        {step < STEPS.length - 1 ? (
          <button
            type="button"
            onClick={handleNext}
            className="h-10 rounded-full bg-primary px-6 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Next
          </button>
        ) : (
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isSubmitting}
            className="h-10 rounded-full bg-primary px-6 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
          >
            {isSubmitting ? (
              <span className="flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Queuing checks...</span>
            ) : "Submit Selection Form"}
          </button>
        )}
        </div>
      </div>
    </div>
  );
}

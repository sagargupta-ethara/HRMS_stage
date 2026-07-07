type ApiErrorDetail = string | Array<{ msg?: string }> | undefined;

function cleanValidationMessage(message: string): string {
  return message.replace(/^Value error,\s*/i, "").trim();
}

export function apiErrorMessage(error: unknown, fallback: string): string {
  const detail = (error as { response?: { data?: { detail?: ApiErrorDetail } } })?.response
    ?.data?.detail;
  if (typeof detail === "string" && detail.trim()) {
    return detail;
  }
  if (Array.isArray(detail)) {
    const messages = detail
      .map((item) => (typeof item?.msg === "string" ? cleanValidationMessage(item.msg) : ""))
      .filter(Boolean);
    if (messages.length > 0) return messages.join(" ");
  }
  return fallback;
}

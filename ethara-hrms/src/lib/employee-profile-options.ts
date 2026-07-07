export const EMPLOYEE_DEPARTMENT_OPTIONS = [
  "Accounts & Admin",
  "Communications and Partnerships",
  "Engineering",
  "Growth",
  "Human Resources",
  "IT",
  "Operations - Technical",
  "Operations - Generalist",
  "R&D",
] as const;

export const EMPLOYEE_DESIGNATION_OPTIONS = [
  "AI Research Engineer",
  "AI Researcher",
  "Assistant Manager - IT",
  "Communications & Partnerships Lead",
  "CTO",
  "DevOps",
  "F&A Executive",
  "Frontend Engineer",
  "Graphic Designer",
  "Graphic/UI UX",
  "Growth Associate",
  "Head of Operations",
  "Head-Recruitment",
  "HR Consultant",
  "HR Executive",
  "HR Manager",
  "HR Ops - Lead",
  "HR Ops - Specialist",
  "IT Head",
  "Jr. Flutter Developer",
  "LLM Post Training- Intern",
  "Manager-HR",
  "Odoo Developer",
  "Project Lead",
  "Project Manager",
  "QA Tester",
  "Quality Lead",
  "Quality Reviewer",
  "Research Lead",
  "Senior Executive",
  "Senior Growth Analyst",
  "Senior Manager-Growth",
  "Software Engineer",
  "Sr Growth Lead",
  "Sr. Exe-Communications and Partnerships",
  "System Admin",
  "System and Network Support Engineer",
  "System IT Admin",
  "TA Lead",
  "TA Specialist",
  "Technical Recruiter",
  "TPM",
] as const;

export const EMPLOYEE_GENDER_OPTIONS = [
  { value: "male", label: "Male" },
  { value: "female", label: "Female" },
  { value: "non_binary", label: "Non-binary" },
  { value: "prefer_not_to_say", label: "Prefer not to say" },
] as const;

export function normalizeEmployeeDepartmentOption(value: string | null | undefined): string {
  if ((value ?? "").trim() === "Operations") return "Operations - Generalist";
  return value ?? "";
}

export function formatDropdownOptionLabel(label: string): string {
  const trimmed = label.trim().replace(/_/g, " ");
  if (!trimmed) return trimmed;
  return trimmed
    .split(" ")
    .map((word) => {
      if (!word) return word;
      if (word === word.toUpperCase() && /[A-Z&]+/.test(word)) return word;
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(" ");
}

/**
 * Trigger-label resolver for department/designation selects.
 *
 * Base UI's `Select.Value` renders the raw stored value in the trigger unless a
 * render function is supplied. Departments/designations are stored as free text
 * (a user may add "temp" in lowercase), while the option list is displayed via
 * `formatDropdownOptionLabel`. Passing this to `<SelectValue>` keeps the closed
 * trigger label identical to the open menu item (e.g. "temp" -> "Temp").
 */
export function resolveEmployeeReferenceLabel(value: string | null | undefined): string {
  return value ? formatDropdownOptionLabel(value) : "";
}

/** Trigger-label resolver for gender selects (maps the stored code to its label). */
export function resolveEmployeeGenderLabel(value: string | null | undefined): string {
  const option = EMPLOYEE_GENDER_OPTIONS.find((item) => item.value === value);
  return option ? option.label : "";
}

export function mergeEmployeeReferenceOptions(
  dynamicOptions: string[] | null | undefined,
  fallbackOptions: readonly string[],
): string[] {
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const raw of [...(dynamicOptions ?? []), ...fallbackOptions]) {
    const value = raw.trim();
    if (!value) continue;
    const key = value.toLowerCase();
    if (key === "others") continue;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(value);
  }
  return merged;
}

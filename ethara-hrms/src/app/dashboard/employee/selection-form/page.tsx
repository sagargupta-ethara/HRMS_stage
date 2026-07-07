"use client";

/* eslint-disable @next/next/no-img-element */

import { startTransition, useCallback, useEffect, useMemo, useRef, useState, type ElementType } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  Building2,
  CheckCircle2,
  ClipboardCheck,
  Download,
  Eye,
  FileText,
  GraduationCap,
  Landmark,
  Loader2,
  MapPin,
  Pencil,
  ShieldCheck,
  Trash2,
  Upload,
  UserRound,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DatePicker } from "@/components/ui/date-picker";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ImageCropDialog } from "@/components/ui/image-crop-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { employeesApi, type EmployeeDocumentRecord } from "@/lib/api";
import {
  EMPLOYEE_DEPARTMENT_OPTIONS,
  EMPLOYEE_DESIGNATION_OPTIONS,
  EMPLOYEE_GENDER_OPTIONS,
  formatDropdownOptionLabel,
  mergeEmployeeReferenceOptions,
  normalizeEmployeeDepartmentOption,
} from "@/lib/employee-profile-options";
import { useEmployeeDashboard } from "@/lib/queries";
import { cn, formatLabel, timeAgo } from "@/lib/utils";

type FormState = Record<string, string>;
type StepValue = "employment" | "family" | "education" | "identity" | "bank" | "address";
type EmployeeDashboard = NonNullable<ReturnType<typeof useEmployeeDashboard>["data"]>;
type PanOcrState = {
  loading: boolean;
  status?: string;
  message?: string;
  panNumber?: string | null;
};
type AadhaarOcrState = {
  loading: boolean;
  status?: string;
  message?: string;
  aadhaarNumber?: string | null;
};
type ChequeOcrState = {
  loading: boolean;
  status?: string;
  message?: string;
  accountNumber?: string | null;
  ifscCode?: string | null;
  accountHolderName?: string | null;
  bankName?: string | null;
};
type AddressOcrState = {
  loading: boolean;
  status?: string;
  message?: string;
  address?: string | null;
  postalCode?: string | null;
};
type DocumentRequirement = {
  type: string;
  label: string;
  step: StepValue;
  accept: string;
  required?: boolean;
  imageOnly?: boolean;
  helper?: string;
};
type PreviewState = {
  title: string;
  url: string;
  mimeType?: string | null;
};

const STEPS: Array<{ value: StepValue; label: string; icon: ElementType }> = [
  { value: "employment", label: "Employment", icon: Building2 },
  { value: "family", label: "Family", icon: UserRound },
  { value: "education", label: "Education", icon: GraduationCap },
  { value: "identity", label: "Identity", icon: ShieldCheck },
  { value: "bank", label: "Bank", icon: Landmark },
  { value: "address", label: "Address", icon: MapPin },
];

const DOCUMENT_REQUIREMENTS: DocumentRequirement[] = [
  {
    type: "resume",
    label: "Resume",
    step: "employment",
    accept: ".pdf,.doc,.docx",
    helper: "PDF, DOC, or DOCX",
  },
  {
    type: "photo",
    label: "Passport Size Photo",
    step: "employment",
    accept: ".jpg,.jpeg,.png,.webp",
    imageOnly: true,
    helper: "JPG, PNG, or WEBP",
  },
  {
    type: "education_10th",
    label: "10th Marksheet / Certificate",
    step: "education",
    accept: ".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx",
  },
  {
    type: "education_12th",
    label: "12th / Diploma Marksheet / Certificate",
    step: "education",
    accept: ".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx",
  },
  {
    type: "highest_qualification",
    label: "Highest Qualification Certificate",
    step: "education",
    accept: ".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx",
  },
  {
    type: "aadhaar",
    label: "Aadhaar Card Upload",
    step: "identity",
    accept: ".pdf,.jpg,.jpeg,.png,.webp",
  },
  {
    type: "pan",
    label: "PAN Card Upload",
    step: "identity",
    accept: ".pdf,.jpg,.jpeg,.png,.webp",
  },
  {
    type: "cancelled_cheque",
    label: "Cancelled Cheque / Passbook Photo",
    step: "bank",
    accept: ".pdf,.jpg,.jpeg,.png,.webp",
  },
  {
    type: "permanent_address_proof",
    label: "Permanent Address Proof",
    step: "address",
    accept: ".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx",
    helper: "Please upload the back side of Aadhaar Card for address extraction through OCR.",
  },
  {
    type: "current_address_proof",
    label: "Current Address Proof",
    step: "address",
    accept: ".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx",
    required: false,
    helper: "Optional when the current address is the same as permanent address.",
  },
];

const STEP_FIELDS: Record<StepValue, string[]> = {
  employment: [
    "employeeCode",
    "employeeName",
    "department",
    "designation",
    "dateOfBirth",
    "gender",
    "contactNumber",
    "bloodGroup",
    "personalEmail",
    "officialEmail",
  ],
  family: [
    "maritalStatus",
    "marriageDate",
    "spouseName",
    "spouseDateOfBirth",
    "spouseGender",
    "hasKids",
    "child1Name",
    "child1DateOfBirth",
    "child1Gender",
    "child2Name",
    "child2DateOfBirth",
    "child2Gender",
    "fatherName",
    "fatherDateOfBirth",
    "motherName",
    "motherDateOfBirth",
    "emergencyContactName",
    "emergencyContactPhone",
    "emergencyContactRelation",
  ],
  education: [
    "class10ScoreType",
    "class10Score",
    "class12ScoreType",
    "class12Score",
    "highestQualification",
    "highestQualificationScoreType",
    "highestQualificationScore",
  ],
  identity: ["aadhaarNumber", "panNumber", "hasUanNumber", "uanNumber"],
  bank: ["hasSavingsAccount", "hasSalaryAccount", "bankAccount", "bankName", "ifscCode"],
  address: ["currentAddress", "permanentAddress"],
};

const BLOOD_GROUP_OPTIONS = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];
const MARITAL_STATUS_OPTIONS = [
  { value: "single", label: "Single" },
  { value: "married", label: "Married" },
  { value: "divorced", label: "Divorced" },
  { value: "widowed", label: "Widowed" },
  { value: "separated", label: "Separated" },
];
const EDUCATION_SCORE_TYPE_OPTIONS = [
  { value: "percentage", label: "Percentage" },
  { value: "cgpa", label: "CGPA" },
];
const QUALIFICATION_OPTIONS = [
  "10th Pass",
  "12th / Diploma Pass",
  "Diploma",
  "ITI",
  "Bachelor's Degree",
  "Master's Degree",
  "MBA",
  "PhD",
  "CA/CMA/CS",
  "Other",
];

const statusStyles: Record<string, string> = {
  completed: "border-emerald-500/25 bg-emerald-500/10 text-emerald-300",
  submitted: "border-emerald-500/25 bg-emerald-500/10 text-emerald-300",
  uploaded: "border-emerald-500/25 bg-emerald-500/10 text-emerald-300",
  verified: "border-emerald-500/25 bg-emerald-500/10 text-emerald-300",
  extracted: "border-emerald-500/25 bg-emerald-500/10 text-emerald-300",
  draft: "border-border bg-muted/20 text-muted-foreground",
  pending: "border-border bg-muted/20 text-muted-foreground",
  missing: "border-border bg-muted/20 text-muted-foreground",
  warning: "border-amber-500/25 bg-amber-500/10 text-amber-300",
  needs_review: "border-amber-500/25 bg-amber-500/10 text-amber-300",
  needs_correction: "border-amber-500/25 bg-amber-500/10 text-amber-300",
  rejected: "border-red-500/25 bg-red-500/10 text-red-300",
};

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const ALLOWED_EXTENSIONS = [".pdf", ".jpg", ".jpeg", ".png", ".webp", ".doc", ".docx"];
const IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp"];
const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);
const PAN_NUMBER_PATTERN = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

function parseStep(value: string | null): StepValue | null {
  return STEPS.some((step) => step.value === value) ? (value as StepValue) : null;
}

function parseEditFlag(value: string | null): boolean {
  return value === "1" || value === "true" || value === "yes";
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="mt-1 text-xs text-destructive">{message}</p>;
}

function normalizePhoneDigits(value: unknown): string {
  return (typeof value === "string" ? value : "").replace(/\D/g, "").slice(0, 10);
}

function normalizeAadhaarDigits(value: unknown): string {
  return (typeof value === "string" ? value : "").replace(/\D/g, "").slice(0, 12);
}

function editableAadhaarValue(value: string): string {
  return value.includes("*") ? "" : normalizeAadhaarDigits(value);
}

function toDateInput(value: unknown): string {
  if (typeof value !== "string" || !value) return "";
  return value.slice(0, 10);
}

function strValue(data: Record<string, unknown>, key: string): string {
  const value = data[key];
  return typeof value === "string" ? value : "";
}

function formatAadhaarDisplay(last4?: string | null): string {
  return last4 ? `**** **** ${last4}` : "";
}

function fileExtension(file: File): string {
  return `.${file.name.split(".").pop()?.toLowerCase() ?? ""}`;
}

function validateFile(file: File, requirement?: DocumentRequirement): string | null {
  const extension = fileExtension(file);
  if (requirement?.imageOnly && !file.type.startsWith("image/") && !IMAGE_EXTENSIONS.includes(extension)) {
    return `${requirement.label} must be JPG, PNG, or WEBP.`;
  }
  if (!ALLOWED_MIME_TYPES.has(file.type) && !ALLOWED_EXTENSIONS.includes(extension)) {
    return "Only PDF, DOC, DOCX, JPG, PNG, or WEBP files are allowed.";
  }
  if (file.size > MAX_FILE_BYTES) return "File must be under 10 MB.";
  if (file.size === 0) return "File appears to be empty.";
  return null;
}

function canPreviewFile(file: File): boolean {
  return file.type === "application/pdf" || file.type.startsWith("image/");
}

function getInitialFormData(dashboard: EmployeeDashboard): FormState {
  const employee = dashboard.employee;
  const saved = (dashboard.selectionForm.formData as Record<string, unknown>) ?? {};

  return {
    employeeCode: strValue(saved, "employeeCode") || employee.employeeCode || "",
    employeeName: strValue(saved, "employeeName") || employee.fullName || "",
    department: normalizeEmployeeDepartmentOption(strValue(saved, "department") || employee.department),
    designation: strValue(saved, "designation") || employee.designation || "",
    dateOfBirth: toDateInput(strValue(saved, "dateOfBirth") || employee.dateOfBirth || ""),
    gender: strValue(saved, "gender") || employee.gender || "",
    contactNumber: normalizePhoneDigits(strValue(saved, "contactNumber") || employee.phone || ""),
    personalEmail: strValue(saved, "personalEmail") || employee.personalEmail || "",
    officialEmail: strValue(saved, "officialEmail") || employee.etharaEmail || "",
    aadhaarNumber: editableAadhaarValue(strValue(saved, "aadhaarNumber") || formatAadhaarDisplay(employee.aadhaarLast4)),
    maritalStatus: strValue(saved, "maritalStatus"),
    marriageDate: toDateInput(strValue(saved, "marriageDate")),
    spouseName: strValue(saved, "spouseName"),
    spouseDateOfBirth: toDateInput(strValue(saved, "spouseDateOfBirth")),
    spouseGender: strValue(saved, "spouseGender"),
    hasKids: strValue(saved, "hasKids") || "no",
    child1Name: strValue(saved, "child1Name"),
    child1DateOfBirth: toDateInput(strValue(saved, "child1DateOfBirth")),
    child1Gender: strValue(saved, "child1Gender"),
    child2Name: strValue(saved, "child2Name"),
    child2DateOfBirth: toDateInput(strValue(saved, "child2DateOfBirth")),
    child2Gender: strValue(saved, "child2Gender"),
    bloodGroup: strValue(saved, "bloodGroup") || employee.bloodGroup || "",
    class10ScoreType: strValue(saved, "class10ScoreType") || "percentage",
    class10Score: strValue(saved, "class10Score"),
    class12ScoreType: strValue(saved, "class12ScoreType") || "percentage",
    class12Score: strValue(saved, "class12Score"),
    highestQualification: strValue(saved, "highestQualification"),
    highestQualificationScoreType: strValue(saved, "highestQualificationScoreType") || "percentage",
    highestQualificationScore: strValue(saved, "highestQualificationScore"),
    fatherName: strValue(saved, "fatherName"),
    fatherDateOfBirth: toDateInput(strValue(saved, "fatherDateOfBirth")),
    motherName: strValue(saved, "motherName"),
    motherDateOfBirth: toDateInput(strValue(saved, "motherDateOfBirth")),
    currentAddress: strValue(saved, "currentAddress"),
    permanentAddress: strValue(saved, "permanentAddress"),
    emergencyContactName: strValue(saved, "emergencyContactName") || employee.emergencyContactName || "",
    emergencyContactPhone: normalizePhoneDigits(strValue(saved, "emergencyContactPhone") || employee.emergencyContactPhone || ""),
    emergencyContactRelation: strValue(saved, "emergencyContactRelation") || employee.emergencyContactRelation || "",
    panNumber: (strValue(saved, "panNumber") || strValue(saved, "pan")).toUpperCase(),
    hasUanNumber: strValue(saved, "hasUanNumber") || (strValue(saved, "uanNumber") ? "yes" : ""),
    uanNumber: strValue(saved, "uanNumber").replace(/\D/g, "").slice(0, 12),
    hasSavingsAccount: strValue(saved, "hasSavingsAccount") || (strValue(saved, "bankAccount") || strValue(saved, "accountNumber") ? "yes" : ""),
    hasSalaryAccount: strValue(saved, "hasSalaryAccount") || (strValue(saved, "bankAccount") || strValue(saved, "accountNumber") ? "yes" : ""),
    bankName: strValue(saved, "bankName"),
    bankAccount: (strValue(saved, "bankAccount") || strValue(saved, "accountNumber")).replace(/\D/g, "").slice(0, 18),
    ifscCode: strValue(saved, "ifscCode").toUpperCase(),
  };
}

export default function EmployeeSelectionFormPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const qc = useQueryClient();
  const { data: dashboard, isLoading, isError } = useEmployeeDashboard();
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const aadhaarOcrRequestRef = useRef(0);
  const panOcrRequestRef = useRef(0);
  const formSectionRef = useRef<HTMLDivElement | null>(null);
  const shouldScrollToFormRef = useRef(false);

  const [formData, setFormData] = useState<FormState>({});
  const [activeStep, setActiveStep] = useState<StepValue>("employment");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [savingProgress, setSavingProgress] = useState(false);
  const [isEditing, setIsEditing] = useState(true);
  const [pendingFiles, setPendingFiles] = useState<Record<string, File | null>>({});
  const [documentsToDelete, setDocumentsToDelete] = useState<Set<string>>(new Set());
  const [aadhaarOcr, setAadhaarOcr] = useState<AadhaarOcrState>({ loading: false });
  const [panOcr, setPanOcr] = useState<PanOcrState>({ loading: false });
  const [chequeOcr, setChequeOcr] = useState<ChequeOcrState>({ loading: false });
  const [addressOcr, setAddressOcr] = useState<Record<string, AddressOcrState>>({});
  // AI document-type check for documents without a dedicated OCR extractor
  // (education marksheets/certificates, etc.). Keyed by document type.
  const [docVerify, setDocVerify] = useState<Record<string, { loading: boolean; status?: string; message?: string }>>({});
  const docVerifyReqRef = useRef<Record<string, number>>({});
  const [ocrReview, setOcrReview] = useState<{
    title: string;
    note: string;
    fields: Array<{ target: string; label: string; value: string }>;
  } | null>(null);
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [cropTarget, setCropTarget] = useState<{ type: string; file: File } | null>(null);
  const [departmentOptions, setDepartmentOptions] = useState<string[]>(() =>
    mergeEmployeeReferenceOptions(null, EMPLOYEE_DEPARTMENT_OPTIONS)
  );
  const [designationOptions, setDesignationOptions] = useState<string[]>(() =>
    mergeEmployeeReferenceOptions(null, EMPLOYEE_DESIGNATION_OPTIONS)
  );
  const [referenceOptionsLoading, setReferenceOptionsLoading] = useState(false);
  const requestedStep = parseStep(searchParams.get("step"));
  const shouldOpenForEdit = parseEditFlag(searchParams.get("edit"));

  // Initialize the form exactly once per visit. The dashboard query refetches on
  // window refocus (which happens whenever the OS file picker closes) and after
  // document uploads; re-initializing on every refetch wiped in-progress answers
  // and threw users back to the first step.
  const initializedRef = useRef(false);
  useEffect(() => {
    if (!dashboard || initializedRef.current) return;
    initializedRef.current = true;
    startTransition(() => {
      const submitted = dashboard.selectionForm.status === "submitted";
      const editAccess = dashboard.selectionForm.editAccessEnabled ?? true;
      setFormData(getInitialFormData(dashboard));
      setPendingFiles({});
      setDocumentsToDelete(new Set());
      setErrors({});
      setActiveStep(requestedStep ?? "employment");
      setIsEditing(!submitted || (editAccess && shouldOpenForEdit));
      aadhaarOcrRequestRef.current += 1;
      panOcrRequestRef.current += 1;
      setAadhaarOcr({ loading: false });
      setPanOcr({ loading: false });
      setChequeOcr({ loading: false });
      setAddressOcr({});
      setDocVerify({});
      shouldScrollToFormRef.current = Boolean(requestedStep || shouldOpenForEdit);
    });
  }, [dashboard, requestedStep, shouldOpenForEdit]);

  // Honor later ?step= navigation without resetting any form state.
  useEffect(() => {
    if (!initializedRef.current || !requestedStep) return;
    setActiveStep(requestedStep);
    shouldScrollToFormRef.current = true;
  }, [requestedStep]);

  // Keep the current step in the URL so a hard refresh resumes in place.
  useEffect(() => {
    if (!initializedRef.current) return;
    const url = new URL(window.location.href);
    if (url.searchParams.get("step") === activeStep) return;
    url.searchParams.set("step", activeStep);
    window.history.replaceState(null, "", url.toString());
  }, [activeStep]);

  useEffect(() => {
    if (!shouldScrollToFormRef.current) return;
    const frame = window.requestAnimationFrame(() => {
      formSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      shouldScrollToFormRef.current = false;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeStep, isEditing]);

  const loadReferenceOptions = useCallback(async () => {
    setReferenceOptionsLoading(true);
    try {
      const options = await employeesApi.referenceOptions();
      setDepartmentOptions(mergeEmployeeReferenceOptions(options.departments, EMPLOYEE_DEPARTMENT_OPTIONS));
      setDesignationOptions(mergeEmployeeReferenceOptions(options.designations, EMPLOYEE_DESIGNATION_OPTIONS));
    } catch {
      // Keep existing dropdown values if the reference endpoint is unavailable.
    } finally {
      setReferenceOptionsLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadReferenceOptions(), 0);
    return () => window.clearTimeout(timer);
  }, [loadReferenceOptions]);

  const refreshReferenceOptions = () => {
    if (!referenceOptionsLoading) void loadReferenceOptions();
  };

  useEffect(() => () => {
    if (preview?.url) URL.revokeObjectURL(preview.url);
  }, [preview]);

  const documentsByType = useMemo(() => {
    const map = new Map<string, EmployeeDocumentRecord>();
    for (const doc of dashboard?.documents ?? []) {
      if (!map.has(doc.type)) map.set(doc.type, doc);
    }
    return map;
  }, [dashboard?.documents]);

  const documentRequirementByType = useMemo(() => {
    const map = new Map<string, DocumentRequirement>();
    for (const requirement of DOCUMENT_REQUIREMENTS) map.set(requirement.type, requirement);
    return map;
  }, []);

  const hasProfile = Boolean(dashboard?.employee?.id);
  const selectionForm = dashboard?.selectionForm;
  const isSubmitted = selectionForm?.status === "submitted";
  const editAccessEnabled = selectionForm?.editAccessEnabled ?? true;
  const formLocked = Boolean(isSubmitted && (!isEditing || !editAccessEnabled));
  const controlsDisabled = !hasProfile || !editAccessEnabled || formLocked || saving;
  const currentIndex = Math.max(0, STEPS.findIndex((step) => step.value === activeStep));
  const currentStep = STEPS[currentIndex] ?? STEPS[0];
  const isLastStep = currentIndex === STEPS.length - 1;

  const str = (key: string) => formData[key] ?? "";

  const set = (key: string, value: string) => {
    let nextValue = value;
    if (["contactNumber", "emergencyContactPhone"].includes(key)) nextValue = normalizePhoneDigits(value);
    if (key === "aadhaarNumber") nextValue = normalizeAadhaarDigits(value);
    if (key === "uanNumber") nextValue = value.replace(/\D/g, "").slice(0, 12);
    if (key === "bankAccount") nextValue = value.replace(/\D/g, "").slice(0, 18);
    if (key === "panNumber") nextValue = value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10);
    if (key === "ifscCode") nextValue = value.toUpperCase().replace(/\s/g, "").slice(0, 11);
    if (["class10Score", "class12Score", "highestQualificationScore"].includes(key)) {
      nextValue = value.replace(/[^0-9.]/g, "").slice(0, 5);
    }
    setFormData((prev) => ({ ...prev, [key]: nextValue }));
    setErrors((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const documentHasValue = (type: string) => {
    if (pendingFiles[type]) return true;
    const doc = documentsByType.get(type);
    if (!doc || doc.missing) return false;
    return !documentsToDelete.has(doc.id);
  };

  const collectValidationErrors = (): Record<string, string> => {
    const next: Record<string, string> = {};
    const require = (key: string, label: string) => {
      if (!str(key).trim()) next[key] = `${label} is required.`;
    };

    [
      ["employeeCode", "Employee Code"],
      ["employeeName", "Employee Name"],
      ["department", "Department"],
      ["designation", "Designation"],
      ["dateOfBirth", "Date Of Birth"],
      ["gender", "Gender"],
      ["contactNumber", "Contact Number"],
      ["maritalStatus", "Marital Status"],
      ["bloodGroup", "Blood Group"],
      ["class10ScoreType", "10th Score Type"],
      ["class10Score", "10th CGPA / Percentage"],
      ["class12ScoreType", "12th / Diploma Score Type"],
      ["class12Score", "12th / Diploma CGPA / Percentage"],
      ["highestQualification", "Highest Qualification"],
      ["highestQualificationScoreType", "Highest Qualification Score Type"],
      ["highestQualificationScore", "Highest Qualification CGPA / Percentage"],
      ["personalEmail", "Personal Email"],
      ["officialEmail", "Official Email"],
      ["fatherName", "Father's Name"],
      ["fatherDateOfBirth", "Father's DOB"],
      ["motherName", "Mother's Name"],
      ["motherDateOfBirth", "Mother's DOB"],
      ["currentAddress", "Current Address"],
      ["permanentAddress", "Permanent Address"],
      ["emergencyContactName", "Emergency Contact Name"],
      ["emergencyContactPhone", "Emergency Contact Number"],
      ["emergencyContactRelation", "Emergency Contact Relation"],
      ["aadhaarNumber", "Aadhaar Number"],
      ["panNumber", "PAN Number"],
      ["hasUanNumber", "UAN Number Availability"],
      ["hasSavingsAccount", "Savings Account Availability"],
    ].forEach(([key, label]) => require(key, label));

    if (str("hasUanNumber") === "yes") {
      require("uanNumber", "UAN Number");
    }

    const aadhaarDigits = normalizeAadhaarDigits(str("aadhaarNumber"));
    if (aadhaarDigits && aadhaarDigits.length !== 12) {
      next.aadhaarNumber = "Aadhaar Number must be exactly 12 digits.";
    }

    if (str("hasSavingsAccount") === "yes") {
      require("hasSalaryAccount", "Salary Account Availability");
      if (str("hasSalaryAccount") === "yes") {
        require("bankName", "Bank Name");
        require("bankAccount", "Bank Account");
        require("ifscCode", "IFSC Code");
      }
    }

    if (str("maritalStatus") === "married") {
      require("marriageDate", "Marriage Date");
      require("spouseName", "Spouse Name");
      require("spouseDateOfBirth", "Spouse DOB");
      require("spouseGender", "Spouse Gender");
    }

    if (str("hasKids") === "yes") {
      const child1Keys = ["child1Name", "child1DateOfBirth", "child1Gender"];
      const child2Keys = ["child2Name", "child2DateOfBirth", "child2Gender"];
      child1Keys.forEach((key) => require(key, key === "child1Name" ? "Child 1 Name" : key === "child1DateOfBirth" ? "Child 1 DOB" : "Child 1 Gender"));
      const child2HasAny = child2Keys.some((key) => str(key).trim());
      if (child2HasAny) {
        child2Keys.forEach((key) => require(key, key === "child2Name" ? "Child 2 Name" : key === "child2DateOfBirth" ? "Child 2 DOB" : "Child 2 Gender"));
      }
    }

    const validateScore = (scoreKey: string, typeKey: string, label: string) => {
      const scoreType = str(typeKey);
      const value = str(scoreKey);
      if (!["percentage", "cgpa"].includes(scoreType)) {
        next[typeKey] = "Select CGPA or Percentage.";
        return;
      }
      if (!/^\d{1,3}(\.\d{1,2})?$/.test(value) || value.length > 5) {
        next[scoreKey] = `${label} must be a number up to 5 characters, e.g. 10.12.`;
        return;
      }
      const numeric = Number(value);
      if (!Number.isFinite(numeric) || numeric <= 0) {
        next[scoreKey] = `${label} must be greater than 0.`;
      } else if (scoreType === "percentage" && numeric > 100) {
        next[scoreKey] = `${label} percentage cannot exceed 100.`;
      } else if (scoreType === "cgpa" && numeric > 10.12) {
        next[scoreKey] = `${label} CGPA cannot exceed 10.12.`;
      }
    };

    validateScore("class10Score", "class10ScoreType", "10th score");
    validateScore("class12Score", "class12ScoreType", "12th / Diploma score");
    validateScore("highestQualificationScore", "highestQualificationScoreType", "Highest qualification score");

    if (str("personalEmail") && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(str("personalEmail"))) {
      next.personalEmail = "Enter a valid personal email address.";
    }
    if (str("officialEmail") && !/^[^\s@]+@ethara\.ai$/i.test(str("officialEmail"))) {
      next.officialEmail = "Official email must be an @ethara.ai address.";
    }
    if (str("contactNumber") && !/^[6-9]\d{9}$/.test(str("contactNumber"))) {
      next.contactNumber = "Enter a valid 10-digit Indian mobile number.";
    }
    if (str("emergencyContactPhone") && !/^\d{10}$/.test(str("emergencyContactPhone"))) {
      next.emergencyContactPhone = "Phone number must be exactly 10 digits.";
    }
    if (str("panNumber") && !PAN_NUMBER_PATTERN.test(str("panNumber"))) {
      next.panNumber = "Enter a valid PAN number (e.g. ABCDE1234F).";
    }
    if (str("uanNumber") && !/^10\d{10}$/.test(str("uanNumber"))) {
      next.uanNumber = "UAN Number must start with 10 and be exactly 12 digits.";
    }
    if (str("bankAccount") && !/^\d{9,18}$/.test(str("bankAccount"))) {
      next.bankAccount = "Bank account number must be 9-18 digits.";
    }
    if (str("ifscCode") && !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(str("ifscCode"))) {
      next.ifscCode = "Enter a valid IFSC code (e.g. HDFC0001234).";
    }

    for (const doc of DOCUMENT_REQUIREMENTS) {
      if (doc.required === false) continue;
      if (doc.type === "cancelled_cheque" && !(str("hasSavingsAccount") === "yes" && str("hasSalaryAccount") === "yes")) continue;
      if (!documentHasValue(doc.type)) {
        next[`document:${doc.type}`] = `${doc.label} is required.`;
      }
    }

    return next;
  };

  const validationKeysForStep = (step: StepValue) => {
    const keys = new Set(STEP_FIELDS[step]);
    for (const requirement of DOCUMENT_REQUIREMENTS) {
      if (requirement.step === step) keys.add(`document:${requirement.type}`);
    }
    return keys;
  };

  const stepForError = (key: string): StepValue => {
    if (key.startsWith("document:")) {
      const type = key.replace("document:", "");
      return documentRequirementByType.get(type)?.step ?? "employment";
    }
    for (const step of STEPS) {
      if (validationKeysForStep(step.value).has(key)) return step.value;
    }
    return "employment";
  };

  const validateStep = (step: StepValue): boolean => {
    const allErrors = collectValidationErrors();
    const keys = validationKeysForStep(step);
    const stepErrors = Object.fromEntries(Object.entries(allErrors).filter(([key]) => keys.has(key)));
    setErrors(stepErrors);
    return Object.keys(stepErrors).length === 0;
  };

  const validateAll = (): boolean => {
    const next = collectValidationErrors();
    setErrors(next);
    if (Object.keys(next).length > 0) {
      setActiveStep(stepForError(Object.keys(next)[0]));
      return false;
    }
    return true;
  };

  const extractAadhaarFromFile = async (file: File) => {
    const requestId = aadhaarOcrRequestRef.current + 1;
    aadhaarOcrRequestRef.current = requestId;
    setAadhaarOcr({ loading: true, status: "extracting", message: "Reading Aadhaar card..." });

    const payload = new FormData();
    payload.append("aadhaarCard", file);

    try {
      const result = await employeesApi.extractAadhaar(payload);
      if (aadhaarOcrRequestRef.current !== requestId) return;

      const extractedAadhaar = normalizeAadhaarDigits(result.aadhaarNumber ?? "");
      if (extractedAadhaar.length === 12) {
        set("aadhaarNumber", extractedAadhaar);
        setAadhaarOcr({
          loading: false,
          status: result.ocrStatus ?? "extracted",
          message: "Aadhaar number extracted — please verify it against your card.",
          aadhaarNumber: extractedAadhaar,
        });
        setOcrReview({
          title: "Verify Aadhaar details",
          note: "We read this from your Aadhaar card. Check it carefully and correct it if anything is wrong — the verified value is what gets saved.",
          fields: [{ target: "aadhaarNumber", label: "Aadhaar Number", value: extractedAadhaar }],
        });
        return;
      }

      setAadhaarOcr({
        loading: false,
        status: result.ocrStatus ?? "needs_review",
        message: result.message ?? "Aadhaar number could not be extracted. Please enter the 12-digit Aadhaar number manually.",
        aadhaarNumber: null,
      });
    } catch {
      if (aadhaarOcrRequestRef.current !== requestId) return;
      setAadhaarOcr({
        loading: false,
        status: "needs_review",
        message: "Aadhaar number could not be extracted. Please enter the 12-digit Aadhaar number manually.",
        aadhaarNumber: null,
      });
    }
  };

  const extractPanFromFile = async (file: File) => {
    const requestId = panOcrRequestRef.current + 1;
    panOcrRequestRef.current = requestId;
    setPanOcr({ loading: true, status: "extracting", message: "Reading PAN card..." });

    const payload = new FormData();
    payload.append("panCard", file);

    try {
      const result = await employeesApi.extractPan(payload);
      if (panOcrRequestRef.current !== requestId) return;

      const extractedPan = (result.panNumber ?? "")
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, "")
        .slice(0, 10);

      if (extractedPan && PAN_NUMBER_PATTERN.test(extractedPan)) {
        setPanOcr({
          loading: false,
          status: result.ocrStatus ?? "extracted",
          message: "PAN number extracted — please verify it against your card.",
          panNumber: extractedPan,
        });
        setOcrReview({
          title: "Verify PAN details",
          note: "We read this from your PAN card. Check it carefully and correct it if anything is wrong — the verified value is what gets saved.",
          fields: [{ target: "panNumber", label: "PAN Number", value: extractedPan }],
        });
        return;
      }

      setPanOcr({
        loading: false,
        status: result.ocrStatus ?? "needs_review",
        message: result.message ?? "PAN details could not be extracted. Please upload a clearer PAN card image or enter the PAN manually.",
        panNumber: null,
      });
    } catch {
      if (panOcrRequestRef.current !== requestId) return;
      setPanOcr({
        loading: false,
        status: "needs_review",
        message: "PAN details could not be extracted. Please upload a clearer PAN card image or enter the PAN manually.",
        panNumber: null,
      });
    }
  };

  const extractChequeFromFile = async (file: File) => {
    setChequeOcr({ loading: true, status: "extracting", message: "Reading cancelled cheque..." });
    const payload = new FormData();
    payload.append("cancelledCheque", file);
    try {
      const result = await employeesApi.extractCheque(payload);
      const accountNumber = (result.accountNumber ?? "").replace(/\D/g, "").slice(0, 18);
      const ifscCode = (result.ifscCode ?? "").toUpperCase().replace(/\s/g, "").slice(0, 11);
      setChequeOcr({
        loading: false,
        status: result.ocrStatus ?? (accountNumber && ifscCode ? "extracted" : "partial"),
        message: accountNumber || ifscCode || result.bankName
          ? "Bank details extracted — please verify them against your cheque."
          : (result.message ?? "Partial extraction. Please verify and complete bank details."),
        accountNumber: accountNumber || null,
        ifscCode: ifscCode || null,
        accountHolderName: result.accountHolderName ?? null,
        bankName: result.bankName ?? null,
      });
      if (accountNumber || ifscCode || result.bankName) {
        setOcrReview({
          title: "Verify bank details",
          note: "We read these from your cancelled cheque. Check every value against the cheque and correct anything that is wrong — the verified values are what get saved.",
          fields: [
            { target: "bankAccount", label: "Account Number", value: accountNumber },
            { target: "ifscCode", label: "IFSC Code", value: ifscCode },
            { target: "bankName", label: "Bank Name", value: result.bankName ?? "" },
          ],
        });
      }
    } catch {
      setChequeOcr({
        loading: false,
        status: "needs_review",
        message: "Could not extract bank details from this cheque. Please upload a clearer image or enter details manually.",
      });
    }
  };

  const extractAddressFromFile = async (type: string, file: File) => {
    const targetField = type === "current_address_proof" ? "currentAddress" : "permanentAddress";
    setAddressOcr((prev) => ({
      ...prev,
      [type]: { loading: true, status: "extracting", message: "Reading address proof..." },
    }));
    const payload = new FormData();
    payload.append("addressProof", file);
    try {
      const result = await employeesApi.extractAddress(payload);
      const address = (result.address ?? "").trim();
      setAddressOcr((prev) => ({
        ...prev,
        [type]: {
          loading: false,
          status: result.ocrStatus ?? (address ? "extracted" : "needs_review"),
          message: address
            ? "Address extracted — please verify it against your document."
            : (result.message ?? "Could not extract address. Please verify or enter it manually."),
          address: address || null,
          postalCode: result.postalCode ?? null,
        },
      }));
      if (address) {
        setOcrReview({
          title: type === "current_address_proof" ? "Verify current address" : "Verify permanent address",
          note: "We read this from your address proof. Check it carefully and correct it if anything is wrong — the verified value is what gets saved.",
          fields: [{ target: targetField, label: "Address", value: address }],
        });
      }
    } catch {
      setAddressOcr((prev) => ({
        ...prev,
        [type]: {
          loading: false,
          status: "needs_review",
          message: "Could not extract address from this document. Please upload a clearer image or enter it manually.",
        },
      }));
    }
  };

  const verifyDocumentFile = async (type: string, file: File) => {
    const requestId = (docVerifyReqRef.current[type] ?? 0) + 1;
    docVerifyReqRef.current[type] = requestId;
    setDocVerify((prev) => ({ ...prev, [type]: { loading: true, status: "extracting", message: "Checking the document…" } }));
    try {
      const result = await employeesApi.verifyMyDocument(type, file);
      if (docVerifyReqRef.current[type] !== requestId) return;
      if (!result.message) {
        // Not an AI-verifiable type (or AI off) — show nothing.
        setDocVerify((prev) => ({ ...prev, [type]: { loading: false } }));
        return;
      }
      setDocVerify((prev) => ({
        ...prev,
        [type]: { loading: false, status: result.ocrStatus, message: result.message },
      }));
    } catch {
      if (docVerifyReqRef.current[type] !== requestId) return;
      // Verification is a best-effort hint; never block the upload on failure.
      setDocVerify((prev) => ({ ...prev, [type]: { loading: false } }));
    }
  };

  const queueDocumentFile = (type: string, file: File) => {
    setPendingFiles((prev) => ({ ...prev, [type]: file }));
    const doc = documentsByType.get(type);
    if (doc && !doc.missing) {
      setDocumentsToDelete((prev) => {
        const next = new Set(prev);
        next.delete(doc.id);
        return next;
      });
    }
    setErrors((prev) => {
      const next = { ...prev };
      delete next[`document:${type}`];
      return next;
    });
    if (type === "aadhaar") void extractAadhaarFromFile(file);
    else if (type === "pan") void extractPanFromFile(file);
    else if (type === "cancelled_cheque") void extractChequeFromFile(file);
    else if (type === "permanent_address_proof" || type === "current_address_proof") {
      void extractAddressFromFile(type, file);
    } else {
      // Education marksheets/certificates and any other AI-verifiable type get a
      // non-blocking document-type check; the backend no-ops for the rest.
      void verifyDocumentFile(type, file);
    }
  };

  const handleSelectFile = (type: string, file: File | null) => {
    if (!file || controlsDisabled) return;
    const requirement = documentRequirementByType.get(type);
    const error = validateFile(file, requirement);
    if (error) {
      toast.error(error);
      return;
    }
    if (type === "photo" && file.type.startsWith("image/")) {
      setCropTarget({ type, file });
      return;
    }
    queueDocumentFile(type, file);
  };

  const clearPendingDocument = (type: string) => {
    setPendingFiles((prev) => ({ ...prev, [type]: null }));
    if (type === "aadhaar") {
      aadhaarOcrRequestRef.current += 1;
      setAadhaarOcr({ loading: false });
    }
    if (type === "pan") {
      panOcrRequestRef.current += 1;
      setPanOcr({ loading: false });
    }
    if (type === "cancelled_cheque") setChequeOcr({ loading: false });
    if (type === "permanent_address_proof" || type === "current_address_proof") {
      setAddressOcr((prev) => ({ ...prev, [type]: { loading: false } }));
    }
    docVerifyReqRef.current[type] = (docVerifyReqRef.current[type] ?? 0) + 1;
    setDocVerify((prev) => ({ ...prev, [type]: { loading: false } }));
  };

  const markDocumentForDeletion = (doc: EmployeeDocumentRecord) => {
    if (doc.missing || controlsDisabled) return;
    setPendingFiles((prev) => ({ ...prev, [doc.type]: null }));
    setDocumentsToDelete((prev) => new Set(prev).add(doc.id));
  };

  const keepExistingDocument = (doc: EmployeeDocumentRecord) => {
    setPendingFiles((prev) => ({ ...prev, [doc.type]: null }));
    setDocumentsToDelete((prev) => {
      const next = new Set(prev);
      next.delete(doc.id);
      return next;
    });
  };

  const openPreview = (next: PreviewState) => {
    setPreview((prev) => {
      if (prev?.url) URL.revokeObjectURL(prev.url);
      return next;
    });
  };

  const handlePreviewDocument = async (type: string) => {
    const requirement = documentRequirementByType.get(type);
    const pendingFile = pendingFiles[type];
    if (pendingFile) {
      if (!canPreviewFile(pendingFile)) {
        toast.error("This selected file cannot be previewed inline.");
        return;
      }
      openPreview({
        title: requirement?.label ?? pendingFile.name,
        url: URL.createObjectURL(pendingFile),
        mimeType: pendingFile.type,
      });
      return;
    }

    const doc = documentsByType.get(type);
    if (!doc || doc.missing || documentsToDelete.has(doc.id) || !doc.previewEndpoint) {
      toast.error("This file cannot be previewed inline.");
      return;
    }
    try {
      const blob = await employeesApi.getBlobFromEndpoint(doc.previewEndpoint);
      openPreview({
        title: doc.label,
        url: URL.createObjectURL(blob),
        mimeType: doc.mimeType || blob.type,
      });
    } catch {
      toast.error("Could not load document preview.");
    }
  };

  const handleDownloadDocument = async (doc: EmployeeDocumentRecord) => {
    if (!doc.downloadEndpoint || !doc.fileName) return;
    setDownloadingId(doc.id);
    try {
      await employeesApi.downloadFromEndpoint(doc.downloadEndpoint, doc.fileName);
    } catch {
      toast.error("Could not download the document.");
    } finally {
      setDownloadingId(null);
    }
  };

  const saveDocumentChanges = async () => {
    const uploaded: Record<string, string> = {};

    for (const requirement of DOCUMENT_REQUIREMENTS) {
      const doc = documentsByType.get(requirement.type);
      const pendingFile = pendingFiles[requirement.type];

      if (pendingFile) {
        const newDoc = await employeesApi.uploadMyDocument(requirement.type, pendingFile);
        uploaded[requirement.type] = newDoc.fileName ?? pendingFile.name;
        if (doc && !doc.missing && doc.id !== doc.type && doc.id !== newDoc.id) {
          await employeesApi.deleteMyDocument(doc.id);
        }
      } else if (doc && !doc.missing && documentsToDelete.has(doc.id)) {
        await employeesApi.deleteMyDocument(doc.id);
      } else if (doc && !doc.missing && doc.fileName) {
        uploaded[requirement.type] = doc.fileName;
      }
    }

    return uploaded;
  };

  const buildSelectionPayload = (uploadedDocuments: Record<string, string>) => {
    const hasSalaryBankDetails = str("hasSavingsAccount") === "yes" && str("hasSalaryAccount") === "yes";

    return {
      ...formData,
      uanNumber: str("hasUanNumber") === "yes" ? str("uanNumber") : "",
      salaryAccountInstruction: hasSalaryBankDetails
        ? "ready_for_salary_eligibility_validation"
        : "open_or_convert_hdfc_salary_account",
      bankAccount: hasSalaryBankDetails ? formData.bankAccount : "",
      accountNumber: hasSalaryBankDetails ? formData.bankAccount : "",
      bankName: hasSalaryBankDetails ? formData.bankName : "",
      ifscCode: hasSalaryBankDetails ? formData.ifscCode : "",
      documentsUploaded: uploadedDocuments,
    };
  };

  const handleSave = async () => {
    if (!hasProfile) {
      toast.error("Your employee profile is still being provisioned.");
      return;
    }
    if (!editAccessEnabled) {
      toast.error("Employee detail form edit access is disabled by HR/Admin.");
      return;
    }
    if (formLocked) return;

    if (!validateAll()) {
      toast.error("Please complete all mandatory fields before saving.");
      return;
    }

    setSaving(true);
    const wasSubmitted = isSubmitted;
    try {
      const uploadedDocuments = await saveDocumentChanges();
      await employeesApi.submitSelectionForm(buildSelectionPayload(uploadedDocuments));
      toast.success("Employee detail form saved. HR and Admin can view the updated details.");
      await qc.invalidateQueries({ queryKey: ["employees", "me", "dashboard"] });
      setIsEditing(false);
      if (!wasSubmitted) router.push("/dashboard/employee");
    } catch (err) {
      const apiErr = err as { response?: { data?: { detail?: string } } };
      toast.error(apiErr.response?.data?.detail || "Could not save the employee detail form.");
    } finally {
      setSaving(false);
    }
  };

  const handleSaveProgress = async () => {
    if (!hasProfile) {
      toast.error("Your employee profile is still being provisioned.");
      return;
    }
    if (!editAccessEnabled) {
      toast.error("Employee detail form edit access is disabled by HR/Admin.");
      return;
    }
    if (formLocked) return;

    setSavingProgress(true);
    try {
      const uploadedDocuments = await saveDocumentChanges();
      await employeesApi.saveSelectionFormDraft(buildSelectionPayload(uploadedDocuments));
      toast.success("Progress saved.");
      await qc.invalidateQueries({ queryKey: ["employees", "me", "dashboard"] });
      setPendingFiles({});
      setDocumentsToDelete(new Set());
    } catch (err) {
      const apiErr = err as { response?: { data?: { detail?: string } } };
      toast.error(apiErr.response?.data?.detail || "Could not save progress.");
    } finally {
      setSavingProgress(false);
    }
  };

  const goNext = () => {
    if (currentIndex >= STEPS.length - 1) return;
    if (!formLocked && !validateStep(activeStep)) {
      toast.error("Please complete this section before continuing.");
      return;
    }
    setActiveStep(STEPS[currentIndex + 1].value);
  };

  const goPrevious = () => {
    if (currentIndex <= 0) return;
    setActiveStep(STEPS[currentIndex - 1].value);
  };

  const cancelEdit = () => {
    if (!dashboard) return;
    setFormData(getInitialFormData(dashboard));
    setPendingFiles({});
    setDocumentsToDelete(new Set());
    setErrors({});
    setIsEditing(false);
    aadhaarOcrRequestRef.current += 1;
    panOcrRequestRef.current += 1;
    setAadhaarOcr({ loading: false });
    setPanOcr({ loading: false });
    setChequeOcr({ loading: false });
    setAddressOcr({});
  };

  const editDetails = () => {
    setIsEditing(true);
    shouldScrollToFormRef.current = true;
  };

  const documentControl = (type: string) => {
    const requirement = documentRequirementByType.get(type);
    if (!requirement) return null;
    const doc = documentsByType.get(type);
    const pendingFile = pendingFiles[type];
    const markedForDelete = Boolean(doc && documentsToDelete.has(doc.id));
    const errorKey = `document:${type}`;
    const hasFile = documentHasValue(type);
    const canPreview = Boolean(
      pendingFile ? canPreviewFile(pendingFile) : doc && !doc.missing && !markedForDelete && doc.canPreview,
    );
    const canDownload = Boolean(doc && !doc.missing && !markedForDelete && doc.downloadEndpoint && doc.fileName);
    const currentAddressOcr = addressOcr[type];

    return (
      <div
        key={type}
        className={cn(
          "rounded-lg border p-4",
          errors[errorKey] ? "border-destructive/50 bg-destructive/5" : "border-border bg-muted/10",
        )}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold">
              {requirement.label} {requirement.required !== false && <span className="text-destructive">*</span>}
            </p>
            <p className="mt-1 break-all text-xs text-muted-foreground">
              {pendingFile
                ? `Selected: ${pendingFile.name}`
                : markedForDelete
                  ? "Marked for deletion"
                  : doc && !doc.missing
                    ? doc.fileName || "Uploaded"
                    : "No file uploaded yet"}
            </p>
            {requirement.helper && (
              <p className="text-xs text-muted-foreground">{requirement.helper}</p>
            )}
            {doc?.uploadedAt && !markedForDelete && (
              <p className="text-xs text-muted-foreground">Uploaded {timeAgo(doc.uploadedAt)}</p>
            )}
          </div>
          <Badge
            variant="outline"
            className={cn(
              "shrink-0 text-[10px]",
              hasFile
                ? statusStyles[pendingFile ? "uploaded" : doc?.verificationStatus ?? "uploaded"]
                : statusStyles.missing,
            )}
          >
            {hasFile
              ? (pendingFile ? "Selected" : formatLabel(doc?.verificationStatus ?? "uploaded"))
              : requirement.required === false
                ? "Optional"
                : "Required"}
          </Badge>
        </div>
        <FieldError message={errors[errorKey]} />
        {type === "aadhaar" && aadhaarOcr.message && (
          <div
            className={cn(
              "mt-2 rounded-lg border p-3 text-xs",
              aadhaarOcr.loading
                ? "border-border bg-muted/10 text-muted-foreground"
                : aadhaarOcr.status === "extracted"
                  ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-300"
                  : "border-amber-500/25 bg-amber-500/10 text-amber-300",
            )}
          >
            <div className="flex items-start gap-1.5">
              {aadhaarOcr.loading
                ? <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin" />
                : aadhaarOcr.status === "extracted"
                  ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  : <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
              <span>{aadhaarOcr.message}</span>
            </div>
            {aadhaarOcr.aadhaarNumber && (
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <div className="rounded-md border border-border/70 bg-background/40 p-2">
                  <p className="text-[10px] uppercase text-muted-foreground">Aadhaar Number</p>
                  <p className="mt-1 font-mono text-sm font-semibold">**** **** {aadhaarOcr.aadhaarNumber.slice(-4)}</p>
                </div>
                <div className="rounded-md border border-border/70 bg-background/40 p-2">
                  <p className="text-[10px] uppercase text-muted-foreground">OCR Status</p>
                  <p className="mt-1 font-medium">{formatLabel(aadhaarOcr.status ?? "extracted")}</p>
                </div>
              </div>
            )}
          </div>
        )}
        {type === "pan" && panOcr.message && (
          <div
            className={cn(
              "mt-2 rounded-lg border p-3 text-xs",
              panOcr.loading
                ? "border-border bg-muted/10 text-muted-foreground"
                : panOcr.status === "extracted"
                  ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-300"
                  : "border-amber-500/25 bg-amber-500/10 text-amber-300",
            )}
          >
            <div className="flex items-start gap-1.5">
              {panOcr.loading
                ? <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin" />
                : panOcr.status === "extracted"
                  ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  : <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
              <span>{panOcr.message}</span>
            </div>
            {panOcr.panNumber && (
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <div className="rounded-md border border-border/70 bg-background/40 p-2">
                  <p className="text-[10px] uppercase text-muted-foreground">PAN Number</p>
                  <p className="mt-1 font-mono text-sm font-semibold">{panOcr.panNumber}</p>
                </div>
                <div className="rounded-md border border-border/70 bg-background/40 p-2">
                  <p className="text-[10px] uppercase text-muted-foreground">OCR Status</p>
                  <p className="mt-1 font-medium">{formatLabel(panOcr.status ?? "extracted")}</p>
                </div>
              </div>
            )}
          </div>
        )}
        {type === "cancelled_cheque" && chequeOcr.message && (
          <div
            className={cn(
              "mt-2 rounded-lg border p-3 text-xs",
              chequeOcr.loading
                ? "border-border bg-muted/10 text-muted-foreground"
                : chequeOcr.status === "extracted"
                  ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-300"
                  : "border-amber-500/25 bg-amber-500/10 text-amber-300",
            )}
          >
            <div className="flex items-start gap-1.5">
              {chequeOcr.loading
                ? <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin" />
                : chequeOcr.status === "extracted"
                  ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  : <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
              <span>{chequeOcr.message}</span>
            </div>
            {(chequeOcr.accountNumber || chequeOcr.ifscCode) && (
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <div className="rounded-md border border-border/70 bg-background/40 p-2">
                  <p className="text-[10px] uppercase text-muted-foreground">Account Number</p>
                  <p className="mt-1 font-mono text-sm font-semibold">{chequeOcr.accountNumber || "Enter manually"}</p>
                </div>
                <div className="rounded-md border border-border/70 bg-background/40 p-2">
                  <p className="text-[10px] uppercase text-muted-foreground">IFSC Code</p>
                  <p className="mt-1 font-mono text-sm font-semibold">{chequeOcr.ifscCode || "Enter manually"}</p>
                </div>
              </div>
            )}
          </div>
        )}
        {(type === "permanent_address_proof" || type === "current_address_proof") && currentAddressOcr?.message && (
          <div
            className={cn(
              "mt-2 rounded-lg border p-3 text-xs",
              currentAddressOcr.loading
                ? "border-border bg-muted/10 text-muted-foreground"
                : currentAddressOcr.status === "extracted"
                  ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-300"
                  : "border-amber-500/25 bg-amber-500/10 text-amber-300",
            )}
          >
            <div className="flex items-start gap-1.5">
              {currentAddressOcr.loading
                ? <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin" />
                : currentAddressOcr.status === "extracted"
                  ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  : <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
              <span>{currentAddressOcr.message}</span>
            </div>
            {currentAddressOcr.address && (
              <div className="mt-2 rounded-md border border-border/70 bg-background/40 p-2">
                <p className="text-[10px] uppercase text-muted-foreground">Extracted Address</p>
                <p className="mt-1 text-sm font-medium">{currentAddressOcr.address}</p>
              </div>
            )}
          </div>
        )}
        {docVerify[type]?.message && (
          <div
            className={cn(
              "mt-2 rounded-lg border p-3 text-xs",
              docVerify[type]?.loading
                ? "border-border bg-muted/10 text-muted-foreground"
                : docVerify[type]?.status === "extracted"
                  ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-300"
                  : "border-amber-500/25 bg-amber-500/10 text-amber-300",
            )}
          >
            <div className="flex items-start gap-1.5">
              {docVerify[type]?.loading
                ? <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin" />
                : docVerify[type]?.status === "extracted"
                  ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  : <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
              <span>{docVerify[type]?.message}</span>
            </div>
          </div>
        )}

        <div className="mt-3 flex flex-wrap gap-2">
          <input
            ref={(node) => {
              fileInputRefs.current[type] = node;
            }}
            type="file"
            className="hidden"
            accept={requirement.accept}
            disabled={controlsDisabled}
            onChange={(event) => {
              handleSelectFile(type, event.target.files?.[0] ?? null);
              event.target.value = "";
            }}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 rounded-full text-xs"
            disabled={controlsDisabled}
            onClick={() => fileInputRefs.current[type]?.click()}
          >
            <Upload className="mr-1.5 h-3.5 w-3.5" />
            {doc && !doc.missing ? "Replace" : "Upload"}
          </Button>
          {pendingFile && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 rounded-full text-xs"
              disabled={controlsDisabled}
              onClick={() => clearPendingDocument(type)}
            >
              Clear
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 rounded-full text-xs"
            disabled={!canPreview}
            onClick={() => void handlePreviewDocument(type)}
          >
            <Eye className="mr-1.5 h-3.5 w-3.5" />
            Preview
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 rounded-full text-xs"
            disabled={!canDownload || downloadingId === doc?.id}
            onClick={() => {
              if (doc) void handleDownloadDocument(doc);
            }}
          >
            {downloadingId === doc?.id
              ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              : <Download className="mr-1.5 h-3.5 w-3.5" />}
            Download
          </Button>
          {doc && !doc.missing && !markedForDelete && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 rounded-full text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
              disabled={controlsDisabled}
              onClick={() => markDocumentForDeletion(doc)}
            >
              <Trash2 className="mr-1.5 h-3.5 w-3.5" />
              Delete
            </Button>
          )}
          {doc && !doc.missing && markedForDelete && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 rounded-full text-xs"
              disabled={controlsDisabled}
              onClick={() => keepExistingDocument(doc)}
            >
              Keep Existing
            </Button>
          )}
        </div>
      </div>
    );
  };

  if (isLoading) {
    return (
      <div className="mx-auto max-w-5xl space-y-6 animate-fade-in">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-[560px] rounded-lg" />
      </div>
    );
  }

  if (isError || !dashboard) {
    return (
      <div className="mx-auto max-w-3xl rounded-lg border border-destructive/30 bg-destructive/5 p-8 text-center">
        <AlertCircle className="mx-auto h-8 w-8 text-destructive" />
        <p className="mt-3 text-sm font-medium">Could not load employee detail form data.</p>
      </div>
    );
  }

  const maritalStatus = str("maritalStatus");
  const hasKids = str("hasKids");
  const hasUanNumber = str("hasUanNumber");
  const hasSavingsAccount = str("hasSavingsAccount");
  const hasSalaryAccount = str("hasSalaryAccount");

  return (
    <div className="mx-auto max-w-5xl space-y-6 overflow-x-hidden animate-fade-in">
      <div className="min-w-0">
        <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight sm:text-2xl">
          <ClipboardCheck className="h-6 w-6 text-primary" />
          Employee Detail Form
        </h1>
        <p className="text-muted-foreground">
          Complete the mandatory employee details and upload each supporting document.
        </p>
      </div>

      <Card className="border-0 shadow-sm">
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
            <div className="min-w-0">
              <CardTitle className="text-base">{currentStep.label}</CardTitle>
              <CardDescription>
                Step {currentIndex + 1} of {STEPS.length}
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Badge
                variant="outline"
                className={cn("capitalize", statusStyles[selectionForm?.status ?? "draft"] ?? statusStyles.pending)}
              >
                {formatLabel(selectionForm?.status ?? "draft")}
              </Badge>
              {selectionForm?.submittedAt && (
                <span className="text-xs text-muted-foreground">
                  Last saved {timeAgo(selectionForm.submittedAt)}
                </span>
              )}
              {formLocked && editAccessEnabled && (
                <Button type="button" variant="outline" size="sm" className="h-8 rounded-full text-xs" onClick={editDetails}>
                  <Pencil className="mr-1.5 h-3.5 w-3.5" />
                  Edit Details
                </Button>
              )}
              {isSubmitted && isEditing && (
                <Button type="button" variant="ghost" size="sm" className="h-8 rounded-full text-xs" onClick={cancelEdit}>
                  Cancel Edit
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          {!hasProfile && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-500/25 bg-amber-500/10 p-3 text-sm text-amber-200">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              Employee detail form will be enabled once your employee record is fully linked by HR.
            </div>
          )}

          {(!editAccessEnabled || formLocked) && (
            <div className="flex items-start gap-2 rounded-lg border border-emerald-500/25 bg-emerald-500/10 p-3 text-sm text-emerald-200">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
              {editAccessEnabled
                ? "This submitted form is read-only. Use Edit Details to make changes."
                : "HR/Admin has disabled edit access after verification. Please contact HR for any corrections."}
            </div>
          )}

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            {STEPS.map((step, index) => {
              const Icon = step.icon;
              const isActive = step.value === activeStep;
              const disabled = !formLocked && index > currentIndex;
              return (
                <button
                  key={step.value}
                  type="button"
                  disabled={disabled}
                  className={cn(
                    "flex h-10 items-center gap-2 rounded-lg border px-3 text-left text-xs font-medium transition-colors",
                    isActive
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border bg-muted/20 text-muted-foreground hover:bg-muted/40",
                    disabled && "cursor-not-allowed opacity-45 hover:bg-muted/20",
                  )}
                  onClick={() => {
                    if (disabled) return;
                    setActiveStep(step.value);
                  }}
                >
                  <Icon className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{step.label}</span>
                </button>
              );
            })}
          </div>

          <div ref={formSectionRef} id={`employee-detail-form-${activeStep}`} className="scroll-mt-24">
          {activeStep === "employment" && (
            <section className="space-y-5">
              <div className="grid gap-5 sm:grid-cols-2">
                <TextField label="Employee Code" value={str("employeeCode")} error={errors.employeeCode} onChange={(v) => set("employeeCode", v)} disabled={controlsDisabled} required />
                <TextField label="Employee Name" value={str("employeeName")} error={errors.employeeName} onChange={(v) => set("employeeName", v)} disabled={controlsDisabled} required />
                <SelectField label="Department" value={str("department")} error={errors.department} onChange={(v) => set("department", v)} options={departmentOptions.map((value) => ({ value, label: formatDropdownOptionLabel(value) }))} disabled={controlsDisabled} required onOpen={refreshReferenceOptions} loading={referenceOptionsLoading} loadingLabel="Loading latest departments..." />
                <SelectField label="Designation" value={str("designation")} error={errors.designation} onChange={(v) => set("designation", v)} options={designationOptions.map((value) => ({ value, label: formatDropdownOptionLabel(value) }))} disabled={controlsDisabled} required onOpen={refreshReferenceOptions} loading={referenceOptionsLoading} loadingLabel="Loading latest designations..." />
                <DateField label="Date Of Birth" value={str("dateOfBirth")} error={errors.dateOfBirth} onChange={(v) => set("dateOfBirth", v)} disabled={controlsDisabled} required />
                <SelectField label="Gender" value={str("gender")} error={errors.gender} onChange={(v) => set("gender", v)} options={EMPLOYEE_GENDER_OPTIONS.map((option) => ({ value: option.value, label: formatDropdownOptionLabel(option.label) }))} disabled={controlsDisabled} required />
                <TextField label="Contact Number" value={str("contactNumber")} error={errors.contactNumber} onChange={(v) => set("contactNumber", v)} disabled={controlsDisabled} required inputMode="numeric" maxLength={10} />
                <SelectField label="Blood Group" value={str("bloodGroup")} error={errors.bloodGroup} onChange={(v) => set("bloodGroup", v)} options={BLOOD_GROUP_OPTIONS.map((value) => ({ value, label: value }))} disabled={controlsDisabled} required />
                <TextField label="Personal Email" value={str("personalEmail")} error={errors.personalEmail} onChange={(v) => set("personalEmail", v)} disabled={controlsDisabled} required type="email" />
                <TextField label="Official Email" value={str("officialEmail")} error={errors.officialEmail} onChange={(v) => set("officialEmail", v)} disabled required type="email" />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {documentControl("resume")}
                {documentControl("photo")}
              </div>
            </section>
          )}

          {activeStep === "family" && (
            <section className="space-y-5">
              <div className="rounded-lg border border-border bg-muted/10 p-3 text-xs text-muted-foreground">
                All details should be mentioned as per Aadhaar Card.
              </div>
              <div className="grid gap-5 sm:grid-cols-2">
              <SelectField
                label="Marital Status"
                value={str("maritalStatus")}
                error={errors.maritalStatus}
                onChange={(v) => set("maritalStatus", v)}
                options={MARITAL_STATUS_OPTIONS}
                disabled={controlsDisabled}
                required
              />
              <SelectField
                label="Kids"
                value={hasKids}
                error={errors.hasKids}
                onChange={(v) => set("hasKids", v)}
                options={[
                  { value: "no", label: "No" },
                  { value: "yes", label: "Yes" },
                ]}
                disabled={controlsDisabled}
              />
              {maritalStatus === "married" && (
                <>
                  <DateField label="Marriage Date" value={str("marriageDate")} error={errors.marriageDate} onChange={(v) => set("marriageDate", v)} disabled={controlsDisabled} required />
                  <TextField label="Spouse Name" value={str("spouseName")} error={errors.spouseName} onChange={(v) => set("spouseName", v)} disabled={controlsDisabled} required />
                  <DateField label="Spouse DOB" value={str("spouseDateOfBirth")} error={errors.spouseDateOfBirth} onChange={(v) => set("spouseDateOfBirth", v)} disabled={controlsDisabled} required />
                  <SelectField label="Spouse Gender" value={str("spouseGender")} error={errors.spouseGender} onChange={(v) => set("spouseGender", v)} options={EMPLOYEE_GENDER_OPTIONS.map((option) => ({ value: option.value, label: formatDropdownOptionLabel(option.label) }))} disabled={controlsDisabled} required />
                </>
              )}
              <TextField label="Father's Name" value={str("fatherName")} error={errors.fatherName} onChange={(v) => set("fatherName", v)} disabled={controlsDisabled} required />
              <DateField label="Father's DOB" value={str("fatherDateOfBirth")} error={errors.fatherDateOfBirth} onChange={(v) => set("fatherDateOfBirth", v)} disabled={controlsDisabled} required />
              <TextField label="Mother's Name" value={str("motherName")} error={errors.motherName} onChange={(v) => set("motherName", v)} disabled={controlsDisabled} required />
              <DateField label="Mother's DOB" value={str("motherDateOfBirth")} error={errors.motherDateOfBirth} onChange={(v) => set("motherDateOfBirth", v)} disabled={controlsDisabled} required />
              <TextField label="Emergency Contact Name" value={str("emergencyContactName")} error={errors.emergencyContactName} onChange={(v) => set("emergencyContactName", v)} disabled={controlsDisabled} required />
              <TextField label="Emergency Contact Number" value={str("emergencyContactPhone")} error={errors.emergencyContactPhone} onChange={(v) => set("emergencyContactPhone", v)} disabled={controlsDisabled} required inputMode="numeric" maxLength={10} />
              <TextField label="Emergency Contact Relation" value={str("emergencyContactRelation")} error={errors.emergencyContactRelation} onChange={(v) => set("emergencyContactRelation", v)} disabled={controlsDisabled} required />
              </div>
              {hasKids === "yes" && (
                <div className="grid gap-4 sm:grid-cols-2">
                  {[1, 2].map((childNumber) => (
                    <div key={childNumber} className="rounded-lg border border-border bg-muted/10 p-4">
                      <p className="mb-4 text-sm font-semibold">Child {childNumber}</p>
                      <div className="space-y-4">
                        <TextField label="Child Name" value={str(`child${childNumber}Name`)} error={errors[`child${childNumber}Name`]} onChange={(v) => set(`child${childNumber}Name`, v)} disabled={controlsDisabled} required={childNumber === 1} />
                        <DateField label="DOB" value={str(`child${childNumber}DateOfBirth`)} error={errors[`child${childNumber}DateOfBirth`]} onChange={(v) => set(`child${childNumber}DateOfBirth`, v)} disabled={controlsDisabled} required={childNumber === 1} />
                        <SelectField label="Gender" value={str(`child${childNumber}Gender`)} error={errors[`child${childNumber}Gender`]} onChange={(v) => set(`child${childNumber}Gender`, v)} options={EMPLOYEE_GENDER_OPTIONS.map((option) => ({ value: option.value, label: formatDropdownOptionLabel(option.label) }))} disabled={controlsDisabled} required={childNumber === 1} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}

          {activeStep === "education" && (
            <section className="space-y-5">
              <div className="rounded-lg border border-border bg-muted/10 p-3 text-xs text-muted-foreground">
                Accepted format: numbers only, up to 5 characters, e.g. 10.12.
              </div>
              <div className="grid gap-5 sm:grid-cols-2">
                <SelectField label="10th Score Type" value={str("class10ScoreType")} error={errors.class10ScoreType} onChange={(v) => set("class10ScoreType", v)} options={EDUCATION_SCORE_TYPE_OPTIONS} disabled={controlsDisabled} required />
                <TextField label="10th Score" value={str("class10Score")} error={errors.class10Score} onChange={(v) => set("class10Score", v)} disabled={controlsDisabled} required inputMode="decimal" maxLength={5} helper="Format: 10.12" />
                <SelectField label="12th / Diploma Score Type" value={str("class12ScoreType")} error={errors.class12ScoreType} onChange={(v) => set("class12ScoreType", v)} options={EDUCATION_SCORE_TYPE_OPTIONS} disabled={controlsDisabled} required />
                <TextField label="12th / Diploma Score" value={str("class12Score")} error={errors.class12Score} onChange={(v) => set("class12Score", v)} disabled={controlsDisabled} required inputMode="decimal" maxLength={5} helper="Format: 10.12" />
                <SelectField label="Highest Qualification" value={str("highestQualification")} error={errors.highestQualification} onChange={(v) => set("highestQualification", v)} options={QUALIFICATION_OPTIONS.map((value) => ({ value, label: value }))} disabled={controlsDisabled} required />
                <SelectField label="Highest Qualification Score Type" value={str("highestQualificationScoreType")} error={errors.highestQualificationScoreType} onChange={(v) => set("highestQualificationScoreType", v)} options={EDUCATION_SCORE_TYPE_OPTIONS} disabled={controlsDisabled} required />
                <TextField label="Highest Qualification Score" value={str("highestQualificationScore")} error={errors.highestQualificationScore} onChange={(v) => set("highestQualificationScore", v)} disabled={controlsDisabled} required inputMode="decimal" maxLength={5} helper="Format: 10.12" />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {documentControl("education_10th")}
                {documentControl("education_12th")}
                {documentControl("highest_qualification")}
              </div>
            </section>
          )}

          {activeStep === "identity" && (
            <section className="space-y-5">
              <div className="grid gap-5 sm:grid-cols-2">
                <TextField label="Aadhaar Number" value={str("aadhaarNumber")} error={errors.aadhaarNumber} onChange={(v) => set("aadhaarNumber", v)} disabled={controlsDisabled} required inputMode="numeric" maxLength={12} helper="Enter the 12-digit Aadhaar number if OCR does not fill it automatically." />
                <TextField label="PAN Number" value={str("panNumber")} error={errors.panNumber} onChange={(v) => set("panNumber", v)} disabled={controlsDisabled} required maxLength={10} />
                <SelectField
                  label="Do you have UAN number?"
                  value={hasUanNumber}
                  error={errors.hasUanNumber}
                  onChange={(v) => set("hasUanNumber", v)}
                  options={[{ value: "yes", label: "Yes" }, { value: "no", label: "No" }]}
                  disabled={controlsDisabled}
                  required
                />
                {hasUanNumber === "yes" && (
                  <TextField label="UAN Number" value={str("uanNumber")} error={errors.uanNumber} onChange={(v) => set("uanNumber", v)} disabled={controlsDisabled} required inputMode="numeric" maxLength={12} helper="Must start with 10 and be exactly 12 digits." />
                )}
              </div>
              {hasUanNumber === "no" && (
                <div className="rounded-lg border border-amber-300/40 bg-amber-500/10 p-3 text-sm text-amber-800">
                  Please apply for a UAN number and provide it as soon as possible.
                </div>
              )}
              <div className="grid gap-3 sm:grid-cols-2">
                {documentControl("aadhaar")}
                {documentControl("pan")}
              </div>
            </section>
          )}

          {activeStep === "bank" && (
            <section className="space-y-5">
              <div className="grid gap-5 sm:grid-cols-2">
                <SelectField
                  label="Do you have a savings account?"
                  value={hasSavingsAccount}
                  error={errors.hasSavingsAccount}
                  onChange={(v) => set("hasSavingsAccount", v)}
                  options={[{ value: "yes", label: "Yes" }, { value: "no", label: "No" }]}
                  disabled={controlsDisabled}
                  required
                />
                {hasSavingsAccount === "yes" && (
                  <SelectField
                    label="Do you have a salary account?"
                    value={hasSalaryAccount}
                    error={errors.hasSalaryAccount}
                    onChange={(v) => set("hasSalaryAccount", v)}
                    options={[{ value: "yes", label: "Yes" }, { value: "no", label: "No" }]}
                    disabled={controlsDisabled}
                    required
                  />
                )}
                {hasSavingsAccount === "yes" && hasSalaryAccount === "yes" && (
                  <>
                    <TextField label="Bank Account" value={str("bankAccount")} error={errors.bankAccount} onChange={(v) => set("bankAccount", v)} disabled={controlsDisabled} required inputMode="numeric" maxLength={18} />
                    <TextField label="Bank Name" value={str("bankName")} error={errors.bankName} onChange={(v) => set("bankName", v)} disabled={controlsDisabled} required />
                    <TextField label="IFSC Code" value={str("ifscCode")} error={errors.ifscCode} onChange={(v) => set("ifscCode", v)} disabled={controlsDisabled} required maxLength={11} />
                  </>
                )}
              </div>
              {hasSavingsAccount === "no" && (
                <div className="rounded-lg border border-amber-300/40 bg-amber-500/10 p-3 text-sm text-amber-800">
                  Please open an HDFC salary account. Until the salary account is opened, you will not be eligible for Salary Eligibility Validation.
                </div>
              )}
              {hasSavingsAccount === "yes" && hasSalaryAccount === "no" && (
                <div className="rounded-lg border border-amber-300/40 bg-amber-500/10 p-3 text-sm text-amber-800">
                  Please change the account type to an HDFC salary account. Until the salary account is opened, you will not be eligible for Salary Eligibility Validation.
                </div>
              )}
              {hasSavingsAccount === "yes" && hasSalaryAccount === "yes" && (
                <div className="grid gap-3 sm:grid-cols-2">
                  {documentControl("cancelled_cheque")}
                </div>
              )}
            </section>
          )}

          {activeStep === "address" && (
            <section className="space-y-5">
              <div className="grid gap-5 sm:grid-cols-2">
                <TextAreaField label="Current Address" value={str("currentAddress")} error={errors.currentAddress} onChange={(v) => set("currentAddress", v)} disabled={controlsDisabled} required />
                <TextAreaField label="Permanent Address" value={str("permanentAddress")} error={errors.permanentAddress} onChange={(v) => set("permanentAddress", v)} disabled={controlsDisabled} required />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {documentControl("permanent_address_proof")}
                {documentControl("current_address_proof")}
              </div>
            </section>
          )}
          </div>

          <div className="flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-muted-foreground">
              HR and Admin will see the latest saved employee detail form.
            </p>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
              <Button type="button" variant="outline" className="rounded-full" onClick={goPrevious} disabled={currentIndex === 0 || saving || savingProgress}>
                Previous
              </Button>
              {!formLocked && (
                <Button
                  type="button"
                  variant="outline"
                  className="rounded-full"
                  onClick={() => void handleSaveProgress()}
                  disabled={saving || savingProgress || !hasProfile || !editAccessEnabled}
                >
                  {savingProgress
                    ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Saving Progress...</>
                    : <><ClipboardCheck className="mr-2 h-4 w-4" /> Save Progress</>}
                </Button>
              )}
              {isLastStep ? (
                formLocked ? (
                  <Button type="button" className="rounded-full" onClick={editDetails} disabled={!editAccessEnabled}>
                    <Pencil className="mr-2 h-4 w-4" />
                    {editAccessEnabled ? "Edit Details" : "Edit Locked"}
                  </Button>
                ) : (
                  <Button className="rounded-full" onClick={handleSave} disabled={saving || !hasProfile || !editAccessEnabled}>
                    {saving
                      ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Saving...</>
                      : <><CheckCircle2 className="mr-2 h-4 w-4" /> Save Employee Detail Form</>}
                  </Button>
                )
              ) : (
                <Button type="button" className="rounded-full" onClick={goNext} disabled={saving || savingProgress}>
                  Next
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <Dialog open={Boolean(ocrReview)} onOpenChange={(open) => { if (!open) setOcrReview(null); }}>
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-primary" />
              {ocrReview?.title}
            </DialogTitle>
          </DialogHeader>
          {ocrReview && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">{ocrReview.note}</p>
              <div className="space-y-3">
                {ocrReview.fields.map((field, index) => (
                  <div key={field.target} className="space-y-1.5">
                    <Label className="text-sm font-medium">{field.label}</Label>
                    <Input
                      value={field.value}
                      onChange={(e) =>
                        setOcrReview((prev) => {
                          if (!prev) return prev;
                          const fields = [...prev.fields];
                          fields[index] = { ...fields[index], value: e.target.value };
                          return { ...prev, fields };
                        })
                      }
                      className="font-mono"
                    />
                  </div>
                ))}
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" className="rounded-xl text-xs" onClick={() => setOcrReview(null)}>
                  Discard — I&apos;ll type it myself
                </Button>
                <Button
                  className="rounded-xl text-xs"
                  onClick={() => {
                    ocrReview.fields.forEach((field) => {
                      if (field.value.trim()) set(field.target, field.value.trim());
                    });
                    setOcrReview(null);
                    toast.success("Verified details applied to the form.");
                  }}
                >
                  Confirm &amp; Use Details
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(preview)}
        onOpenChange={(open) => {
          if (!open) {
            setPreview((prev) => {
              if (prev?.url) URL.revokeObjectURL(prev.url);
              return null;
            });
          }
        }}
      >
        <DialogContent className="max-h-[calc(100dvh-2rem)] max-w-[calc(100vw-2rem)] overflow-y-auto border-border bg-background sm:max-w-5xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-primary" />
              {preview?.title}
            </DialogTitle>
          </DialogHeader>
          {preview && (
            preview.mimeType?.startsWith("image/") ? (
              <img
                src={preview.url}
                alt={preview.title}
                className="max-h-[70vh] w-full rounded-xl object-contain"
              />
            ) : (
              <iframe
                src={preview.url}
                title={preview.title}
                className="h-[70vh] w-full rounded-xl border"
              />
            )
          )}
        </DialogContent>
      </Dialog>

      <ImageCropDialog
        open={Boolean(cropTarget)}
        file={cropTarget?.file ?? null}
        onCancel={() => setCropTarget(null)}
        onCropped={(croppedFile) => {
          const type = cropTarget?.type;
          setCropTarget(null);
          if (type) queueDocumentFile(type, croppedFile);
        }}
      />
    </div>
  );
}

function TextField({
  label,
  value,
  error,
  onChange,
  disabled,
  required,
  type = "text",
  inputMode,
  maxLength,
  helper,
}: {
  label: string;
  value: string;
  error?: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  required?: boolean;
  type?: string;
  inputMode?: "text" | "numeric" | "tel" | "email" | "decimal" | "search" | "url";
  maxLength?: number;
  helper?: string;
}) {
  return (
    <div className="space-y-2">
      <Label className="text-xs uppercase tracking-wide text-muted-foreground">
        {label} {required && <span className="text-destructive">*</span>}
      </Label>
      <Input
        type={type}
        inputMode={inputMode}
        maxLength={maxLength}
        className="rounded-lg"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
      />
      {helper && <p className="text-xs text-muted-foreground">{helper}</p>}
      <FieldError message={error} />
    </div>
  );
}

function TextAreaField({
  label,
  value,
  error,
  onChange,
  disabled,
  required,
}: {
  label: string;
  value: string;
  error?: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  required?: boolean;
}) {
  return (
    <div className="space-y-2">
      <Label className="text-xs uppercase tracking-wide text-muted-foreground">
        {label} {required && <span className="text-destructive">*</span>}
      </Label>
      <Textarea
        className="min-h-28 rounded-lg"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
      />
      <FieldError message={error} />
    </div>
  );
}

function DateField({
  label,
  value,
  error,
  onChange,
  disabled,
  required,
}: {
  label: string;
  value: string;
  error?: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  required?: boolean;
}) {
  return (
    <div className="space-y-2">
      <Label className="text-xs uppercase tracking-wide text-muted-foreground">
        {label} {required && <span className="text-destructive">*</span>}
      </Label>
      <DatePicker value={value} onChange={onChange} disabled={disabled} className="rounded-lg" />
      <FieldError message={error} />
    </div>
  );
}

function SelectField({
  label,
  value,
  error,
  onChange,
  options,
  disabled,
  required,
  onOpen,
  loading,
  loadingLabel,
}: {
  label: string;
  value: string;
  error?: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  disabled?: boolean;
  required?: boolean;
  onOpen?: () => void;
  loading?: boolean;
  loadingLabel?: string;
}) {
  return (
    <div className="space-y-2">
      <Label className="text-xs uppercase tracking-wide text-muted-foreground">
        {label} {required && <span className="text-destructive">*</span>}
      </Label>
      <Select
        value={value}
        onValueChange={(nextValue) => onChange(nextValue ?? "")}
        onOpenChange={(open) => {
          if (open) onOpen?.();
        }}
        disabled={disabled}
      >
        <SelectTrigger className="h-10 w-full rounded-lg px-3 py-2 text-sm">
          <SelectValue placeholder={`Select ${label.toLowerCase()}`}>
            {(selected) =>
              options.find((option) => option.value === selected)?.label ??
              `Select ${label.toLowerCase()}`
            }
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {loading && (
            <SelectItem value={`__loading_${label.toLowerCase().replace(/\s+/g, "_")}__`} disabled>
              {loadingLabel ?? "Loading latest options..."}
            </SelectItem>
          )}
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <FieldError message={error} />
    </div>
  );
}

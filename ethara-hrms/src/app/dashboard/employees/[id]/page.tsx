"use client";

import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  AlertCircle,
  ArrowLeft,
  ClipboardCheck,
  Eye,
  FileBadge2,
  FileText,
  LockKeyhole,
  Loader2,
  Mail,
  Phone,
  ShieldCheck,
  Star,
  UnlockKeyhole,
  UserCheck,
  UserX,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { IdCardDetailsCard } from "@/components/employees/id-card-details-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DatePicker } from "@/components/ui/date-picker";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { ContractTab } from "@/components/contracts/ContractTab";
import { EvaluationView } from "@/components/employee-evaluation/evaluation-view";
import {
  employeesApi,
  separationApi,
  type EmployeeDetailRecord,
  type EmployeeDocumentRecord,
  type EmployeeJourneyStageRecord,
  type EmployeeSelectionFormRecord,
} from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { queryKeys, useEmployeeDetail } from "@/lib/queries";
import { cn, formatLabel, getInitials, hasAssignedRole, timeAgo } from "@/lib/utils";

const REQUIRED_EMPLOYEE_DOCUMENTS = [
  { type: "resume", label: "Resume" },
  { type: "photo", label: "Passport Size Photo" },
  { type: "aadhaar", label: "Aadhaar Card" },
  { type: "pan", label: "PAN Card" },
  { type: "education_10th", label: "10th Marksheet / Certificate" },
  { type: "education_12th", label: "12th / Diploma Marksheet / Certificate" },
  { type: "highest_qualification", label: "Highest Qualification Certificate" },
  { type: "cancelled_cheque", label: "Cancelled Cheque / Passbook Photo" },
  { type: "permanent_address_proof", label: "Permanent Address Proof" },
] as const;

const EMPLOYEE_DETAIL_FORM_GROUPS = [
  {
    title: "Employment",
    fields: [
      { key: "employeeCode", label: "Employee Code" },
      { key: "employeeName", label: "Employee Name" },
      { key: "department", label: "Department" },
      { key: "designation", label: "Designation" },
      { key: "dateOfBirth", label: "Date Of Birth" },
      { key: "gender", label: "Gender" },
      { key: "contactNumber", label: "Contact Number" },
      { key: "bloodGroup", label: "Blood Group" },
      { key: "personalEmail", label: "Personal Email" },
      { key: "officialEmail", label: "Official Email" },
    ],
  },
  {
    title: "Family",
    fields: [
      { key: "maritalStatus", label: "Marital Status" },
      { key: "marriageDate", label: "Marriage Date" },
      { key: "spouseName", label: "Spouse Name" },
      { key: "spouseDateOfBirth", label: "Spouse DOB" },
      { key: "spouseGender", label: "Spouse Gender" },
      { key: "hasKids", label: "Kids" },
      { key: "child1Name", label: "Child 1 Name" },
      { key: "child1DateOfBirth", label: "Child 1 DOB" },
      { key: "child1Gender", label: "Child 1 Gender" },
      { key: "child2Name", label: "Child 2 Name" },
      { key: "child2DateOfBirth", label: "Child 2 DOB" },
      { key: "child2Gender", label: "Child 2 Gender" },
      { key: "fatherName", label: "Father's Name" },
      { key: "fatherDateOfBirth", label: "Father's DOB" },
      { key: "motherName", label: "Mother's Name" },
      { key: "motherDateOfBirth", label: "Mother's DOB" },
    ],
  },
  {
    title: "Education",
    fields: [
      { key: "class10ScoreType", label: "10th Score Type" },
      { key: "class10Score", label: "10th Score" },
      { key: "class12ScoreType", label: "12th / Diploma Score Type" },
      { key: "class12Score", label: "12th / Diploma Score" },
      { key: "highestQualification", label: "Highest Qualification" },
      { key: "highestQualificationScoreType", label: "Highest Qualification Score Type" },
      { key: "highestQualificationScore", label: "Highest Qualification Score" },
    ],
  },
  {
    title: "Identity & Emergency",
    fields: [
      { key: "emergencyContactName", label: "Emergency Contact Name" },
      { key: "emergencyContactPhone", label: "Emergency Contact" },
      { key: "emergencyContactRelation", label: "Emergency Contact Relation" },
      { key: "aadhaarNumber", label: "Aadhaar Number" },
      { key: "panNumber", label: "PAN Number" },
      { key: "uanNumber", label: "UAN Number" },
    ],
  },
  {
    title: "Bank",
    fields: [
      { key: "bankAccount", label: "Bank Account" },
      { key: "bankName", label: "Bank Name" },
      { key: "ifscCode", label: "IFSC Code" },
    ],
  },
  {
    title: "Address",
    fields: [
      { key: "currentAddress", label: "Current Address" },
      { key: "permanentAddress", label: "Permanent Address" },
    ],
  },
] as const;

const INVOLUNTARY_TYPES = ["termination", "no_show", "absconding"] as const;

const INVOLUNTARY_LABEL: Record<(typeof INVOLUNTARY_TYPES)[number], string> = {
  termination: "Terminated",
  no_show: "No Show",
  absconding: "Absconding",
};

function createMissingEmployeeDocument(
  type: string,
  label: string,
): EmployeeDocumentRecord {
  return {
    id: type,
    type,
    label,
    fileName: null,
    mimeType: null,
    uploadedAt: null,
    verificationStatus: "missing",
    remarks: `${label} is still required.`,
    missing: true,
    canPreview: false,
    previewEndpoint: null,
    downloadEndpoint: null,
  };
}

function buildSelectionFormDefaults(
  employee?: EmployeeDetailRecord | null,
): Record<string, unknown> {
  return {
    employeeCode: employee?.employeeCode ?? "",
    employeeName: employee?.fullName ?? employee?.name ?? "",
    department: employee?.department ?? "",
    designation: employee?.designation ?? "",
    dateOfBirth: employee?.dateOfBirth ? String(employee.dateOfBirth).slice(0, 10) : "",
    gender: employee?.gender ?? "",
    contactNumber: employee?.phone ?? "",
    bloodGroup: employee?.bloodGroup ?? "",
    personalEmail: employee?.personalEmail ?? "",
    officialEmail: employee?.etharaEmail ?? "",
    aadhaarNumber: employee?.aadhaarLast4 ? `**** **** ${employee.aadhaarLast4}` : "",
    maritalStatus: "",
    marriageDate: "",
    spouseName: "",
    spouseDateOfBirth: "",
    spouseGender: "",
    hasKids: "no",
    child1Name: "",
    child1DateOfBirth: "",
    child1Gender: "",
    child2Name: "",
    child2DateOfBirth: "",
    child2Gender: "",
    class10ScoreType: "percentage",
    class10Score: "",
    class12ScoreType: "percentage",
    class12Score: "",
    highestQualification: "",
    highestQualificationScoreType: "percentage",
    highestQualificationScore: "",
    fatherName: "",
    fatherDateOfBirth: "",
    motherName: "",
    motherDateOfBirth: "",
    emergencyContactName: "",
    emergencyContactPhone: "",
    emergencyContactRelation: "",
    panNumber: "",
    uanNumber: "",
    bankName: "",
    bankAccount: "",
    ifscCode: "",
    currentAddress: "",
    permanentAddress: "",
  };
}

function normalizeSelectionForm(
  selectionForm: EmployeeSelectionFormRecord | null | undefined,
  employee?: EmployeeDetailRecord | null,
): EmployeeSelectionFormRecord {
  return {
    id: selectionForm?.id ?? null,
    status: selectionForm?.status ?? "draft",
    formData: {
      ...buildSelectionFormDefaults(employee),
      ...((selectionForm?.formData as
        | Record<string, unknown>
        | null
        | undefined) ?? {}),
    },
    submittedAt: selectionForm?.submittedAt ?? null,
    reviewedAt: selectionForm?.reviewedAt ?? null,
    reviewedBy: selectionForm?.reviewedBy ?? null,
    remarks: selectionForm?.remarks ?? null,
    editAccessEnabled: selectionForm?.editAccessEnabled ?? employee?.editAccessEnabled ?? true,
    createdAt: selectionForm?.createdAt ?? null,
    updatedAt: selectionForm?.updatedAt ?? null,
  };
}

function buildDocumentCompletionStatus(documents: EmployeeDocumentRecord[]) {
  const completed = documents.filter(
    (document) => !document.missing,
  ).length;
  const verifiedOrUploaded = documents.filter(
    (document) =>
      !document.missing &&
      ["uploaded", "verified", "submitted", "extracted", "signed"].includes(
        document.verificationStatus,
      ),
  ).length;
  const missing = documents
    .filter((document) => document.missing)
    .map((document) => document.label);

  return {
    completed,
    total: documents.length,
    verifiedOrUploaded,
    missing,
    percentage:
      documents.length > 0
        ? Math.round((completed / documents.length) * 100)
        : 0,
  };
}

const AADHAAR_VERIFIED_STATUSES = new Set([
  "passed",
  "matched",
  "verified",
  "validated",
]);

const AADHAAR_REVIEW_STATUSES = new Set([
  "failed",
  "mismatch",
  "needs_review",
  "needs_correction",
  "incorrect",
  "rejected",
]);

function normalizedStatus(value?: string | null) {
  return (value || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function latestUploadedAadhaarDocument(employee: EmployeeDetailRecord | null) {
  return (
    employee?.documents.find(
      (document) => document.type === "aadhaar" && !document.missing,
    ) ?? null
  );
}

function employeeAadhaarReviewState(employee: EmployeeDetailRecord | null) {
  if (!employee) return { label: "Not submitted", state: "missing" as const };

  const validationStatus = normalizedStatus(employee.aadhaarValidationStatus);
  const ocrStatus = normalizedStatus(employee.aadhaarOcrStatus);
  const aadhaarDocument = latestUploadedAadhaarDocument(employee);
  const documentStatus = normalizedStatus(aadhaarDocument?.verificationStatus);

  if (
    AADHAAR_VERIFIED_STATUSES.has(validationStatus) ||
    employee.aadhaarOcrMatch === true ||
    documentStatus === "verified"
  ) {
    return { label: "Verified", state: "verified" as const };
  }

  if (
    AADHAAR_REVIEW_STATUSES.has(validationStatus) ||
    AADHAAR_REVIEW_STATUSES.has(ocrStatus) ||
    employee.aadhaarOcrMatch === false ||
    aadhaarDocument?.needsReview
  ) {
    return { label: "Needs review", state: "needs_review" as const };
  }

  if (employee.aadhaarLast4 || employee.aadhaarOcrStatus || aadhaarDocument) {
    return { label: "Uploaded", state: "uploaded" as const };
  }

  return { label: "Not submitted", state: "missing" as const };
}

function buildProfileJourney(detail: {
  fullName: string;
  etharaEmail: string;
  employeeCode?: string | null;
  selectionForm: EmployeeSelectionFormRecord;
  documents: EmployeeDocumentRecord[];
  contracts: EmployeeDetailRecord["contracts"];
  complianceForms: EmployeeDetailRecord["complianceForms"];
}): EmployeeJourneyStageRecord[] {
  const requiredDocuments = detail.documents.filter((document) =>
    REQUIRED_EMPLOYEE_DOCUMENTS.some(
      (requiredDocument) => requiredDocument.type === document.type,
    ),
  );
  const missingDocuments = requiredDocuments.some(
    (document) => document.missing,
  );
  const rejectedDocuments = requiredDocuments.some((document) =>
    ["rejected", "needs_correction"].includes(document.verificationStatus),
  );
  const contractSigned = detail.contracts.some(
    (contract) => contract.status === "signed",
  );
  const contractWarning = detail.contracts.some(
    (contract) => contract.status === "expired",
  );
  const complianceWarning = detail.complianceForms.some((form) =>
    ["rejected", "needs_correction"].includes(form.status),
  );
  const compliancePending = detail.complianceForms.some(
    (form) => !["submitted", "verified"].includes(form.status),
  );

  return [
    {
      key: "basic_profile",
      title: "Basic profile completed",
      status:
        detail.fullName && detail.etharaEmail && detail.employeeCode
          ? "completed"
          : "pending",
      description:
        "Employee profile and company contact details are available.",
    },
    {
      key: "selection_form",
      title: "Employee detail form submitted",
      status:
        detail.selectionForm.status === "submitted" ? "completed" : "pending",
      description: "Employee detail form is available for HR review.",
    },
    {
      key: "documents",
      title: "Documents uploaded",
      status: rejectedDocuments
        ? "warning"
        : missingDocuments
          ? "pending"
          : "completed",
      description:
        "Required onboarding documents are listed here whether uploaded or not.",
    },
    {
      key: "contract",
      title: "Contract completed",
      status: contractSigned
        ? "completed"
        : contractWarning
          ? "warning"
          : "pending",
      description:
        "Assigned employment contracts and their status appear here.",
    },
    {
      key: "compliance",
      title: "Compliance submitted",
      status: complianceWarning
        ? "warning"
        : compliancePending
          ? "pending"
          : "completed",
      description: "Compliance forms remain visible even before submission.",
    },
    {
      key: "referral",
      title: "Referral module available",
      status: "completed",
      description:
        "Referral activity stays visible even if nothing has been referred yet.",
    },
  ];
}

function formatEmployeeDetailValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return "—";
    if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return trimmed.slice(0, 10);
    return formatLabel(trimmed);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

const PENDING_DETAIL_REGISTRATION_STATUSES = new Set([
  "account_activation_pending",
  "candidate_onboarding_pending",
  "imported_pending",
  "needs_repair",
]);
const OFFBOARDED_DETAIL_STATUS_TERMS = [
  "offboard",
  "resign",
  "terminated",
  "termination",
  "no show",
  "no_show",
  "abscond",
  "blacklist",
  "separated",
  "inactive",
];

function normalizedStatusKey(value?: string | null) {
  return String(value ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function hasOffboardedDetailStatus(employee: EmployeeDetailRecord) {
  const status = normalizedStatusKey(employee.employmentStatus ?? employee.currentEmployeeStatus);
  return OFFBOARDED_DETAIL_STATUS_TERMS.some((term) =>
    status.includes(normalizedStatusKey(term)),
  );
}

function employeeHeaderStatus(employee: EmployeeDetailRecord) {
  const registrationStatus = normalizedStatusKey(employee.registrationStatus);
  if (hasOffboardedDetailStatus(employee)) {
    return {
      label: "Offboarded",
      variant: "secondary" as const,
      className: "capitalize",
    };
  }
  if (
    PENDING_DETAIL_REGISTRATION_STATUSES.has(registrationStatus) ||
    !employee.isActive
  ) {
    return {
      label: "Pending Activation",
      variant: "outline" as const,
      className: "border-warning/40 bg-warning/10 text-warning",
    };
  }
  return {
    label: "Active",
    variant: "default" as const,
    className: "capitalize",
  };
}

function normalizeEmployeeDetail(
  employeeId: string,
  source: EmployeeDetailRecord | null | undefined,
): EmployeeDetailRecord {
  const requiredDocuments = REQUIRED_EMPLOYEE_DOCUMENTS.map(
    ({ type, label }) => {
      const existing = source?.documents?.find(
        (document) => document.type === type,
      );
      return existing ?? createMissingEmployeeDocument(type, label);
    },
  );
  const extraDocuments = (source?.documents ?? []).filter(
    (document) =>
      !REQUIRED_EMPLOYEE_DOCUMENTS.some(
        (requiredDocument) => requiredDocument.type === document.type,
      ),
  );
  const documents = [...requiredDocuments, ...extraDocuments];
  const selectionForm = normalizeSelectionForm(
    source?.selectionForm,
    source,
  );
  const documentCompletionStatus = buildDocumentCompletionStatus(documents);
  const profileJourney = source?.profileJourney?.length
    ? source.profileJourney
    : buildProfileJourney({
        fullName: source?.fullName ?? source?.name ?? "Employee",
        etharaEmail: source?.etharaEmail ?? "",
        employeeCode: source?.employeeCode ?? null,
        selectionForm,
        documents,
        contracts: source?.contracts ?? [],
        complianceForms: source?.complianceForms ?? [],
      });
  const nextRequiredAction =
    source?.nextRequiredAction ??
    profileJourney.find(
      (stage) =>
        [
          "basic_profile",
          "selection_form",
          "documents",
          "contract",
          "compliance",
        ].includes(stage.key) && stage.status !== "completed",
    )?.title ??
    "All employee sections are available.";

  return {
    id: source?.id ?? employeeId,
    userId: source?.userId ?? null,
    name: source?.name ?? source?.fullName ?? "Employee",
    fullName: source?.fullName ?? source?.name ?? "Employee",
    etharaEmail: source?.etharaEmail ?? "Not available",
    personalEmail: source?.personalEmail ?? undefined,
    employeeCode: source?.employeeCode ?? "Pending",
    linkedCandidateId: source?.linkedCandidateId ?? null,
    linkedCandidateStage: source?.linkedCandidateStage ?? null,
    phone: source?.phone ?? undefined,
    department: source?.department ?? undefined,
    designation: source?.designation ?? undefined,
    gender: source?.gender ?? undefined,
    vendor: source?.vendor ?? null,
    workMode: source?.workMode ?? null,
    employmentStatus: source?.employmentStatus ?? null,
    dateOfJoining: source?.dateOfJoining ?? null,
    aadhaarLast4: source?.aadhaarLast4 ?? undefined,
    aadhaarOcrStatus: source?.aadhaarOcrStatus ?? undefined,
    aadhaarValidationStatus: source?.aadhaarValidationStatus ?? null,
    aadhaarMismatchReason: source?.aadhaarMismatchReason ?? null,
    aadhaarOcrMatch: source?.aadhaarOcrMatch ?? null,
    dateOfBirth: source?.dateOfBirth ?? undefined,
    resumePath: source?.resumePath ?? undefined,
    isActive: source?.isActive ?? false,
    editAccessEnabled: source?.editAccessEnabled ?? selectionForm.editAccessEnabled ?? true,
    createdAt: source?.createdAt ?? new Date(0).toISOString(),
    managerId: source?.managerId ?? null,
    managerName: source?.managerName ?? null,
    managerEmail: source?.managerEmail ?? null,
    bloodGroup: source?.bloodGroup ?? null,
    emergencyContactName: source?.emergencyContactName ?? null,
    emergencyContactPhone: source?.emergencyContactPhone ?? null,
    registrationStatus:
      source?.registrationStatus ??
      (source?.userId ? "completed" : "needs_repair"),
    currentEmployeeStatus:
      source?.currentEmployeeStatus ??
      (source?.isActive ? "active" : "offboarded"),
    documentCompletionStatus,
    resumeDocument:
      documents.find((document) => document.type === "resume") ?? null,
    documents,
    missingDocuments: documentCompletionStatus.missing,
    selectionForm,
    contracts: source?.contracts ?? [],
    complianceForms: source?.complianceForms ?? [],
    referralActivity: source?.referralActivity ?? [],
    profileJourney,
    profileCompletionPercentage:
      source?.profileCompletionPercentage ??
      documentCompletionStatus.percentage,
    nextRequiredAction,

    auditLogs: source?.auditLogs ?? [],
    timeline: source?.timeline ?? [],
    updatedAt: source?.updatedAt ?? null,
  };
}

function StatusPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-xl border border-border bg-muted/20 px-3 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 break-words text-sm font-medium capitalize">
        {formatLabel(value)}
      </p>
    </div>
  );
}

export default function EmployeeDetailPage() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const employeeId = String(params.id || "");
  const { data: employeeData, isLoading, isError, error } = useEmployeeDetail(employeeId);
  const employee = useMemo(
    () => normalizeEmployeeDetail(employeeId, employeeData),
    [employeeData, employeeId],
  );
  const aadhaarReviewState = useMemo(
    () => employeeAadhaarReviewState(employee),
    [employee],
  );
  const headerStatus = useMemo(() => employeeHeaderStatus(employee), [employee]);

  const [selectedDocument, setSelectedDocument] =
    useState<EmployeeDocumentRecord | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewingDocumentId, setPreviewingDocumentId] = useState<
    string | null
  >(null);
  const [reviewingDocumentId, setReviewingDocumentId] = useState<string | null>(null);
  const [incorrectDocument, setIncorrectDocument] = useState<EmployeeDocumentRecord | null>(null);
  const [incorrectRemarks, setIncorrectRemarks] = useState("");
  const [involuntaryOpen, setInvoluntaryOpen] = useState(false);
  const [involuntaryType, setInvoluntaryType] =
    useState<(typeof INVOLUNTARY_TYPES)[number]>("termination");
  const [involuntaryReason, setInvoluntaryReason] = useState("");
  const [involuntaryRemarks, setInvoluntaryRemarks] = useState("");
  const [involuntaryDate, setInvoluntaryDate] = useState("");
  const [markingInvoluntary, setMarkingInvoluntary] = useState(false);
  const [editAccessSaving, setEditAccessSaving] = useState(false);
  const canManageEditAccess = Boolean(
    hasAssignedRole(user, ["admin", "super_admin", "hr", "ta", "it_team"]),
  );
  // HR/admin-only employment fields (Vendor / Work Mode / Date of Joining).
  const canEditHrFields = Boolean(
    hasAssignedRole(user, ["admin", "super_admin", "hr", "ta"]),
  );
  // The evaluation "Performance" tab is admin/HR-only — it surfaces evaluation
  // signals, AI insight and skill editing that other viewers must not see.
  const canViewPerformance = hasAssignedRole(user, ["super_admin", "admin", "leadership", "hr"]);
  const [hrSaving, setHrSaving] = useState(false);
  const [vendorInput, setVendorInput] = useState("");
  const [workModeInput, setWorkModeInput] = useState("");
  const [dojInput, setDojInput] = useState("");
  // Employee-code editing (HR/admin) + conflict resolution.
  const [editingCode, setEditingCode] = useState(false);
  const [codeInput, setCodeInput] = useState("");
  const [codeSaving, setCodeSaving] = useState(false);
  const [codeConflict, setCodeConflict] = useState<{
    type: string;
    id: string;
    name?: string | null;
    email?: string | null;
    employeeCode?: string | null;
    employmentStatus?: string | null;
    currentStatus?: string | null;
  } | null>(null);
  const [activeTab, setActiveTab] = useState("overview");
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    setVendorInput(employee.vendor ?? "");
    setWorkModeInput(employee.workMode ?? "");
    setDojInput(
      employee.dateOfJoining ? String(employee.dateOfJoining).slice(0, 10) : "",
    );
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [employee.vendor, employee.workMode, employee.dateOfJoining]);
  const editAccessEnabled = employee.selectionForm.editAccessEnabled ?? employee.editAccessEnabled ?? true;

  const documents = employee.documents;
  const aadhaarDocument = useMemo(
    () => latestUploadedAadhaarDocument(employee),
    [employee],
  );
  const canManuallyVerifyAadhaar = Boolean(
    canEditHrFields &&
      aadhaarReviewState.state !== "verified" &&
      aadhaarDocument &&
      !aadhaarDocument.missing,
  );
  const passportPhotoDocument = useMemo(
    () =>
      documents.find(
        (document) =>
          document.type === "photo" &&
          !document.missing &&
          document.previewEndpoint,
      ) ?? null,
    [documents],
  );
  const [employeePhotoUrl, setEmployeePhotoUrl] = useState<string | null>(null);

  useEffect(() => {
    const firstPreviewable = employee.documents.find(
      (document) => !document.missing && document.canPreview,
    );
    const timeoutId = window.setTimeout(() => {
      setSelectedDocument(
        firstPreviewable ??
          employee.resumeDocument ??
          employee.documents[0] ??
          null,
      );
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [employee]);

  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;

    if (!passportPhotoDocument?.previewEndpoint) {
      const timeoutId = window.setTimeout(() => setEmployeePhotoUrl(null), 0);
      return () => window.clearTimeout(timeoutId);
    }

    employeesApi
      .getBlobFromEndpoint(passportPhotoDocument.previewEndpoint)
      .then((blob) => {
        if (!active) return;
        objectUrl = URL.createObjectURL(blob);
        setEmployeePhotoUrl(objectUrl);
      })
      .catch(() => {
        if (active) setEmployeePhotoUrl(null);
      });

    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [passportPhotoDocument?.previewEndpoint]);

  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;

    const loadPreview = async () => {
      if (
        !selectedDocument ||
        selectedDocument.missing ||
        !selectedDocument.canPreview ||
        !selectedDocument.previewEndpoint
      ) {
        setPreviewUrl(null);
        return;
      }
      setPreviewingDocumentId(selectedDocument.id);
      try {
        const blob = await employeesApi.getBlobFromEndpoint(
          selectedDocument.previewEndpoint,
        );
        objectUrl = URL.createObjectURL(blob);
        if (active) setPreviewUrl(objectUrl);
      } catch {
        if (active) {
          setPreviewUrl(null);
          toast.error("Could not load document preview.");
        }
      } finally {
        if (active) setPreviewingDocumentId(null);
      }
    };

    void loadPreview();

    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [employee, selectedDocument]);

  const overview = useMemo(() => {
    return [
      { label: "Registration", value: employee.registrationStatus },
      { label: "Employee Status", value: employee.currentEmployeeStatus },
      {
        label: "Aadhaar",
        value: aadhaarReviewState.label,
      },
      {
        label: "Documents",
        value: `${employee.documentCompletionStatus.completed}/${employee.documentCompletionStatus.total} complete`,
      },
    ];
  }, [aadhaarReviewState.label, employee]);
  const employeeTabs = [
    { value: "overview", label: "Overview", icon: UserCheck },
    { value: "documents", label: "Documents", icon: FileText },
    { value: "detail-form", label: "Detail Form", icon: ClipboardCheck },
    { value: "id-card", label: "ID Card", icon: FileBadge2 },
    { value: "contracts", label: "Contracts", icon: FileBadge2 },
    { value: "compliance", label: "Compliance", icon: ShieldCheck },
    { value: "activity", label: "Activity", icon: Users },
    // Admin/HR-only evaluation view.
    ...(canViewPerformance ? [{ value: "performance", label: "Performance", icon: Star }] : []),
  ];

  const handleEditAccessToggle = async () => {
    setEditAccessSaving(true);
    try {
      const nextEnabled = !editAccessEnabled;
      await employeesApi.updateEditAccess(employee.id, nextEnabled);
      toast.success(`Employee edit access ${nextEnabled ? "enabled" : "disabled"}.`);
      await Promise.all([
        qc.invalidateQueries({
          queryKey: queryKeys.employeeDetail(employeeId),
        }),
        qc.invalidateQueries({ queryKey: ["employees"] }),
      ]);
    } catch {
      toast.error("Could not update employee edit access.");
    } finally {
      setEditAccessSaving(false);
    }
  };

  const [sendingCompliance, setSendingCompliance] = useState(false);
  const handleSendCompliance = async () => {
    setSendingCompliance(true);
    try {
      await employeesApi.sendComplianceEsign(employee.id);
      toast.success("Compliance forms sent to the employee's Ethara email for e-signature.");
      await qc.invalidateQueries({ queryKey: queryKeys.employeeDetail(employeeId) });
    } catch (err) {
      const detail =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      toast.error(detail || "Could not send compliance forms.");
    } finally {
      setSendingCompliance(false);
    }
  };

  const [verifyingDocs, setVerifyingDocs] = useState(false);
  const handleValidateDocument = async (document: EmployeeDocumentRecord) => {
    setReviewingDocumentId(document.id);
    try {
      await employeesApi.reviewDocument(employee.id, document.id, {
        status: "validated",
      });
      toast.success(`${document.label} marked validated.`);
      await Promise.all([
        qc.invalidateQueries({ queryKey: queryKeys.employeeDetail(employeeId) }),
        qc.invalidateQueries({ queryKey: ["employees"] }),
      ]);
    } catch (err) {
      const detail =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      toast.error(detail || "Could not validate document.");
    } finally {
      setReviewingDocumentId(null);
    }
  };

  const handleVerifyAadhaarManually = async () => {
    if (!aadhaarDocument || aadhaarDocument.missing) {
      toast.error("No uploaded Aadhaar document found.");
      return;
    }
    await handleValidateDocument(aadhaarDocument);
  };

  const openIncorrectDocumentDialog = (document: EmployeeDocumentRecord) => {
    setIncorrectDocument(document);
    setIncorrectRemarks(
      document.type === "aadhaar"
        ? "Aadhaar document did not pass HR review. Please upload a clear and correct Aadhaar card."
        : `${document.label} did not pass HR review. Please upload a corrected document.`,
    );
  };

  const handleMarkDocumentIncorrect = async () => {
    if (!incorrectDocument || !incorrectRemarks.trim()) return;
    setReviewingDocumentId(incorrectDocument.id);
    try {
      await employeesApi.reviewDocument(employee.id, incorrectDocument.id, {
        status: "incorrect",
        remarks: incorrectRemarks.trim(),
      });
      toast.success(`${incorrectDocument.label} marked incorrect. Employee notified by email.`);
      setIncorrectDocument(null);
      setIncorrectRemarks("");
      await Promise.all([
        qc.invalidateQueries({ queryKey: queryKeys.employeeDetail(employeeId) }),
        qc.invalidateQueries({ queryKey: ["employees"] }),
      ]);
    } catch (err) {
      const detail =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      toast.error(detail || "Could not mark document incorrect.");
    } finally {
      setReviewingDocumentId(null);
    }
  };

  const handleVerifyDocuments = async () => {
    setVerifyingDocs(true);
    try {
      const result = await employeesApi.verifyAllDocuments(employee.id);
      if (!result.enabled) {
        toast.error(result.message || "AI document verification is not enabled.");
        return;
      }
      if (result.total === 0) {
        toast.info("No verifiable documents found for this employee.");
      } else if (result.needsReview > 0 || result.failed > 0) {
        toast.warning(
          `Checked ${result.total}: ${result.verified} verified, ` +
            `${result.needsReview} need review${result.failed ? `, ${result.failed} unreadable` : ""}.`,
        );
      } else {
        toast.success(`All ${result.verified} document(s) verified successfully.`);
      }
      await qc.invalidateQueries({ queryKey: queryKeys.employeeDetail(employeeId) });
    } catch (err) {
      const detail =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      toast.error(detail || "Could not verify documents.");
    } finally {
      setVerifyingDocs(false);
    }
  };

  const handleSaveHrFields = async () => {
    setHrSaving(true);
    try {
      await employeesApi.updateHrFields(employee.id, {
        vendor: vendorInput.trim(),
        workMode: workModeInput.trim(),
        dateOfJoining: dojInput || "",
      });
      toast.success("Employment details updated.");
      await Promise.all([
        qc.invalidateQueries({
          queryKey: queryKeys.employeeDetail(employeeId),
        }),
        qc.invalidateQueries({ queryKey: ["employees"] }),
      ]);
    } catch {
      toast.error("Could not update employment details.");
    } finally {
      setHrSaving(false);
    }
  };

  const startEditingCode = () => {
    setCodeInput(employee.employeeCode ?? "");
    setEditingCode(true);
  };

  const handleSaveEmployeeCode = async () => {
    const next = codeInput.trim().toUpperCase().replace(/\s+/g, "");
    if (!/^GRP\d+$/.test(next)) {
      toast.error("Employee code must look like GRP1234 (GRP followed by digits).");
      return;
    }
    if (next === (employee.employeeCode ?? "").toUpperCase()) {
      setEditingCode(false);
      return;
    }
    setCodeSaving(true);
    try {
      const result = await employeesApi.updateEmployeeCode(employee.id, next);
      const moved = Object.entries(result.propagated ?? {})
        .map(([k, v]) => `${v} ${k}`)
        .join(", ");
      toast.success(
        `Employee code updated to ${result.employeeCode}.${moved ? ` Synced: ${moved}.` : ""}`,
      );
      setEditingCode(false);
      await Promise.all([
        qc.invalidateQueries({ queryKey: queryKeys.employeeDetail(employeeId) }),
        qc.invalidateQueries({ queryKey: ["employees"] }),
      ]);
    } catch (error) {
      const detail = (error as { response?: { data?: { detail?: unknown }; status?: number } })
        ?.response?.data?.detail;
      if (detail && typeof detail === "object" && "conflict" in detail) {
        const d = detail as { message?: string; conflict: typeof codeConflict };
        setCodeConflict(d.conflict);
      } else {
        toast.error(
          (typeof detail === "string" && detail) || "Could not update the employee code.",
        );
      }
    } finally {
      setCodeSaving(false);
    }
  };

  const openInvoluntaryDialog = () => {
    setInvoluntaryType("termination");
    setInvoluntaryReason("");
    setInvoluntaryRemarks("");
    setInvoluntaryDate(new Date().toISOString().slice(0, 10));
    setInvoluntaryOpen(true);
  };

  const handleMarkInvoluntary = async () => {
    if (!involuntaryReason.trim() || !involuntaryDate) {
      toast.error("Reason and effective date are required.");
      return;
    }
    setMarkingInvoluntary(true);
    try {
      await separationApi.terminate({
        employeeProfileId: employee.id,
        separationType: involuntaryType,
        reason: involuntaryReason.trim(),
        remarks: involuntaryRemarks.trim() || undefined,
        effectiveDate: new Date(involuntaryDate).toISOString(),
      });
      toast.success(
        `${employee.fullName || employee.name} marked as ${INVOLUNTARY_LABEL[involuntaryType]}. Access deactivation started.`,
      );
      setInvoluntaryOpen(false);
      await Promise.all([
        qc.invalidateQueries({
          queryKey: queryKeys.employeeDetail(employeeId),
        }),
        qc.invalidateQueries({ queryKey: ["employees"] }),
      ]);
    } catch (err) {
      const apiErr = err as { response?: { data?: { detail?: string } } };
      toast.error(
        apiErr.response?.data?.detail ||
          "Could not update employee separation status.",
      );
    } finally {
      setMarkingInvoluntary(false);
    }
  };

  if (isLoading && !employeeData) {
    return (
      <div className="space-y-4 animate-fade-in">
        <Skeleton className="h-10 w-48" />
        <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
          <Skeleton className="h-[340px] rounded-2xl" />
          <Skeleton className="h-[340px] rounded-2xl" />
        </div>
        <Skeleton className="h-[220px] rounded-2xl" />
      </div>
    );
  }

  if (isError && !employeeData) {
    const apiError = error as { response?: { status?: number; data?: { detail?: string } } } | null;
    const isAccessDenied = apiError?.response?.status === 403;
    return (
      <div className="space-y-4 animate-fade-in">
        <Link href="/dashboard/employees">
          <Button variant="ghost" size="sm" className="rounded-xl text-xs">
            <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
            Back to Employees
          </Button>
        </Link>
        <Card className="border-destructive/30 bg-destructive/5">
          <CardContent className="p-8 text-center">
            <AlertCircle className="mx-auto mb-3 h-10 w-10 text-destructive" />
            <h3 className="font-semibold">
              {isAccessDenied ? "Employee profile access restricted" : "Employee not found"}
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {apiError?.response?.data?.detail ||
                (isAccessDenied
                  ? "Only Admin, HR, and TA users can open full employee details."
                  : "This employee record does not exist or could not be loaded.")}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-w-0 max-w-full space-y-4 overflow-x-hidden animate-fade-in">
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/dashboard/employees">
          <Button variant="ghost" size="sm" className="rounded-xl text-xs">
            <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
            Back to Employees
          </Button>
        </Link>
      </div>

      <div className="grid gap-4">
        <Card className="border-0 shadow-sm lg:col-span-2">
          <CardContent className="p-4 sm:p-6">
            <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex min-w-0 items-start gap-3 sm:items-center sm:gap-4">
                <Avatar className="h-16 w-16 shrink-0 sm:h-20 sm:w-20">
                  {employeePhotoUrl && (
                    <AvatarImage
                      src={employeePhotoUrl}
                      alt={`${employee.fullName || employee.name} passport photo`}
                    />
                  )}
                  <AvatarFallback className="bg-primary/10 text-primary">
                    {getInitials(employee.fullName || employee.name)}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <h1 className="min-w-0 break-words text-xl font-bold tracking-tight sm:truncate sm:text-2xl">
                      {employee.fullName || employee.name}
                    </h1>
                    <Badge
                      variant={headerStatus.variant}
                      className={headerStatus.className}
                    >
                      {headerStatus.label}
                    </Badge>
                    {employee.identityValidation &&
                      (employee.identityValidation.status === "verified" ||
                        employee.identityValidation.status === "mismatch") && (
                        <Badge
                          variant="outline"
                          title={
                            employee.identityValidation.reason ||
                            "Registration and onboarding identity match (Name + Aadhaar)."
                          }
                          className={
                            employee.identityValidation.status === "verified"
                              ? "border-success/40 bg-success/10 text-success"
                              : "border-destructive/40 bg-destructive/10 text-destructive"
                          }
                        >
                          {employee.identityValidation.status === "verified"
                            ? "ID Verified"
                            : "ID Mismatch"}
                        </Badge>
                      )}
                  </div>
                  <p className="mt-1 break-words text-sm text-muted-foreground">
                    {employee.designation || "Employee"}
                    {employee.department ? ` · ${employee.department}` : ""}
                  </p>
                  <div className="mt-3 grid min-w-0 gap-2 text-xs text-muted-foreground sm:flex sm:flex-wrap sm:gap-x-4 sm:gap-y-2">
                    <span className="inline-flex min-w-0 items-start gap-1 sm:items-center">
                      <Mail className="mt-0.5 h-3.5 w-3.5 shrink-0 sm:mt-0" />
                      <span className="min-w-0 break-all">
                        {employee.etharaEmail}
                      </span>
                    </span>
                    {employee.personalEmail && (
                      <span className="inline-flex min-w-0 items-start gap-1 sm:items-center">
                        <UserCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 sm:mt-0" />
                        <span className="min-w-0 break-all">
                          Personal: {employee.personalEmail}
                        </span>
                      </span>
                    )}
                    {employee.phone && (
                      <span className="inline-flex items-center gap-1">
                        <Phone className="h-3.5 w-3.5 shrink-0" />
                        {employee.phone}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <div className="grid min-w-0 gap-2 sm:w-64 lg:w-[520px] lg:grid-cols-2">
                <StatusPill
                  label="Employee Code"
                  value={employee.employeeCode || "n/a"}
                />
                <StatusPill
                  label="Aadhaar"
                  value={aadhaarReviewState.label}
                />
                {canManuallyVerifyAadhaar && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="w-full rounded-xl border-success/30 bg-success/10 text-xs text-success hover:bg-success/15"
                    onClick={() => void handleVerifyAadhaarManually()}
                    disabled={reviewingDocumentId !== null}
                    title="Mark Aadhaar as manually verified after HR review"
                  >
                    {reviewingDocumentId === aadhaarDocument?.id ? (
                      <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <ShieldCheck className="mr-1.5 h-3.5 w-3.5" />
                    )}
                    Mark Aadhaar verified
                  </Button>
                )}
                <Button
                  variant="destructive"
                  size="sm"
                  className="w-full rounded-xl text-xs"
                  onClick={openInvoluntaryDialog}
                  disabled={!employee.isActive}
                >
                  <UserX className="mr-1.5 h-3.5 w-3.5" />
                  Mark Terminated / No Show
                </Button>
              </div>
            </div>

          </CardContent>
        </Card>
      </div>

      <Tabs
        value={activeTab}
        onValueChange={setActiveTab}
        className="min-w-0 space-y-4"
      >
        <TabsList className="flex h-auto w-full max-w-full items-stretch justify-start gap-1 overflow-x-auto rounded-xl bg-muted/50 p-1 [scrollbar-width:thin] group-data-horizontal/tabs:h-auto sm:w-fit sm:flex-nowrap [&::-webkit-scrollbar]:h-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border">
          {employeeTabs.map((tab) => (
            <TabsTrigger
              key={tab.value}
              value={tab.value}
              className="h-auto min-h-9 min-w-0 flex-1 rounded-lg px-2 py-1 text-center text-[11px] leading-tight whitespace-normal gap-1.5 data-[state=active]:shadow-sm sm:min-h-0 sm:flex-none sm:shrink-0 sm:whitespace-nowrap sm:px-3 sm:text-xs"
            >
              <tab.icon className="h-3.5 w-3.5" />
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {overview.map((item) => (
              <StatusPill
                key={item.label}
                label={item.label}
                value={item.value}
              />
            ))}
          </div>

          <Card className="border-0 shadow-sm">
            <CardContent className="space-y-4 p-4 sm:p-6">
              {/* Employment details — HR/admin only. Vendor / Work Mode / Date of Joining. */}
              <div className="rounded-2xl border border-border bg-muted/20 p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Employment Details
                  </p>
                  {canEditHrFields && (
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8 rounded-lg text-xs"
                        onClick={() => void handleSendCompliance()}
                        disabled={sendingCompliance}
                        title="Send Form 11 / Form 2 / Form F to the employee's Ethara email for e-signature"
                      >
                        {sendingCompliance ? (
                          <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                        ) : null}
                        Send Compliance Forms
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8 rounded-lg text-xs"
                        onClick={() => void handleSaveHrFields()}
                        disabled={hrSaving}
                      >
                        {hrSaving ? (
                          <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                        ) : null}
                        Save
                      </Button>
                    </div>
                  )}
                </div>
                {canEditHrFields ? (
                  <div className="mt-3 grid gap-3 sm:grid-cols-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs">Vendor</Label>
                      <Input
                        value={vendorInput}
                        onChange={(e) => setVendorInput(e.target.value)}
                        placeholder="e.g. Onroll"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Work Mode</Label>
                      <Input
                        value={workModeInput}
                        onChange={(e) => setWorkModeInput(e.target.value)}
                        placeholder="e.g. Onsite / Remote / Hybrid"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Date of Joining</Label>
                      <DatePicker value={dojInput} onChange={setDojInput} />
                    </div>
                  </div>
                ) : (
                  <div className="mt-3 grid gap-2 text-sm sm:grid-cols-3">
                    <div className="flex items-center justify-between gap-3 sm:flex-col sm:items-start">
                      <span className="text-muted-foreground">Vendor</span>
                      <span>{employee.vendor || "Not set"}</span>
                    </div>
                    <div className="flex items-center justify-between gap-3 sm:flex-col sm:items-start">
                      <span className="text-muted-foreground">Work Mode</span>
                      <span>{employee.workMode || "Not set"}</span>
                    </div>
                    <div className="flex items-center justify-between gap-3 sm:flex-col sm:items-start">
                      <span className="text-muted-foreground">Date of Joining</span>
                      <span>
                        {employee.dateOfJoining
                          ? new Date(employee.dateOfJoining).toLocaleDateString()
                          : "Not set"}
                      </span>
                    </div>
                  </div>
                )}
              </div>

              {/* Employee Code — HR/admin only. Edits propagate to the candidate record and
                  every code-keyed module; conflicts surface the record that holds the code. */}
              <div className="rounded-2xl border border-border bg-muted/20 p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Employee Code
                    </p>
                    <p className="mt-1 font-mono text-sm">
                      {employee.employeeCode || "Not set"}
                    </p>
                  </div>
                  {canEditHrFields && !editingCode && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-8 rounded-lg text-xs"
                      onClick={startEditingCode}
                    >
                      Edit code
                    </Button>
                  )}
                </div>
                {canEditHrFields && editingCode && (
                  <div className="mt-3 flex flex-wrap items-end gap-2">
                    <div className="space-y-1.5">
                      <Label className="text-xs">New Employee Code</Label>
                      <Input
                        value={codeInput}
                        onChange={(e) => setCodeInput(e.target.value)}
                        placeholder="e.g. GRP1709"
                        className="font-mono uppercase"
                      />
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      className="h-9 rounded-lg text-xs"
                      onClick={() => void handleSaveEmployeeCode()}
                      disabled={codeSaving}
                    >
                      {codeSaving ? (
                        <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                      ) : null}
                      Save
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-9 rounded-lg text-xs"
                      onClick={() => setEditingCode(false)}
                      disabled={codeSaving}
                    >
                      Cancel
                    </Button>
                  </div>
                )}
                <p className="mt-2 text-xs text-muted-foreground">
                  Changing the code also updates the linked candidate record and every module
                  keyed by code (ID card, leave, attendance, reimbursements).
                </p>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="rounded-2xl border border-border bg-muted/20 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Document Completion
                  </p>
                  <div className="mt-3 flex items-center gap-3">
                    <div className="flex-1">
                      <Progress
                        value={employee.documentCompletionStatus.percentage}
                        className="h-2"
                      />
                    </div>
                    <span className="text-sm font-semibold">
                      {employee.documentCompletionStatus.percentage}%
                    </span>
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {employee.documentCompletionStatus.completed} of{" "}
                    {employee.documentCompletionStatus.total} required documents
                    available.
                  </p>
                </div>

                <div className="rounded-2xl border border-border bg-muted/20 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Profile Snapshot
                  </p>
                  <div className="mt-3 grid gap-2 text-sm">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-muted-foreground">DOB</span>
                      <span>
                        {employee.dateOfBirth
                          ? new Date(employee.dateOfBirth).toLocaleDateString()
                          : "Not available"}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-muted-foreground">Gender</span>
                      <span className="capitalize">
                        {employee.gender || "Not available"}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-muted-foreground">Aadhaar Match</span>
                      <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
                        <span>{aadhaarReviewState.label}</span>
                        {canManuallyVerifyAadhaar && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-7 rounded-lg border-success/30 bg-success/10 px-2 text-[11px] text-success hover:bg-success/15"
                            onClick={() => void handleVerifyAadhaarManually()}
                            disabled={reviewingDocumentId !== null}
                          >
                            {reviewingDocumentId === aadhaarDocument?.id ? (
                              <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                            ) : (
                              <ShieldCheck className="mr-1 h-3 w-3" />
                            )}
                            Mark verified
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="documents">
          <div className="grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
            <Card className="border-0 shadow-sm">
              <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
                <CardTitle className="text-base">Documents</CardTitle>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 gap-1.5 text-xs"
                  onClick={() => void handleVerifyDocuments()}
                  disabled={verifyingDocs}
                  title="Re-check every uploaded document with AI to confirm it matches its expected type"
                >
                  {verifyingDocs ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <ShieldCheck className="h-3.5 w-3.5" />
                  )}
                  {verifyingDocs ? "Verifying…" : "Verify documents"}
                </Button>
              </CardHeader>
              <CardContent className="space-y-3">
                {documents.map((document) => {
                  const canReviewDocument =
                    !document.missing &&
                    (document.needsReview ||
                      (document.type === "aadhaar" &&
                        aadhaarReviewState.state === "needs_review"));

                  return (
                    <div
                      key={document.id}
                      role={!document.missing ? "button" : undefined}
                      tabIndex={!document.missing ? 0 : undefined}
                      onClick={() => {
                        if (!document.missing) setSelectedDocument(document);
                      }}
                      onKeyDown={(event) => {
                        if (!document.missing && (event.key === "Enter" || event.key === " ")) {
                          event.preventDefault();
                          setSelectedDocument(document);
                        }
                      }}
                      className={cn(
                        "min-w-0 rounded-xl border p-4 transition-colors",
                        !document.missing && "cursor-pointer hover:border-primary/30 hover:bg-primary/5",
                        selectedDocument?.id === document.id
                          ? "border-primary/30 bg-primary/5"
                          : "border-border",
                      )}
                    >
                      <div className="flex min-w-0 items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="break-words text-sm font-semibold">
                              {document.label}
                            </p>
                            <Badge
                              variant={document.missing ? "secondary" : "outline"}
                              className="capitalize"
                            >
                              {formatLabel(document.verificationStatus)}
                            </Badge>
                            {canReviewDocument && (
                              <Badge
                                variant="outline"
                                className="border-warning/40 bg-warning/10 text-warning"
                              >
                                Needs review
                              </Badge>
                            )}
                          </div>
                          <p className="mt-1 break-all text-xs text-muted-foreground sm:truncate">
                            {document.fileName || "No file uploaded"}
                          </p>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            Uploaded{" "}
                            {document.uploadedAt
                              ? timeAgo(document.uploadedAt)
                              : "not yet"}
                          </p>
                          {document.remarks && (
                            <p className="mt-1 break-words text-xs text-muted-foreground">
                              {document.remarks}
                            </p>
                          )}
                        </div>
                        <div className="flex shrink-0 flex-col items-end gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-9 rounded-xl text-xs"
                            disabled={
                              document.missing ||
                              !document.canPreview ||
                              !document.previewEndpoint
                            }
                            onClick={(event) => {
                              event.stopPropagation();
                              setSelectedDocument(document);
                            }}
                          >
                            <Eye className="mr-1.5 h-3.5 w-3.5" />
                            Preview
                          </Button>
                          {canReviewDocument && (
                            <div className="flex flex-wrap justify-end gap-2">
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="h-8 rounded-lg text-xs"
                                disabled={reviewingDocumentId !== null}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  void handleValidateDocument(document);
                                }}
                              >
                                {reviewingDocumentId === document.id ? (
                                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  <ShieldCheck className="mr-1.5 h-3.5 w-3.5" />
                                )}
                                Validate
                              </Button>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="h-8 rounded-lg border-destructive/40 text-xs text-destructive hover:bg-destructive/10"
                                disabled={reviewingDocumentId !== null}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  openIncorrectDocumentDialog(document);
                                }}
                              >
                                <AlertCircle className="mr-1.5 h-3.5 w-3.5" />
                                Mark Incorrect
                              </Button>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}

                {employee.missingDocuments.length > 0 && (
                  <div className="rounded-xl border border-warning/30 bg-warning/5 p-4">
                    <p className="text-sm font-semibold text-warning">
                      Missing documents
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {employee.missingDocuments.join(", ")}
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="border-0 shadow-sm">
              <CardHeader>
                <CardTitle className="text-base">Document Preview</CardTitle>
              </CardHeader>
              <CardContent>
                {!selectedDocument || selectedDocument.missing ? (
                  <div className="flex min-h-[420px] flex-col items-center justify-center rounded-2xl border border-dashed border-border text-center text-muted-foreground">
                    <FileText className="mb-3 h-10 w-10 opacity-30" />
                    <p className="text-sm font-medium">
                      No document selected for preview
                    </p>
                    <p className="mt-1 text-xs">
                      Choose an uploaded document from the list to preview it here.
                    </p>
                  </div>
                ) : !selectedDocument.canPreview ? (
                  <div className="flex min-h-[420px] flex-col items-center justify-center rounded-2xl border border-dashed border-border text-center text-muted-foreground">
                    <FileText className="mb-3 h-10 w-10 opacity-30" />
                    <p className="text-sm font-medium">
                      {selectedDocument.label} cannot be previewed inline
                    </p>
                    <p className="mt-1 text-xs">
                      Preview is available for supported document formats only.
                    </p>
                  </div>
                ) : previewingDocumentId === selectedDocument.id ? (
                  <div className="flex min-h-[420px] items-center justify-center rounded-2xl border border-border">
                    <Loader2 className="h-6 w-6 animate-spin text-primary" />
                  </div>
                ) : previewUrl ? (
                  selectedDocument.mimeType?.startsWith("image/") ? (
                    <div className="rounded-2xl border border-border p-3">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={previewUrl}
                        alt={selectedDocument.label}
                        className="max-h-[520px] w-full rounded-xl object-contain"
                      />
                    </div>
                  ) : (
                    <iframe
                      src={previewUrl}
                      title={selectedDocument.label}
                      className="h-[520px] w-full rounded-2xl border"
                    />
                  )
                ) : (
                  <div className="flex min-h-[420px] flex-col items-center justify-center rounded-2xl border border-dashed border-border text-center text-muted-foreground">
                    <AlertCircle className="mb-3 h-10 w-10 opacity-40" />
                    <p className="text-sm font-medium">
                      Preview could not be loaded
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="detail-form">
          <Card className="border-0 shadow-sm">
            <CardHeader>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <CardTitle className="flex items-center gap-2 text-base">
                  <ClipboardCheck className="h-4 w-4 text-primary" />
                  Employee Detail Form
                </CardTitle>
                {canManageEditAccess && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 rounded-lg text-xs"
                    onClick={() => void handleEditAccessToggle()}
                    disabled={editAccessSaving}
                  >
                    {editAccessSaving ? (
                      <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    ) : editAccessEnabled ? (
                      <LockKeyhole className="mr-1.5 h-3.5 w-3.5" />
                    ) : (
                      <UnlockKeyhole className="mr-1.5 h-3.5 w-3.5" />
                    )}
                    {editAccessEnabled ? "Disable Edit" : "Enable Edit"}
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent className="grid gap-3 lg:grid-cols-2">
              <div className="flex flex-wrap items-center gap-2 lg:col-span-2">
                <Badge variant="outline" className="capitalize">
                  {formatLabel(employee.selectionForm.status)}
                </Badge>
                <Badge
                  variant="outline"
                  className={cn(
                    "text-xs",
                    editAccessEnabled
                      ? "text-success border-success/30"
                      : "text-warning border-warning/30",
                  )}
                >
                  Edit Access: {editAccessEnabled ? "Enabled" : "Disabled"}
                </Badge>
              </div>
              {EMPLOYEE_DETAIL_FORM_GROUPS.map((group) => (
                <div key={group.title} className="rounded-lg border border-border/70 p-3">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {group.title}
                  </p>
                  <div className="space-y-2">
                    {group.fields.map(({ key, label }) => {
                      const value = (
                        employee.selectionForm.formData as
                          | Record<string, unknown>
                          | null
                          | undefined
                      )?.[key];
                      return (
                        <div
                          key={key}
                          className="flex items-start justify-between gap-3 border-b border-border/50 pb-2 last:border-b-0 last:pb-0"
                        >
                          <span className="text-xs text-muted-foreground">{label}</span>
                          <span className="max-w-[60%] text-right text-xs font-medium">
                            {formatEmployeeDetailValue(value)}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="id-card">
          <IdCardDetailsCard
            mode="staff"
            employeeId={employee.id}
            onSaved={() => {
              void qc.invalidateQueries({ queryKey: queryKeys.employeeDetail(employeeId) });
            }}
          />
        </TabsContent>

        <TabsContent value="contracts">
          <div className="space-y-4">
          {employee.linkedCandidateId ? (
            <ContractTab
              candidateId={employee.linkedCandidateId}
              candidateName={employee.fullName}
              currentStage={employee.linkedCandidateStage ?? "onboarding_completed"}
            />
          ) : null}
          <Card className="border-0 shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <FileBadge2 className="h-4 w-4 text-primary" />
                Signed Contract Documents
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {employee.contracts.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
                  No contracts assigned yet.
                </div>
              ) : (
                employee.contracts.map((contract) => (
                  <div
                    key={contract.id}
                    className="rounded-xl border border-border p-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold">{contract.title}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {contract.remarks ||
                            "Contract activity will appear here."}
                        </p>
                      </div>
                      <Badge variant="outline" className="capitalize">
                        {formatLabel(contract.status)}
                      </Badge>
                    </div>
                    {contract.completedAt && (
                      <p className="mt-2 text-[11px] text-muted-foreground">
                        Completed {timeAgo(contract.completedAt)}
                      </p>
                    )}
                  </div>
                ))
              )}
            </CardContent>
          </Card>
          </div>
        </TabsContent>

        <TabsContent value="compliance">
          <Card className="border-0 shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <UserCheck className="h-4 w-4 text-primary" />
                Compliance
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {employee.complianceForms.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
                  No compliance forms are available yet.
                </div>
              ) : (
                employee.complianceForms.map((form) => (
                  <div
                    key={form.id}
                    className="rounded-xl border border-border p-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold">{form.formTitle}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {form.remarks ||
                            "Awaiting employee submission or review."}
                        </p>
                      </div>
                      <Badge variant="outline" className="capitalize">
                        {formatLabel(form.status)}
                      </Badge>
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="activity">
      <Card className="border-0 shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Users className="h-4 w-4 text-primary" />
            Referral Activity
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {employee.referralActivity.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
              No employee referral activity linked to this employee yet.
            </div>
          ) : (
            employee.referralActivity.map((item) => (
              <div
                key={item.candidateId}
                className="rounded-xl border border-border p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold">
                      {item.candidateName}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {item.positionTitle || "Unassigned role"}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {item.currentStatus}
                    </p>
                  </div>
                  <Badge variant="outline" className="capitalize">
                    {formatLabel(item.currentStage)}
                  </Badge>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
        </TabsContent>

        {canViewPerformance && (
          <TabsContent value="performance" className="space-y-4">
            <EvaluationView employeeId={employeeId} enabled={activeTab === "performance"} />
          </TabsContent>
        )}
      </Tabs>

      <Dialog
        open={Boolean(incorrectDocument)}
        onOpenChange={(open) => {
          if (!open && reviewingDocumentId === null) {
            setIncorrectDocument(null);
            setIncorrectRemarks("");
          }
        }}
      >
        <DialogContent className="w-[calc(100vw-1rem)] max-w-md rounded-2xl sm:w-full">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <AlertCircle className="h-5 w-5" />
              Mark Document Incorrect
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="rounded-xl border border-border bg-muted/30 p-3 text-sm">
              <p className="font-medium">
                {incorrectDocument?.label || "Document"}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {employee.fullName || employee.name} · {employee.etharaEmail}
              </p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">
                Correction reason <span className="text-destructive">*</span>
              </Label>
              <Textarea
                value={incorrectRemarks}
                onChange={(event) => setIncorrectRemarks(event.target.value)}
                placeholder="Explain what is wrong and what the employee should upload..."
                className="min-h-[104px] resize-none rounded-xl"
              />
            </div>
            <div className="rounded-xl border border-warning/25 bg-warning/5 p-3 text-xs text-warning">
              This will mark the document as needing correction and send the employee an in-app notification plus email.
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => {
                setIncorrectDocument(null);
                setIncorrectRemarks("");
              }}
              disabled={reviewingDocumentId !== null}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => void handleMarkDocumentIncorrect()}
              disabled={
                reviewingDocumentId !== null ||
                !incorrectDocument ||
                !incorrectRemarks.trim()
              }
            >
              {reviewingDocumentId === incorrectDocument?.id && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              Notify Employee
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(codeConflict)}
        onOpenChange={(open) => !open && setCodeConflict(null)}
      >
        <DialogContent className="w-[calc(100vw-1rem)] max-w-md rounded-2xl sm:w-full">
          <DialogHeader>
            <DialogTitle>Employee code already in use</DialogTitle>
          </DialogHeader>
          {codeConflict && (
            <div className="space-y-3 py-2 text-sm">
              <p>
                <span className="font-mono font-medium">
                  {codeInput.trim().toUpperCase()}
                </span>{" "}
                is already assigned to{" "}
                <span className="font-medium">
                  {codeConflict.name || codeConflict.email || "another record"}
                </span>{" "}
                (
                {codeConflict.type === "employee"
                  ? "employee"
                  : codeConflict.type === "candidate"
                    ? "candidate"
                    : "pre-registration record"}
                {codeConflict.email ? ` · ${codeConflict.email}` : ""}
                {codeConflict.employmentStatus
                  ? ` · ${codeConflict.employmentStatus}`
                  : codeConflict.currentStatus
                    ? ` · ${codeConflict.currentStatus}`
                    : ""}
                ).
              </p>
              <p className="text-muted-foreground">
                To use this code here, first change that record&rsquo;s code to free it up,
                then try again.
              </p>
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setCodeConflict(null)}>
              Close
            </Button>
            {codeConflict &&
              (codeConflict.type === "employee" ||
                codeConflict.type === "candidate") && (
                <Button
                  onClick={() => {
                    const target =
                      codeConflict.type === "employee"
                        ? `/dashboard/employees/${codeConflict.id}`
                        : `/dashboard/candidates/${codeConflict.id}`;
                    setCodeConflict(null);
                    router.push(target);
                  }}
                >
                  Edit {codeConflict.name || "the other record"}&rsquo;s code
                </Button>
              )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={involuntaryOpen} onOpenChange={setInvoluntaryOpen}>
        <DialogContent className="w-[calc(100vw-1rem)] max-w-md rounded-2xl sm:w-full">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <UserX className="h-5 w-5" />
              Mark Employee Separation
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="rounded-xl border border-border bg-muted/30 p-3 text-sm">
              <p className="font-medium">
                {employee.fullName || employee.name}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {employee.employeeCode} · {employee.etharaEmail}
              </p>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Outcome</Label>
              <Select
                value={involuntaryType}
                onValueChange={(value) =>
                  setInvoluntaryType(
                    (value as typeof involuntaryType) || "termination",
                  )
                }
              >
                <SelectTrigger className="h-10 w-full rounded-xl px-3 text-sm">
                  <span
                    data-slot="select-value"
                    className="flex flex-1 text-left"
                  >
                    {INVOLUNTARY_LABEL[involuntaryType]}
                  </span>
                </SelectTrigger>
                <SelectContent>
                  {INVOLUNTARY_TYPES.map((type) => (
                    <SelectItem key={type} value={type}>
                      {INVOLUNTARY_LABEL[type]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">
                Reason <span className="text-destructive">*</span>
              </Label>
              <Textarea
                value={involuntaryReason}
                onChange={(event) => setInvoluntaryReason(event.target.value)}
                placeholder={`Reason for ${INVOLUNTARY_LABEL[involuntaryType].toLowerCase()}...`}
                className="min-h-[96px] resize-none rounded-xl"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">
                Effective Date <span className="text-destructive">*</span>
              </Label>
              <DatePicker
                value={involuntaryDate}
                onChange={setInvoluntaryDate}
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Additional Remarks</Label>
              <Textarea
                value={involuntaryRemarks}
                onChange={(event) => setInvoluntaryRemarks(event.target.value)}
                placeholder="Optional HR remarks..."
                className="min-h-[76px] resize-none rounded-xl"
              />
            </div>

            <div className="rounded-xl border border-destructive/25 bg-destructive/5 p-3 text-xs text-destructive">
              This will deactivate the employee login, mark active assets for
              deactivation, notify IT/HR, and add the record to the involuntary
              separation list.
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => setInvoluntaryOpen(false)}
              disabled={markingInvoluntary}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleMarkInvoluntary}
              disabled={
                markingInvoluntary ||
                !involuntaryReason.trim() ||
                !involuntaryDate
              }
            >
              {markingInvoluntary && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              Confirm {INVOLUNTARY_LABEL[involuntaryType]}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { useParams, useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { StageTimeline, StageBadge } from "@/components/shared/stage-timeline";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DatePicker } from "@/components/ui/date-picker";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  cn,
  getInitials,
  hasAssignedRole,
  SOURCE_LABELS,
  formatDateTime,
  formatLabel,
  timeAgo,
} from "@/lib/utils";
import type { CandidateStage } from "@/types";
import {
  assessmentPlatformApi,
  evaluationsApi,
  candidateIdCardApi,
  candidatesApi,
  complianceApi,
  documentsApi,
  selectionFormsApi,
  type ApAssignment,
  type CandidateIdCardFormRecord,
} from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useColleges, usePositions } from "@/lib/queries";
import { ContractTab } from "@/components/contracts/ContractTab";
import {
  ArrowLeft,
  Mail,
  Phone,
  Building2,
  GraduationCap,
  FileText,
  ClipboardCheck,
  FileCheck,
  Scale,
  User,
  Shield,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Download,
  Eye,
  Loader2,
  RotateCcw,
  Pencil,
  CreditCard,
  BarChart3,
  Users,
  Trophy,
  MoreHorizontal,
} from "lucide-react";
import { toast } from "sonner";

const NONE_OPTION = "__none__";

const ASSESSMENT_BYPASS_ACTION_LABELS = {
  score_bypass: "Bypass with external scores",
  manual_pass: "Mark as Pass Manually",
} as const;

const INTERVIEW_BYPASS_ACTION_LABELS = {
  outcome: "Close with Outcome",
  manual_pass: "Mark as Pass Manually",
} as const;

type CandidateEditForm = {
  fullName: string;
  personalEmail: string;
  etharaEmail: string;
  employeeCode: string;
  phone: string;
  gender: string;
  dateOfBirth: string;
  experienceType: string;
  currentCompany: string;
  currentCTC: string;
  expectedCTC: string;
  noticePeriod: string;
  positionId: string;
  collegeId: string;
};

type CandidateDocument = {
  id: string;
  key?: string;
  type: string;
  file_name?: string;
  fileName?: string;
  file_url?: string;
  fileUrl?: string;
  documentId?: string | null;
  document_id?: string | null;
  fileAvailable?: boolean;
  status: string;
  verificationStatus?: string | null;
  verification_status?: string | null;
  created_at?: string;
  createdAt?: string;
  ocr_status?: string | null;
  ocrStatus?: string | null;
  mime_type?: string;
  mimeType?: string;
  needsReview?: boolean;
  needs_review?: boolean;
  detectedDocumentType?: string | null;
  detected_document_type?: string | null;
  matchesExpectedCategory?: boolean | null;
  matches_expected_category?: boolean | null;
  verificationMessage?: string | null;
  verification_message?: string | null;
  file_size?: number;
  fileSize?: number;
  source?: string;
};

type CandidateComplianceForm = {
  id: string;
  formTitle?: string;
  form_title?: string;
  formType?: string;
  form_type?: string;
  status: string;
  signedUrl?: string | null;
  signed_url?: string | null;
  pdfUrl?: string | null;
  pdf_url?: string | null;
  signedAt?: string | null;
  signed_at?: string | null;
};

type CandidateEvaluation = {
  id: string;
  total_score?: number;
  totalScore?: number;
  recommendation?: string;
  notes?: string;
  completed_at?: string;
  completedAt?: string;
  evaluator?: { name: string };
  piRounds?: Array<{
    id: string;
    roundNumber: number;
    subject?: string | null;
    status?: string | null;
    mode?: string | null;
    scheduledAt?: string | null;
    completedAt?: string | null;
    score?: number | null;
    remarks?: string | null;
    notes?: string | null;
    panelLabel?: string | null;
    panelMembers?: string[] | null;
    roundDecision?: string | null;
    noFurtherPiRequired?: boolean;
    finalVerdict?: string | null;
    evaluatorName?: string | null;
  }>;
};

const EMPTY_CANDIDATE_FORM: CandidateEditForm = {
  fullName: "",
  personalEmail: "",
  etharaEmail: "",
  employeeCode: "",
  phone: "",
  gender: "",
  dateOfBirth: "",
  experienceType: "",
  currentCompany: "",
  currentCTC: "",
  expectedCTC: "",
  noticePeriod: "",
  positionId: "",
  collegeId: "",
};

function pickText(...values: Array<unknown>) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function pickBoolean(...values: Array<unknown>): boolean | null {
  for (const value of values) {
    if (typeof value === "boolean") return value;
    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      if (normalized === "true") return true;
      if (normalized === "false") return false;
    }
  }
  return null;
}

function getCandidateSelectionForm(candidate: Record<string, unknown>) {
  return asRecord(candidate.selectionForm ?? candidate.selection_form);
}

function getCandidateSelectionFormData(candidate: Record<string, unknown>) {
  const selectionForm = getCandidateSelectionForm(candidate);
  return asRecord(selectionForm.formData ?? selectionForm.form_data);
}

function buildSelectionFormAadhaarExtracted(candidate: Record<string, unknown>): Record<string, unknown> {
  const formData = getCandidateSelectionFormData(candidate);
  const basicDetails = asRecord(formData.basicDetails);
  const personalDetails = asRecord(formData.personalDetails);
  const identityDetails = asRecord(formData.identityDetails);
  const aadhaarNumber = pickText(
    identityDetails.aadhaarNumber,
    personalDetails.aadhaarNumber,
  ).replace(/\D/g, "");
  const dateOfBirth = pickText(basicDetails.dateOfBirth);
  const cardHolderName = pickText(basicDetails.fullName);
  if (!aadhaarNumber && !dateOfBirth && !cardHolderName) return {};
  return {
    aadhaarNumber,
    dateOfBirth,
    cardHolderName,
    ocrStatus: "selection_form",
    message: "Shown from submitted selection form.",
  };
}

function getSelectionFormDocumentRows(candidate: Record<string, unknown>): CandidateDocument[] {
  const selectionForm = getCandidateSelectionForm(candidate);
  const formData = getCandidateSelectionFormData(candidate);
  const documentsUploaded = asRecord(formData.documentsUploaded);
  const submittedAt = pickText(selectionForm.submittedAt, selectionForm.submitted_at);

  const rows = Object.entries(documentsUploaded)
    .map(([type, raw]) => {
      const record = asRecord(raw);
      const fileName = pickText(
        typeof raw === "string" ? raw : "",
        record.fileName,
        record.file_name,
        record.name,
      );
      if (!fileName) return null;
      const documentId = pickText(record.documentId, record.document_id, record.id);
      const fileUrl = pickText(record.fileUrl, record.file_url);
      const fileAvailable =
        pickBoolean(record.fileAvailable, record.file_available) ??
        Boolean(documentId || fileUrl);
      const verificationStatus = pickText(
        record.verificationStatus,
        record.verification_status,
        record.status,
      );
      const ocrStatus = pickText(record.ocrStatus, record.ocr_status);
      const row: CandidateDocument = {
        id: documentId || `selection-form-${type}`,
        key: type,
        documentId: documentId || null,
        type,
        fileName,
        fileUrl,
        fileAvailable,
        status: verificationStatus || ocrStatus || "uploaded",
        verificationStatus: verificationStatus || null,
        createdAt: submittedAt,
        ocrStatus: ocrStatus || null,
        mimeType: pickText(record.mimeType, record.mime_type) || undefined,
        needsReview: pickBoolean(record.needsReview, record.needs_review) ?? false,
        detectedDocumentType:
          pickText(record.detectedDocumentType, record.detected_document_type) ||
          null,
        matchesExpectedCategory: pickBoolean(
          record.matchesExpectedCategory,
          record.matches_expected_category,
        ),
        verificationMessage:
          pickText(record.verificationMessage, record.verification_message) ||
          null,
        source: "selection_form",
      };
      return row;
    })
    .filter((doc): doc is CandidateDocument => Boolean(doc));
  return rows;
}

function screeningErrorMessage(error: unknown, fallback: string): string {
  const candidate = error as {
    code?: string;
    message?: string;
    response?: { data?: { detail?: string } };
  };
  if (candidate.response?.data?.detail) return candidate.response.data.detail;
  if (candidate.code === "ECONNABORTED") {
    return "Screening is taking longer than expected. Please try again in a moment.";
  }
  return candidate.message || fallback;
}

function normalizeDateValue(value: string | null | undefined) {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
  }
  const slashMatch = trimmed.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/);
  if (slashMatch) {
    const [, day, month, year] = slashMatch;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

function toDateInputValue(value: string | null | undefined) {
  return normalizeDateValue(value) ?? "";
}

function formatDateForDisplay(value: string | null | undefined) {
  const normalized = normalizeDateValue(value);
  if (!normalized) return null;
  return new Date(`${normalized}T00:00:00`).toLocaleDateString("en-IN");
}

function getCandidateAadhaarExtracted(candidate: Record<string, unknown>) {
  const selectionFormAadhaar = buildSelectionFormAadhaarExtracted(candidate);
  if (Object.keys(selectionFormAadhaar).length > 0) return selectionFormAadhaar;
  return asRecord(candidate.aadhaarExtracted ?? candidate.aadhaar_extracted);
}

function buildCandidateEditForm(
  candidate: Record<string, unknown>,
): CandidateEditForm {
  const aadhaarExtracted = getCandidateAadhaarExtracted(candidate);
  return {
    fullName: pickText(
      candidate.fullName,
      candidate.full_name,
      aadhaarExtracted.cardHolderName,
      (aadhaarExtracted as { name?: string }).name,
    ),
    personalEmail: pickText(candidate.personalEmail, candidate.personal_email),
    etharaEmail: pickText(candidate.etharaEmail, candidate.ethara_email),
    employeeCode: pickText(candidate.employeeCode, candidate.employee_code),
    phone: pickText(candidate.phone),
    gender: pickText(candidate.gender),
    dateOfBirth: toDateInputValue(
      pickText(
        candidate.dateOfBirth,
        candidate.date_of_birth,
        aadhaarExtracted.dateOfBirth,
      ),
    ),
    experienceType: pickText(
      candidate.experienceType,
      candidate.experience_type,
    ),
    currentCompany: pickText(
      candidate.currentCompany,
      candidate.current_company,
    ),
    currentCTC:
      candidate.currentCTC != null ? String(candidate.currentCTC) : "",
    expectedCTC:
      candidate.expectedCTC != null ? String(candidate.expectedCTC) : "",
    noticePeriod:
      candidate.noticePeriod != null ? String(candidate.noticePeriod) : "",
    positionId: pickText(candidate.positionId, candidate.position_id),
    collegeId: pickText(candidate.collegeId, candidate.college_id),
  };
}

function inferResumeMimeType(fileName?: string | null, url?: string | null) {
  const value = `${fileName ?? ""} ${url ?? ""}`.toLowerCase();
  if (value.includes(".pdf")) return "application/pdf";
  if (/\.(png)(\?|$)/i.test(value)) return "image/png";
  if (/\.(jpe?g)(\?|$)/i.test(value)) return "image/jpeg";
  if (/\.(webp)(\?|$)/i.test(value)) return "image/webp";
  if (/\.(docx?)(\?|$)/i.test(value)) {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }
  return null;
}

function getComplianceFormTitle(form: CandidateComplianceForm) {
  return String(
    form.formTitle ??
      form.form_title ??
      form.formType ??
      form.form_type ??
      "Compliance form",
  );
}

function getCompliancePdfAvailable(form: CandidateComplianceForm) {
  return Boolean(form.pdfUrl ?? form.pdf_url);
}

function canPreviewDocumentMimeType(mimeType: string) {
  return mimeType === "application/pdf" || mimeType.startsWith("image/");
}

function candidateDocumentFileName(document: CandidateDocument) {
  return (
    document.fileName ??
    document.file_name ??
    document.fileUrl?.split("/").pop() ??
    document.file_url?.split("/").pop() ??
    formatLabel(document.type)
  );
}

function candidateDocumentMimeType(document: CandidateDocument) {
  return (
    document.mimeType ??
    document.mime_type ??
    inferResumeMimeType(candidateDocumentFileName(document), document.fileUrl ?? document.file_url)
  );
}

function candidateDocumentUploadedAt(document: CandidateDocument) {
  return document.createdAt ?? document.created_at ?? null;
}

function candidateDocumentStatus(document: CandidateDocument) {
  return (
    document.verificationStatus ??
    document.verification_status ??
    document.ocrStatus ??
    document.ocr_status ??
    document.status ??
    "uploaded"
  );
}

function candidateDocumentAvailable(document: CandidateDocument) {
  if (document.source === "selection_form") {
    return document.fileAvailable !== false;
  }
  return Boolean(document.id);
}

function InfoRow({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string | null | undefined;
  icon?: React.ElementType;
}) {
  return (
    <div className="flex items-start gap-3 py-2">
      {Icon && (
        <Icon className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
      )}
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="break-words text-sm font-medium">{value || "—"}</p>
      </div>
    </div>
  );
}

function DocStatusBadge({ status, label }: { status: string; label?: string }) {
  const variants: Record<
    string,
    "default" | "outline" | "secondary" | "destructive"
  > = {
    verified: "default",
    shortlisted: "default",
    screening_complete: "default",
    uploaded: "outline",
    pending: "secondary",
    pending_verification: "secondary",
    rejected: "destructive",
    failed: "destructive",
  };
  const labels: Record<string, string> = {
    verified: "Verified",
    shortlisted: "Shortlisted",
    screening_complete: "Screening Complete",
    uploaded: "Uploaded",
    pending: "Pending Review",
    pending_verification: "Pending Review",
    rejected: "Rejected",
    failed: "Failed",
  };
  return (
    <Badge variant={variants[status] ?? "secondary"} className="text-[10px]">
      {label ?? labels[status] ?? formatLabel(status)}
    </Badge>
  );
}

function getSortedCandidatePiRounds(
  evaluation: CandidateEvaluation | null | undefined,
) {
  return [...(evaluation?.piRounds ?? [])].sort(
    (left, right) => left.roundNumber - right.roundNumber,
  );
}

function formatAttemptScore(assignment: ApAssignment) {
  const attempt = assignment.attempt;
  if (!attempt) return "—";
  if (attempt.totalScore == null) {
    return attempt.status === "in_progress" ? "In Progress" : "Pending";
  }
  if (attempt.maxScore != null) {
    return `${attempt.totalScore}/${attempt.maxScore}`;
  }
  return String(attempt.totalScore);
}

function formatAttemptSubtext(assignment: ApAssignment) {
  const attempt = assignment.attempt;
  if (!attempt) return formatLabel(assignment.status);
  if (attempt.percentage != null) {
    return `${attempt.percentage}% · ${formatLabel(attempt.resultStatus ?? attempt.status)}`;
  }
  return formatLabel(attempt.resultStatus ?? attempt.status);
}

function scoreCardTone(assignment: ApAssignment) {
  const result = assignment.attempt?.resultStatus;
  if (result === "pass") return "bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800";
  if (result === "fail") return "bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800";
  if (assignment.attempt?.status === "in_progress") return "bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800";
  return "bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800";
}

export default function CandidateProfilePage() {
  const params = useParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const id =
    typeof params.id === "string"
      ? params.id
      : Array.isArray(params.id)
        ? params.id[0]
        : "";
  const canEditCandidateDetails = hasAssignedRole(user, ["super_admin", "admin", "hr"]);
  const canResendComplianceForms = hasAssignedRole(user, ["super_admin", "admin", "hr"]);
  const canViewIdCardForm = hasAssignedRole(user, ["super_admin", "admin", "leadership", "hr", "ta", "it_team"]);
  const canBypassAssessment = hasAssignedRole(user, ["super_admin", "admin", "leadership", "evaluator", "hr", "ta"]);
  const canBypassPi = hasAssignedRole(user, ["super_admin", "admin", "leadership", "evaluator", "hr", "ta"]);
  const { data: positionsData } = usePositions();
  const { data: collegesData } = useColleges();
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [candidateForm, setCandidateForm] =
    useState<CandidateEditForm>(EMPTY_CANDIDATE_FORM);
  const [resumePreviewUrl, setResumePreviewUrl] = useState<string | null>(null);
  const [documentPreview, setDocumentPreview] = useState<{
    complianceForm?: CandidateComplianceForm;
    fileName: string;
    mimeType: string;
    url: string;
    description?: string;
  } | null>(null);
  const [candidateDocumentAction, setCandidateDocumentAction] = useState<string | null>(null);
  const [isCompliancePreviewLoading, setIsCompliancePreviewLoading] = useState<string | null>(null);
  const [isComplianceResendLoading, setIsComplianceResendLoading] = useState<string | null>(null);
  const [resumePreviewError, setResumePreviewError] = useState<string | null>(
    null,
  );
  const [isResumePreviewLoading, setIsResumePreviewLoading] = useState(false);
  const [isResumeDownloading, setIsResumeDownloading] = useState(false);
  const [isResumeScreening, setIsResumeScreening] = useState(false);
  const [bypassOpen, setBypassOpen] = useState(false);
  const [bypassMode, setBypassMode] = useState<"score_bypass" | "manual_pass">("score_bypass");
  const [bypassAssignments, setBypassAssignments] = useState<Record<string, boolean>>({});
  const [bypassScores, setBypassScores] = useState<Record<string, string>>({});
  const [bypassFeedback, setBypassFeedback] = useState<Record<string, string>>({});
  const [bypassNotes, setBypassNotes] = useState("");
  const [isBypassing, setIsBypassing] = useState(false);
  const [piBypassOpen, setPiBypassOpen] = useState(false);
  const [piBypassMode, setPiBypassMode] = useState<"outcome" | "manual_pass">("outcome");
  const [piBypassVerdict, setPiBypassVerdict] = useState<"selected" | "rejected">("selected");
  const [piBypassScore, setPiBypassScore] = useState("");
  const [piBypassNotes, setPiBypassNotes] = useState("");
  const [isPiBypassing, setIsPiBypassing] = useState(false);
  const [activeTab, setActiveTab] = useState("overview");

  const {
    data: candidate,
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: ["candidates", id],
    queryFn: () => candidatesApi.get(id),
    enabled: !!id,
  });
  const { data: idCardForm, isLoading: isIdCardFormLoading } = useQuery({
    queryKey: ["candidate-id-card-form", id],
    queryFn: () => candidateIdCardApi.get(id),
    enabled: canViewIdCardForm && !!id,
  });
  const {
    data: assignedAssessments,
    isLoading: isAssignedAssessmentsLoading,
  } = useQuery({
    queryKey: ["candidate-assessment-platform-assignments", id],
    queryFn: () => assessmentPlatformApi.candidateAssignments(id),
    enabled: !!id && activeTab === "performance-report",
  });

  const positions: Array<{ id: string; title: string; department?: string }> =
    Array.isArray(positionsData) ? positionsData : (positionsData?.data ?? []);
  const colleges: Array<{ id: string; name: string }> = Array.isArray(
    collegesData,
  )
    ? collegesData
    : (collegesData?.data ?? []);
  const selectedExperienceTypeLabel = candidateForm.experienceType
    ? formatLabel(candidateForm.experienceType)
    : "Not specified";
  const selectedCandidatePosition = positions.find(
    (position) => position.id === candidateForm.positionId,
  );
  const selectedCandidatePositionLabel = candidateForm.positionId
    ? selectedCandidatePosition
      ? `${selectedCandidatePosition.title}${selectedCandidatePosition.department ? ` · ${selectedCandidatePosition.department}` : ""}`
      : "No position assigned"
    : "No position assigned";
  const selectedCandidateCollegeLabel = candidateForm.collegeId
    ? (colleges.find((college) => college.id === candidateForm.collegeId)
        ?.name ?? "No college assigned")
    : "No college assigned";

  const candidateRecord = (candidate ?? {}) as Record<string, unknown>;
  const storedDocuments: CandidateDocument[] =
    (candidateRecord.documents as CandidateDocument[] | undefined) ?? [];
  const selectionFormDocuments = getSelectionFormDocumentRows(candidateRecord);
  const storedDocumentTypes = new Set(
    storedDocuments.map((doc) => String(doc.type ?? "").toLowerCase()),
  );
  const documents: CandidateDocument[] = [
    ...storedDocuments,
    ...selectionFormDocuments.filter(
      (doc) => !storedDocumentTypes.has(String(doc.type ?? "").toLowerCase()),
    ),
  ];

  const evaluations: CandidateEvaluation[] =
    (candidateRecord.evaluations as CandidateEvaluation[] | undefined) ?? [];

  const latestEvaluation =
    [...evaluations].sort((left, right) => {
      const leftTime = new Date(
        left.completedAt ?? left.completed_at ?? 0,
      ).getTime();
      const rightTime = new Date(
        right.completedAt ?? right.completed_at ?? 0,
      ).getTime();
      return rightTime - leftTime;
    })[0] ?? null;
  const latestPiRounds = getSortedCandidatePiRounds(latestEvaluation);
  const latestPiRound =
    latestPiRounds.length > 0
      ? (latestPiRounds[latestPiRounds.length - 1] ?? null)
      : null;
  const assignedAssessmentRows = useMemo(
    () => assignedAssessments ?? [],
    [assignedAssessments],
  );
  const bypassableAssessmentRows = useMemo(
    () =>
      assignedAssessmentRows.filter(
        (assignment) =>
          assignment.status !== "revoked" &&
          assignment.attempt?.resultStatus !== "pass",
      ),
    [assignedAssessmentRows],
  );
  const selectedBypassAssessmentCount =
    bypassMode === "manual_pass"
      ? bypassableAssessmentRows.length
      : bypassableAssessmentRows.filter(
          (assignment) => bypassAssignments[assignment.id] ?? true,
        ).length;
  const hasBypassableAssessments = bypassableAssessmentRows.length > 0;
  const hasSelectedBypassAssessments =
    !hasBypassableAssessments || selectedBypassAssessmentCount > 0;
  const allBypassableAssessmentsSelected =
    hasBypassableAssessments &&
    selectedBypassAssessmentCount === bypassableAssessmentRows.length;
  const piScoreValue =
    latestPiRound?.score ??
    ((
      latestEvaluation as unknown as {
        piScore?: number | null;
      } | null
    )?.piScore ??
      "—");
  const finalVerdictValue =
    latestPiRounds.find((round) => round.finalVerdict)?.finalVerdict ??
    latestEvaluation?.recommendation ??
    "Pending";
  const screeningScore = (candidateRecord.resumeScore ??
    candidateRecord.resume_score) as number | null | undefined;
  const screeningSummary = (candidateRecord.resumeSummary ??
    candidateRecord.resume_summary) as string | null | undefined;
  const screeningPayload = (candidateRecord.screeningPayload ??
    candidateRecord.screening_payload) as
    | Record<string, unknown>
    | null
    | undefined;
  const screeningRecommendation = String(
    screeningPayload?.recommendation ?? "",
  ).toLowerCase();
  const screeningBadge =
    screeningRecommendation === "needs_review"
      ? {
          label: "Manual Review",
          variant: "outline" as const,
          className: "border-warning/30 text-warning",
        }
      : screeningRecommendation === "shortlisted" || (screeningScore ?? 0) >= 60
        ? { label: "Shortlisted", variant: "default" as const, className: "" }
        : { label: "Rejected", variant: "destructive" as const, className: "" };
  const aadhaarExtracted = getCandidateAadhaarExtracted(candidateRecord);
  const extractedAadhaarNumber = pickText(aadhaarExtracted.aadhaarNumber);
  const displayedAadhaarLast4 =
    extractedAadhaarNumber.length >= 4
      ? extractedAadhaarNumber.slice(-4)
      : pickText(candidateRecord.aadhaarLast4, candidateRecord.aadhaar_last4);
  const extractedAadhaarName = pickText(
    aadhaarExtracted.cardHolderName,
    (aadhaarExtracted as { name?: string }).name,
  );
  const extractedAadhaarDob = normalizeDateValue(
    pickText(aadhaarExtracted.dateOfBirth),
  );
  const resolvedDateOfBirth = pickText(
    candidateRecord.dateOfBirth,
    candidateRecord.date_of_birth,
    extractedAadhaarDob,
  );
  const displayDateOfBirth = formatDateForDisplay(resolvedDateOfBirth);
  const hasAadhaarDetails = Object.keys(aadhaarExtracted).length > 0;
  const resumeDocument = [...documents]
    .filter((doc) => doc.type === "resume")
    .sort((a, b) => {
      const left = new Date(String(b.createdAt ?? b.created_at ?? 0)).getTime();
      const right = new Date(
        String(a.createdAt ?? a.created_at ?? 0),
      ).getTime();
      return left - right;
    })[0];
  const resumeFileName =
    resumeDocument?.fileName ??
    resumeDocument?.file_name ??
    String(candidateRecord.resumeUrl ?? "")
      .split("/")
      .pop() ??
    `${String(candidateRecord.fullName ?? "candidate")
      .replace(/\s+/g, "-")
      .toLowerCase()}-resume`;
  const resumeMimeType = inferResumeMimeType(
    resumeFileName,
    candidateRecord.resumeUrl as string | undefined,
  );
  const canPreviewResume = Boolean(
    candidateRecord.resumeUrl &&
    (resumeMimeType === "application/pdf" ||
      resumeMimeType?.startsWith("image/")),
  );

  useEffect(() => {
    let objectUrl: string | null = null;
    let active = true;

    async function loadResumePreview() {
      if (!candidateRecord.resumeUrl || !canPreviewResume || !id) {
        setResumePreviewUrl(null);
        setResumePreviewError(null);
        setIsResumePreviewLoading(false);
        return;
      }
      setIsResumePreviewLoading(true);
      setResumePreviewError(null);
      try {
        const blob = await candidatesApi.getResumeBlob(id);
        if (!active) return;
        objectUrl = URL.createObjectURL(blob);
        setResumePreviewUrl(objectUrl);
      } catch {
        if (!active) return;
        setResumePreviewUrl(null);
        setResumePreviewError("Preview could not be loaded for this resume.");
      } finally {
        if (active) {
          setIsResumePreviewLoading(false);
        }
      }
    }

    void loadResumePreview();

    return () => {
      active = false;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [candidateRecord.resumeUrl, canPreviewResume, id]);

  useEffect(() => {
    return () => {
      if (documentPreview?.url) {
        URL.revokeObjectURL(documentPreview.url);
      }
    };
  }, [documentPreview?.url]);

  if (isLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm">Loading candidate profile...</p>
        </div>
      </div>
    );
  }

  if (isError || !candidate) {
    const apiError = error as { response?: { status?: number; data?: { detail?: string } } } | null;
    const isAccessDenied = apiError?.response?.status === 403;
    const errorDetail = apiError?.response?.data?.detail;
    return (
      <div className="space-y-4">
        <Button
          variant="ghost"
          size="sm"
          className="gap-2"
          onClick={() =>
            window.history.length > 1
              ? router.back()
              : router.push("/dashboard/candidates")
          }
        >
          <ArrowLeft className="h-4 w-4" /> Back
        </Button>
        <Card className="border-destructive/30 bg-destructive/5">
          <CardContent className="p-8 text-center">
            <AlertTriangle className="h-10 w-10 text-destructive mx-auto mb-3" />
            <h3 className="font-semibold">
              {isAccessDenied ? "Candidate profile access restricted" : "Candidate not found"}
            </h3>
            <p className="text-sm text-muted-foreground mt-1">
              {errorDetail || (isAccessDenied
                ? "Only Admin, HR, and TA users can open full candidate details."
                : "This candidate record does not exist or could not be loaded.")}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const handleResumeDownload = async () => {
    if (!id || !candidateRecord.resumeUrl) {
      toast.error("Resume is not available for download.");
      return;
    }
    setIsResumeDownloading(true);
    try {
      const blob = await candidatesApi.getResumeBlob(id);
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute("download", resumeFileName);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch {
      toast.error("Could not download the resume.");
    } finally {
      setIsResumeDownloading(false);
    }
  };

  const handleResumeOpen = async () => {
    if (resumePreviewUrl) {
      window.open(resumePreviewUrl, "_blank", "noopener,noreferrer");
      return;
    }
    await handleResumeDownload();
  };

  const handleCompliancePreview = async (form: CandidateComplianceForm) => {
    const formId = String(form.id ?? "");
    const fileName = `${getComplianceFormTitle(form)}.pdf`;
    if (!formId || !getCompliancePdfAvailable(form)) {
      toast.error("Signed compliance PDF is not available yet.");
      return;
    }

    setIsCompliancePreviewLoading(formId);
    try {
      const blob = await complianceApi.getSignedFormBlob(formId, "preview");
      const mimeType = blob.type || "application/pdf";
      if (!canPreviewDocumentMimeType(mimeType)) {
        toast.error("Preview is available for PDF and image documents.");
        return;
      }
      const url = URL.createObjectURL(blob);
      setDocumentPreview({
        complianceForm: form,
        fileName,
        mimeType,
        url,
        description: "Preview the signed compliance form without leaving this page.",
      });
    } catch {
      toast.error("Could not open this signed compliance form.");
    } finally {
      setIsCompliancePreviewLoading(null);
    }
  };

  const handleComplianceDownload = async (form: CandidateComplianceForm) => {
    const formId = String(form.id ?? "");
    if (!formId || !getCompliancePdfAvailable(form)) {
      toast.error("Signed compliance PDF is not available yet.");
      return;
    }
    try {
      await complianceApi.downloadSignedForm(formId, `${getComplianceFormTitle(form)}.pdf`);
    } catch {
      toast.error("Could not download this signed compliance form.");
    }
  };

  const handleCandidateDocumentPreview = async (document: CandidateDocument) => {
    const fileName = candidateDocumentFileName(document);
    if (!candidateDocumentAvailable(document)) {
      toast.error("This document only has saved metadata. Attach the file from Selection Forms to preview it.");
      return;
    }

    setCandidateDocumentAction(`preview:${document.source ?? "candidate"}:${document.id}`);
    try {
      const blob =
        document.source === "selection_form" && document.key
          ? await selectionFormsApi.getDocumentBlob(id, document.key, "preview")
          : await documentsApi.getBlob(document.id);
      const mimeType =
        blob.type ||
        candidateDocumentMimeType(document) ||
        "application/octet-stream";
      if (!canPreviewDocumentMimeType(mimeType)) {
        toast.error("Inline preview is available for PDF and image documents.");
        return;
      }
      const url = URL.createObjectURL(blob);
      setDocumentPreview({
        fileName,
        mimeType,
        url,
        description:
          document.source === "selection_form"
            ? "Selection form document uploaded by the candidate."
            : "Candidate document uploaded during the hiring workflow.",
      });
    } catch (err: unknown) {
      const apiErr = err as { response?: { data?: { detail?: string } } };
      toast.error(
        apiErr.response?.data?.detail ||
          "Unable to open this document. The file may not have been uploaded.",
      );
    } finally {
      setCandidateDocumentAction(null);
    }
  };

  const handleCandidateDocumentDownload = async (document: CandidateDocument) => {
    const fileName = candidateDocumentFileName(document);
    if (!candidateDocumentAvailable(document)) {
      toast.error("This document only has saved metadata. Attach the file from Selection Forms to download it.");
      return;
    }

    setCandidateDocumentAction(`download:${document.source ?? "candidate"}:${document.id}`);
    try {
      if (document.source === "selection_form" && document.key) {
        await selectionFormsApi.downloadDocument(id, document.key, fileName);
      } else {
        await documentsApi.download(document.id, fileName);
      }
    } catch (err: unknown) {
      const apiErr = err as { response?: { data?: { detail?: string } } };
      toast.error(
        apiErr.response?.data?.detail ||
          "Unable to download this document.",
      );
    } finally {
      setCandidateDocumentAction(null);
    }
  };

  const handleComplianceResend = async (form: CandidateComplianceForm) => {
    const formId = String(form.id ?? "");
    if (!formId) {
      toast.error("Compliance form is missing.");
      return;
    }

    setIsComplianceResendLoading(formId);
    try {
      await complianceApi.resendCandidateForm(formId);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["candidates", id] }),
        queryClient.invalidateQueries({ queryKey: ["candidates"] }),
      ]);
      toast.success(`${getComplianceFormTitle(form)} sent again.`);
    } catch (error: unknown) {
      const apiError = error as { response?: { data?: { detail?: string } } };
      toast.error(
        apiError.response?.data?.detail ||
          "Could not resend this compliance form.",
      );
    } finally {
      setIsComplianceResendLoading(null);
    }
  };

  const handleResumeScreening = async () => {
    if (!id || !candidateRecord.resumeUrl) {
      toast.error("Upload a resume before running screening.");
      return;
    }
    setIsResumeScreening(true);
    try {
      await candidatesApi.triggerScreening(id);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["candidates", id] }),
        queryClient.invalidateQueries({ queryKey: ["candidates"] }),
        queryClient.invalidateQueries({ queryKey: ["screening"] }),
      ]);
      toast.success("Resume screening refreshed.");
    } catch (error: unknown) {
      toast.error(
        screeningErrorMessage(error, "Could not run resume screening."),
      );
    } finally {
      setIsResumeScreening(false);
    }
  };

  const handleBypassAssessment = async () => {
    const manualPass = bypassMode === "manual_pass";
    const selectedAssignments = bypassableAssessmentRows.filter((assignment) =>
      manualPass ? true : (bypassAssignments[assignment.id] ?? true),
    );
    if (bypassableAssessmentRows.length > 0 && selectedAssignments.length === 0) {
      toast.error("Select at least one assigned assessment to bypass.");
      return;
    }
    if (!manualPass) {
      const invalidScore = selectedAssignments.find((assignment) => {
        const v = parseFloat(bypassScores[assignment.id] ?? "");
        return isNaN(v) || v < 0 || v > 100;
      });
      if (invalidScore !== undefined) {
        toast.error("Enter a valid score (0–100) for each selected assessment.");
        return;
      }
    }
    setIsBypassing(true);
    try {
      const result = await assessmentPlatformApi.bypassCandidateAssessments(id, {
        assignments: selectedAssignments.map((assignment) => ({
          assignmentId: assignment.id,
          score: manualPass ? 100 : parseFloat(bypassScores[assignment.id] ?? ""),
          feedback: manualPass
            ? bypassFeedback[assignment.id]?.trim() || "Marked as pass manually. Test was not conducted on the platform."
            : bypassFeedback[assignment.id]?.trim() || undefined,
        })),
        notes: bypassNotes.trim() || (manualPass ? "Assessments marked as pass manually." : undefined),
        manualPass,
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["candidates", id] }),
        queryClient.invalidateQueries({ queryKey: ["candidates"] }),
        queryClient.invalidateQueries({
          queryKey: ["candidate-assessment-platform-assignments", id],
        }),
      ]);
      toast.success(
        result.advanced
          ? manualPass
            ? "Assessments marked as pass manually. Candidate advanced to Selection Form."
            : "Assessments bypassed. Candidate advanced to Selection Form."
          : "Assessment bypass saved. Remaining assigned assessments must still be cleared.",
      );
      setBypassOpen(false);
      setBypassMode("score_bypass");
      setBypassAssignments({});
      setBypassScores({});
      setBypassFeedback({});
      setBypassNotes("");
    } catch (err) {
      const apiErr = err as { response?: { data?: { detail?: string } } };
      toast.error(
        apiErr.response?.data?.detail || "Could not bypass assessments.",
      );
    } finally {
      setIsBypassing(false);
    }
  };

  const handlePiBypass = async () => {
    const manualPass = piBypassMode === "manual_pass";
    const score = piBypassScore.trim()
      ? Number.parseFloat(piBypassScore)
      : manualPass
        ? 100
        : undefined;
    if (
      score !== undefined &&
      (Number.isNaN(score) || score < 0 || score > 100)
    ) {
      toast.error("PI score must be between 0 and 100.");
      return;
    }
    setIsPiBypassing(true);
    try {
      const payload = {
        finalVerdict: manualPass ? "selected" : piBypassVerdict,
        notes: piBypassNotes.trim() || (manualPass ? "Interview marked as pass manually. Interview was not conducted on the platform." : undefined),
        piScore: score,
      };
      if (latestEvaluation?.id) {
        await evaluationsApi.bypassPi(latestEvaluation.id, payload);
      } else {
        await evaluationsApi.bypassCandidatePi(id, payload);
      }
      await queryClient.invalidateQueries({ queryKey: ["candidates", id] });
      await queryClient.invalidateQueries({ queryKey: ["candidates"] });
      toast.success(
        manualPass
          ? "Interview marked as pass manually. Candidate moved to Selection Form."
          : piBypassVerdict === "selected"
            ? "Interview bypassed. Candidate moved to Selection Form."
            : "Interview bypassed. Candidate marked as Rejected.",
      );
      setPiBypassOpen(false);
      setPiBypassMode("outcome");
      setPiBypassVerdict("selected");
      setPiBypassScore("");
      setPiBypassNotes("");
    } catch (err) {
      const apiErr = err as { response?: { data?: { detail?: string } } };
      toast.error(apiErr.response?.data?.detail || "Could not bypass PI.");
    } finally {
      setIsPiBypassing(false);
    }
  };

  const handleSaveCandidate = async () => {
    if (!id) return;
    setIsSaving(true);
    try {
      const originalForm = buildCandidateEditForm(candidateRecord);
      const payload: Record<string, unknown> = {};
      const addChanged = (
        key: string,
        nextValue: unknown,
        nextComparable: string,
        previousComparable: string,
      ) => {
        if (nextComparable !== previousComparable) {
          payload[key] = nextValue;
        }
      };
      const fullName = candidateForm.fullName.trim();
      const personalEmail = candidateForm.personalEmail.trim().toLowerCase();
      const etharaEmail = candidateForm.etharaEmail.trim().toLowerCase();
      const employeeCode = candidateForm.employeeCode.trim().toUpperCase();
      const phone = candidateForm.phone.trim();
      const gender = candidateForm.gender.trim();
      const currentCompany = candidateForm.currentCompany.trim();
      const currentCTC = candidateForm.currentCTC.trim();
      const expectedCTC = candidateForm.expectedCTC.trim();
      const noticePeriod = candidateForm.noticePeriod.trim();

      addChanged("fullName", fullName, fullName, originalForm.fullName.trim());
      addChanged(
        "personalEmail",
        personalEmail,
        personalEmail,
        originalForm.personalEmail.trim().toLowerCase(),
      );
      addChanged(
        "etharaEmail",
        etharaEmail || null,
        etharaEmail,
        originalForm.etharaEmail.trim().toLowerCase(),
      );
      addChanged(
        "employeeCode",
        employeeCode || null,
        employeeCode,
        originalForm.employeeCode.trim().toUpperCase(),
      );
      addChanged("phone", phone, phone, originalForm.phone.trim());
      addChanged("gender", gender || null, gender, originalForm.gender.trim());
      addChanged(
        "dateOfBirth",
        candidateForm.dateOfBirth || null,
        candidateForm.dateOfBirth || "",
        originalForm.dateOfBirth || "",
      );
      addChanged(
        "experienceType",
        candidateForm.experienceType || null,
        candidateForm.experienceType || "",
        originalForm.experienceType || "",
      );
      addChanged(
        "currentCompany",
        currentCompany || null,
        currentCompany,
        originalForm.currentCompany.trim(),
      );
      addChanged(
        "currentCTC",
        currentCTC ? Number(currentCTC) : null,
        currentCTC,
        originalForm.currentCTC.trim(),
      );
      addChanged(
        "expectedCTC",
        expectedCTC ? Number(expectedCTC) : null,
        expectedCTC,
        originalForm.expectedCTC.trim(),
      );
      addChanged(
        "noticePeriod",
        noticePeriod ? Number(noticePeriod) : null,
        noticePeriod,
        originalForm.noticePeriod.trim(),
      );
      addChanged(
        "positionId",
        candidateForm.positionId || null,
        candidateForm.positionId || "",
        originalForm.positionId || "",
      );
      addChanged(
        "collegeId",
        candidateForm.collegeId || null,
        candidateForm.collegeId || "",
        originalForm.collegeId || "",
      );

      if (Object.keys(payload).length === 0) {
        toast.info("No candidate changes to save.");
        setIsEditOpen(false);
        return;
      }

      await candidatesApi.update(id, payload);
      await queryClient.invalidateQueries({ queryKey: ["candidates", id] });
      await queryClient.invalidateQueries({ queryKey: ["candidates"] });
      toast.success("Candidate details updated.");
      setIsEditOpen(false);
    } catch (error) {
      const apiError = error as { response?: { data?: { detail?: string } } };
      toast.error(
        apiError.response?.data?.detail ||
          "Could not update candidate details.",
      );
    } finally {
      setIsSaving(false);
    }
  };

  const profileTabs = [
    { value: "overview", label: "Overview", icon: User },
    { value: "documents", label: "Documents", icon: FileText },
    { value: "resume", label: "Resume Scores", icon: FileText },
    { value: "aadhaar", label: "Aadhaar Details", icon: Shield },
    {
      value: "performance-report",
      label: "Performance Report",
      icon: BarChart3,
    },
    { value: "contract", label: "Contract", icon: FileCheck },
    { value: "compliance", label: "Compliance", icon: Scale },
    ...(canViewIdCardForm
      ? [{ value: "id-card", label: "ID Card", icon: CreditCard }]
      : []),
  ];

  return (
    <div className="min-w-0 max-w-full space-y-4 overflow-x-hidden animate-fade-in">
      <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:gap-4">
        <Button
          variant="ghost"
          size="icon"
          className="rounded-xl h-9 w-9"
          onClick={() => {
            if (window.history.length > 1) {
              router.back();
            } else {
              router.push("/dashboard/candidates");
            }
          }}
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-start gap-3">
            <Avatar className="h-12 w-12 shrink-0">
              <AvatarFallback className="bg-primary/10 text-primary font-bold">
                {getInitials(candidate.fullName)}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <h1 className="min-w-0 break-words text-lg font-bold sm:text-xl">
                  {candidate.fullName}
                </h1>
                <StageBadge stage={candidate.currentStage as CandidateStage} />
                {candidate.isDuplicate && (
                  <Badge variant="destructive" className="text-[10px]">
                    DUPLICATE
                  </Badge>
                )}
              </div>
              <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
                <span className="max-w-full break-all font-mono text-xs">
                  {candidate.candidateCode}
                </span>
                {candidate.employeeCode && (
                  <>
                    <span className="hidden sm:inline">·</span>
                    <span className="max-w-full break-all font-mono text-xs">
                      {candidate.employeeCode}
                    </span>
                  </>
                )}
                <span className="hidden sm:inline">·</span>
                <span className="max-w-full break-words">
                  {candidate.position?.title ??
                    candidate.positionTitle ??
                    "No position assigned"}
                </span>
                <span className="hidden sm:inline">·</span>
                <Badge variant="outline" className="text-[10px]">
                  {SOURCE_LABELS[candidate.sourceType] ?? formatLabel(candidate.sourceType)}
                </Badge>
              </div>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-9 w-9 shrink-0 rounded-full sm:hidden"
                    aria-label="Candidate profile options"
                  />
                }
              >
                <MoreHorizontal className="h-4 w-4" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-60 rounded-xl">
                {canEditCandidateDetails && (
                  <DropdownMenuItem
                    className="gap-2 text-xs"
                    onClick={() => {
                      setCandidateForm(buildCandidateEditForm(candidateRecord));
                      setIsEditOpen(true);
                    }}
                  >
                    <Pencil className="h-3.5 w-3.5" /> Edit Details
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem className="gap-2 text-xs">
                  <Download className="h-3.5 w-3.5" /> Export
                </DropdownMenuItem>
                {candidate.resumeUrl && (
                  <DropdownMenuItem
                    className="gap-2 text-xs"
                    disabled={isResumeScreening}
                    onClick={() => void handleResumeScreening()}
                  >
                    {isResumeScreening ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <RotateCcw className="h-3.5 w-3.5" />
                    )}
                    Re-screen Resume
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                {profileTabs.map((tab) => (
                  <DropdownMenuItem
                    key={tab.value}
                    className={cn(
                      "gap-2 text-xs",
                      activeTab === tab.value && "bg-muted text-foreground",
                    )}
                    onClick={() => setActiveTab(tab.value)}
                  >
                    <tab.icon className="h-3.5 w-3.5" />
                    {tab.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
        <div className="hidden w-full flex-col gap-2 min-[420px]:flex-row sm:flex sm:w-auto sm:items-center">
          {canEditCandidateDetails && (
            <Button
              variant="outline"
              size="sm"
              className="w-full rounded-xl text-xs min-[420px]:w-auto"
              onClick={() => {
                setCandidateForm(buildCandidateEditForm(candidateRecord));
                setIsEditOpen(true);
              }}
            >
              <Pencil className="mr-1.5 h-3.5 w-3.5" /> Edit Details
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            className="w-full rounded-xl text-xs min-[420px]:w-auto"
          >
            <Download className="mr-1.5 h-3.5 w-3.5" /> Export
          </Button>
          {candidate.resumeUrl && (
            <Button
              variant="outline"
              size="sm"
              className="w-full rounded-xl text-xs min-[420px]:w-auto"
              disabled={isResumeScreening}
              onClick={() => void handleResumeScreening()}
            >
              {isResumeScreening ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
              )}
              Re-screen Resume
            </Button>
          )}
        </div>
      </div>

      <Tabs
        value={activeTab}
        onValueChange={setActiveTab}
        className="min-w-0 space-y-4"
      >
        <TabsList className="hidden h-auto w-full max-w-full items-stretch gap-1 overflow-visible rounded-xl bg-muted/50 p-1 group-data-horizontal/tabs:h-auto sm:flex sm:w-fit sm:flex-nowrap sm:justify-start sm:overflow-x-auto">
          {profileTabs.map((tab) => (
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

        <TabsContent value="overview">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-4">
              <Card className="border-0 shadow-sm">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">
                    Personal Information
                  </CardTitle>
                </CardHeader>
                <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-x-6">
                  <InfoRow
                    label="Full Name"
                    value={candidate.fullName}
                    icon={User}
                  />
                  <InfoRow
                    label="Personal Email"
                    value={candidate.personalEmail}
                    icon={Mail}
                  />
                  <InfoRow
                    label="Ethara Email"
                    value={candidate.etharaEmail}
                    icon={Mail}
                  />
                  <InfoRow
                    label="Employee Code"
                    value={candidate.employeeCode}
                    icon={CreditCard}
                  />
                  <InfoRow label="Phone" value={candidate.phone} icon={Phone} />
                  <InfoRow
                    label="Date of Birth"
                    value={displayDateOfBirth}
                    icon={User}
                  />
                  <InfoRow
                    label="Gender"
                    value={candidate.gender}
                    icon={User}
                  />
                  <InfoRow
                    label="Experience Type"
                    value={
                      candidate.experienceType
                        ? formatLabel(String(candidate.experienceType))
                        : null
                    }
                    icon={User}
                  />
                  <InfoRow
                    label="College"
                    value={candidate.college?.name ?? candidate.collegeName}
                    icon={GraduationCap}
                  />
                  <InfoRow
                    label="Current Company"
                    value={candidate.currentCompany}
                    icon={Building2}
                  />
                  <InfoRow
                    label="Applied"
                    value={
                      candidate.createdAt
                        ? formatDateTime(candidate.createdAt)
                        : null
                    }
                    icon={Clock}
                  />
                </CardContent>
              </Card>

            </div>

            <div>
              <Card className="border-0 shadow-sm">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Stage Progress</CardTitle>
                  <CardDescription>Current pipeline position</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4 sm:hidden">
                    <div className="rounded-2xl border border-border/70 bg-muted/20 p-4">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                        Current stage
                      </p>
                      <div className="mt-2">
                        <StageBadge
                          stage={candidate.currentStage as CandidateStage}
                        />
                      </div>
                    </div>
                    <StageTimeline
                      currentStage={candidate.currentStage as CandidateStage}
                      compact
                    />
                  </div>
                  <div className="hidden sm:block">
                    <StageTimeline
                      currentStage={candidate.currentStage as CandidateStage}
                    />
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="documents">
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
            <Card className="border-0 shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">
                  Selection Form Documents
                </CardTitle>
                <CardDescription>
                  Files uploaded by the candidate while submitting the selection form.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {selectionFormDocuments.length === 0 ? (
                  <EmptyState
                    icon={FileText}
                    title="No selection-form documents"
                    description="Documents uploaded from the selection form will appear here."
                  />
                ) : (
                  selectionFormDocuments.map((document) => {
                    const available = candidateDocumentAvailable(document);
                    const actionId = `${document.source ?? "candidate"}:${document.id}`;
                    const status = candidateDocumentStatus(document);
                    return (
                      <div
                        key={`${document.source}-${document.key ?? document.id}`}
                        className="rounded-xl border border-border/70 bg-muted/10 p-4"
                      >
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="break-words text-sm font-semibold">
                                {formatLabel(document.type)}
                              </p>
                              <DocStatusBadge
                                status={available ? status : "pending"}
                                label={available ? undefined : "Metadata only"}
                              />
                              {document.needsReview ||
                              document.matchesExpectedCategory === false ? (
                                <Badge
                                  variant="outline"
                                  className="border-amber-500/40 bg-amber-500/10 text-amber-300"
                                >
                                  Needs review
                                </Badge>
                              ) : null}
                            </div>
                            <p className="mt-1 break-all text-xs text-muted-foreground">
                              {candidateDocumentFileName(document)}
                            </p>
                            <p className="mt-1 text-[11px] text-muted-foreground">
                              {candidateDocumentUploadedAt(document)
                                ? `Submitted ${timeAgo(candidateDocumentUploadedAt(document)!)}`
                                : "Submitted with selection form"}
                            </p>
                            {document.verificationMessage && (
                              <p className="mt-2 break-words text-xs text-muted-foreground">
                                {document.verificationMessage}
                              </p>
                            )}
                            {document.detectedDocumentType && (
                              <p className="mt-1 text-[11px] text-muted-foreground">
                                Detected: {formatLabel(document.detectedDocumentType)}
                              </p>
                            )}
                          </div>
                          <div className="flex shrink-0 flex-wrap gap-2 sm:justify-end">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-8 rounded-lg text-xs"
                              disabled={!available || candidateDocumentAction !== null}
                              onClick={() => void handleCandidateDocumentPreview(document)}
                            >
                              {candidateDocumentAction === `preview:${actionId}` ? (
                                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <Eye className="mr-1.5 h-3.5 w-3.5" />
                              )}
                              Preview
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-8 rounded-lg text-xs"
                              disabled={!available || candidateDocumentAction !== null}
                              onClick={() => void handleCandidateDocumentDownload(document)}
                            >
                              {candidateDocumentAction === `download:${actionId}` ? (
                                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <Download className="mr-1.5 h-3.5 w-3.5" />
                              )}
                              Download
                            </Button>
                          </div>
                        </div>
                        {!available && (
                          <p className="mt-3 rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2 text-xs text-amber-300">
                            This older submission has the filename only. Attach
                            the file in Selection Forms to enable preview and download.
                          </p>
                        )}
                      </div>
                    );
                  })
                )}
              </CardContent>
            </Card>

            <Card className="border-0 shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Candidate Uploads</CardTitle>
                <CardDescription>
                  Resume, Aadhaar, and other files stored on the candidate profile.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {storedDocuments.length === 0 ? (
                  <EmptyState
                    icon={FileText}
                    title="No profile documents"
                    description="Candidate uploads outside the selection form will appear here."
                  />
                ) : (
                  storedDocuments.map((document) => {
                    const actionId = `${document.source ?? "candidate"}:${document.id}`;
                    const mimeType = candidateDocumentMimeType(document) ?? "";
                    const canPreview =
                      Boolean(mimeType) && canPreviewDocumentMimeType(mimeType);
                    return (
                      <div
                        key={document.id}
                        className="rounded-xl border border-border/70 bg-muted/10 p-4"
                      >
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="break-words text-sm font-semibold">
                                {formatLabel(document.type)}
                              </p>
                              <DocStatusBadge status={candidateDocumentStatus(document)} />
                            </div>
                            <p className="mt-1 break-all text-xs text-muted-foreground">
                              {candidateDocumentFileName(document)}
                            </p>
                            <p className="mt-1 text-[11px] text-muted-foreground">
                              {candidateDocumentUploadedAt(document)
                                ? `Uploaded ${timeAgo(candidateDocumentUploadedAt(document)!)}`
                                : "Uploaded date unavailable"}
                            </p>
                          </div>
                          <div className="flex shrink-0 flex-wrap gap-2 sm:justify-end">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-8 rounded-lg text-xs"
                              disabled={!canPreview || candidateDocumentAction !== null}
                              onClick={() => void handleCandidateDocumentPreview(document)}
                            >
                              {candidateDocumentAction === `preview:${actionId}` ? (
                                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <Eye className="mr-1.5 h-3.5 w-3.5" />
                              )}
                              Preview
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-8 rounded-lg text-xs"
                              disabled={candidateDocumentAction !== null}
                              onClick={() => void handleCandidateDocumentDownload(document)}
                            >
                              {candidateDocumentAction === `download:${actionId}` ? (
                                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <Download className="mr-1.5 h-3.5 w-3.5" />
                              )}
                              Download
                            </Button>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="resume">
          <div className="space-y-4">
            <Card className="border-0 shadow-sm">
              <CardHeader className="pb-2">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <CardTitle className="text-base">Resume</CardTitle>
                  {candidate.resumeUrl && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 rounded-lg text-xs gap-1"
                      onClick={() => void handleResumeDownload()}
                      disabled={isResumeDownloading}
                    >
                      {isResumeDownloading ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Download className="h-3.5 w-3.5" />
                      )}
                      Download
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {candidate.resumeUrl && canPreviewResume ? (
                  <div className="space-y-2">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      Resume Preview
                    </p>
                    {isResumePreviewLoading ? (
                      <div className="flex h-[600px] items-center justify-center rounded-xl border border-border bg-muted/20">
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Loading resume preview...
                        </div>
                      </div>
                    ) : resumePreviewUrl ? (
                      <iframe
                        src={resumePreviewUrl}
                        title="Resume Preview"
                        className="w-full rounded-xl border"
                        style={{
                          height: "600px",
                          borderColor: "hsl(var(--border))",
                        }}
                      />
                    ) : (
                      <div className="flex min-w-0 items-start gap-3 rounded-lg bg-muted/50 p-3">
                        <AlertTriangle className="h-5 w-5 text-warning shrink-0" />
                        <p className="text-xs text-muted-foreground">
                          {resumePreviewError ||
                            "Preview is not available for this resume right now."}
                        </p>
                      </div>
                    )}
                  </div>
                ) : candidate.resumeUrl ? (
                  <div className="flex min-w-0 items-start gap-3 rounded-lg bg-muted/50 p-3">
                    <FileText className="h-5 w-5 text-primary shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium">Resume file</p>
                      <p className="text-xs text-muted-foreground">
                        Inline preview is only available for PDF and image
                        resumes. Use Download to open this file.
                      </p>
                    </div>
                  </div>
                ) : null}

                {(candidate.resumeSummary ??
                  (candidate as Record<string, unknown>).resume_summary) && (
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                      Summary
                    </p>
                    <p className="text-sm leading-relaxed rounded-lg bg-muted/30 p-3">
                      {
                        (candidate.resumeSummary ??
                          (candidate as Record<string, unknown>)
                            .resume_summary) as string
                      }
                    </p>
                  </div>
                )}

                {(candidate.resumeKeyPoints ?? candidate.resume_key_points) && (
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                      Key Points
                    </p>
                    <ul className="space-y-1.5">
                      {(
                        (candidate.resumeKeyPoints ??
                          candidate.resume_key_points) as string[]
                      ).map((pt: string, i: number) => (
                        <li key={i} className="flex items-start gap-2 text-sm">
                          <CheckCircle2 className="h-3.5 w-3.5 text-primary mt-0.5 shrink-0" />
                          {pt}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {(candidate.resumeText ?? candidate.resume_text) ? (
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                      Full Resume Text
                    </p>
                    <pre className="text-xs whitespace-pre-wrap bg-muted/30 rounded-lg p-4 max-h-96 overflow-y-auto font-mono leading-relaxed">
                      {
                        (candidate.resumeText ??
                          candidate.resume_text) as string
                      }
                    </pre>
                  </div>
                ) : (
                  <EmptyState
                    icon={FileText}
                    title="Resume text not extracted"
                    description="Upload a resume to extract and display its text content."
                  />
                )}
              </CardContent>
            </Card>

            <Card className="border-0 shadow-sm">
              <CardHeader>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <CardTitle className="text-base">
                    Resume Screening Results
                  </CardTitle>
                  {screeningScore != null && (
                    <Badge
                      variant={screeningBadge.variant}
                      className={cn("text-xs", screeningBadge.className)}
                    >
                      {screeningBadge.label}
                    </Badge>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                {screeningScore != null ? (
                  <div className="space-y-4">
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-6">
                      <div className="text-center">
                        <p className="text-4xl font-bold text-success">
                          {screeningScore}
                        </p>
                        <p className="text-xs text-muted-foreground mt-1">
                          Match Score / 100
                        </p>
                      </div>
                      <Separator
                        orientation="vertical"
                        className="hidden h-16 sm:block"
                      />
                      <div className="min-w-0 flex-1">
                        <h4 className="text-sm font-semibold mb-1">
                          AI Screening Summary
                        </h4>
                        <p className="text-sm text-muted-foreground leading-relaxed">
                          {screeningSummary || "No summary available."}
                        </p>
                        {(candidate.llmStatus ?? candidate.llm_status) && (
                          <Badge variant="outline" className="mt-2 text-[10px]">
                            LLM: {candidate.llmStatus ?? candidate.llm_status}
                          </Badge>
                        )}
                      </div>
                    </div>
                    {screeningPayload &&
                      (() => {
                        const sp = screeningPayload;
                        const strengths = sp.strengths as string[] | undefined;
                        const gaps = sp.gaps as string[] | undefined;
                        const rec = sp.recommendation as string | undefined;
                        return (
                          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                            {strengths && strengths.length > 0 && (
                              <div className="rounded-xl bg-green-50 dark:bg-green-950/20 p-4">
                                <p className="text-xs font-semibold text-green-700 dark:text-green-300 mb-2">
                                  Strengths
                                </p>
                                <ul className="space-y-1">
                                  {strengths.map((s: string, i: number) => (
                                    <li
                                      key={i}
                                      className="text-xs text-green-800 dark:text-green-200 flex gap-1.5 items-start"
                                    >
                                      <CheckCircle2 className="h-3 w-3 mt-0.5 shrink-0" />
                                      {s}
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}
                            {gaps && gaps.length > 0 && (
                              <div className="rounded-xl bg-red-50 dark:bg-red-950/20 p-4">
                                <p className="text-xs font-semibold text-red-700 dark:text-red-300 mb-2">
                                  Gaps
                                </p>
                                <ul className="space-y-1">
                                  {gaps.map((g: string, i: number) => (
                                    <li
                                      key={i}
                                      className="text-xs text-red-800 dark:text-red-200 flex gap-1.5 items-start"
                                    >
                                      <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
                                      {g}
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}
                            {rec && (
                              <div className="flex flex-wrap items-center gap-2 md:col-span-2">
                                <span className="text-xs text-muted-foreground">
                                  Recommendation:
                                </span>
                                <Badge
                                  className={cn(
                                    "text-[11px]",
                                    rec === "shortlist" || rec === "shortlisted"
                                      ? "bg-green-100 text-green-700"
                                      : rec === "reject"
                                        ? "bg-red-100 text-red-700"
                                        : "bg-amber-100 text-amber-700",
                                  )}
                                >
                                  {formatLabel(rec)}
                                </Badge>
                              </div>
                            )}
                          </div>
                        );
                      })()}
                    {candidate.resumeUrl && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="rounded-xl text-xs"
                        onClick={() => void handleResumeOpen()}
                        disabled={isResumeDownloading || isResumePreviewLoading}
                      >
                        {isResumeDownloading || isResumePreviewLoading ? (
                          <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <FileText className="mr-1.5 h-3.5 w-3.5" />
                        )}
                        {resumePreviewUrl ? "View Resume" : "Download Resume"}
                      </Button>
                    )}
                  </div>
                ) : (
                  <EmptyState
                    icon={FileText}
                    title="Screening not yet run"
                    description="Resume screening will begin automatically after upload. You can also trigger it manually from the candidate actions."
                  />
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ── Aadhaar OCR Tab ─────────────────────────────────── */}
        <TabsContent value="aadhaar">
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Aadhaar Details</CardTitle>
            </CardHeader>
            <CardContent>
              {hasAadhaarDetails ? (
                (() => {
                  const ocrData = aadhaarExtracted as Record<string, string>;
                  return (
                    <div className="space-y-4">
                      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                        <div className="p-4 rounded-xl bg-muted/30">
                          <p className="text-xs text-muted-foreground mb-1">
                            Extracted Aadhaar Number
                          </p>
                          <p className="font-mono text-sm font-semibold">
                            {extractedAadhaarNumber
                              ? `${extractedAadhaarNumber.slice(0, 4)} ${extractedAadhaarNumber.slice(4, 8)} ${extractedAadhaarNumber.slice(8)}`
                              : "—"}
                          </p>
                          <p className="text-xs text-muted-foreground mt-1">
                            Last 4 on file:{" "}
                            <span className="font-medium">
                              {displayedAadhaarLast4 || "—"}
                            </span>
                          </p>
                        </div>
                        <div className="p-4 rounded-xl bg-muted/30">
                          <p className="text-xs text-muted-foreground mb-1">
                            Extracted Date of Birth
                          </p>
                          <p className="text-sm font-semibold">
                            {formatDateForDisplay(extractedAadhaarDob) ?? "—"}
                          </p>
                          <p className="text-xs text-muted-foreground mt-1">
                            DOB on file:{" "}
                            <span className="font-medium">
                              {displayDateOfBirth ?? "—"}
                            </span>
                          </p>
                        </div>
                        <div className="p-4 rounded-xl bg-muted/30">
                          <p className="text-xs text-muted-foreground mb-1">
                            Extracted Name
                          </p>
                          <p className="text-sm font-semibold">
                            {extractedAadhaarName || "—"}
                          </p>
                          <p className="text-xs text-muted-foreground mt-1">
                            Name on profile:{" "}
                            <span className="font-medium">
                              {candidate.fullName ?? "—"}
                            </span>
                          </p>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 rounded-lg bg-muted/20 p-3 text-sm">
                        <Shield className="h-4 w-4 text-primary shrink-0" />
                        <span className="font-medium">OCR Status:</span>
                        <Badge
                          variant={
                            ocrData.ocrStatus === "extracted" || ocrData.ocrStatus === "selection_form"
                              ? "default"
                              : "secondary"
                          }
                          className="text-[11px]"
                        >
                          {ocrData.ocrStatus ? formatLabel(ocrData.ocrStatus) : "Unknown"}
                        </Badge>
                        {ocrData.message && (
                          <span className="text-muted-foreground text-xs ml-1">
                            {ocrData.message}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })()
              ) : (
                <EmptyState
                  icon={Shield}
                  title="No Aadhaar data"
                  description="Aadhaar details will appear here once the candidate uploads their Aadhaar document."
                />
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="performance-report">
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {assignedAssessmentRows.length > 0 ? (
                assignedAssessmentRows.map((assignment) => (
                  <div
                    key={assignment.id}
                    className={cn(
                      "min-w-0 rounded-2xl border p-4",
                      scoreCardTone(assignment),
                    )}
                  >
                    <p className="truncate text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      {assignment.assessmentTitle ?? "Assigned Assessment"}
                    </p>
                    <p className="mt-1 break-words text-2xl font-bold leading-tight">
                      {formatAttemptScore(assignment)}
                    </p>
                    <p className="mt-1.5 text-[10px] font-medium text-muted-foreground">
                      {formatAttemptSubtext(assignment)}
                    </p>
                  </div>
                ))
              ) : (
                <div className="min-w-0 rounded-2xl border border-blue-200 bg-blue-50 p-4 dark:border-blue-800 dark:bg-blue-950/30">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Assigned Assessments
                  </p>
                  <p className="mt-1 break-words text-2xl font-bold leading-tight">
                    {isAssignedAssessmentsLoading ? "Loading..." : "—"}
                  </p>
                  <p className="mt-1.5 text-[10px] font-medium text-muted-foreground">
                    No assessment assignment found.
                  </p>
                </div>
              )}
              {[
                {
                  label: "PI Score (Latest)",
                  value: piScoreValue,
                  sub:
                    latestPiRound?.finalVerdict ??
                    latestPiRound?.roundDecision ??
                    null,
                  color:
                    "bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800",
                },
                {
                  label: "Final Verdict",
                  value: finalVerdictValue,
                  sub: null,
                  color:
                    "bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800",
                },
              ].map(({ label, value, sub, color }) => (
                <div
                  key={label}
                  className={`min-w-0 rounded-2xl border p-4 ${color}`}
                >
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {label}
                  </p>
                  <p className="mt-1 break-words text-2xl font-bold leading-tight">
                    {typeof value === "number"
                      ? value
                      : typeof value === "string" && value !== "—"
                        ? formatLabel(value)
                        : String(value ?? "—")}
                  </p>
                  {sub && (
                    <span
                      className={cn(
                        "mt-1.5 inline-block text-[10px] font-medium px-1.5 py-0.5 rounded-full",
                        sub === "pass" || sub === "selected"
                          ? "bg-emerald-100 text-emerald-700"
                          : sub === "fail" || sub === "rejected"
                            ? "bg-red-100 text-red-700"
                            : "bg-amber-100 text-amber-700",
                      )}
                    >
                      {formatLabel(sub)}
                    </span>
                  )}
                </div>
              ))}
            </div>

            <Card className="border-0 shadow-sm">
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                  <ClipboardCheck className="h-4 w-4 text-primary" />
                  <CardTitle className="text-sm">
                    Assigned Assessment Scores
                  </CardTitle>
                </div>
                <CardDescription className="text-xs">
                  Scores from assessment tests assigned to this candidate.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {isAssignedAssessmentsLoading ? (
                  <div className="flex items-center justify-center rounded-2xl border border-dashed border-border p-8 text-sm text-muted-foreground">
                    <Loader2 className="mr-2 h-4 w-4 animate-spin text-primary" />
                    Loading assessment scores...
                  </div>
                ) : assignedAssessmentRows.length === 0 ? (
                  <EmptyState
                    icon={ClipboardCheck}
                    title="No assigned assessments"
                    description="Scores will appear here once an assessment is assigned and submitted."
                  />
                ) : (
                  <div className="space-y-3">
                    {assignedAssessmentRows.map((assignment) => {
                      const attempt = assignment.attempt;
                      const result = attempt?.resultStatus;
                      const statusText = result
                        ? formatLabel(result)
                        : formatLabel(attempt?.status ?? assignment.status);
                      const badgeVariant:
                        | "default"
                        | "secondary"
                        | "destructive" =
                        result === "fail"
                          ? "destructive"
                          : result === "pass"
                            ? "default"
                            : "secondary";
                      const activityDate =
                        attempt?.gradedAt ??
                        attempt?.submittedAt ??
                        attempt?.startedAt ??
                        assignment.lastInvitedAt ??
                        assignment.invitedAt ??
                        null;
                      return (
                        <div
                          key={assignment.id}
                          className="grid gap-3 rounded-xl border border-border/60 bg-muted/5 p-4 md:grid-cols-[minmax(0,1.4fr)_120px_120px_160px] md:items-center"
                        >
                          <div className="min-w-0">
                            <p className="break-words text-sm font-semibold">
                              {assignment.assessmentTitle ??
                                "Assigned Assessment"}
                            </p>
                            <p className="mt-1 break-all text-xs text-muted-foreground">
                              {assignment.email}
                            </p>
                          </div>
                          <div className="min-w-0">
                            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground md:hidden">
                              Status
                            </p>
                            <Badge variant={badgeVariant} className="text-[11px]">
                              {statusText}
                            </Badge>
                          </div>
                          <div className="min-w-0">
                            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground md:hidden">
                              Score
                            </p>
                            <p className="text-sm font-semibold">
                              {formatAttemptScore(assignment)}
                            </p>
                            {attempt?.percentage != null && (
                              <p className="text-[11px] text-muted-foreground">
                                {attempt.percentage}%
                              </p>
                            )}
                          </div>
                          <div className="min-w-0">
                            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground md:hidden">
                              Updated
                            </p>
                            <p className="break-words text-xs font-medium text-muted-foreground">
                              {activityDate ? formatDateTime(activityDate) : "—"}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* ── Bypass Assessment (admin / evaluator only) ────────────────── */}
            {canBypassAssessment && (
              <Card className="border-0 shadow-sm border-amber-500/20 bg-amber-500/5">
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="h-4 w-4 text-amber-400" />
                      <CardTitle className="text-sm text-amber-300">
                        Bypass Assessments
                      </CardTitle>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="rounded-xl text-xs h-7 border-amber-500/30 text-amber-300 hover:bg-amber-500/10"
                      onClick={() => {
                        if (bypassOpen) {
                          setBypassOpen(false);
                          return;
                        }
                        setBypassAssignments(
                          Object.fromEntries(
                            bypassableAssessmentRows.map((assignment) => [
                              assignment.id,
                              true,
                            ]),
                          ) as Record<string, boolean>,
                        );
                        setBypassOpen(true);
                      }}
                    >
                      {bypassOpen ? "Cancel" : "Open Bypass Form"}
                    </Button>
                  </div>
                  <CardDescription className="text-xs text-amber-400/70">
                    If the assessment was completed outside the platform, enter
                    the scores here to advance the candidate to the Selection
                    Form stage.
                  </CardDescription>
                </CardHeader>

                {bypassOpen && (
                  <CardContent className="space-y-5 pt-0">
                    <div className="h-px bg-amber-500/20" />

                    <div className="grid gap-4 md:grid-cols-[260px_minmax(0,1fr)]">
                      <div className="space-y-1.5">
                        <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
                          Action
                        </Label>
                        <Select
                          value={bypassMode}
                          onValueChange={(value) =>
                            setBypassMode(value as "score_bypass" | "manual_pass")
                          }
                        >
                          <SelectTrigger className="h-9 rounded-xl text-sm">
                            <span className="flex flex-1 text-left">
                              {ASSESSMENT_BYPASS_ACTION_LABELS[bypassMode]}
                            </span>
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="score_bypass">Bypass with external scores</SelectItem>
                            <SelectItem value="manual_pass">Mark as Pass Manually</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-xs text-amber-300">
                        {bypassMode === "manual_pass"
                          ? "Use this when no assessment happened on the platform. The candidate will be marked as passed and moved to Selection Form."
                          : "Use this when assessments happened outside the platform and you want to record the external scores."}
                      </div>
                    </div>

                    {isAssignedAssessmentsLoading ? (
                      <div className="flex items-center justify-center rounded-xl border border-dashed border-amber-500/25 p-5 text-sm text-amber-200">
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Loading assigned assessments...
                      </div>
                    ) : (
                      <div className="grid gap-4 sm:grid-cols-2">
                        {bypassableAssessmentRows.map((assignment) => {
                          const checked =
                            bypassMode === "manual_pass"
                              ? true
                              : (bypassAssignments[assignment.id] ?? true);
                          const statusText = formatLabel(
                            assignment.attempt?.resultStatus ??
                              assignment.attempt?.status ??
                              assignment.status,
                          );
                          return (
                            <div
                              key={assignment.id}
                              className={cn(
                                "rounded-xl border p-4 space-y-3 transition-colors",
                                checked
                                  ? "border-amber-500/30 bg-amber-500/5"
                                  : "border-border/60 bg-muted/10 opacity-60",
                              )}
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <p className="break-words text-xs font-semibold">
                                    {assignment.assessmentTitle ??
                                      "Assigned Assessment"}
                                  </p>
                                  <p className="mt-1 break-all text-[11px] text-muted-foreground">
                                    {assignment.email}
                                  </p>
                                  <p className="mt-1 text-[10px] font-medium text-amber-300/80">
                                    Current status: {statusText}
                                  </p>
                                </div>
                                {bypassMode === "score_bypass" && (
                                  <label className="flex shrink-0 cursor-pointer select-none items-center gap-1.5">
                                    <input
                                      type="checkbox"
                                      className="h-3.5 w-3.5 accent-amber-400"
                                      checked={checked}
                                      onChange={(e) =>
                                        setBypassAssignments((current) => ({
                                          ...current,
                                          [assignment.id]: e.target.checked,
                                        }))
                                      }
                                    />
                                    <span className="text-[10px] text-muted-foreground">
                                      Include
                                    </span>
                                  </label>
                                )}
                              </div>

                              {bypassMode === "score_bypass" ? (
                                <>
                                  <div className="space-y-1.5">
                                    <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
                                      Score (0–100) *
                                    </Label>
                                    <Input
                                      type="number"
                                      min={0}
                                      max={100}
                                      placeholder="e.g. 78"
                                      className="h-9 rounded-xl text-sm"
                                      value={bypassScores[assignment.id] ?? ""}
                                      disabled={!checked}
                                      onChange={(e) =>
                                        setBypassScores((current) => ({
                                          ...current,
                                          [assignment.id]: e.target.value,
                                        }))
                                      }
                                    />
                                  </div>

                                  <div className="space-y-1.5">
                                    <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
                                      Evaluator Remarks
                                    </Label>
                                    <Input
                                      placeholder="Optional remarks for this assessment"
                                      className="h-9 rounded-xl text-sm"
                                      value={bypassFeedback[assignment.id] ?? ""}
                                      disabled={!checked}
                                      onChange={(e) =>
                                        setBypassFeedback((current) => ({
                                          ...current,
                                          [assignment.id]: e.target.value,
                                        }))
                                      }
                                    />
                                  </div>
                                </>
                              ) : (
                                <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                                  This assigned assessment will be marked as passed without a platform attempt.
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {bypassMode === "manual_pass" && bypassableAssessmentRows.length > 0 && (
                      <div className="rounded-xl border border-amber-500/25 bg-amber-500/10 p-4 text-sm text-amber-200">
                        Manual pass will record the assessment requirement as passed without a platform attempt.
                      </div>
                    )}

                    {/* Notes / reason */}
                    <div className="space-y-1.5">
                      <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
                        Reason for Bypass *
                      </Label>
                      <textarea
                        rows={2}
                        placeholder="e.g. Assessment conducted via phone interview on 01-Jun-2026"
                        className="w-full rounded-xl border border-border bg-input/30 px-3 py-2 text-sm focus:outline-none focus:border-amber-400/60 resize-none"
                        value={bypassNotes}
                        onChange={(e) => setBypassNotes(e.target.value)}
                      />
                    </div>

                    <div className="flex flex-col gap-3 pt-1 sm:flex-row sm:items-center sm:justify-between">
                      <p className="text-[11px] text-amber-400/70">
                        {!hasBypassableAssessments || allBypassableAssessmentsSelected
                          ? "Candidate will be advanced to Selection Form stage."
                          : "Selected assessments will be bypassed; remaining assigned assessments must still be cleared."}
                      </p>
                      <Button
                        size="sm"
                        className="rounded-xl text-xs bg-amber-500 hover:bg-amber-600 text-white"
                        onClick={handleBypassAssessment}
                        disabled={
                          isBypassing ||
                          !bypassNotes.trim() ||
                          !hasSelectedBypassAssessments
                        }
                      >
                        {isBypassing ? (
                          <>
                            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                            Bypassing…
                          </>
                        ) : (
                          <>
                            <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
                            {bypassMode === "manual_pass"
                              ? hasBypassableAssessments
                                ? "Mark Pass"
                                : "Mark Pass & Advance"
                              : hasBypassableAssessments
                                ? "Bypass Selected"
                                : "Bypass & Advance"}
                          </>
                        )}
                      </Button>
                    </div>
                  </CardContent>
                )}
              </Card>
            )}

            {canBypassPi && (
              <Card className="border-0 border-violet-500/20 bg-violet-500/5 shadow-sm">
                <CardHeader className="pb-2">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-center gap-2">
                      <RotateCcw className="h-4 w-4 text-violet-300" />
                      <CardTitle className="text-sm text-violet-200">
                        Interview Bypass
                      </CardTitle>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 rounded-xl border-violet-500/30 text-xs text-violet-200 hover:bg-violet-500/10"
                      onClick={() => setPiBypassOpen((open) => !open)}
                    >
                      {piBypassOpen ? "Cancel" : "Open Interview Bypass"}
                    </Button>
                  </div>
                  <CardDescription className="text-xs text-violet-300/70">
                    Admins, HR, TA, and evaluators can close the interview directly.
                    A selected outcome moves the candidate to the Selection Form stage.
                  </CardDescription>
                </CardHeader>
                {piBypassOpen && (
                  <CardContent className="space-y-4 pt-0">
                    <div className="h-px bg-violet-500/20" />
                    <div className="grid gap-4 md:grid-cols-[220px_180px_180px_minmax(0,1fr)]">
                      <div className="space-y-1.5">
                        <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
                          Action
                        </Label>
                        <Select
                          value={piBypassMode}
                          onValueChange={(value) =>
                            setPiBypassMode(value as "outcome" | "manual_pass")
                          }
                        >
                          <SelectTrigger className="h-9 rounded-xl text-sm">
                            <span className="flex flex-1 text-left">
                              {INTERVIEW_BYPASS_ACTION_LABELS[piBypassMode]}
                            </span>
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="outcome">Close with Outcome</SelectItem>
                            <SelectItem value="manual_pass">Mark as Pass Manually</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
                          Final Verdict *
                        </Label>
                        <Select
                          value={piBypassMode === "manual_pass" ? "selected" : piBypassVerdict}
                          onValueChange={(value) =>
                            setPiBypassVerdict(
                              value as "selected" | "rejected",
                            )
                          }
                          disabled={piBypassMode === "manual_pass"}
                        >
                          <SelectTrigger className="h-9 rounded-xl text-sm">
                            <SelectValue placeholder="Select verdict" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="selected">Selected</SelectItem>
                            <SelectItem value="rejected">Rejected</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
                          PI Score
                        </Label>
                        <Input
                          type="number"
                          min={0}
                          max={100}
                          placeholder={piBypassMode === "manual_pass" ? "100 default" : "0-100"}
                          className="h-9 rounded-xl text-sm"
                          value={piBypassScore}
                          onChange={(event) =>
                            setPiBypassScore(event.target.value)
                          }
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
                          Notes
                        </Label>
                        <Input
                          placeholder={
                            piBypassMode === "manual_pass"
                              ? "Reason PI was marked manually"
                              : "Reason or context for bypass"
                          }
                          className="h-9 rounded-xl text-sm"
                          value={piBypassNotes}
                          onChange={(event) =>
                            setPiBypassNotes(event.target.value)
                          }
                        />
                      </div>
                    </div>
                    <div className="flex justify-end">
                      <Button
                        size="sm"
                        className="rounded-xl text-xs"
                        onClick={handlePiBypass}
                        disabled={isPiBypassing}
                      >
                        {isPiBypassing ? (
                          <>
                            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                            Saving...
                          </>
                        ) : (
                          <>
                            <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
                            {piBypassMode === "manual_pass" ? "Mark Interview Pass" : "Bypass Interview"}
                          </>
                        )}
                      </Button>
                    </div>
                  </CardContent>
                )}
              </Card>
            )}

            <Card className="border-0 shadow-sm">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Users className="h-4 w-4 text-primary" />
                    <CardTitle className="text-sm">
                      PI Interview Journey
                    </CardTitle>
                  </div>
                  <Badge variant="outline" className="text-[11px]">
                    {latestPiRounds.length}/5 rounds
                  </Badge>
                </div>
                <CardDescription className="text-xs">
                  Round-wise evaluator/panel details, marks, remarks, and final
                  PI outcome.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {latestPiRounds.length > 0 ? (
                  <div className="grid gap-3 xl:grid-cols-2">
                    {latestPiRounds.map((round) => (
                      <div
                        key={round.id}
                        className="rounded-xl border border-border/60 bg-muted/5 p-4"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-2 mb-3">
                          <div>
                            <p className="text-sm font-semibold">
                              Round {round.roundNumber}
                            </p>
                            <p className="text-[11px] text-muted-foreground">
                              {round.subject ?? "PI Interview"}
                              {round.evaluatorName
                                ? ` · ${round.evaluatorName}`
                                : ""}
                            </p>
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            {round.status && (
                              <span
                                className={cn(
                                  "text-[10px] font-medium px-1.5 py-0.5 rounded-full",
                                  round.status === "completed" ||
                                    round.status === "no_further_pi_required"
                                    ? "bg-green-100 text-green-700"
                                    : round.status === "scheduled" ||
                                        round.status === "rescheduled"
                                      ? "bg-blue-100 text-blue-700"
                                      : "bg-muted text-muted-foreground",
                                )}
                              >
                                {formatLabel(round.status)}
                              </span>
                            )}
                            {(round.finalVerdict || round.roundDecision) && (
                              <span
                                className={cn(
                                  "text-[10px] font-medium px-1.5 py-0.5 rounded-full",
                                  (round.finalVerdict ??
                                    round.roundDecision) === "selected"
                                    ? "bg-emerald-100 text-emerald-700"
                                    : (round.finalVerdict ??
                                          round.roundDecision) === "rejected"
                                      ? "bg-red-100 text-red-700"
                                      : "bg-amber-100 text-amber-700",
                                )}
                              >
                                {formatLabel(
                                  round.finalVerdict ??
                                    round.roundDecision ??
                                    "",
                                )}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="grid gap-2 text-xs sm:grid-cols-2">
                          <div className="flex justify-between sm:block">
                            <span className="text-muted-foreground">Score</span>
                            <span className="font-semibold sm:ml-1">
                              {round.score != null ? String(round.score) : "—"}
                            </span>
                          </div>
                          <div className="flex justify-between sm:block">
                            <span className="text-muted-foreground">Mode</span>
                            <span className="font-medium sm:ml-1">
                              {round.mode ? formatLabel(round.mode) : "—"}
                            </span>
                          </div>
                          <div className="flex justify-between sm:block">
                            <span className="text-muted-foreground">
                              Scheduled
                            </span>
                            <span className="font-medium sm:ml-1">
                              {round.scheduledAt
                                ? formatDateTime(round.scheduledAt)
                                : "—"}
                            </span>
                          </div>
                          <div className="flex justify-between sm:block">
                            <span className="text-muted-foreground">
                              Completed
                            </span>
                            <span className="font-medium sm:ml-1">
                              {round.completedAt
                                ? formatDateTime(round.completedAt)
                                : "—"}
                            </span>
                          </div>
                          <div className="flex justify-between sm:block">
                            <span className="text-muted-foreground">Panel</span>
                            <span className="font-medium sm:ml-1">
                              {round.panelLabel ?? "—"}
                            </span>
                          </div>
                          <div className="flex justify-between sm:block">
                            <span className="text-muted-foreground">
                              Members
                            </span>
                            <span className="font-medium sm:ml-1">
                              {round.panelMembers?.length
                                ? round.panelMembers.join(", ")
                                : "—"}
                            </span>
                          </div>
                        </div>
                        {round.noFurtherPiRequired && (
                          <div className="mt-3 rounded-lg bg-violet-50 dark:bg-violet-950/30 px-3 py-2 text-[11px] text-violet-700 dark:text-violet-300">
                            No further PI required — final verdict recorded
                            here.
                          </div>
                        )}
                        <div className="mt-3 rounded-lg border border-border/60 bg-background/70 p-3">
                          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                            Evaluator Remarks
                          </p>
                          <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">
                            {round.remarks ??
                              round.notes ??
                              "No remarks added yet."}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-2xl border border-dashed border-border p-8 text-center text-muted-foreground">
                    <Users className="h-8 w-8 mx-auto mb-2 opacity-20" />
                    <p className="text-sm font-medium">
                      No PI rounds scheduled yet
                    </p>
                    <p className="text-xs mt-1">
                      PI rounds will appear here once scheduled by the
                      evaluator.
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>

            {latestEvaluation && (
              <Card className="border-0 shadow-sm">
                <CardHeader className="pb-2">
                  <div className="flex items-center gap-2">
                    <Trophy className="h-4 w-4 text-primary" />
                    <CardTitle className="text-sm">Final Evaluation</CardTitle>
                  </div>
                  <CardDescription className="text-xs">
                    Candidate interview score, recommendation, and evaluator
                    notes.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {[
                      {
                        label: "Total Score",
                        value:
                          latestEvaluation.totalScore ??
                          latestEvaluation.total_score ??
                          "—",
                        unit: "/10",
                      },
                      {
                        label: "Recommendation",
                        value: latestEvaluation.recommendation
                          ? formatLabel(latestEvaluation.recommendation)
                          : "—",
                        unit: "",
                      },
                      {
                        label: "Evaluator",
                        value: latestEvaluation.evaluator?.name ?? "—",
                        unit: "",
                      },
                    ].map(({ label, value, unit }) => (
                      <div
                        key={label}
                        className="rounded-xl border border-border/60 bg-muted/5 p-3"
                      >
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                          {label}
                        </p>
                        <p className="mt-1 text-lg font-bold">
                          {typeof value === "number"
                            ? value.toFixed(2)
                            : String(value ?? "—")}
                          {unit && value !== "—" ? unit : ""}
                        </p>
                      </div>
                    ))}
                  </div>
                  {latestEvaluation.notes && (
                    <div className="mt-3 rounded-xl border border-border/60 bg-muted/5 p-4">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                        Evaluator Notes
                      </p>
                      <p className="text-xs leading-relaxed text-muted-foreground whitespace-pre-wrap">
                        {latestEvaluation.notes}
                      </p>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
          </div>
        </TabsContent>

        <TabsContent value="contract">
          <ContractTab
            candidateId={candidate.id}
            candidateName={candidate.fullName ?? candidate.full_name ?? ""}
            currentStage={
              candidate.currentStage ?? candidate.current_stage ?? ""
            }
            initialContract={
              candidate.contract
                ? {
                    id: candidate.contract.id,
                    candidateId: candidate.contract.candidateId ?? candidate.id,
                    status: candidate.contract.status,
                    documensoId: candidate.contract.documensoId,
                    templateId: candidate.contract.templateId,
                    signedUrl: candidate.contract.signedUrl,
                    pdfUrl: candidate.contract.pdfUrl,
                    signedItems: candidate.contract.signedItems,
                    sentAt: candidate.contract.sentAt,
                    viewedAt: candidate.contract.viewedAt,
                    signedAt: candidate.contract.signedAt,
                    expiresAt: candidate.contract.expiresAt,
                    ctc: candidate.contract.ctc,
                    joiningDate: candidate.contract.joiningDate,
                    createdAt: candidate.contract.createdAt ?? "",
                    updatedAt: candidate.contract.updatedAt ?? "",
                  }
                : null
            }
          />
        </TabsContent>

        <TabsContent value="compliance">
          <Card className="border-0 shadow-sm">
            <CardHeader>
              <CardTitle className="text-base">
                Statutory & Compliance Forms
              </CardTitle>
            </CardHeader>
            <CardContent>
              {candidate.complianceForms?.length > 0 ? (
                <div className="space-y-2">
                  {candidate.complianceForms.map((form: CandidateComplianceForm) => {
                    const title = getComplianceFormTitle(form);
                    const hasSignedPdf = getCompliancePdfAvailable(form);
                    const isLoading = isCompliancePreviewLoading === form.id;
                    const isResending = isComplianceResendLoading === form.id;
                    const canResendForm = canResendComplianceForms && !hasSignedPdf;
                    return (
                      <div
                        key={form.id}
                        role={hasSignedPdf ? "button" : undefined}
                        tabIndex={hasSignedPdf ? 0 : undefined}
                        onClick={() => {
                          if (hasSignedPdf) void handleCompliancePreview(form);
                        }}
                        onKeyDown={(event) => {
                          if (!hasSignedPdf) return;
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            void handleCompliancePreview(form);
                          }
                        }}
                        className={cn(
                          "flex flex-col gap-3 rounded-xl border border-border p-3 transition sm:flex-row sm:items-center sm:justify-between",
                          hasSignedPdf
                            ? "cursor-pointer hover:bg-muted/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
                            : "cursor-default",
                        )}
                      >
                        <div className="flex min-w-0 items-start gap-3">
                          <Shield className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                          <div className="min-w-0">
                            <p className="break-words text-sm font-medium">{title}</p>
                            {!hasSignedPdf && (
                              <p className="mt-1 text-xs text-muted-foreground">
                                Signed PDF is not available yet.
                              </p>
                            )}
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                          <DocStatusBadge status={form.status} />
                          {canResendForm && (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="rounded-xl"
                              disabled={isResending}
                              onClick={(event) => {
                                event.stopPropagation();
                                void handleComplianceResend(form);
                              }}
                            >
                              {isResending ? (
                                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                              )}
                              Resend
                            </Button>
                          )}
                          {hasSignedPdf && (
                            <>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="rounded-xl"
                                disabled={isLoading}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  void handleCompliancePreview(form);
                                }}
                              >
                                {isLoading ? (
                                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  <FileText className="mr-1.5 h-3.5 w-3.5" />
                                )}
                                Preview
                              </Button>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="rounded-xl"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  void handleComplianceDownload(form);
                                }}
                              >
                                <Download className="mr-1.5 h-3.5 w-3.5" />
                                Download
                              </Button>
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <EmptyState
	                  icon={Shield}
	                  title="Statutory forms not yet sent"
	                  description="HR or Admin can send the statutory forms after the contract is signed."
	                />
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {canViewIdCardForm && (
          <TabsContent value="id-card">
            <Card className="border-0 shadow-sm">
              <CardHeader>
                <CardTitle className="text-base">ID Card Details</CardTitle>
                <CardDescription>
                  Available after the Ethara email has been created. Admin, HR,
                  and IT can view this form.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {!candidate.etharaEmail ? (
                  <EmptyState
                    icon={CreditCard}
                    title="Ethara email pending"
                    description="Create the Ethara email first, then fill the ID card details form."
                  />
                ) : isIdCardFormLoading ? (
                  <div className="flex items-center justify-center py-10 text-muted-foreground">
                    <Loader2 className="h-5 w-5 animate-spin" />
                  </div>
                ) : (
                  <CandidateIdCardFormPanel
                    key={`${id}:${idCardForm?.updatedAt ?? "draft"}`}
                    candidateId={candidate.id}
                    candidateName={
                      candidate.fullName ?? candidate.full_name ?? ""
                    }
                    initialRecord={
                      idCardForm ?? {
                        candidateId: candidate.id,
                        name: candidate.fullName ?? candidate.full_name ?? "",
                      }
                    }
                    onSaved={async () => {
                      await queryClient.invalidateQueries({
                        queryKey: ["candidate-id-card-form", id],
                      });
                    }}
                  />
                )}
              </CardContent>
            </Card>
          </TabsContent>
        )}
      </Tabs>

      <Dialog
        open={!!documentPreview}
        onOpenChange={(open) => {
          if (!open) {
            setDocumentPreview(null);
          }
        }}
      >
        <DialogContent className="max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] max-w-5xl overflow-hidden rounded-2xl p-0 sm:w-full">
          <DialogHeader className="border-b border-border px-5 py-4 text-left">
            <DialogTitle className="flex min-w-0 items-center gap-2">
              <FileText className="h-4 w-4 shrink-0 text-primary" />
              <span className="min-w-0 break-words">
                {documentPreview?.fileName ?? "Document preview"}
              </span>
            </DialogTitle>
            <DialogDescription>
              {documentPreview?.description ??
                "Preview the selected document without leaving this page."}
            </DialogDescription>
          </DialogHeader>
          <div className="h-[70dvh] min-h-[420px] bg-muted/20">
            {documentPreview?.mimeType === "application/pdf" ? (
              <iframe
                src={documentPreview.url}
                title={documentPreview.fileName}
                className="h-full w-full border-0"
              />
            ) : documentPreview?.mimeType.startsWith("image/") ? (
              <div className="flex h-full items-center justify-center overflow-auto p-4">
                <Image
                  src={documentPreview.url}
                  alt={documentPreview.fileName}
                  width={1200}
                  height={900}
                  unoptimized
                  className="h-auto max-h-full w-auto max-w-full rounded-lg object-contain"
                />
              </div>
            ) : (
              <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
                Preview is not available for this file type.
              </div>
            )}
          </div>
          <DialogFooter className="border-t border-border px-5 py-4">
            <Button
              variant="outline"
              className="rounded-xl"
              onClick={() => setDocumentPreview(null)}
            >
              Close
            </Button>
            {documentPreview?.complianceForm && (
              <Button
                className="rounded-xl"
                onClick={() => {
                  if (documentPreview?.complianceForm) {
                    void handleComplianceDownload(documentPreview.complianceForm);
                  }
                }}
              >
                <Download className="mr-1.5 h-4 w-4" />
                Download
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
        <DialogContent className="max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] max-w-2xl overflow-x-hidden overflow-y-auto rounded-2xl sm:w-full">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Pencil className="h-4 w-4 text-primary" />
              Edit Candidate Details
            </DialogTitle>
            <DialogDescription>
              Update the candidate name, contact details, and profile metadata
              without changing any other pipeline data.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-x-5 gap-y-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Full Name</Label>
              <Input
                value={candidateForm.fullName}
                onChange={(event) =>
                  setCandidateForm((prev) => ({
                    ...prev,
                    fullName: event.target.value,
                  }))
                }
                placeholder="Candidate full name"
              />
            </div>
            <div className="space-y-2">
              <Label>Personal Email</Label>
              <Input
                type="email"
                value={candidateForm.personalEmail}
                onChange={(event) =>
                  setCandidateForm((prev) => ({
                    ...prev,
                    personalEmail: event.target.value,
                  }))
                }
                placeholder="candidate@example.com"
              />
            </div>
            <div className="space-y-2">
              <Label>Ethara Email</Label>
              <Input
                type="email"
                value={candidateForm.etharaEmail}
                onChange={(event) =>
                  setCandidateForm((prev) => ({
                    ...prev,
                    etharaEmail: event.target.value,
                  }))
                }
                placeholder="Optional Ethara email"
              />
            </div>
            <div className="space-y-2">
              <Label>Employee Code</Label>
              <Input
                value={candidateForm.employeeCode}
                onChange={(event) =>
                  setCandidateForm((prev) => ({
                    ...prev,
                    employeeCode: event.target.value.toUpperCase(),
                  }))
                }
                placeholder="GRP1001"
              />
            </div>
            <div className="space-y-2">
              <Label>Phone</Label>
              <Input
                value={candidateForm.phone}
                onChange={(event) =>
                  setCandidateForm((prev) => ({
                    ...prev,
                    phone: event.target.value,
                  }))
                }
                placeholder="Phone number"
              />
            </div>
            <div className="space-y-2">
              <Label>Gender</Label>
              <Input
                value={candidateForm.gender}
                onChange={(event) =>
                  setCandidateForm((prev) => ({
                    ...prev,
                    gender: event.target.value,
                  }))
                }
                placeholder="Gender"
              />
            </div>
            <div className="space-y-2">
              <Label>Date of Birth</Label>
              <DatePicker
                value={candidateForm.dateOfBirth}
                onChange={(value) =>
                  setCandidateForm((prev) => ({ ...prev, dateOfBirth: value }))
                }
                max={new Date().toISOString().slice(0, 10)}
              />
            </div>
            <div className="space-y-2">
              <Label>Experience Type</Label>
              <Select
                value={candidateForm.experienceType || NONE_OPTION}
                onValueChange={(value) =>
                  setCandidateForm((prev) => ({
                    ...prev,
                    experienceType:
                      !value || value === NONE_OPTION ? "" : value,
                  }))
                }
              >
                <SelectTrigger className="h-10 w-full rounded-xl">
                  <SelectValue placeholder="Select experience type">
                    {(value) =>
                      value
                        ? selectedExperienceTypeLabel
                        : "Select experience type"
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE_OPTION}>Not specified</SelectItem>
                  <SelectItem value="fresher">Fresher</SelectItem>
                  <SelectItem value="experienced">Experienced</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Current Company</Label>
              <Input
                value={candidateForm.currentCompany}
                onChange={(event) =>
                  setCandidateForm((prev) => ({
                    ...prev,
                    currentCompany: event.target.value,
                  }))
                }
                placeholder="Current company"
              />
            </div>
            <div className="space-y-2">
              <Label>Current CTC</Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={candidateForm.currentCTC}
                onChange={(event) =>
                  setCandidateForm((prev) => ({
                    ...prev,
                    currentCTC: event.target.value,
                  }))
                }
                placeholder="Current CTC"
              />
            </div>
            <div className="space-y-2">
              <Label>Expected CTC</Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={candidateForm.expectedCTC}
                onChange={(event) =>
                  setCandidateForm((prev) => ({
                    ...prev,
                    expectedCTC: event.target.value,
                  }))
                }
                placeholder="Expected CTC"
              />
            </div>
            <div className="space-y-2">
              <Label>Notice Period (days)</Label>
              <Input
                type="number"
                min="0"
                step="1"
                value={candidateForm.noticePeriod}
                onChange={(event) =>
                  setCandidateForm((prev) => ({
                    ...prev,
                    noticePeriod: event.target.value,
                  }))
                }
                placeholder="Notice period"
              />
            </div>
            <div className="space-y-2">
              <Label>Position</Label>
              <Select
                value={candidateForm.positionId || NONE_OPTION}
                onValueChange={(value) =>
                  setCandidateForm((prev) => ({
                    ...prev,
                    positionId: !value || value === NONE_OPTION ? "" : value,
                  }))
                }
              >
                <SelectTrigger className="h-10 w-full rounded-xl">
                  <SelectValue placeholder="Select a position">
                    {(value) =>
                      value
                        ? selectedCandidatePositionLabel
                        : "Select a position"
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectContent className="w-[min(28rem,calc(100vw-2rem))]">
                  <SelectItem value={NONE_OPTION}>
                    No position assigned
                  </SelectItem>
                  {positions.map((position) => (
                    <SelectItem key={position.id} value={position.id}>
                      {position.title}
                      {position.department ? ` · ${position.department}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>College</Label>
              <Select
                value={candidateForm.collegeId || NONE_OPTION}
                onValueChange={(value) =>
                  setCandidateForm((prev) => ({
                    ...prev,
                    collegeId: !value || value === NONE_OPTION ? "" : value,
                  }))
                }
              >
                <SelectTrigger className="h-10 w-full rounded-xl">
                  <SelectValue placeholder="Select a college">
                    {(value) =>
                      value ? selectedCandidateCollegeLabel : "Select a college"
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectContent className="w-[min(24rem,calc(100vw-2rem))]">
                  <SelectItem value={NONE_OPTION}>
                    No college assigned
                  </SelectItem>
                  {colleges.map((college) => (
                    <SelectItem key={college.id} value={college.id}>
                      {college.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter className="mt-2">
            <Button
              variant="outline"
              className="rounded-xl"
              onClick={() => setIsEditOpen(false)}
              disabled={isSaving}
            >
              Cancel
            </Button>
            <Button
              className="rounded-xl"
              onClick={() => void handleSaveCandidate()}
              disabled={
                isSaving ||
                !candidateForm.fullName.trim() ||
                !candidateForm.personalEmail.trim() ||
                !candidateForm.phone.trim()
              }
            >
              {isSaving ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CandidateIdCardFormPanel({
  candidateId,
  candidateName,
  initialRecord,
  onSaved,
}: {
  candidateId: string;
  candidateName: string;
  initialRecord: CandidateIdCardFormRecord;
  onSaved: () => Promise<void>;
}) {
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState(initialRecord.name ?? candidateName);
  const [employeeId, setEmployeeId] = useState(initialRecord.employeeId ?? "");
  const [bloodGroup, setBloodGroup] = useState(initialRecord.bloodGroup ?? "");
  const [emergencyNo, setEmergencyNo] = useState(
    initialRecord.emergencyNo ?? "",
  );
  const [submittedAt, setSubmittedAt] = useState(
    initialRecord.submittedAt ?? null,
  );

  const handleSave = async () => {
    if (
      !name.trim() ||
      !employeeId.trim() ||
      !bloodGroup.trim() ||
      !emergencyNo.trim()
    ) {
      toast.error("Please complete all ID card fields before saving.");
      return;
    }
    setSaving(true);
    try {
      const saved = await candidateIdCardApi.submit(candidateId, {
        name: name.trim(),
        employeeId: employeeId.trim(),
        bloodGroup: bloodGroup.trim(),
        emergencyNo: emergencyNo.trim(),
      });
      setSubmittedAt(saved.submittedAt ?? null);
      toast.success("ID card details saved.");
      await onSaved();
    } catch (error) {
      const apiError = error as { response?: { data?: { detail?: string } } };
      toast.error(
        apiError.response?.data?.detail ||
          "Could not save the ID card details.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="grid gap-5 sm:grid-cols-2">
        <div className="space-y-2">
          <Label className="text-xs uppercase tracking-wide text-muted-foreground">
            Name
          </Label>
          <Input
            className="rounded-xl"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Candidate name for the ID card"
          />
        </div>
        <div className="space-y-2">
          <Label className="text-xs uppercase tracking-wide text-muted-foreground">
            Employee ID
          </Label>
          <Input
            className="rounded-xl"
            value={employeeId}
            onChange={(event) => setEmployeeId(event.target.value)}
            placeholder="Employee code or ID"
          />
        </div>
        <div className="space-y-2">
          <Label className="text-xs uppercase tracking-wide text-muted-foreground">
            Blood Group
          </Label>
          <Input
            className="rounded-xl"
            value={bloodGroup}
            onChange={(event) => setBloodGroup(event.target.value)}
            placeholder="e.g. O+, A-, AB+"
          />
        </div>
        <div className="space-y-2">
          <Label className="text-xs uppercase tracking-wide text-muted-foreground">
            Emergency No
          </Label>
          <Input
            className="rounded-xl"
            value={emergencyNo}
            onChange={(event) => setEmergencyNo(event.target.value)}
            placeholder="Emergency contact number"
          />
        </div>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="min-w-0 break-words text-xs text-muted-foreground">
          {submittedAt
            ? `Last submitted ${formatDateTime(submittedAt)}`
            : "Once saved, these details become visible to Admin, HR, and IT on this candidate record."}
        </p>
        <Button
          className="w-full rounded-full sm:w-auto"
          onClick={() => void handleSave()}
          disabled={saving}
        >
          {saving ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <CheckCircle2 className="mr-2 h-4 w-4" />
          )}
          Save ID Card Details
        </Button>
      </div>
    </div>
  );
}

function EmptyState({
  icon: Icon,
  title,
  description,
}: {
  icon: React.ElementType;
  title: string;
  description: string;
}) {
  return (
    <div className="flex flex-col items-center py-10 text-center">
      <div className="h-14 w-14 rounded-2xl bg-muted flex items-center justify-center mb-4">
        <Icon className="h-7 w-7 text-muted-foreground" />
      </div>
      <h3 className="text-base font-semibold">{title}</h3>
      <p className="text-sm text-muted-foreground mt-1 max-w-md">
        {description}
      </p>
    </div>
  );
}

// ============================================================
// Ethara HRMS — Core Type Definitions
// ============================================================

export type Role =
  | "super_admin"
  | "admin"
  | "leadership"
  | "hr"
  | "ta"
  | "employee"
  | "vendor"
  | "employee_referrer"
  | "evaluator"
  | "it_team"
  | "compliance"
  | "candidate"
  | "manager"
  | "office_admin"
  | "pl_tpm";

export type AuthProfile =
  | {
      type: "employee";
      id: string;
      userId?: string | null;
      fullName: string;
      name: string;
      etharaEmail: string;
      personalEmail?: string | null;
      employeeCode: string;
      phone?: string | null;
      department?: string | null;
      designation?: string | null;
      gender?: string | null;
      aadhaarLast4?: string | null;
      aadhaarOcrStatus?: string | null;
      aadhaarOcrMatch?: boolean | null;
      dateOfBirth?: string | null;
      aadhaarPath?: string | null;
      resumePath?: string | null;
      profilePhotoEndpoint?: string | null;
      createdAt?: string;
      updatedAt?: string;
    }
  | {
      type: "candidate";
      id: string;
      candidateCode: string;
      fullName: string;
      personalEmail: string;
      etharaEmail?: string | null;
      currentStage: string;
      currentStatus: string;
      campusLock?: boolean;
      campusAssessmentPassed?: boolean;
      campusNextRoute?: string | null;
    }
  | {
      type: "vendor";
      id: string;
      name: string;
      contactEmail: string;
      contactPhone?: string | null;
    };

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
  roles?: Role[];
  phone?: string;
  avatarUrl?: string;
  profilePhotoEndpoint?: string | null;
  isActive: boolean;
  mustChangePassword?: boolean;
  emailVerified?: boolean;
  emailVerifiedAt?: string;
  lastLoginAt?: string;
  createdAt: string;
  updatedAt?: string;
  permissions?: string[];
}

export interface CareerApplication {
  id: string;
  fullName: string;
  email: string;
  phone: string;
  linkedinUrl?: string | null;
  portfolioUrl?: string | null;
  githubUrl?: string | null;
  referredByName?: string | null;
  resumeFileName: string | null;
  resumeUrl: string | null;
  resumeMimeType?: string | null;
  resumeSize?: number | null;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export type CandidateStage =
  | "new_application"
  | "source_tagged"
  | "resume_uploaded"
  | "resume_screening_pending"
  | "resume_shortlisted"
  | "resume_rejected"
  | "evaluation_assigned"
  | "evaluation_in_progress"
  | "evaluation_passed"
  | "evaluation_failed"
  | "selection_form_sent"
  | "selection_form_submitted"
  | "selection_form_validated"
  | "contract_sent"
  | "contract_signed"
  | "induction_completed"
  | "it_email_created"
  | "welcome_mail_sent"
  | "statutory_forms_sent"
  | "statutory_forms_submitted"
  | "compliance_verified"
  | "onboarding_completed";

export type SourceType =
  | "vendor"
  | "lateral_hiring"
  | "employee_referral"
  | "direct_application"
  | "campus_hire";

export type ExperienceType = "fresher" | "experienced";

export type MaritalStatus = "unmarried" | "married";

export interface Candidate {
  id: string;
  accessLevel?: "full" | "scoped" | "preview";
  canOpenDetail?: boolean;
  candidateCode: string;
  employeeCode?: string | null;
  fullName: string;
  personalEmail: string;
  etharaEmail?: string;
  phone: string;
  aadhaarLast4?: string;
  experienceType?: ExperienceType | null;
  experienceYears?: number | null;
  sourceType: SourceType;
  sourceId?: string;
  positionId?: string;
  positionTitle?: string;
  collegeId?: string;
  collegeName?: string;
  currentStage: CandidateStage;
  currentStatus: string;
  priorityScore: number;
  isDuplicate: boolean;
  duplicateReason?: string;
  isReapplicationBlocked: boolean;
  lastAppliedAt?: string;
  position?: Position;
  college?: College;
  createdAt: string;
  updatedAt: string;
}

export interface Position {
  id: string;
  title: string;
  slug?: string;
  department: string;
  summary?: string;
  description?: string;
  location?: string;
  employmentType?: string;
  workMode?: string;
  experienceLevel?: string;
  experienceYears?: number | null;
  salaryBracket?: string | null;
  responsibilities?: string[];
  requirements?: string[];
  preferredSkills?: string[];
  benefits?: string[];
  featured?: boolean;
  openings?: number;
  postedAt?: string;
  urgencyLevel: number;
  isActive: boolean;
  approvalStatus?: string;
  approvalRequestedAt?: string | null;
  approvalDecidedAt?: string | null;
  requestedBy?: string | null;
  approvedBy?: string | null;
  approvalRecipientEmail?: string | null;
  reviewedByEmail?: string | null;
  rejectionReason?: string | null;
  approvalEmailSentAt?: string | null;
  createdAt: string;
  updatedAt?: string;
  candidateCount?: number;
}

export interface ScreeningPayload {
  score?: number;
  matchScore?: number;
  recommendation?: string;
  summary?: string;
  strengths?: string[];
  gaps?: string[];
}

export interface CandidateContract {
  id: string;
  candidateId: string;
  status: "draft" | "sent" | "viewed" | "signed" | "expired";
  documensoId?: string | null;
  templateId?: number | null;
  signedUrl?: string | null;
  pdfUrl?: string | null;
  sentAt?: string | null;
  viewedAt?: string | null;
  signedAt?: string | null;
  expiresAt?: string | null;
  ctc?: number | null;
  joiningDate?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CandidateDetail extends Candidate {
  gender?: string;
  dateOfBirth?: string;
  maritalStatus?: string;
  experienceType?: ExperienceType | null;
  currentCompany?: string;
  currentCTC?: number;
  expectedCTC?: number;
  noticePeriod?: number;
  resumeUrl?: string;
  resumeScore?: number;
  resumeSummary?: string;
  resumeKeyPoints?: string[];
  screeningPayload?: ScreeningPayload;
  llmStatus?: string;
  position?: Position;
  college?: College;
  stageLogs?: StageStatusLog[];
  contract?: CandidateContract | null;
}

export interface CandidatePortalOverview {
  currentApplication?: CandidateDetail | null;
  applications: Candidate[];
  emailVerified: boolean;
  emailVerifiedAt?: string;
}

export interface DashboardMetric {
  label: string;
  value: number;
  change?: number;
  changeLabel?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  icon?: any;
  color?: "primary" | "success" | "warning" | "destructive" | "info";
  href?: string;
}

export interface StageStatusLog {
  id: string;
  candidateId: string;
  fromStage: CandidateStage;
  toStage: CandidateStage;
  changedBy: string;
  changedByName?: string;
  notes?: string;
  createdAt: string;
}

export interface Notification {
  id: string;
  userId: string;
  candidateId?: string | null;
  title: string;
  message: string;
  type: "info" | "warning" | "success" | "error" | "action";
  isRead: boolean;
  entityType?: string | null;
  entityId?: string | null;
  payload?: Record<string, unknown> | null;
  route?: string | null;
  createdAt: string;
}

export interface Vendor {
  id: string;
  name: string;
  contactEmail: string;
  contactPhone: string;
  isActive: boolean;
  candidateCount?: number;
  createdAt: string;
}

export interface College {
  id: string;
  name: string;
  isActive: boolean;
  createdAt: string;
}

export interface AuditLog {
  id: string;
  entityType: string;
  entityId: string;
  action: string;
  performedBy: string;
  performedByName?: string;
  ipAddress?: string;
  createdAt: string;
}

export interface Escalation {
  id: string;
  candidateId: string;
  candidateName?: string;
  stage: string;
  responsibleUserId: string;
  responsibleUserName?: string;
  slaDeadline: string;
  delayedBy: string;
  escalationLevel: number;
  status: "open" | "acknowledged" | "resolved";
  emailSentAt?: string;
  resolvedAt?: string;
  resolvedBy?: string;
}

import { useQuery, useMutation, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import {
  candidatesApi, CandidateFilters,
  reportsApi, positionsApi, vendorsApi, collegesApi, usersApi,
  escalationsApi, notificationsApi, itRequestsApi, auditLogsApi, documentsApi,
  employeesApi, screeningApi,
} from "./api";
import { toast } from "sonner";

type ApiErrorLike = {
  response?: {
    data?: {
      message?: string;
    };
  };
};

// ─── Query Keys ────────────────────────────────────────────────────────────

export const queryKeys = {
  candidates: (filters?: CandidateFilters) => ["candidates", filters] as const,
  candidate: (id: string) => ["candidates", id] as const,
  candidateStats: () => ["candidates", "stats"] as const,
  reportSummary: () => ["reports", "summary"] as const,
  reportFunnel: () => ["reports", "funnel"] as const,
  reportEscalations: () => ["reports", "escalations"] as const,
  reportPositions: () => ["reports", "positions"] as const,
  reportPiSummary: () => ["reports", "pi-summary"] as const,
  positions: () => ["positions"] as const,
  vendors: () => ["vendors"] as const,
  colleges: () => ["colleges"] as const,
  users: () => ["users"] as const,
  escalations: (status?: string) => ["escalations", status] as const,
  notifications: () => ["notifications"] as const,
  itRequests: (status?: string) => ["it-requests", status] as const,
  auditLogs: (params?: object) => ["audit-logs", params] as const,
  documents: (candidateId?: string) => ["documents", candidateId] as const,
  allDocuments: (params?: object) => ["documents", "all", params] as const,
  screening: (params?: object) => ["screening", params] as const,
  screeningRecord: (candidateId: string) => ["screening", candidateId] as const,
  employeeDashboard: () => ["employees", "me", "dashboard"] as const,
  employeeDetail: (employeeId: string) => ["employees", employeeId] as const,
};

// ─── Candidates ────────────────────────────────────────────────────────────

export function useCandidates(filters: CandidateFilters = {}) {
  return useQuery({
    queryKey: queryKeys.candidates(filters),
    queryFn: () => candidatesApi.list(filters),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
}

export function useCandidate(id: string) {
  return useQuery({
    queryKey: queryKeys.candidate(id),
    queryFn: () => candidatesApi.get(id),
    enabled: !!id,
  });
}

export function useCandidateStats() {
  return useQuery({
    queryKey: queryKeys.candidateStats(),
    queryFn: candidatesApi.stats,
    staleTime: 60_000,
  });
}

export function useCreateCandidate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: Record<string, unknown>) => candidatesApi.create(payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["candidates"] });
      toast.success("Candidate added successfully!");
    },
    onError: (err: unknown) => {
      const apiErr = err as ApiErrorLike;
      toast.error(apiErr.response?.data?.message || "Failed to add candidate");
    },
  });
}

export function useUpdateCandidate(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: Record<string, unknown>) => candidatesApi.update(id, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.candidate(id) });
      toast.success("Candidate updated.");
    },
  });
}

export function useAdvanceStage(candidateId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ toStage, notes }: { toStage: string; notes?: string }) =>
      candidatesApi.advanceStage(candidateId, toStage, notes),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.candidate(candidateId) });
      qc.invalidateQueries({ queryKey: ["candidates"] });
      toast.success("Stage advanced!");
    },
    onError: (err: unknown) => {
      const apiErr = err as ApiErrorLike;
      toast.error(apiErr.response?.data?.message || "Failed to advance stage");
    },
  });
}

// ─── Reports ───────────────────────────────────────────────────────────────

export function useReportSummary() {
  return useQuery({
    queryKey: queryKeys.reportSummary(),
    queryFn: () => reportsApi.summary(),
    staleTime: 60_000,
  });
}

export function useHiringFunnel() {
  return useQuery({
    queryKey: queryKeys.reportFunnel(),
    queryFn: () => reportsApi.funnel(),
    staleTime: 300_000,
  });
}

export function useEscalationMetrics() {
  return useQuery({
    queryKey: queryKeys.reportEscalations(),
    queryFn: reportsApi.escalationMetrics,
    staleTime: 60_000,
  });
}

export function usePiSummaryReport() {
  return useQuery({
    queryKey: queryKeys.reportPiSummary(),
    queryFn: reportsApi.piSummary,
    staleTime: 60_000,
  });
}

// ─── Positions ─────────────────────────────────────────────────────────────

export function usePositions() {
  return useQuery({
    queryKey: queryKeys.positions(),
    queryFn: positionsApi.list,
    staleTime: 300_000,
  });
}

export function useCreatePosition() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: Record<string, unknown>) => positionsApi.create(payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.positions() });
      toast.success("Position created!");
    },
  });
}

export function useUpdatePosition() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...payload }: { id: string } & Record<string, unknown>) =>
      positionsApi.update(id, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.positions() });
      toast.success("Position updated.");
    },
  });
}

// ─── Vendors ───────────────────────────────────────────────────────────────

export function useVendors() {
  return useQuery({
    queryKey: queryKeys.vendors(),
    queryFn: vendorsApi.list,
    staleTime: 300_000,
  });
}

export function useCreateVendor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: Record<string, unknown>) => vendorsApi.create(payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.vendors() });
      toast.success("Vendor added!");
    },
  });
}

// ─── Colleges ──────────────────────────────────────────────────────────────

export function useColleges(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: queryKeys.colleges(),
    queryFn: collegesApi.list,
    staleTime: 300_000,
    enabled: options?.enabled ?? true,
  });
}

// ─── Users ─────────────────────────────────────────────────────────────────

export function useUsers() {
  return useQuery({
    queryKey: queryKeys.users(),
    queryFn: usersApi.list,
    staleTime: 120_000,
  });
}

export function useCreateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: Record<string, unknown>) => usersApi.create(payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.users() });
      toast.success("User invited!");
    },
  });
}

export function useUpdateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...payload }: { id: string } & Record<string, unknown>) =>
      usersApi.update(id, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.users() });
      toast.success("User updated.");
    },
  });
}

// ─── Escalations ───────────────────────────────────────────────────────────

export function useEscalations(status?: string) {
  return useQuery({
    queryKey: queryKeys.escalations(status),
    queryFn: () => escalationsApi.list({ status }),
    staleTime: 30_000,
    refetchInterval: 60_000, // Poll every minute
  });
}

export function useResolveEscalation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, notes }: { id: string; notes?: string }) =>
      escalationsApi.resolve(id, notes),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["escalations"] });
      toast.success("Escalation resolved!");
    },
  });
}

export function useAcknowledgeEscalation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => escalationsApi.acknowledge(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["escalations"] });
      toast.success("Escalation acknowledged.");
    },
  });
}

// ─── Notifications ─────────────────────────────────────────────────────────

export function useNotifications() {
  return useQuery({
    queryKey: queryKeys.notifications(),
    queryFn: notificationsApi.list,
    staleTime: 15_000,
    refetchInterval: 30_000, // Poll every 30s
  });
}

export function useMarkNotificationRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => notificationsApi.markRead(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.notifications() });
    },
  });
}

export function useMarkAllNotificationsRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: notificationsApi.markAllRead,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.notifications() });
      toast.success("All notifications marked as read.");
    },
  });
}

// ─── IT Requests ───────────────────────────────────────────────────────────

export function useITRequests(status?: string) {
  return useQuery({
    queryKey: queryKeys.itRequests(status),
    queryFn: () => itRequestsApi.list({ status }),
    staleTime: 30_000,
  });
}

export function useCompleteITRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, createdEmail }: { id: string; createdEmail: string }) =>
      itRequestsApi.complete(id, createdEmail),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["it-requests"] });
      toast.success("Email setup completed!");
    },
  });
}

// ─── Audit Logs ────────────────────────────────────────────────────────────

export function useAuditLogs(params?: { entityType?: string; page?: number; limit?: number }) {
  return useQuery({
    queryKey: queryKeys.auditLogs(params),
    queryFn: () => auditLogsApi.list(params),
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });
}

export function useDocuments(candidateId: string) {
  return useQuery({
    queryKey: queryKeys.documents(candidateId),
    queryFn: () => documentsApi.list(candidateId),
    enabled: !!candidateId,
    staleTime: 30_000,
  });
}

export function useAllDocuments(params?: { search?: string; status?: string; page?: number; limit?: number }) {
  return useQuery({
    queryKey: queryKeys.allDocuments(params),
    queryFn: () => documentsApi.listAll(params),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
}

export function useScreeningRecords(params?: { search?: string; recommendation?: string; page?: number; limit?: number }) {
  return useQuery({
    queryKey: queryKeys.screening(params),
    queryFn: () => screeningApi.list(params),
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  });
}

export function useScreeningRecord(candidateId: string) {
  return useQuery({
    queryKey: queryKeys.screeningRecord(candidateId),
    queryFn: () => screeningApi.get(candidateId),
    enabled: !!candidateId,
    staleTime: 10_000,
  });
}

export function useEmployeeDetail(employeeId: string) {
  return useQuery({
    queryKey: queryKeys.employeeDetail(employeeId),
    queryFn: () => employeesApi.get(employeeId),
    enabled: !!employeeId,
    staleTime: 30_000,
  });
}

export function useEmployeeDashboard(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: queryKeys.employeeDashboard(),
    queryFn: () => employeesApi.getDashboard(),
    enabled: options?.enabled ?? true,
    staleTime: 15_000,
  });
}

export function useUploadDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ candidateId, file, type }: { candidateId: string; file: File; type: string }) =>
      documentsApi.upload(candidateId, file, type),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: queryKeys.documents(vars.candidateId) });
      qc.invalidateQueries({ queryKey: ["documents", "all"] });
      toast.success("Document uploaded successfully!");
    },
    onError: () => {
      toast.error("Failed to upload document.");
    },
  });
}

export function useVerifyDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: "verified" | "rejected" }) =>
      documentsApi.verify(id, status),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["documents"] });
      toast.success("Document status updated.");
    },
    onError: () => {
      toast.error("Failed to update document status.");
    },
  });
}

// ─── Assessment Platform ─────────────────────────────────────────────────────

import { assessmentPlatformApi, type ApAssessmentInput } from "./api";

// FastAPI returns errors as { detail }; some legacy hooks read { message }. Prefer detail.
function apErr(err: unknown, fallback: string): string {
  const e = err as { response?: { data?: { detail?: string; message?: string } } };
  return e.response?.data?.detail ?? e.response?.data?.message ?? fallback;
}

export const apKeys = {
  assessments: (params?: object) => ["ap-assessments", params] as const,
  assessment: (id: string) => ["ap-assessments", id] as const,
  questionBank: (params?: object) => ["ap-question-bank", params] as const,
  assignments: (assessmentId: string) => ["ap-assignments", assessmentId] as const,
  myAssignments: () => ["ap", "me", "assignments"] as const,
  results: (assessmentId: string, params?: object) => ["ap-results", assessmentId, params] as const,
  scorecard: (attemptId: string) => ["ap-scorecard", attemptId] as const,
  gradingQueue: (assessmentId?: string) => ["ap-grading-queue", assessmentId] as const,
  gradingAttempt: (attemptId: string) => ["ap-grading-attempt", attemptId] as const,
  questionTypes: () => ["ap-question-types"] as const,
};

// ── reads ──
export function useApAssessments(params: { status?: string; search?: string; page?: number; limit?: number } = {}) {
  return useQuery({
    queryKey: apKeys.assessments(params),
    queryFn: () => assessmentPlatformApi.list(params),
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  });
}

export function useApAssessment(id: string) {
  return useQuery({
    queryKey: apKeys.assessment(id),
    queryFn: () => assessmentPlatformApi.get(id),
    enabled: !!id,
  });
}

export function useApQuestionTypes() {
  return useQuery({
    queryKey: apKeys.questionTypes(),
    queryFn: () => assessmentPlatformApi.questionTypes(),
    staleTime: 5 * 60_000,
  });
}

export function useApQuestionBank(params: { search?: string; tag?: string; includeArchived?: boolean } = {}) {
  return useQuery({
    queryKey: apKeys.questionBank(params),
    queryFn: () => assessmentPlatformApi.bankList(params),
    staleTime: 15_000,
  });
}

export function useApAssignments(assessmentId: string) {
  return useQuery({
    queryKey: apKeys.assignments(assessmentId),
    queryFn: () => assessmentPlatformApi.assignments(assessmentId),
    enabled: !!assessmentId,
  });
}

export function useMyAssignments() {
  return useQuery({
    queryKey: apKeys.myAssignments(),
    queryFn: () => assessmentPlatformApi.myAssignments(),
    staleTime: 10_000,
  });
}

export function useApResults(assessmentId: string, params: { status?: string; page?: number; limit?: number } = {}) {
  return useQuery({
    queryKey: apKeys.results(assessmentId, params),
    queryFn: () => assessmentPlatformApi.results(assessmentId, params),
    enabled: !!assessmentId,
    placeholderData: keepPreviousData,
  });
}

export function useApScorecard(attemptId: string) {
  return useQuery({
    queryKey: apKeys.scorecard(attemptId),
    queryFn: () => assessmentPlatformApi.scorecard(attemptId),
    enabled: !!attemptId,
  });
}

export function useGradingQueue(assessmentId?: string) {
  return useQuery({
    queryKey: apKeys.gradingQueue(assessmentId),
    queryFn: () => assessmentPlatformApi.gradingQueue(assessmentId),
    staleTime: 10_000,
  });
}

export function useAttemptForGrading(attemptId: string) {
  return useQuery({
    queryKey: apKeys.gradingAttempt(attemptId),
    queryFn: () => assessmentPlatformApi.attemptForGrading(attemptId),
    enabled: !!attemptId,
  });
}

// ── mutations ──
export function useCreateApAssessment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: ApAssessmentInput & { title: string }) => assessmentPlatformApi.create(payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ap-assessments"] });
      toast.success("Assessment created.");
    },
    onError: (err) => toast.error(apErr(err, "Failed to create assessment")),
  });
}

export function useUpdateApAssessment(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: ApAssessmentInput) => assessmentPlatformApi.update(id, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ap-assessments"] });
      toast.success("Saved.");
    },
    onError: (err) => toast.error(apErr(err, "Failed to save")),
  });
}

export function useImportApAssessment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (spec: Record<string, unknown>) => assessmentPlatformApi.importSpec(spec),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ap-assessments"] });
      toast.success("Assessment created from code.");
    },
    onError: (err) => toast.error(apErr(err, "Import failed")),
  });
}

export function useDeleteApAssessment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => assessmentPlatformApi.remove(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ap-assessments"] });
      toast.success("Assessment archived.");
    },
    onError: (err) => toast.error(apErr(err, "Failed to archive")),
  });
}

export function useCloneApAssessment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => assessmentPlatformApi.clone(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ap-assessments"] });
      toast.success("Assessment cloned to a new draft.");
    },
    onError: (err) => toast.error(apErr(err, "Failed to clone")),
  });
}

export function usePublishApAssessment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => assessmentPlatformApi.publish(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ap-assessments"] });
      toast.success("Assessment published.");
    },
    onError: (err) => toast.error(apErr(err, "Failed to publish")),
  });
}

export function useUnpublishApAssessment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => assessmentPlatformApi.unpublish(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ap-assessments"] });
      toast.success("Moved back to draft.");
    },
    onError: (err) => toast.error(apErr(err, "Failed to unpublish")),
  });
}

export function useAssignEmails(assessmentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ emails, expiresInDays }: { emails: string[]; expiresInDays?: number }) =>
      assessmentPlatformApi.assignEmails(assessmentId, emails, expiresInDays),
    onSuccess: () => qc.invalidateQueries({ queryKey: apKeys.assignments(assessmentId) }),
    onError: (err) => toast.error(apErr(err, "Failed to assign")),
  });
}

export function useAssignCsv(assessmentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => assessmentPlatformApi.assignCsv(assessmentId, file),
    onSuccess: () => qc.invalidateQueries({ queryKey: apKeys.assignments(assessmentId) }),
    onError: (err) => toast.error(apErr(err, "Failed to import CSV")),
  });
}

export function useResendInvite(assessmentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (assignmentId: string) => assessmentPlatformApi.resendInvite(assignmentId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: apKeys.assignments(assessmentId) });
      toast.success("Invite re-sent.");
    },
    onError: (err) => toast.error(apErr(err, "Failed to resend")),
  });
}

export function useRevokeAssignment(assessmentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (assignmentId: string) => assessmentPlatformApi.revokeAssignment(assignmentId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: apKeys.assignments(assessmentId) });
      toast.success("Assignment revoked.");
    },
    onError: (err) => toast.error(apErr(err, "Failed to revoke")),
  });
}

export function useUploadResults(assessmentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => assessmentPlatformApi.uploadResults(assessmentId, file),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ap-results", assessmentId] });
      qc.invalidateQueries({ queryKey: apKeys.assignments(assessmentId) });
    },
    onError: (err) => toast.error(apErr(err, "Failed to import results")),
  });
}

export function useReleaseResults(assessmentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => assessmentPlatformApi.releaseResults(assessmentId),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["ap-results", assessmentId] });
      qc.invalidateQueries({ queryKey: apKeys.assignments(assessmentId) });
      toast.success(`Released ${r.released} result(s).` + (r.skippedPending ? ` ${r.skippedPending} still pending grading.` : ""));
    },
    onError: (err) => toast.error(apErr(err, "Failed to release results")),
  });
}

export function useReleaseAttempt(assessmentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (attemptId: string) => assessmentPlatformApi.releaseAttempt(attemptId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ap-results", assessmentId] });
      toast.success("Result released.");
    },
    onError: (err) => toast.error(apErr(err, "Failed to release")),
  });
}

export function useBankCreate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: Record<string, unknown>) => assessmentPlatformApi.bankCreate(payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ap-question-bank"] });
      toast.success("Added to question bank.");
    },
    onError: (err) => toast.error(apErr(err, "Failed to save question")),
  });
}

export function useBankUpdate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Record<string, unknown> }) =>
      assessmentPlatformApi.bankUpdate(id, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ap-question-bank"] });
      toast.success("Question updated.");
    },
    onError: (err) => toast.error(apErr(err, "Failed to update question")),
  });
}

export function useBankArchive() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => assessmentPlatformApi.bankArchive(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ap-question-bank"] });
      toast.success("Question archived.");
    },
    onError: (err) => toast.error(apErr(err, "Failed to archive")),
  });
}

export function useGradeAnswer(attemptId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ questionId, marks, feedback }: { questionId: string; marks: number; feedback?: string }) =>
      assessmentPlatformApi.gradeAnswer(attemptId, questionId, { marks, feedback }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: apKeys.gradingAttempt(attemptId) });
    },
    onError: (err) => toast.error(apErr(err, "Failed to save grade")),
  });
}

export function useFinalizeGrading(attemptId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => assessmentPlatformApi.finalizeGrading(attemptId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: apKeys.gradingAttempt(attemptId) });
      qc.invalidateQueries({ queryKey: ["ap-grading-queue"] });
      toast.success("Grading finalized.");
    },
    onError: (err) => toast.error(apErr(err, "Failed to finalize")),
  });
}

import api from "./api-client";
import type {
  AuthProfile,
  CareerApplication,
} from "@/types";

const SCREENING_REQUEST_TIMEOUT_MS = 180_000;
const SELECTION_FORM_SUBMIT_TIMEOUT_MS = 240_000;
// Document upload + AI verification (Vertex OCR) can take far longer than the
// 12s axios default — especially large files on slow mobile links. Without this
// the browser aborts mid-request (ECONNABORTED) while the server still finishes
// and logs HTTP 200, surfacing as a phantom "error" and stalled submissions.
const DOCUMENT_REQUEST_TIMEOUT_MS = 120_000;

// ─── Auth ──────────────────────────────────────────────────────────────────

export const authApi = {
  login: async (email: string, password: string) => {
    const normalizedEmail = email.trim().toLowerCase();
    // _skipRetry prevents the interceptor from trying to refresh a token on a
    // 401 from /auth/login — invalid credentials are not a token-expiry issue.
    const { data } = await api.post(
      "/auth/login",
      { email: normalizedEmail, password },
      {
        _skipRetry: true,
      } as Record<string, unknown>,
    );
    return data; // { user, profile, accessToken }
  },
  requestPasswordReset: async (email: string) => {
    const { data } = await api.post("/auth/password-reset/request", {
      email: email.trim().toLowerCase(),
    });
    return data;
  },
  confirmPasswordReset: async (
    email: string,
    code: string,
    newPassword: string,
  ) => {
    const { data } = await api.post("/auth/password-reset/confirm", {
      email: email.trim().toLowerCase(),
      code,
      newPassword,
    });
    return data;
  },
  requestEmailVerification: async () => {
    const { data } = await api.post("/auth/email-verification/request");
    return data;
  },
  confirmEmailVerification: async (code: string) => {
    const { data } = await api.post("/auth/email-verification/confirm", {
      code,
    });
    return data;
  },
  // Public (unauthenticated) variants — used in post-registration OTP flow
  requestEmailVerificationPublic: async (email: string) => {
    const { data } = await api.post("/auth/email-verification/request-public", {
      email: email.trim().toLowerCase(),
    });
    return data; // { message, developmentCode, expiresAt }
  },
  confirmEmailVerificationPublic: async (email: string, code: string) => {
    const { data } = await api.post("/auth/email-verification/confirm-public", {
      email: email.trim().toLowerCase(),
      code,
    });
    return data; // { message, user, profile, accessToken }
  },
  logout: () => api.post("/auth/logout"),
  me: async () => {
    const { data } = await api.get("/auth/me");
    return data;
  },
  changePassword: async (oldPassword: string, newPassword: string) => {
    const { data } = await api.post("/auth/change-password", {
      oldPassword,
      newPassword,
    });
    return data;
  },
  requestChangePasswordOtp: async () => {
    const { data } = await api.post("/auth/change-password-otp/request");
    return data as {
      message: string;
      developmentCode?: string | null;
      expiresAt?: string | null;
    };
  },
  confirmChangePasswordOtp: async (code: string, newPassword: string) => {
    const { data } = await api.post("/auth/change-password-otp/confirm", {
      code,
      newPassword,
    });
    return data as {
      message: string;
      user?: unknown;
      profile?: AuthProfile | null;
      accessToken?: string;
    };
  },
  updateProfile: async (payload: { name?: string; phone?: string }) => {
    const { data } = await api.patch("/auth/me/profile", payload);
    return data;
  },
  switchRole: async (role: string) => {
    const { data } = await api.post("/auth/me/switch-role", { role });
    return data; // { user, profile }
  },
};

// ─── Candidates ────────────────────────────────────────────────────────────

export type CandidateFilters = {
  search?: string;
  sourceType?: string;
  stage?: string;
  positionId?: string;
  createdFrom?: string;
  createdTo?: string;
  blacklisted?: boolean;
  page?: number;
  limit?: number;
  sortBy?: string;
  sortDir?: "asc" | "desc";
};

export const candidatesApi = {
  extractAadhaar: async (payload: FormData) => {
    const { data } = await api.post("/candidates/aadhaar/ocr", payload, {
      headers: { "Content-Type": "multipart/form-data" },
      timeout: 60_000,
    });
    return data;
  },
  extractCheque: async (payload: FormData) => {
    const { data } = await api.post("/candidates/cheque/ocr", payload, {
      headers: { "Content-Type": "multipart/form-data" },
      timeout: 60_000,
    });
    return data;
  },
  extractPan: async (payload: FormData) => {
    const { data } = await api.post("/candidates/pan/ocr", payload, {
      headers: { "Content-Type": "multipart/form-data" },
      timeout: 60_000,
    });
    return data as {
      panNumber?: string | null;
      ocrStatus?: string;
      message?: string;
    };
  },
  extractAddress: async (payload: FormData) => {
    const { data } = await api.post("/candidates/address/ocr", payload, {
      headers: { "Content-Type": "multipart/form-data" },
      timeout: 60_000,
    });
    return data as {
      address?: string | null;
      addressLines?: string[];
      postalCode?: string | null;
      ocrStatus?: string;
      message?: string;
    };
  },
  register: async (payload: FormData) => {
    const { data } = await api.post("/candidates/register", payload, {
      headers: { "Content-Type": "multipart/form-data" },
      timeout: SCREENING_REQUEST_TIMEOUT_MS,
    });
    return data;
  },
  list: async (params: CandidateFilters = {}) => {
    const { data } = await api.get("/candidates", { params });
    return data; // { data, total, page, limit, totalPages }
  },
  exportCsv: async (params: CandidateFilters = {}) => {
    // Server-side CSV with signed, openable document links. Fetched with auth as
    // a blob so the browser can download it. Generous timeout: the export can be
    // slow on large datasets (the default 12s client timeout would abort it).
    const { data } = await api.get("/candidates/export", {
      params,
      responseType: "blob",
      timeout: 180_000,
    });
    return data as Blob;
  },
  get: async (id: string) => {
    const { data } = await api.get(`/candidates/${id}`);
    return data;
  },
  create: async (payload: Record<string, unknown>) => {
    const { data } = await api.post("/candidates", payload);
    return data;
  },
  update: async (id: string, payload: Record<string, unknown>) => {
    const { data } = await api.patch(`/candidates/${id}`, payload);
    return data;
  },
  backfillSignedEmployeeCodes: async () => {
    const { data } = await api.post("/candidates/employee-codes/backfill-signed");
    return data as { message: string };
  },
  remove: async (id: string) => {
    const { data } = await api.delete(`/candidates/${id}`);
    return data;
  },
  advanceStage: async (id: string, toStage: string, notes?: string) => {
    const { data } = await api.post(`/candidates/${id}/advance-stage`, {
      toStage,
      notes,
    });
    return data;
  },
  stats: async () => {
    const { data } = await api.get("/candidates/stats");
    return data;
  },
  me: async () => {
    const { data } = await api.get("/candidates/me");
    return data;
  },
  refreshMyCompliance: async () => {
    const { data } = await api.post("/candidates/me/compliance/refresh");
    return data;
  },
  apply: async (positionId: string) => {
    const { data } = await api.post("/candidates/me/apply", { positionId });
    return data;
  },
  updateMyProfile: async (payload: Record<string, unknown>) => {
    const { data } = await api.patch("/candidates/me/profile", payload);
    return data;
  },
  checkAadhaar: async (aadhaarNumber: string) => {
    const { data } = await api.post("/candidates/aadhaar/check", {
      aadhaarNumber,
    });
    return data as { exists: boolean; message: string };
  },
  uploadResume: async (candidateId: string, file: File) => {
    const form = new FormData();
    form.append("file", file);
    form.append("candidateId", candidateId);
    form.append("type", "resume");
    const { data } = await api.post("/documents/upload", form, {
      headers: { "Content-Type": "multipart/form-data" },
    });
    return data;
  },
  uploadAadhaarDoc: async (candidateId: string, file: File) => {
    const form = new FormData();
    form.append("file", file);
    form.append("candidateId", candidateId);
    form.append("type", "aadhaar");
    const { data } = await api.post("/documents/upload", form, {
      headers: { "Content-Type": "multipart/form-data" },
    });
    return data;
  },
  parseResume: async (payload: FormData) => {
    const { data } = await api.post("/candidates/resume/parse", payload, {
      headers: { "Content-Type": "multipart/form-data" },
    });
    return data as {
      resumeText: string;
      summary: string;
      keyPoints: string[];
      skills: string[];
    };
  },
  triggerScreening: async (candidateId: string) => {
    const { data } = await api.post(`/candidates/${candidateId}/screen`, null, {
      timeout: SCREENING_REQUEST_TIMEOUT_MS,
    });
    return data;
  },
  getResumeBlob: async (candidateId: string) => {
    const response = await api.get(
      `/candidates/${candidateId}/resume/download`,
      {
        responseType: "blob",
      },
    );
    return response.data as Blob;
  },
};

// ─── Reports ───────────────────────────────────────────────────────────────

export type PiSummaryReport = {
  totalRounds: number;
  scheduled: number;
  completed: number;
  selected: number;
  rejected: number;
  avgScore: number | null;
  byRound: Array<{ roundNumber: number; count: number }>;
};

export type ReportDateFilters = {
  createdFrom?: string;
  createdTo?: string;
};

export type DomainWiseReportRow = {
  department: string;
  positions: number;
  activePositions: number;
  openings: number;
  candidates: number;
  inPipeline: number;
  shortlisted: number;
  inEvaluation: number;
  joined: number;
  rejected: number;
  conversionRate: number;
};

export const reportsApi = {
  summary: async (params?: ReportDateFilters) => {
    const { data } = await api.get("/reports/summary", { params });
    return data;
  },
  funnel: async (params?: ReportDateFilters) => {
    const { data } = await api.get("/reports/funnel", { params });
    return data;
  },
  escalationMetrics: async () => {
    const { data } = await api.get("/reports/escalations");
    return data;
  },
  positions: async () => {
    const { data } = await api.get("/reports/positions");
    return data;
  },
  piSummary: async () => {
    const { data } = await api.get("/reports/pi-summary");
    return data as PiSummaryReport;
  },
  domains: async () => {
    const { data } = await api.get("/reports/domains");
    return data as DomainWiseReportRow[];
  },
};

// ─── Positions ─────────────────────────────────────────────────────────────

export const positionsApi = {
  publicList: async (
    params?: Record<string, string | boolean | number | undefined>,
  ) => {
    const { data } = await api.get("/public/positions", { params });
    return data;
  },
  publicGet: async (slug: string) => {
    const { data } = await api.get(`/public/positions/${slug}`);
    return data;
  },
  list: async () => {
    const { data } = await api.get("/positions");
    return data;
  },
  create: async (payload: Record<string, unknown>) => {
    const { data } = await api.post("/positions", payload);
    return data;
  },
  update: async (id: string, payload: Record<string, unknown>) => {
    const { data } = await api.patch(`/positions/${id}`, payload);
    return data;
  },
  delete: async (id: string) => {
    await api.delete(`/positions/${id}`);
  },
  toggleActive: async (id: string, isActive: boolean) => {
    const { data } = await api.patch(`/positions/${id}`, { isActive });
    return data;
  },
};

// ─── Vendors ───────────────────────────────────────────────────────────────

export const vendorsApi = {
  list: async () => {
    const { data } = await api.get("/vendors");
    return data;
  },
  create: async (payload: Record<string, unknown>) => {
    const { data } = await api.post("/vendors", payload);
    return data;
  },
  update: async (id: string, payload: Record<string, unknown>) => {
    const { data } = await api.patch(`/vendors/${id}`, payload);
    return data;
  },
  bulkUpload: async (file: File, positionId: string) => {
    const form = new FormData();
    form.append("file", file);
    form.append("positionId", positionId);
    const { data } = await api.post("/vendors/bulk-upload", form, {
      headers: { "Content-Type": "multipart/form-data" },
    });
    return data as {
      total: number;
      saved: number;
      failed: number;
      errors: string[];
    };
  },
};

// ─── Colleges ──────────────────────────────────────────────────────────────

export const collegesApi = {
  publicList: async () => {
    const { data } = await api.get("/public/colleges");
    return data;
  },
  list: async () => {
    const { data } = await api.get("/colleges");
    return data;
  },
  create: async (payload: Record<string, unknown>) => {
    const { data } = await api.post("/colleges", payload);
    return data;
  },
  update: async (id: string, payload: Record<string, unknown>) => {
    const { data } = await api.patch(`/colleges/${id}`, payload);
    return data;
  },
};

// ─── Users ─────────────────────────────────────────────────────────────────

export const usersApi = {
  list: async () => {
    const { data } = await api.get("/users");
    return data;
  },
  create: async (payload: Record<string, unknown>) => {
    const { data } = await api.post("/users", payload);
    return data;
  },
  update: async (id: string, payload: Record<string, unknown>) => {
    const { data } = await api.patch(`/users/${id}`, payload);
    return data;
  },
  resetPassword: async (id: string): Promise<{ message: string; email: string }> => {
    const { data } = await api.post(`/users/${id}/reset-password`);
    return data;
  },
};

// ─── Escalations ───────────────────────────────────────────────────────────

export const escalationsApi = {
  list: async (params?: { status?: string }) => {
    const { data } = await api.get("/escalations", { params });
    return data;
  },
  resolve: async (id: string, notes?: string) => {
    const { data } = await api.patch(`/escalations/${id}/resolve`, { notes });
    return data;
  },
  acknowledge: async (id: string) => {
    const { data } = await api.patch(`/escalations/${id}/acknowledge`);
    return data;
  },
};

// ─── Notifications ─────────────────────────────────────────────────────────

export type NotificationRecord = {
  id: string;
  userId: string;
  candidateId?: string | null;
  title: string;
  message: string;
  type: "info" | "warning" | "success" | "error" | "action";
  isRead: boolean;
  createdAt: string;
  candidateName?: string | null;
  route?: string | null;
};

export const notificationsApi = {
  list: async (): Promise<NotificationRecord[]> => {
    const { data } = await api.get("/notifications");
    return data;
  },
  markRead: async (id: string): Promise<NotificationRecord> => {
    const { data } = await api.patch(`/notifications/${id}/read`);
    return data;
  },
  markAllRead: async () => {
    const { data } = await api.patch("/notifications/read-all");
    return data;
  },
  remove: async (id: string) => {
    await api.delete(`/notifications/${id}`);
  },
  clearAll: async () => {
    await api.delete("/notifications");
  },
};

// ─── Documents ─────────────────────────────────────────────────────────────

export const documentsApi = {
  list: async (candidateId: string) => {
    const { data } = await api.get(`/documents`, { params: { candidateId } });
    return data;
  },
  listAll: async (params?: {
    search?: string;
    status?: string;
    page?: number;
    limit?: number;
  }) => {
    const { data } = await api.get(`/documents/all`, { params });
    return data;
  },
  upload: async (candidateId: string, file: File, type: string) => {
    const form = new FormData();
    form.append("file", file);
    form.append("candidateId", candidateId);
    form.append("type", type);
    const { data } = await api.post("/documents/upload", form, {
      headers: { "Content-Type": "multipart/form-data" },
      timeout: DOCUMENT_REQUEST_TIMEOUT_MS,
    });
    return data;
  },
  uploadGeneral: async (file: File, type: string, candidateId?: string) => {
    const form = new FormData();
    form.append("file", file);
    form.append("type", type);
    if (candidateId) form.append("candidateId", candidateId);
    const { data } = await api.post("/documents/upload", form, {
      headers: { "Content-Type": "multipart/form-data" },
      timeout: DOCUMENT_REQUEST_TIMEOUT_MS,
    });
    return data;
  },
  getBlob: async (id: string) => {
    const response = await api.get(`/documents/${id}/download`, {
      responseType: "blob",
    });
    return response.data as Blob;
  },
  verify: async (id: string, status: "verified" | "rejected") => {
    const { data } = await api.patch(`/documents/${id}/verify`, { status });
    return data;
  },
  download: async (id: string, fileName: string) => {
    const blob = await documentsApi.getBlob(id);
    downloadBlob(blob, fileName);
  },
};

export const downloadBlob = (blob: Blob, fileName: string) => {
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.setAttribute("download", fileName);
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
};

export const careerApplicationsApi = {
  submit: async (payload: FormData) => {
    const { data } = await api.post("/applications", payload, {
      headers: { "Content-Type": "multipart/form-data" },
    });
    return data as CareerApplication;
  },
  list: async (limit = 25, offset = 0) => {
    const { data } = await api.get("/applications", { params: { limit, offset } });
    return data as CareerApplication[];
  },
  exportCsv: async () => {
    const response = await api.get("/applications/export", {
      responseType: "blob",
      timeout: 180_000,
    });
    downloadBlob(response.data as Blob, `career_applications_${new Date().toISOString().slice(0, 10)}.csv`);
  },
  getResumeBlob: async (id: string) => {
    const response = await api.get(`/applications/${id}/resume/download`, {
      responseType: "blob",
    });
    return response.data as Blob;
  },
  downloadResume: async (id: string, fileName: string) => {
    const blob = await careerApplicationsApi.getResumeBlob(id);
    downloadBlob(blob, fileName);
  },
};

const normalizeEmployeeApiPath = (path: string) =>
  path.startsWith("/api/v1") ? path.slice("/api/v1".length) || "/" : path;

export const screeningApi = {
  list: async (params?: {
    search?: string;
    recommendation?: string;
    page?: number;
    limit?: number;
  }) => {
    const { data } = await api.get("/screening", { params });
    return data as ScreeningListResponse;
  },
  get: async (candidateId: string) => {
    const { data } = await api.get(`/screening/${candidateId}`);
    return data as ScreeningRecord;
  },
  run: async (candidateId: string, payload?: { jobDescription?: string }) => {
    const { data } = await api.post(
      `/screening/${candidateId}/run`,
      payload ?? {},
      {
        timeout: SCREENING_REQUEST_TIMEOUT_MS,
      },
    );
    return data as ScreeningRecord;
  },
  override: async (
    candidateId: string,
    payload: { recommendation: string; reason: string },
  ) => {
    const { data } = await api.post(
      `/screening/${candidateId}/override`,
      payload,
    );
    return data as ScreeningRecord;
  },
};

// ─── Admin Settings ─────────────────────────────────────────────────────────

export type AdminSetting = {
  id: string;
  namespace: string;
  key: string;
  value: string | number | boolean | null;
  description?: string | null;
};

export const adminSettingsApi = {
  list: async (namespace?: string) => {
    const { data } = await api.get("/settings", {
      params: namespace ? { namespace } : undefined,
    });
    return data as AdminSetting[];
  },
  upsert: async (payload: {
    key: string;
    value: string | number | boolean | null;
    namespace?: string;
    description?: string;
  }) => {
    const { data } = await api.put("/settings", {
      namespace: "system",
      ...payload,
    });
    return data as AdminSetting;
  },
};

// ─── Search ────────────────────────────────────────────────────────────────

export const searchApi = {
  search: async (query: string, limit = 10) => {
    const { data } = await api.get("/search", { params: { q: query, limit } });
    return data as {
      candidates: {
        id: string;
        fullName: string;
        candidateCode: string;
        position?: { title?: string };
        currentStage: string;
      }[];
      documents: {
        id: string;
        type: string;
        candidateId: string;
        candidateName?: string;
      }[];
    };
  },
};

// ─── IT Requests ───────────────────────────────────────────────────────────

export const itRequestsApi = {
  list: async (params?: { status?: string }) => {
    const { data } = await api.get("/it-requests", { params });
    return data;
  },
  complete: async (id: string, createdEmail: string) => {
    const { data } = await api.patch(`/it-requests/${id}/complete`, {
      createdEmail,
    });
    return data;
  },
};

// ─── Audit Logs ────────────────────────────────────────────────────────────

export const auditLogsApi = {
  list: async (params?: {
    entityType?: string;
    page?: number;
    limit?: number;
  }) => {
    const { data } = await api.get("/audit-logs", { params });
    return data;
  },
};

// ─── System Logs ──────────────────────────────────────────────────────────

export type LogStreamSummary = {
  key: string;
  label: string;
  group: string;
  lines: number;
  bytes?: number | null;
  files: number;
  lastModified?: string | null;
};

export type LogsSummaryResponse = {
  streams: LogStreamSummary[];
  totals: {
    streams: number;
    events: number;
    bytes: number;
    files: number;
  };
};

export type LogEntry = {
  id: string;
  timestamp?: string | null;
  level?: string | null;
  event?: string | null;
  message: string;
  raw: string;
  source: string;
  fields?: Record<string, unknown>;
  costUsd?: number | null;
  structured?: {
    title?: string | null;
    description?: string | null;
    status?: "success" | "error" | "info" | string | null;
    costUsd?: number | null;
    provider?: string | null;
    model?: string | null;
    operation?: string | null;
    promptTokens?: number | null;
    completionTokens?: number | null;
    totalTokens?: number | null;
    errorDetail?: string | null;
    httpStatus?: number | null;
    recipient?: string | null;
    subject?: string | null;
    backend?: string | null;
    email?: string | null;
    role?: string | null;
    ipAddress?: string | null;
    clientLabel?: string | null;
    isTestClient?: boolean | null;
  };
};

export type LogInsightCard = {
  label: string;
  value: number | string | null;
  format?: "currency" | "duration" | "bytes" | string;
  detail?: string | null;
  tone?: string | null;
};

export type LogInsightBreakdown = {
  label: string;
  items: { label: string; value: number }[];
};

export type LogTimelinePoint = {
  time: string;
  label: string;
  events: number;
  errors: number;
  costUsd?: number | null;
};

export type LogStreamInsights = {
  cards: LogInsightCard[];
  breakdown: LogInsightBreakdown[];
  timeline: LogTimelinePoint[];
  cost?: {
    estimatedUsd: number;
    currency: string;
    note?: string | null;
  };
  searchableFields: string[];
};

export type LogStreamResponse = {
  stream: string;
  label: string;
  group: string;
  data: LogEntry[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  files: string[];
  bytes?: number | null;
  lastModified?: string | null;
  insights?: LogStreamInsights | null;
};

export type SystemStatusResponse = {
  generatedAt: string;
  performance: {
    cpu: {
      percent: number | null;
      source?: "sample" | "load" | null;
      cores: number | null;
      load1: number | null;
      load5: number | null;
      load15: number | null;
    };
    memory: {
      totalBytes: number;
      usedBytes: number;
      availableBytes: number;
      percent: number | null;
    } | null;
    disk: {
      totalBytes: number;
      usedBytes: number;
      freeBytes: number;
      percent: number | null;
    } | null;
    uptimeSeconds: number | null;
    processRssBytes: number | null;
  };
  services: {
    database: { ok: boolean; latencyMs: number | null };
    redis: { ok: boolean };
  };
  activeUsers: {
    liveSessions: number;
    activeLast15m: number;
    activeLast24h: number;
    recent: {
      name: string;
      email: string;
      role: string;
      lastLoginAt: string | null;
      hasSession: boolean;
    }[];
  };
  stats: {
    usersTotal: number;
    usersActive: number;
    byRole: { role: string; count: number }[];
    candidatesTotal: number;
    candidatesThisMonth: number;
    employeesTotal: number;
    itRequestsOpen: number;
    evaluationsPending: number;
    contractsSigned: number;
    auditEvents: number;
  };
  processes?: {
    topCpu: {
      pid: number;
      cpuPercent: number;
      memoryPercent: number;
      rssBytes: number;
      command: string;
      args: string;
    }[];
  };
  integrations?: {
    key: string;
    label: string;
    configured: boolean;
    ok: boolean | null;
    latencyMs?: number | null;
    detail?: string | null;
  }[];
};

export const logsApi = {
  summary: async () => {
    const { data } = await api.get("/logs/summary");
    return data as LogsSummaryResponse;
  },
  stream: async (
    stream: string,
    params?: { search?: string; page?: number; limit?: number },
  ) => {
    const { data } = await api.get(`/logs/${stream}`, { params });
    return data as LogStreamResponse;
  },
  systemStatus: async () => {
    const { data } = await api.get("/logs/system-status");
    return data as SystemStatusResponse;
  },
};

// ─── Evaluations ───────────────────────────────────────────────────────────

export const evaluationsApi = {
  list: async () => {
    const { data } = await api.get("/evaluations");
    return data;
  },
  submit: async (id: string, payload: Record<string, unknown>) => {
    const { data } = await api.patch(`/evaluations/${id}/submit`, payload);
    return data;
  },
  assign: async (payload: { candidateId: string; evaluatorId?: string }) => {
    const { data } = await api.post("/evaluations", payload);
    return data;
  },
  schedule: async (
    evaluationId: string,
    payload: {
      subject: string;
      scheduledAt: string;
      notes?: string;
      mode?: string;
      durationMinutes?: number;
      roundNumber?: number;
      evaluatorId?: string;
      panelLabel?: string;
      panelMembers?: string[];
    },
  ) => {
    const { data } = await api.patch(
      `/evaluations/${evaluationId}/schedule`,
      payload,
    );
    return data;
  },
  complete: async (
    evaluationId: string,
    payload: {
      decision:
        | "passed"
        | "failed"
        | "selected"
        | "rejected"
        | "proceed_to_next_round";
      notes?: string;
      piScore?: number;
      roundId?: string;
      roundNumber?: number;
      noFurtherPiRequired?: boolean;
      finalVerdict?: "selected" | "rejected" | null;
    },
  ) => {
    const { data } = await api.patch(
      `/evaluations/${evaluationId}/complete`,
      payload,
    );
    return data;
  },
  bypassPi: async (
    evaluationId: string,
    payload: {
      finalVerdict: "selected" | "rejected";
      notes?: string;
      piScore?: number;
    },
  ) => {
    const { data } = await api.patch(
      `/evaluations/${evaluationId}/pi-bypass`,
      payload,
    );
    return data;
  },
  bypassCandidatePi: async (
    candidateId: string,
    payload: {
      finalVerdict: "selected" | "rejected";
      notes?: string;
      piScore?: number;
    },
  ) => {
    const { data } = await api.patch(
      `/candidates/${candidateId}/pi-bypass`,
      payload,
    );
    return data;
  },
  updatePmsScore: async (evaluationId: string, pmsScore: number) => {
    const { data } = await api.patch(`/evaluations/${evaluationId}/pms-score`, {
      pmsScore,
    });
    return data;
  },
  forCandidate: async (candidateId: string) => {
    const { data } = await api.get("/evaluations");
    const all = Array.isArray(data) ? data : (data?.data ?? []);
    return all.filter(
      (e: { candidateId?: string }) => e.candidateId === candidateId,
    );
  },
};

export type PmsScores = {
  verbalClarity: number | null;
  conciseness: number | null;
  fluency: number | null;
  vocabulary: number | null;
  pronunciation: number | null;
  nonverbalConfidence: number | null;
  introBackground: number | null;
  etharaAwareness: number | null;
  currentAffairs: number | null;
  instagramFamiliarity: number | null;
  promptEngineering: number | null;
  videoEditing: number | null;
};

export type PmsOverallRating =
  | "unsatisfactory"
  | "needs_improvement"
  | "average"
  | "meets_expectations"
  | "exceeds_expectations";

export type PmsEvaluationRecord = {
  id: string;
  candidateId: string | null;
  employeeId: string | null;
  evaluatorId: string;
  candidateName: string | null;
  candidateCode: string | null;
  employeeName: string | null;
  etharaId: string | null;
  positionTitle: string | null;
  evaluatorName: string | null;
  scores: PmsScores;
  metricRemarks: Record<string, string>;
  totalScore: number | null;
  averageScore: number | null;
  overallRating: PmsOverallRating | "above_expectation" | null;
  remarks: string | null;
  submittedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

export type PmsEmployeePerformanceReport = {
  employee: {
    id: string;
    name: string;
    employeeCode: string | null;
    etharaEmail: string | null;
    personalEmail: string | null;
    department: string | null;
    designation: string | null;
  };
  pmsRecords: PmsEvaluationRecord[];
  candidateRecords: {
    candidateId: string;
    candidateCode: string;
    fullName: string;
    personalEmail: string | null;
    etharaEmail: string | null;
    positionTitle: string | null;
    currentStage: string;
    assessments: {
      id: string;
      level: number;
      status: string;
      autoScore: number | null;
      evaluatorScore: number | null;
      totalScore: number | null;
      decision: string | null;
      feedback: string | null;
      submittedAt: string | null;
      evaluatedAt: string | null;
      evaluatorName: string | null;
    }[];
    evaluations: {
      id: string;
      totalScore: number | null;
      recommendation: string | null;
      notes: string | null;
      technicalSkills: number | null;
      communication: number | null;
      problemSolving: number | null;
      culturalFit: number | null;
      attitude: number | null;
      piScore: number | null;
      completedAt: string | null;
      interviewStatus: string | null;
      interviewNotes: string | null;
      evaluatorName: string | null;
    }[];
  }[];
};

type PmsTargetPayload = {
  candidateId?: string;
  employeeId?: string;
  scores: Partial<PmsScores>;
  metricRemarks?: Record<string, string>;
  overallRating?: string | null;
  remarks?: string | null;
};

export type PmsMeetingRecord = {
  id: string;
  employeeId: string;
  employeeName: string | null;
  employeeEmail: string | null;
  organizerId: string;
  organizerName: string | null;
  organizerEmail: string | null;
  title: string;
  mode: "online" | "offline";
  scheduledAt: string | null;
  durationMinutes: number;
  location: string | null;
  attendees: string[];
  inviteEmployee: boolean;
  notes: string | null;
  status: string;
  createdAt: string | null;
  notifiedEmails?: string[];
};

export type PmsMeetingPayload = {
  employeeId: string;
  title: string;
  mode: "online" | "offline";
  scheduledAt?: string | null;
  durationMinutes?: number;
  location?: string | null;
  attendees?: string[];
  inviteEmployee?: boolean;
  notes?: string | null;
};

export const pmsApi = {
  list: async (params?: { candidateId?: string; employeeId?: string }) => {
    const { data } = await api.get("/pms-evaluations", { params });
    return data as PmsEvaluationRecord[];
  },
  get: async (id: string) => {
    const { data } = await api.get(`/pms-evaluations/${id}`);
    return data as PmsEvaluationRecord;
  },
  create: async (payload: PmsTargetPayload) => {
    const { data } = await api.post("/pms-evaluations", payload);
    return data as PmsEvaluationRecord;
  },
  update: async (id: string, payload: PmsTargetPayload) => {
    const { data } = await api.patch(`/pms-evaluations/${id}`, payload);
    return data as PmsEvaluationRecord;
  },
  forCandidate: async (candidateId: string) => {
    const { data } = await api.get("/pms-evaluations", {
      params: { candidateId },
    });
    return data as PmsEvaluationRecord[];
  },
  forEmployee: async (employeeId: string) => {
    const { data } = await api.get("/pms-evaluations", {
      params: { employeeId },
    });
    return data as PmsEvaluationRecord[];
  },
  employeeReport: async (employeeId: string) => {
    const { data } = await api.get(
      `/pms-evaluations/employee-report/${employeeId}`,
    );
    return data as PmsEmployeePerformanceReport;
  },
  listMeetings: async (employeeId: string) => {
    const { data } = await api.get("/pms-evaluations/meetings", {
      params: { employeeId },
    });
    return data as PmsMeetingRecord[];
  },
  createMeeting: async (payload: PmsMeetingPayload) => {
    const { data } = await api.post("/pms-evaluations/meetings", payload);
    return data as PmsMeetingRecord;
  },
  deleteMeeting: async (id: string) => {
    await api.delete(`/pms-evaluations/meetings/${id}`);
  },
};

// ─── Role → module access ────────────────────────────────────────────────────
export type ModuleDef = { key: string; label: string; segments: string[] };

export const roleModulesApi = {
  myModules: async () => {
    const { data } = await api.get("/role-modules/me");
    return data as { enabled: string[] };
  },
  matrix: async () => {
    const { data } = await api.get("/role-modules");
    return data as { modules: ModuleDef[]; roles: Record<string, string[]> };
  },
  setRole: async (role: string, modules: string[]) => {
    const { data } = await api.put(`/role-modules/${role}`, { modules });
    return data as { role: string; enabled: string[] };
  },
  userModules: async (userId: string) => {
    const { data } = await api.get(`/role-modules/users/${userId}`);
    return data as {
      userId: string;
      name: string;
      role: string;
      hasOverride: boolean;
      roleDefault: string[];
      enabled: string[];
    };
  },
  setUser: async (userId: string, modules: string[]) => {
    const { data } = await api.put(`/role-modules/users/${userId}`, {
      modules,
    });
    return data as { userId: string; enabled: string[] };
  },
  clearUser: async (userId: string) => {
    const { data } = await api.delete(`/role-modules/users/${userId}`);
    return data as { userId: string; cleared: boolean };
  },
};

export type CandidateIdCardFormRecord = {
  id?: string | null;
  candidateId: string;
  name?: string | null;
  employeeId?: string | null;
  bloodGroup?: string | null;
  emergencyNo?: string | null;
  submittedAt?: string | null;
  submittedBy?: string | null;
  itCompletedAt?: string | null;
  itCompletedBy?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};

export type CandidateIdCardQueueItem = CandidateIdCardFormRecord & {
  candidateName: string;
  personalEmail?: string | null;
  etharaEmail?: string | null;
  currentStage?: string | null;
  currentStatus?: string | null;
  designation?: string | null;
  photoUrl?: string | null;
  status: string;
  canMarkDone: boolean;
};

export const candidateIdCardApi = {
  listQueue: async () => {
    const { data } = await api.get("/id-card-forms");
    return data as CandidateIdCardQueueItem[];
  },
  get: async (candidateId: string) => {
    const { data } = await api.get(`/id-card-forms/${candidateId}`);
    return data as CandidateIdCardFormRecord;
  },
  getMine: async () => {
    const { data } = await api.get("/candidates/me/id-card-form");
    return data as CandidateIdCardFormRecord;
  },
  submit: async (
    candidateId: string,
    payload: {
      name: string;
      employeeId: string;
      bloodGroup: string;
      emergencyNo: string;
    },
  ) => {
    const { data } = await api.post(`/id-card-forms/${candidateId}`, payload);
    return data as CandidateIdCardFormRecord;
  },
  submitMine: async (payload: {
    name: string;
    employeeId: string;
    bloodGroup: string;
    emergencyNo: string;
  }) => {
    const { data } = await api.post("/candidates/me/id-card-form", payload);
    return data as CandidateIdCardFormRecord;
  },
  markDone: async (candidateIds: string[]) => {
    const { data } = await api.post("/id-card-forms/mark-done", {
      candidateIds,
    });
    return data as {
      updatedCount: number;
      updatedCandidateIds: string[];
    };
  },
  downloadStatusTemplate: async (): Promise<void> => {
    const { data } = await api.get("/id-card-forms/status-template", {
      responseType: "blob",
    });
    downloadBlob(data as Blob, "id_card_status_template.csv");
  },
  uploadStatusSheet: async (file: File) => {
    const form = new FormData();
    form.append("file", file);
    const { data } = await api.post("/id-card-forms/status/upload", form, {
      headers: { "Content-Type": "multipart/form-data" },
      timeout: 120_000,
    });
    return data as {
      markedDone: number;
      markedPending: number;
      notFound: string[];
      skipped: { email: string; reason: string }[];
    };
  },
};

// ─── Selection Forms ────────────────────────────────────────────────────────

export type CandidateSelectionFormRecord = {
  id?: string | null;
  candidateId: string;
  sentAt?: string | null;
  submittedAt?: string | null;
  validatedAt?: string | null;
  verificationStatus?: string | null;
  verificationMessage?: string | null;
  verificationTaskId?: string | null;
  verificationQueuedAt?: string | null;
  verificationStartedAt?: string | null;
  verificationCompletedAt?: string | null;
  verificationRequiredDocuments?: number;
  verificationSubmittedDocuments?: number;
  verificationMissingDocuments?: number;
  formData?: Record<string, unknown> | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};

export const selectionFormsApi = {
  get: async (candidateId: string) => {
    const { data } = await api.get(`/selection-forms/${candidateId}`);
    return data as CandidateSelectionFormRecord;
  },
  submit: async (candidateId: string, formData: Record<string, unknown>) => {
    const { data } = await api.post(
      `/selection-forms/${candidateId}/submit`,
      { formData },
      { timeout: SELECTION_FORM_SUBMIT_TIMEOUT_MS },
    );
    return data as CandidateSelectionFormRecord;
  },
  validate: async (candidateId: string) => {
    const { data } = await api.patch(
      `/selection-forms/${candidateId}/validate`,
    );
    return data as CandidateSelectionFormRecord;
  },
  reopen: async (candidateId: string) => {
    const { data } = await api.patch(`/selection-forms/${candidateId}/reopen`);
    return data as CandidateSelectionFormRecord;
  },
  getDocumentBlob: async (
    candidateId: string,
    documentKey: string,
    action: "preview" | "download" = "download",
  ) => {
    const response = await api.get(
      `/selection-forms/${candidateId}/documents/${encodeURIComponent(documentKey)}/${action}`,
      { responseType: "blob" },
    );
    return response.data as Blob;
  },
  downloadDocument: async (
    candidateId: string,
    documentKey: string,
    fileName: string,
  ) => {
    const blob = await selectionFormsApi.getDocumentBlob(candidateId, documentKey, "download");
    downloadBlob(blob, fileName);
  },
  uploadDocument: async (
    candidateId: string,
    documentKey: string,
    file: File,
  ) => {
    const form = new FormData();
    form.append("file", file);
    const { data } = await api.post(
      `/selection-forms/${candidateId}/documents/${encodeURIComponent(documentKey)}/upload`,
      form,
      { headers: { "Content-Type": "multipart/form-data" }, timeout: DOCUMENT_REQUEST_TIMEOUT_MS },
    );
    return data as CandidateSelectionFormRecord;
  },
  verifyDocument: async (
    candidateId: string,
    documentKey: string,
    file: File,
  ) => {
    const form = new FormData();
    form.append("file", file);
    const { data } = await api.post(
      `/selection-forms/${candidateId}/documents/${encodeURIComponent(documentKey)}/verify`,
      form,
      { headers: { "Content-Type": "multipart/form-data" }, timeout: DOCUMENT_REQUEST_TIMEOUT_MS },
    );
    return data as {
      detectedDocumentType: string | null;
      matchesExpectedCategory: boolean | null;
      ocrStatus: string;
      message: string;
    };
  },
  verifyAttachedDocument: async (
    candidateId: string,
    documentKey: string,
  ) => {
    const { data } = await api.post(
      `/selection-forms/${candidateId}/documents/${encodeURIComponent(documentKey)}/verify`,
      undefined,
      { timeout: DOCUMENT_REQUEST_TIMEOUT_MS },
    );
    return data as {
      result: {
        detectedDocumentType: string | null;
        matchesExpectedCategory: boolean | null;
        ocrStatus: string;
        message: string;
      };
      form: CandidateSelectionFormRecord;
    };
  },
};

// ─── Contracts ──────────────────────────────────────────────────────────────

export const contractsApi = {
  get: async (candidateId: string) => {
    const { data } = await api.get(`/contracts/${candidateId}`);
    return data;
  },
  update: async (candidateId: string, payload: Record<string, unknown>) => {
    const { data } = await api.patch(`/contracts/${candidateId}`, payload);
    return data;
  },
};

// ─── Compliance ─────────────────────────────────────────────────────────────

export const complianceApi = {
  list: async (candidateId: string) => {
    const { data } = await api.get(`/compliance`, { params: { candidateId } });
    return data;
  },
  submit: async (formId: string, formData: Record<string, unknown>) => {
    const { data } = await api.post(`/compliance/${formId}/submit`, {
      formData,
    });
    return data;
  },
  verify: async (formId: string) => {
    const { data } = await api.patch(`/compliance/${formId}/verify`);
    return data;
  },
  // Pull a candidate's Documenso compliance forms' signing status on demand.
  syncCandidate: async (candidateId: string) => {
    const { data } = await api.post(`/compliance/sync/${candidateId}`);
    return data;
  },
  sendCandidateEsign: async (candidateId: string) => {
    const { data } = await api.post(`/compliance/send-esign/${candidateId}`);
    return data;
  },
  resendCandidateForm: async (formId: string) => {
    const { data } = await api.post(`/compliance/${formId}/resend-esign`);
    return data;
  },
  // Cancel a form (removes it if it's a duplicate); returns the candidate's remaining forms.
  cancelForm: async (formId: string) => {
    const { data } = await api.post(`/compliance/${formId}/cancel`);
    return data;
  },
  // Email the candidate the existing signing link (no new Documenso doc).
  remindForm: async (formId: string) => {
    const { data } = await api.post(`/compliance/${formId}/remind`);
    return data;
  },
  getSignedFormBlob: async (
    formId: string,
    action: "preview" | "download" = "preview",
  ) => {
    const response = await api.get(`/compliance/${formId}/${action}`, {
      responseType: "blob",
    });
    return response.data as Blob;
  },
  downloadSignedForm: async (formId: string, fileName: string) => {
    const blob = await complianceApi.getSignedFormBlob(formId, "download");
    downloadBlob(blob, fileName);
  },
};

export type EmployeeReferenceOptions = {
  departments: string[];
  designations: string[];
  departmentAdmins?: Record<string, DepartmentAdminRef | DepartmentAdminRef[] | null>;
};

export type DepartmentAdminRef = {
  id: string;
  name?: string | null;
  email?: string | null;
  role?: string | null;
  department?: string | null;
  designation?: string | null;
};

export type EmployeeBulkUpdateResult = {
  total: number;
  updated: number;
  rejected: number;
  results: Array<{ row: number; identifier: string; status: string; reason: string | null }>;
};

export type EmployeePendingReminderResult = {
  message: string;
  sent: number;
  failed: number;
  skipped: number;
  pendingAccounts: number;
  pendingImports: number;
};

export type EmployeeIssueReminderIssue =
  | "selection_form_pending"
  | "aadhaar_not_submitted";

export type EmployeeExportParams = {
  search?: string;
  lifecycle?: "all" | "active" | "pending_activation" | "offboarded";
  department?: string;
  workMode?: string;
  issue?: "all" | "selection_form_pending" | "aadhaar_needs_review" | "aadhaar_not_submitted";
  joiningFrom?: string;
  joiningTo?: string;
  sortBy?: "joining_desc" | "joining_asc" | "created_desc" | "name_asc";
  employeeIds?: string;
};

export type EmployeeIssueReminderResult = {
  message: string;
  issue: EmployeeIssueReminderIssue;
  sent: number;
  failed: number;
  skipped: number;
  emailsSent?: number;
  results: Array<{
    employeeId: string;
    status: "sent" | "skipped" | "failed";
    reason?: string | null;
  }>;
};

export const employeesApi = {
  bulkUpdate: async (file: File) => {
    const form = new FormData();
    form.append("file", file);
    const { data } = await api.post("/employees/bulk-update", form, {
      headers: { "Content-Type": "multipart/form-data" },
    });
    return data as EmployeeBulkUpdateResult;
  },
  downloadBulkUpdateTemplate: async () => {
    const { data } = await api.get("/employees/bulk-update/template", { responseType: "blob" });
    downloadBlob(data as Blob, "employee_update_template.csv");
  },
  referenceOptions: async () => {
    const { data } = await api.get("/employees/reference-options", {
      params: { _: Date.now() },
    });
    return data as EmployeeReferenceOptions;
  },
  referenceOptionsAdmin: async () => {
    const { data } = await api.get("/employees/reference-options/admin", {
      params: { _: Date.now() },
    });
    return data as EmployeeReferenceOptions;
  },
  updateReferenceOptions: async (
    payload: Partial<Omit<EmployeeReferenceOptions, "departmentAdmins">> & {
      departmentAdmins?: Record<string, string | string[] | null>;
    },
  ) => {
    const { data } = await api.put("/employees/reference-options", payload);
    return data as EmployeeReferenceOptions;
  },
  register: async (payload: FormData) => {
    const { data } = await api.post("/employees/register", payload, {
      headers: { "Content-Type": "multipart/form-data" },
    });
    return data as {
      requiresVerification?: boolean;
      email?: string;
      message?: string;
    };
  },
  bulkRegister: async (csvFile: File) => {
    const payload = new FormData();
    payload.append("csvFile", csvFile);
    const { data } = await api.post("/employees/bulk-register", payload, {
      headers: { "Content-Type": "multipart/form-data" },
      // Bulk register creates accounts + backfills docs synchronously and can take well over
      // the default 12s client timeout for large files. Aborting early made the UI report
      // "failed" while the server kept committing rows (they appeared minutes later).
      timeout: 180_000,
    });
    return data as {
      total: number;
      created: number;
      failed: number;
      results: { name: string; email: string; employeeCode: string }[];
      errors: {
        row: number;
        name: string;
        email: string;
        employeeCode: string;
        errors: string[];
      }[];
    };
  },
  verifyEmail: async (payload: { email: string; code: string }) => {
    const { data } = await api.post("/employees/verify-email", payload);
    return data as { message: string };
  },
  resendVerification: async (payload: { email: string }) => {
    const { data } = await api.post("/employees/resend-verification", payload);
    return data as { message: string };
  },
  sendPendingActivationReminders: async () => {
    const { data } = await api.post("/employees/pending-activation/reminders");
    return data as EmployeePendingReminderResult;
  },
  sendIssueReminders: async (payload: {
    employeeIds: string[];
    issue: EmployeeIssueReminderIssue;
    message?: string;
  }) => {
    const { data } = await api.post("/employees/issue-reminders", payload);
    return data as EmployeeIssueReminderResult;
  },
  list: async (params?: { search?: string; limit?: number }) => {
    const { data } = await api.get("/employees/list", { params });
    return data as EmployeeRecord[];
  },
  exportCsv: async (params?: EmployeeExportParams) => {
    // Server-side CSV with every employee field + signed, openable document links.
    // Generous timeout: the export includes related PMS/evaluation records and
    // signed document links, which can take longer than the default 12s timeout.
    const { data } = await api.get("/employees/export", {
      params,
      responseType: "blob",
      timeout: 180_000,
    });
    return data as Blob;
  },
  exportUsersCsv: async (params?: EmployeeExportParams) => {
    const { data } = await api.get("/employees/export/users", {
      params,
      responseType: "blob",
      timeout: 180_000,
    });
    return data as Blob;
  },
  exportStatusCsv: async (params?: EmployeeExportParams) => {
    const { data } = await api.get("/employees/export/status", {
      params,
      responseType: "blob",
      timeout: 180_000,
    });
    return data as Blob;
  },
  exportPackage: async (params?: EmployeeExportParams) => {
    const { data } = await api.get("/employees/export/package", {
      params,
      responseType: "blob",
      timeout: 300_000,
    });
    return data as Blob;
  },
  updateEditAccess: async (employeeId: string, enabled: boolean) => {
    const { data } = await api.patch(`/employees/${employeeId}/edit-access`, {
      enabled,
    });
    return data as { employeeId: string; editAccessEnabled: boolean };
  },
  // HR/admin-only: set Vendor / Work Mode / Date of Joining. Send only the fields you want to
  // change (PATCH semantics). dateOfJoining is an ISO date string (or "" to clear).
  updateHrFields: async (
    employeeId: string,
    fields: { vendor?: string; workMode?: string; employmentStatus?: string; dateOfJoining?: string },
  ) => {
    const { data } = await api.patch(`/employees/${employeeId}/hr-fields`, fields);
    return data as {
      employeeId: string;
      vendor?: string | null;
      workMode?: string | null;
      employmentStatus?: string | null;
      dateOfJoining?: string | null;
    };
  },
  bulkUpdateEditAccess: async (employeeIds: string[], enabled: boolean) => {
    const { data } = await api.post("/employees/edit-access/bulk", {
      employeeIds,
      enabled,
    });
    return data as { updated: number; missing: string[]; editAccessEnabled: boolean };
  },
  // Change an employee's GRP code. Propagates to the linked candidate + code-keyed modules.
  // On conflict the API responds 409 with { message, conflict } describing who holds the code.
  updateEmployeeCode: async (employeeId: string, employeeCode: string) => {
    const { data } = await api.patch(`/employees/${employeeId}/employee-code`, {
      employeeCode,
    });
    return data as {
      employeeId: string;
      employeeCode: string;
      changed: boolean;
      previousCode?: string | null;
      propagated?: Record<string, number>;
    };
  },
  listManagers: async (): Promise<ManagerUser[]> => {
    const { data } = await api.get("/employees/managers");
    return data;
  },
  assignManager: async (
    employeeId: string,
    managerId: string,
  ): Promise<{ message: string; managerId: string }> => {
    const { data } = await api.patch(
      `/manager/employee/${employeeId}/set-manager`,
      null,
      {
        params: { managerId },
      },
    );
    return data;
  },
  removeManager: async (employeeId: string): Promise<{ message: string }> => {
    const { data } = await api.patch(`/manager/employee/${employeeId}/update`, {
      manager_id: null,
    });
    return data;
  },
  get: async (employeeId: string) => {
    const { data } = await api.get(`/employees/${employeeId}`);
    return data as EmployeeDetailRecord;
  },
  getDashboard: async () => {
    const { data } = await api.get("/employees/me/dashboard");
    return data as EmployeeDashboardRecord;
  },
  getJourney: async () => {
    const { data } = await api.get("/employees/me/journey");
    return data as EmployeeJourneyStageRecord[];
  },
  getSelectionForm: async () => {
    const { data } = await api.get("/employees/me/selection-form");
    return data as EmployeeSelectionFormRecord;
  },
  updateMyProfile: async (payload: FormData) => {
    const { data } = await api.patch("/employees/me/profile", payload, {
      headers: { "Content-Type": "multipart/form-data" },
    });
    return data as AuthProfile & { type: "employee" };
  },
  submitSelectionForm: async (formData: Record<string, unknown>) => {
    const { data } = await api.post("/employees/me/selection-form", {
      formData,
    });
    return data as EmployeeSelectionFormRecord;
  },
  saveSelectionFormDraft: async (formData: Record<string, unknown>) => {
    const { data } = await api.post("/employees/me/selection-form/draft", {
      formData,
    });
    return data as EmployeeSelectionFormRecord;
  },
  listMyDocuments: async () => {
    const { data } = await api.get("/employees/me/documents");
    return data as EmployeeDocumentRecord[];
  },
  uploadMyDocument: async (type: string, file: File) => {
    const form = new FormData();
    form.append("type", type);
    form.append("file", file);
    const { data } = await api.post("/employees/me/documents/upload", form, {
      headers: { "Content-Type": "multipart/form-data" },
    });
    return data as EmployeeDocumentRecord;
  },
  verifyMyDocument: async (documentType: string, file: File) => {
    const form = new FormData();
    form.append("documentType", documentType);
    form.append("file", file);
    const { data } = await api.post("/employees/me/documents/verify", form, {
      headers: { "Content-Type": "multipart/form-data" },
    });
    return data as {
      detectedDocumentType: string | null;
      matchesExpectedCategory: boolean | null;
      ocrStatus: string;
      message: string;
    };
  },
  uploadDocument: async (employeeId: string, type: string, file: File) => {
    const form = new FormData();
    form.append("type", type);
    form.append("file", file);
    const { data } = await api.post(
      `/employees/${employeeId}/documents/upload`,
      form,
      {
        headers: { "Content-Type": "multipart/form-data" },
      },
    );
    return data as EmployeeDocumentRecord;
  },
  verifyAllDocuments: async (employeeId: string) => {
    const { data } = await api.post(`/employees/${employeeId}/documents/verify-all`);
    return data as {
      enabled: boolean;
      total: number;
      verified: number;
      needsReview: number;
      skipped: number;
      failed: number;
      message?: string;
      results: Array<{
        type: string;
        label: string;
        status: string;
        detected: string | null;
        message: string;
      }>;
    };
  },
  reviewDocument: async (
    employeeId: string,
    documentId: string,
    payload: { status: "validated" | "incorrect"; remarks?: string },
  ) => {
    const { data } = await api.patch(
      `/employees/${employeeId}/documents/${documentId}/review`,
      payload,
    );
    return data as EmployeeDocumentRecord;
  },
  getMyIdCardDetails: async () => {
    const { data } = await api.get("/employees/me/id-card-details");
    return data as EmployeeIdCardDetails;
  },
  saveMyIdCardDetails: async (payload: EmployeeIdCardDetailsInput) => {
    const { data } = await api.post("/employees/me/id-card-details", payload);
    return data as EmployeeIdCardDetails;
  },
  getIdCardDetails: async (employeeId: string) => {
    const { data } = await api.get(`/employees/${employeeId}/id-card-details`);
    return data as EmployeeIdCardDetails;
  },
  saveIdCardDetails: async (employeeId: string, payload: EmployeeIdCardDetailsInput) => {
    const { data } = await api.post(`/employees/${employeeId}/id-card-details`, payload);
    return data as EmployeeIdCardDetails;
  },
  deleteMyDocument: async (documentId: string) => {
    await api.delete(`/employees/me/documents/${documentId}`);
  },
  deleteDocument: async (employeeId: string, documentId: string) => {
    await api.delete(`/employees/${employeeId}/documents/${documentId}`);
  },
  getBlobFromEndpoint: async (endpoint: string) => {
    const response = await api.get(normalizeEmployeeApiPath(endpoint), {
      responseType: "blob",
    });
    return response.data as Blob;
  },
  downloadFromEndpoint: async (endpoint: string, fileName: string) => {
    const blob = await employeesApi.getBlobFromEndpoint(endpoint);
    downloadBlob(blob, fileName);
  },
  getDocumentBlob: async (
    employeeId: string,
    documentType: string,
    mode: "preview" | "download",
  ) => {
    const response = await api.get(
      `/employees/${employeeId}/documents/${documentType}/${mode}`,
      {
        responseType: "blob",
      },
    );
    return response.data as Blob;
  },
  downloadDocument: async (
    employeeId: string,
    documentType: string,
    fileName: string,
  ) => {
    const blob = await employeesApi.getDocumentBlob(
      employeeId,
      documentType,
      "download",
    );
    downloadBlob(blob, fileName);
  },
  listMyContracts: async () => {
    const { data } = await api.get("/employees/me/contracts");
    return data as EmployeeContractRecord[];
  },
  listMyCompliance: async () => {
    const { data } = await api.get("/employees/me/compliance");
    return data as EmployeeComplianceFormRecord[];
  },
  refreshMyComplianceEsign: async () => {
    const { data } = await api.post("/employees/me/compliance/refresh-esign");
    return data as EmployeeComplianceFormRecord[];
  },
  sendComplianceEsign: async (employeeId: string) => {
    const { data } = await api.post(
      `/employees/${employeeId}/compliance/send-esign`,
    );
    return data as EmployeeComplianceFormRecord[];
  },
  submitMyCompliance: async (
    formId: string,
    formData: Record<string, unknown>,
  ) => {
    const { data } = await api.post(
      `/employees/me/compliance/${formId}/submit`,
      { formData },
    );
    return data as EmployeeComplianceFormRecord;
  },
  listMyReferrals: async () => {
    const { data } = await api.get("/employees/me/referrals");
    return data as EmployeeReferralRecord[];
  },
  createReferral: async (payload: {
    fullName: string;
    personalEmail: string;
    phone: string;
    linkedinUrl: string;
    resume: File;
    portfolioUrl?: string | null;
    githubUrl?: string | null;
  }) => {
    const form = new FormData();
    form.append("fullName", payload.fullName);
    form.append("personalEmail", payload.personalEmail);
    form.append("phone", payload.phone);
    form.append("linkedinUrl", payload.linkedinUrl);
    form.append("resume", payload.resume);
    if (payload.portfolioUrl) form.append("portfolioUrl", payload.portfolioUrl);
    if (payload.githubUrl) form.append("githubUrl", payload.githubUrl);
    const { data } = await api.post("/employees/me/referrals", form, {
      headers: { "Content-Type": "multipart/form-data" },
    });
    return data as EmployeeReferralRecord;
  },
  listComplianceQueue: async () => {
    const { data } = await api.get("/employees/compliance/forms");
    return data as EmployeeComplianceQueueRecord[];
  },
  reviewCompliance: async (
    employeeId: string,
    formId: string,
    payload: { status: string; remarks?: string | null },
  ) => {
    const { data } = await api.patch(
      `/employees/${employeeId}/compliance/${formId}`,
      payload,
    );
    return data as EmployeeComplianceFormRecord;
  },
  extractAadhaar: async (payload: FormData) => {
    const { data } = await api.post("/employees/aadhaar/ocr", payload, {
      headers: { "Content-Type": "multipart/form-data" },
    });
    return data as {
      aadhaarNumber?: string | null;
      dateOfBirth?: string | null;
      cardHolderName?: string | null;
      ocrStatus?: string;
      message?: string;
    };
  },
  extractPan: async (payload: FormData) => {
    const { data } = await api.post("/employees/pan/ocr", payload, {
      headers: { "Content-Type": "multipart/form-data" },
      timeout: 60_000,
    });
    return data as {
      panNumber?: string | null;
      ocrStatus?: string;
      message?: string;
    };
  },
  extractCheque: async (payload: FormData) => {
    const { data } = await api.post("/employees/cheque/ocr", payload, {
      headers: { "Content-Type": "multipart/form-data" },
      timeout: 60_000,
    });
    return data as {
      accountNumber?: string | null;
      ifscCode?: string | null;
      accountHolderName?: string | null;
      bankName?: string | null;
      ocrStatus?: string;
      message?: string;
    };
  },
  extractAddress: async (payload: FormData) => {
    const { data } = await api.post("/employees/address/ocr", payload, {
      headers: { "Content-Type": "multipart/form-data" },
      timeout: 60_000,
    });
    return data as {
      address?: string | null;
      addressLines?: string[];
      postalCode?: string | null;
      ocrStatus?: string;
      message?: string;
    };
  },
};

export type EmployeeRecord = {
  id: string;
  accessLevel?: "full" | "preview" | "imported";
  stagingId?: string | null;
  canOpenDetail?: boolean;
  userId?: string | null;
  name: string;
  etharaEmail: string;
  personalEmail?: string;
  phone?: string;
  employeeCode?: string;
  department?: string;
  designation?: string;
  gender?: string;
  aadhaarLast4?: string;
  aadhaarPath?: string | null;
  aadhaarOcrStatus?: string;
  aadhaarValidationStatus?: string | null;
  aadhaarMismatchReason?: string | null;
  dateOfBirth?: string;
  resumePath?: string;
  isActive: boolean;
  editAccessEnabled?: boolean;
  selectionFormStatus?: string | null;
  selectionFormSubmittedAt?: string | null;
  createdAt: string;
  managerId?: string | null;
  managerName?: string | null;
  managerEmail?: string | null;
  bloodGroup?: string | null;
  emergencyContactName?: string | null;
  emergencyContactPhone?: string | null;
  emergencyContactRelation?: string | null;
  vendor?: string | null;
  employmentStatus?: string | null;
  workMode?: string | null;
  dateOfJoining?: string | null;
  registrationStatus?: string;
  candidateStage?: string | null;
  candidateStatus?: string | null;
};

export type ManagerUser = {
  id: string;
  name: string;
  email: string;
  role: string;
};

export type ScreeningDocumentRecord = {
  id: string;
  type: string;
  fileName: string;
  mimeType?: string | null;
  status: string;
  uploadedAt?: string | null;
};

export type ScreeningRecord = {
  candidateId: string;
  candidateCode: string;
  candidateName: string;
  personalEmail: string;
  phone?: string | null;
  positionId?: string | null;
  positionTitle?: string | null;
  currentStage: string;
  currentStatus: string;
  screeningStatus: string;
  llmStatus?: string | null;
  screeningScore?: number | null;
  matchScore?: number | null;
  recommendation?: string | null;
  screeningSummary?: string | null;
  parsedResumeDetails?: {
    summary?: string | null;
    keyPoints?: string[];
    resumeText?: string | null;
    skills?: string[];
    totalExperienceYears?: number | null;
    currentRole?: string | null;
    education?: string | null;
  } | null;
  screeningPayload?: Record<string, unknown> | null;
  manualOverride?: {
    recommendation: string;
    reason: string;
    performedBy?: string;
    performedByName?: string;
    performedAt?: string;
  } | null;
  resumeUploadedAt?: string | null;
  lastScreenedAt?: string | null;
  updatedAt?: string | null;
  createdAt?: string | null;
  resumeDocument?: ScreeningDocumentRecord | null;
};

export type ScreeningListResponse = {
  data: ScreeningRecord[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
};

export type EmployeeDocumentRecord = {
  id: string;
  type: string;
  label: string;
  fileName?: string | null;
  mimeType?: string | null;
  uploadedAt?: string | null;
  verificationStatus: string;
  remarks?: string | null;
  // AI document-type verification (Vertex AI). needsReview is true when the
  // uploaded file did not match its expected type; verification holds the verdict.
  ocrStatus?: string | null;
  needsReview?: boolean;
  verification?: {
    detected_document_type?: string;
    matches_expected_category?: boolean | null;
    confidence?: number;
    issues?: string[];
    validation_notes?: string;
  } | null;
  missing: boolean;
  canPreview: boolean;
  previewEndpoint?: string | null;
  downloadEndpoint?: string | null;
};

export type EmployeeIdCardDetailsInput = {
  bloodGroup?: string;
  emergencyContactName?: string;
  emergencyContactPhone?: string;
  emergencyContactRelation?: string;
  fatherName?: string;
  motherName?: string;
  maritalStatus?: string;
  currentAddress?: string;
  permanentAddress?: string;
};

export type EmployeeIdCardDetails = Required<EmployeeIdCardDetailsInput> & {
  name: string;
  employeeId: string;
  submittedAt?: string | null;
  submittedBy?: string | null;
  bloodGroupMissing: boolean;
  applicable: boolean;
  incomplete: boolean;
};

export type EmployeeSelectionFormRecord = {
  id?: string | null;
  status: string;
  formData?: Record<string, unknown> | null;
  editAccessEnabled?: boolean;
  submittedAt?: string | null;
  reviewedAt?: string | null;
  reviewedBy?: string | null;
  remarks?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};

export type EmployeeContractRecord = {
  id: string;
  title: string;
  status: string;
  fileName?: string | null;
  fileUrl?: string | null;
  mimeType?: string | null;
  issuedAt?: string | null;
  completedAt?: string | null;
  remarks?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  canPreview: boolean;
  previewEndpoint?: string | null;
  downloadEndpoint?: string | null;
};

export type EmployeeComplianceFormRecord = {
  id: string;
  formType: string;
  formTitle: string;
  status: string;
  formData?: Record<string, unknown> | null;
  submittedAt?: string | null;
  verifiedAt?: string | null;
  reviewedBy?: string | null;
  remarks?: string | null;
  documensoId?: string | null;
  signedUrl?: string | null;
  pdfUrl?: string | null;
  sentAt?: string | null;
  signedAt?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};

export type EmployeeReferralRecord = {
  candidateId: string;
  candidateName: string;
  positionTitle?: string | null;
  currentStage: string;
  currentStatus: string;
  createdAt: string;
};

export type EmployeeJourneyStageRecord = {
  key: string;
  title: string;
  status: string;
  description: string;
};

export type EmployeeTimelineRecord = {
  id: string;
  title: string;
  description?: string | null;
  status: string;
  occurredAt: string;
};

export type EmployeeAuditRecord = {
  id: string;
  entityType: string;
  entityId: string;
  action: string;
  performedBy: string;
  performedByName?: string | null;
  performedByRole?: string | null;
  candidateId?: string | null;
  userId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  oldValue?: Record<string, unknown> | null;
  newValue?: Record<string, unknown> | null;
  createdAt: string;
};

export type IdentityValidation = {
  status: "verified" | "mismatch" | "not_linked" | "insufficient";
  reason?: string | null;
  checks: { field: string; match: boolean; registration: string; onboarding: string }[];
  candidateId?: string | null;
};

export type EmployeeDetailRecord = EmployeeRecord & {
  fullName: string;
  linkedCandidateId?: string | null;
  linkedCandidateStage?: string | null;
  identityValidation?: IdentityValidation | null;
  aadhaarOcrMatch?: boolean | null;
  registrationStatus: string;
  currentEmployeeStatus: string;
  documentCompletionStatus: {
    completed: number;
    total: number;
    verifiedOrUploaded: number;
    missing: string[];
    percentage: number;
  };
  resumeDocument?: EmployeeDocumentRecord | null;
  documents: EmployeeDocumentRecord[];
  missingDocuments: string[];
  selectionForm: EmployeeSelectionFormRecord;
  contracts: EmployeeContractRecord[];
  complianceForms: EmployeeComplianceFormRecord[];
  referralActivity: EmployeeReferralRecord[];
  profileJourney: EmployeeJourneyStageRecord[];
  profileCompletionPercentage: number;
  nextRequiredAction?: string | null;
  auditLogs: EmployeeAuditRecord[];
  timeline: EmployeeTimelineRecord[];
  updatedAt?: string | null;
};

export type EmployeeDashboardRecord = {
  employee: {
    id?: string | null;
    userId?: string | null;
    fullName: string;
    etharaEmail: string;
    personalEmail?: string | null;
    employeeCode?: string | null;
    phone?: string | null;
    department?: string | null;
    designation?: string | null;
    gender?: string | null;
    dateOfJoining?: string | null;
    bloodGroup?: string | null;
    emergencyContactName?: string | null;
    emergencyContactPhone?: string | null;
    emergencyContactRelation?: string | null;
    managerId?: string | null;
    managerName?: string | null;
    managerEmail?: string | null;
    aadhaarLast4?: string | null;
    aadhaarOcrStatus?: string | null;
    aadhaarOcrMatch?: boolean | null;
    dateOfBirth?: string | null;
    isActive?: boolean;
    profilePhotoEndpoint?: string | null;
    createdAt?: string | null;
    updatedAt?: string | null;
  };
  selectionForm: EmployeeSelectionFormRecord;
  documents: EmployeeDocumentRecord[];
  documentCompletionStatus: {
    completed: number;
    total: number;
    verifiedOrUploaded: number;
    missing: string[];
    percentage: number;
  };
  missingDocuments: string[];
  contracts: EmployeeContractRecord[];
  complianceForms: EmployeeComplianceFormRecord[];
  referralActivity: EmployeeReferralRecord[];
  profileJourney: EmployeeJourneyStageRecord[];
  profileCompletionPercentage: number;
  nextRequiredAction?: string | null;
  idCardApplicable?: boolean;
  idCardIncomplete?: boolean;
};

export type EmployeeComplianceQueueRecord = EmployeeComplianceFormRecord & {
  employeeId: string;
  employeeName: string;
  employeeCode?: string | null;
  etharaEmail?: string | null;
};

export type DocumensoTemplate = {
  id: string;
  templateId: number;
  title: string;
  description?: string | null;
  fields?: unknown[];
  recipients?: unknown[];
  syncedAt: string;
};

export type DocumensoContract = {
  id: string;
  candidateId: string;
  status: string;
  documensoId?: string | null;
  templateId?: number | null;
  templateTitle?: string | null;
  signedUrl?: string | null;
  pdfUrl?: string | null;
  signedItems?: SignedContractItem[] | null;
  sentDocuments?: SentContractDocument[] | null;
  sentAt?: string | null;
  viewedAt?: string | null;
  signedAt?: string | null;
  expiresAt?: string | null;
  ctc?: number | null;
  joiningDate?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SentContractDocument = {
  documensoId?: string | null;
  documentId?: string | null;
  templateId?: number | null;
  templateTitle?: string | null;
  signingUrl?: string | null;
  status?: string | null;
  sentAt?: string | null;
  viewedAt?: string | null;
  signedAt?: string | null;
  cancelledAt?: string | null;
  expiredAt?: string | null;
  primary?: boolean | null;
};

export type SignedContractItem = {
  itemId?: string | null;
  title?: string | null;
  order?: number | null;
  type?: string | null;
  url?: string | null;
};

export type DocumensoContractField = {
  id: string;
  contractId: string;
  fieldName: string;
  fieldType: string;
  fieldValue?: string | null;
  recipientEmail?: string | null;
  createdAt: string;
};

export type DocumensoSyncState = {
  id: string;
  lastSyncedAt?: string | null;
  lastDocumentId?: number | null;
  syncStatus: string;
  errorMessage?: string | null;
  documentsProcessed: number;
  updatedAt: string;
};

export type DocumensoSyncLog = {
  id: string;
  logType: string;
  status: string;
  message: string;
  documentId?: number | null;
  candidateId?: string | null;
  extra?: Record<string, unknown> | null;
  createdAt: string;
};

export type SendContractPayload = {
  templateId?: number;
  // Multi-select: each template is issued as its own Documenso document in one go;
  // the first one is the primary contract tracked on the candidate's contract record.
  templateIds?: number[];
  ctc?: number;
  joiningDate?: string;
  extraFields?: Record<string, string>;
  sendImmediately?: boolean;
};

export type SyncLogsParams = {
  page?: number;
  limit?: number;
  logType?: string;
  status?: string;
  candidateId?: string;
};

export type SyncJobRun = {
  id: string;
  jobName: string;
  trigger: string;
  status: string;
  startedAt: string;
  finishedAt?: string | null;
  durationSeconds?: number | null;
  documentsProcessed: number;
  errors: number;
  message?: string | null;
};

export const documensoApi = {
  listTemplates: async (refresh = false): Promise<DocumensoTemplate[]> => {
    const { data } = await api.get("/documenso/templates", {
      params: refresh ? { refresh: true } : {},
    });
    return data;
  },

  refreshTemplates: async (): Promise<{ message: string }> => {
    const { data } = await api.post("/documenso/templates/refresh");
    return data;
  },

  sendContract: async (
    candidateId: string,
    payload: SendContractPayload,
  ): Promise<DocumensoContract> => {
    const { data } = await api.post(
      `/documenso/contracts/${candidateId}/send`,
      payload,
    );
    return data;
  },

  getContract: async (candidateId: string): Promise<DocumensoContract> => {
    const { data } = await api.get(`/documenso/contracts/${candidateId}`);
    return data;
  },

  cancelContract: async (
    candidateId: string,
    payload: { reason?: string | null; force?: boolean } = {},
  ): Promise<DocumensoContract> => {
    const { data } = await api.post(
      `/documenso/contracts/${candidateId}/cancel`,
      payload,
    );
    return data;
  },

  // On-demand: pull this candidate's contract status from Documenso right now.
  refreshContractStatus: async (
    candidateId: string,
  ): Promise<DocumensoContract> => {
    const { data } = await api.post(
      `/documenso/contracts/${candidateId}/refresh`,
    );
    return data;
  },

  // Send one contract template to many candidates at once.
  bulkSendContracts: async (payload: {
    candidateIds: string[];
    templateId?: number;
    templateIds?: number[];
    sendImmediately?: boolean;
  }): Promise<{
    sent: number;
    failed: number;
    results: { candidateId: string; status: string; error?: string }[];
  }> => {
    const { data } = await api.post(`/documenso/contracts/bulk-send`, payload);
    return data;
  },

  getContractFields: async (
    candidateId: string,
  ): Promise<DocumensoContractField[]> => {
    const { data } = await api.get(
      `/documenso/contracts/${candidateId}/fields`,
    );
    return data;
  },

  getSyncState: async (): Promise<DocumensoSyncState> => {
    const { data } = await api.get("/documenso/sync/state");
    return data;
  },

  triggerSync: async (): Promise<{ message: string }> => {
    const { data } = await api.post("/documenso/sync/trigger");
    return data;
  },

  triggerTemplateRefresh: async (): Promise<{ message: string }> => {
    const { data } = await api.post("/documenso/sync/templates");
    return data;
  },

  getSyncLogs: async (
    params: SyncLogsParams = {},
  ): Promise<{
    data: DocumensoSyncLog[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> => {
    const { data } = await api.get("/documenso/sync/logs", { params });
    return data;
  },

  getJobRuns: async (params?: {
    jobName?: string;
    limit?: number;
  }): Promise<SyncJobRun[]> => {
    const { data } = await api.get("/documenso/sync/job-runs", { params });
    return data;
  },

  getProfileJobRuns: async (limit = 50): Promise<SyncJobRun[]> => {
    const { data } = await api.get("/documenso/signed-profiles/job-runs", {
      params: { limit },
    });
    return data;
  },

  getHistoricalSyncState: async (): Promise<DocumensoSyncState> => {
    const { data } = await api.get("/documenso/sync/historical/state");
    return data;
  },

  triggerHistoricalSync: async (): Promise<{ message: string }> => {
    const { data } = await api.post("/documenso/sync/historical");
    return data;
  },

  resetHistoricalSync: async (): Promise<{ message: string }> => {
    const { data } = await api.post("/documenso/sync/historical/reset");
    return data;
  },
};

export type SignedProfile = {
  id: string;
  documensoDocId: number;
  templateId?: number | null;
  templateTitle?: string | null;
  recipientEmail: string;
  recipientName?: string | null;
  completedAt?: string | null;
  fieldValues?: Record<string, string | string[]> | null;
  pdfUrl?: string | null;
  candidateId?: string | null;
  candidate?: {
    id: string;
    candidateCode: string;
    fullName: string;
    personalEmail: string;
    etharaEmail?: string | null;
    phone: string;
    currentStage: string;
    currentStatus: string;
    position?: { title?: string } | null;
  } | null;
  syncedAt: string;
  createdAt: string;
};

export type ProfileSyncState = {
  id: string;
  syncStatus: string;
  lastSyncedAt?: string | null;
  lastDocumentId?: number | null;
  documentsProcessed: number;
  updatedAt: string;
};

export const signedProfilesApi = {
  list: async (
    params: {
      page?: number;
      limit?: number;
      q?: string;
      templateId?: number;
      // "contracts" (backend default) excludes statutory Form 11/2/F docs;
      // "compliance" returns only those forms.
      docClass?: "contracts" | "compliance" | "all";
    } = {},
  ): Promise<{
    data: SignedProfile[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> => {
    const { data } = await api.get("/documenso/signed-profiles", { params });
    return data;
  },

  exportCsvUrl: (params: { q?: string; templateId?: number } = {}): string => {
    const base = process.env.NEXT_PUBLIC_API_URL || "/api/v1";
    const qs = new URLSearchParams();
    if (params.q) qs.set("q", params.q);
    if (params.templateId) qs.set("templateId", String(params.templateId));
    return `${base}/documenso/signed-profiles/export${qs.toString() ? "?" + qs.toString() : ""}`;
  },

  exportCsv: async (params: { q?: string; templateId?: number } = {}) => {
    const response = await api.get("/documenso/signed-profiles/export", {
      params,
      responseType: "blob",
    });
    const disposition = String(response.headers["content-disposition"] || "");
    const filenameMatch = disposition.match(/filename=\"?([^"]+)\"?/i);
    return {
      blob: response.data as Blob,
      filename:
        filenameMatch?.[1] ||
        `signed_contracts_${new Date().toISOString().slice(0, 10)}.csv`,
    };
  },

  getSyncState: async (): Promise<ProfileSyncState> => {
    const { data } = await api.get("/documenso/signed-profiles/sync-state");
    return data;
  },

  getOpenUrl: async (profileId: string): Promise<{ url: string }> => {
    const { data } = await api.get(
      `/documenso/signed-profiles/${profileId}/open-url`,
    );
    return data;
  },

  triggerSync: async (): Promise<{ message: string }> => {
    const { data } = await api.post("/documenso/signed-profiles/sync");
    return data;
  },

  resetSync: async (): Promise<{ message: string }> => {
    const { data } = await api.post("/documenso/signed-profiles/sync/reset");
    return data;
  },

  syncAll: async (): Promise<{ message: string }> => {
    const { data } = await api.post(
      "/documenso/signed-profiles/sync/all",
      null,
      { timeout: 600000 },
    );
    return data;
  },

  enrichFields: async (): Promise<{ message: string }> => {
    const { data } = await api.post(
      "/documenso/signed-profiles/enrich-fields",
      null,
      { timeout: 300000 },
    );
    return data;
  },
};

export type AssessmentRecord = {
  id: string;
  candidateId: string;
  level: number;
  status: string;
  deployedUrl?: string | null;
  repoUrl?: string | null;
  readmePath?: string | null;
  explanationVideoPath?: string | null;
  communicationVideoPath?: string | null;
  promptResponse?: string | null;
  autoScore?: number | null;
  evaluatorScore?: number | null;
  totalScore?: number | null;
  feedback?: string | null;
  decision?: string | null;
  submittedAt?: string | null;
  evaluatedAt?: string | null;
  evaluatorId?: string | null;
  evaluatorName?: string | null;
  candidateCode?: string | null;
  positionTitle?: string | null;
  currentStage?: string | null;
  createdAt?: string | null;
};

export type PIInterviewRoundRecord = {
  id: string;
  evaluationId: string;
  candidateId?: string;
  evaluatorId?: string | null;
  roundNumber: number;
  panelLabel?: string | null;
  subject: string | null;
  scheduledAt: string | null;
  status: string | null;
  mode: string | null;
  durationMinutes?: number;
  score?: number | null;
  remarks?: string | null;
  notes?: string | null;
  roundDecision?: string | null;
  noFurtherPiRequired?: boolean;
  finalVerdict?: string | null;
  panelMembers?: string[];
  evaluatorName?: string | null;
  completedAt: string | null;
};

export type PIInterviewRecord = PIInterviewRoundRecord;

export type EvaluatorCandidateAssessmentSummary = {
  id: string;
  status: string;
  autoScore: number | null;
  evaluatorScore: number | null;
  totalScore: number | null;
  decision: string | null;
  feedback: string | null;
  submittedAt: string | null;
  evaluatedAt: string | null;
  evaluatorName: string | null;
};

export type EvaluatorCandidatePIRecord = PIInterviewRoundRecord;

export type EvaluatorCandidateEvalRecord = {
  id: string;
  totalScore: number | null;
  recommendation: string | null;
  notes: string | null;
  pmsScore: number | null;
  completedAt: string | null;
  evaluatorName: string | null;
};

export type EvaluatorCandidateRecord = {
  candidateId: string;
  candidateCode: string;
  fullName: string;
  personalEmail: string;
  positionId: string | null;
  positionTitle: string | null;
  currentStage: string;
  currentStatus: string;
  assessment1: EvaluatorCandidateAssessmentSummary | null;
  assessment2: EvaluatorCandidateAssessmentSummary | null;
  evalsAssessment: EvaluatorCandidateAssessmentSummary | null;
  piInterview: EvaluatorCandidatePIRecord | null;
  piRounds: EvaluatorCandidatePIRecord[];
  piScheduled: boolean;
  evaluation: EvaluatorCandidateEvalRecord | null;
  finalDecision: "pass" | "fail" | null;
  updatedAt: string | null;
};

export const assessmentsApi = {
  mine: async () => {
    const { data } = await api.get("/assessments/me");
    return data as AssessmentRecord[];
  },
  myInterviews: async () => {
    const { data } = await api.get("/assessments/me/interviews");
    return data as PIInterviewRecord[];
  },
  evaluatorView: async (filters?: {
    positionId?: string;
    stage?: string;
    passFail?: string;
    piScheduled?: string;
  }) => {
    const params: Record<string, string> = {};
    if (filters?.positionId) params.position_id = filters.positionId;
    if (filters?.stage) params.stage = filters.stage;
    if (filters?.passFail) params.pass_fail = filters.passFail;
    if (filters?.piScheduled) params.pi_scheduled = filters.piScheduled;
    const { data } = await api.get("/assessments/evaluator-view", { params });
    return data as EvaluatorCandidateRecord[];
  },
  forCandidate: async (candidateId: string) => {
    const { data } = await api.get(`/assessments/candidate/${candidateId}`);
    return data as AssessmentRecord[];
  },
  pending: async () => {
    const { data } = await api.get("/assessments/pending");
    return data as AssessmentRecord[];
  },
  submitLevel: async (level: number, payload: FormData) => {
    const { data } = await api.post(
      `/assessments/me/level/${level}/submit`,
      payload,
      {
        headers: { "Content-Type": "multipart/form-data" },
      },
    );
    return data as AssessmentRecord;
  },
  evaluate: async (
    assessmentId: string,
    payload: { score: number; decision: "pass" | "fail"; feedback?: string },
  ) => {
    const form = new FormData();
    form.append("score", String(payload.score));
    form.append("decision", payload.decision);
    if (payload.feedback) form.append("feedback", payload.feedback);
    const { data } = await api.patch(
      `/assessments/${assessmentId}/evaluate`,
      form,
      {
        headers: { "Content-Type": "multipart/form-data" },
      },
    );
    return data as AssessmentRecord;
  },
  bypass: async (
    candidateId: string,
    payload: {
      bypasses: { level: number; score: number; feedback?: string }[];
      notes?: string;
    },
  ) => {
    const { data } = await api.post(
      `/assessments/candidate/${candidateId}/bypass`,
      payload,
    );
    return data as {
      success: boolean;
      assessments: AssessmentRecord[];
      newStage: string;
      newStatus: string;
    };
  },
};

export type SeparationRecord = {
  id: string;
  employeeProfileId: string;
  separationType: "resignation" | "termination" | "no_show" | "absconding";
  separationTypeLabel?: string | null;
  status: string;
  reason?: string | null;
  remarks?: string | null;
  earlyRelievingRequested: boolean;
  appliedAt?: string | null;
  lastWorkingDay?: string | null;
  effectiveDate?: string | null;
  managerId?: string | null;
  managerName?: string | null;
  managerEmail?: string | null;
  managerRemarks?: string | null;
  managerAction?: string | null;
  managerActionAt?: string | null;
  reviewedBy?: string | null;
  reviewedAt?: string | null;
  employeeName?: string | null;
  employeeCode?: string | null;
  department?: string | null;
  designation?: string | null;
  etharaEmail?: string | null;
  personalEmail?: string | null;
  phone?: string | null;
  bloodGroup?: string | null;
  emergencyContactName?: string | null;
  emergencyContactPhone?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};

export const separationApi = {
  resign: async (payload: {
    reason?: string;
    earlyRelievingRequested?: boolean;
    requestedNoticeDays?: number;
    remarks?: string;
  }) => {
    const { data } = await api.post("/separation/resign", {
      reason: payload.reason,
      early_relieving_requested: payload.earlyRelievingRequested ?? false,
      requested_notice_days: payload.requestedNoticeDays,
      remarks: payload.remarks,
    });
    return data as SeparationRecord;
  },
  mine: async () => {
    const { data } = await api.get("/separation/mine");
    return data as SeparationRecord[];
  },
  list: async (params?: { sep_type?: string; sep_status?: string }) => {
    const { data } = await api.get("/separation/list", { params });
    return data as SeparationRecord[];
  },
  managerInbox: async () => {
    const { data } = await api.get("/separation/manager");
    return data as SeparationRecord[];
  },
  managerAction: async (
    id: string,
    payload: { action: string; remarks?: string; suggested_lwd?: string },
  ) => {
    const { data } = await api.patch(
      `/separation/${id}/manager-action`,
      payload,
    );
    return data as SeparationRecord;
  },
  classifyReason: async (
    id: string,
    payload: { reason: string; remarks?: string },
  ) => {
    const { data } = await api.patch(`/separation/${id}/reason`, payload);
    return data as SeparationRecord;
  },
  hrAction: async (
    id: string,
    payload: { action: string; remarks?: string },
  ) => {
    const { data } = await api.patch(`/separation/${id}/hr-action`, payload);
    return data as SeparationRecord;
  },
  updateLwd: async (
    id: string,
    lastWorkingDay: string,
    remarks?: string,
  ): Promise<SeparationRecord> => {
    const { data } = await api.patch(`/separation/${id}/update-lwd`, {
      last_working_day: lastWorkingDay,
      remarks,
    });
    return data as SeparationRecord;
  },
  revoke: async (id: string, remarks?: string): Promise<SeparationRecord> => {
    const { data } = await api.post(`/separation/${id}/revoke`, { remarks });
    return data as SeparationRecord;
  },
  terminate: async (payload: {
    employeeProfileId: string;
    reason: string;
    remarks?: string;
    effectiveDate: string;
    separationType?: "termination" | "no_show" | "absconding";
  }) => {
    const { data } = await api.post("/separation/terminate", {
      employee_profile_id: payload.employeeProfileId,
      reason: payload.reason,
      remarks: payload.remarks,
      effective_date: payload.effectiveDate,
      separation_type: payload.separationType ?? "termination",
    });
    return data as SeparationRecord;
  },
};

// ─── Leave Management ────────────────────────────────────────────────────────

export type LeaveBalance = {
  id: string;
  leaveType: string;
  year: number;
  totalDays: number;
  usedDays: number;
  pendingDays: number;
  availableDays: number;
};

// greytHR-sourced leave balance (the source of truth shown on the Leave screen).
export type GreytHRLeaveBalance = {
  code: string;
  type: string;
  year: number;
  opening: number;
  granted: number;
  availed: number;
  applied: number;
  lapsed: number;
  deducted: number;
  encashed: number;
  balance: number;
  syncedAt: string | null;
};

export type GreytHRLeaveBalances = {
  employeeCode: string;
  year: number;
  syncedAt: string | null;
  balances: GreytHRLeaveBalance[];
};

export type LeaveRequest = {
  id: string;
  employeeProfileId: string;
  employeeName?: string | null;
  employeeCode?: string | null;
  department?: string | null;
  leaveType: string;
  status: string;
  startDate: string;
  endDate: string;
  days: number;
  reason?: string | null;
  managerId?: string | null;
  managerName?: string | null;
  managerAction?: string | null;
  managerActionAt?: string | null;
  managerRemarks?: string | null;
  hrReviewedBy?: string | null;
  hrReviewedAt?: string | null;
  hrRemarks?: string | null;
  createdAt: string;
};

export const leaveApi = {
  getBalances: async (year?: number): Promise<LeaveBalance[]> => {
    const { data } = await api.get("/leave/balances", {
      params: year ? { year } : {},
    });
    return data;
  },
  getGreytHRBalances: async (year?: number): Promise<GreytHRLeaveBalances> => {
    const { data } = await api.get("/leave/greythr-balances", {
      params: year ? { year } : {},
    });
    return data;
  },
  apply: async (payload: {
    leave_type: string;
    start_date: string;
    end_date: string;
    reason?: string;
  }) => {
    const { data } = await api.post("/leave/apply", payload);
    return data as LeaveRequest;
  },
  myRequests: async (): Promise<LeaveRequest[]> => {
    const { data } = await api.get("/leave/my");
    return data;
  },
  managerInbox: async (): Promise<LeaveRequest[]> => {
    const { data } = await api.get("/leave/manager/inbox");
    return data;
  },
  managerAction: async (leaveId: string, action: string, remarks?: string) => {
    const { data } = await api.patch(`/leave/${leaveId}/manager-action`, {
      action,
      remarks,
    });
    return data as LeaveRequest;
  },
  list: async (params?: {
    status?: string;
    employeeId?: string;
  }): Promise<LeaveRequest[]> => {
    const { data } = await api.get("/leave/list", { params });
    return data;
  },
  hrAction: async (leaveId: string, action: string, remarks?: string) => {
    const { data } = await api.patch(`/leave/${leaveId}/hr-action`, {
      action,
      remarks,
    });
    return data as LeaveRequest;
  },
};

// ─── Attendance Management ───────────────────────────────────────────────────

export type AttendanceStatus = "present" | "absent" | "half_day" | "holiday" | "weekoff";

export type AttendanceRecord = {
  id: string;
  employeeProfileId?: string | null;
  employeeCode: string;
  employeeName?: string | null;
  department?: string | null;
  designation?: string | null;
  attendanceDate: string;
  inTime?: string | null;
  outTime?: string | null;
  workedHours?: number | null;
  status: AttendanceStatus;
  source: "biometric" | "manual";
  isEdited: boolean;
  originalInTime?: string | null;
  originalOutTime?: string | null;
  originalStatus?: AttendanceStatus | null;
  editedBy?: string | null;
  editedAt?: string | null;
  editReason?: string | null;
  isFinal: boolean;
  createdAt?: string | null;
  updatedAt?: string | null;
};

export type AttendanceMatrixCell = {
  id: string;
  attendanceDate: string;
  inTime?: string | null;
  status: AttendanceStatus;
  source: "biometric" | "manual";
  isEdited: boolean;
  isFinal: boolean;
};

export type AttendanceMatrixRow = {
  employeeProfileId?: string | null;
  employeeCode: string;
  employeeName?: string | null;
  department?: string | null;
  designation?: string | null;
  dates: Record<string, AttendanceMatrixCell | undefined>;
};

export type AttendanceMatrixResponse = {
  dates: string[];
  data: AttendanceMatrixRow[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
};

export type AttendanceSummary = {
  total: number;
  present: number;
  absent: number;
  halfDay: number;
  holiday: number;
  weekoff: number;
  edited: number;
  averageWorkedHours?: number | null;
};

export type AttendanceSyncLog = {
  id: string;
  syncDate: string;
  source: string;
  status: string;
  startedAt?: string | null;
  finishedAt?: string | null;
  rowsSeen: number;
  rowsSynced: number;
  unmappedCount: number;
  unmappedCodes: string[];
  error?: string | null;
  isFinal: boolean;
};

export type AttendanceSyncRangeResult = {
  from: string;
  to: string;
  days: number;
  rowsSeen: number;
  rowsSynced: number;
  unmappedCount: number;
  unmappedCodes: string[];
  logs: AttendanceSyncLog[];
};

export type AttendanceListParams = {
  from?: string;
  to?: string;
  employeeId?: string;
  department?: string;
  status?: string;
  search?: string;
  mapped?: boolean;
  page?: number;
  limit?: number;
};

export const attendanceApi = {
  list: async (params: AttendanceListParams = {}) => {
    const { data } = await api.get("/attendance/list", { params });
    return data as {
      data: AttendanceRecord[];
      total: number;
      page: number;
      limit: number;
      totalPages: number;
    };
  },
  matrix: async (params: AttendanceListParams = {}) => {
    const { data } = await api.get("/attendance/matrix", { params });
    return data as AttendanceMatrixResponse;
  },
  summary: async (params: AttendanceListParams = {}) => {
    const { data } = await api.get("/attendance/summary", { params });
    return data as AttendanceSummary;
  },
  me: async (params: AttendanceListParams = {}) => {
    const { data } = await api.get("/attendance/me", { params });
    return data as {
      data: AttendanceRecord[];
      total: number;
      page: number;
      limit: number;
      totalPages: number;
    };
  },
  myMatrix: async (params: AttendanceListParams = {}) => {
    const { data } = await api.get("/attendance/me/matrix", { params });
    return data as AttendanceMatrixResponse;
  },
  mySummary: async (params: AttendanceListParams = {}) => {
    const { data } = await api.get("/attendance/me/summary", { params });
    return data as AttendanceSummary;
  },
  exportCsv: async (params: AttendanceListParams = {}) => {
    const { data } = await api.get("/attendance/export", {
      params,
      responseType: "blob",
      timeout: 180_000,
    });
    return data as Blob;
  },
  exportMineCsv: async (params: AttendanceListParams = {}) => {
    const { data } = await api.get("/attendance/me/export", {
      params,
      responseType: "blob",
      timeout: 180_000,
    });
    return data as Blob;
  },
  edit: async (
    id: string,
    payload: { inTime?: string | null; outTime?: string | null; status: string; reason: string },
  ) => {
    const { data } = await api.patch(`/attendance/${id}`, payload);
    return data as AttendanceRecord;
  },
  sync: async (syncDate: string, options?: { force?: boolean; final?: boolean }) => {
    const { data } = await api.post("/attendance/sync", null, {
      params: { date: syncDate, force: options?.force, final: options?.final },
      timeout: 120_000,
    });
    return data as AttendanceSyncLog;
  },
  syncYear: async (year: number, options?: { force?: boolean }) => {
    const { data } = await api.post("/attendance/sync-year", null, {
      params: { year, force: options?.force },
      timeout: 600_000,
    });
    return data as AttendanceSyncRangeResult;
  },
  syncRange: async (from: string, to: string, options?: { force?: boolean }) => {
    const { data } = await api.post("/attendance/sync-range", null, {
      params: { from, to, force: options?.force },
      timeout: 600_000,
    });
    return data as AttendanceSyncRangeResult;
  },
  syncLogs: async (params?: { page?: number; limit?: number }) => {
    const { data } = await api.get("/attendance/sync-logs", { params });
    return data as {
      data: AttendanceSyncLog[];
      total: number;
      page: number;
      limit: number;
      totalPages: number;
    };
  },
  downloadExport: async (params: AttendanceListParams = {}, fileName?: string) => {
    const blob = await attendanceApi.exportCsv(params);
    downloadBlob(blob, fileName ?? `attendance_${new Date().toISOString().slice(0, 10)}.csv`);
  },
  downloadMineExport: async (params: AttendanceListParams = {}, fileName?: string) => {
    const blob = await attendanceApi.exportMineCsv(params);
    downloadBlob(
      blob,
      fileName ?? `my_attendance_${new Date().toISOString().slice(0, 10)}.csv`,
    );
  },
};

// ─── Resource Segregation ───────────────────────────────────────────────────

export type ResourcePerson = {
  id: string;
  name?: string | null;
  email?: string | null;
  role?: string | null;
  roles?: string[];
  isActive?: boolean;
  employeeProfileId?: string | null;
  employeeCode?: string | null;
  employeeEmail?: string | null;
  department?: string | null;
  designation?: string | null;
  designationMatchesPlTpm?: boolean;
};

export type ResourceEmployee = {
  id: string;
  userId?: string | null;
  fullName: string;
  employeeCode: string;
  etharaEmail: string;
  department?: string | null;
  designation?: string | null;
};

export type ResourceProject = {
  id: string;
  name: string;
  code?: string | null;
  description?: string | null;
  managerId: string;
  managerName?: string | null;
  status: string;
  startDate?: string | null;
  endDate?: string | null;
  leads: Array<{ id: string; userId: string; name?: string | null; email?: string | null; roleLabel: string }>;
  analytics: { tagged: number; present: number; absent: number };
  createdAt?: string | null;
};

export type ResourceAssignment = {
  id: string;
  projectId: string;
  projectName?: string | null;
  employee: ResourceEmployee | null;
  reportingMember?: ResourceEmployee | null;
  assignedAt?: string | null;
  status: string;
  state: "present" | "absent";
};

export type ResourceTransferRequest = {
  id: string;
  employee: ResourceEmployee | null;
  fromProjectId: string;
  fromProjectName?: string | null;
  toProjectId: string;
  toProjectName?: string | null;
  reportingMember?: ResourceEmployee | null;
  requestedBy?: string | null;
  reviewerId?: string | null;
  reviewerName?: string | null;
  status: string;
  reason?: string | null;
  decisionComment?: string | null;
  createdAt?: string | null;
  decidedAt?: string | null;
};

export type ResourceDashboard = {
  date: string;
  summary: {
    projects: number;
    tagged: number;
    present: number;
    absent: number;
    pendingTransfers: number;
  };
  projects: ResourceProject[];
  assignments: ResourceAssignment[];
  transferRequests: ResourceTransferRequest[];
};

export type ResourceUploadResult = {
  total: number;
  accepted: number;
  rejected: number;
  transferRequested: number;
  results: Array<{ row: number; name: string; email: string; status: string; reason: string }>;
};

export const resourceSegregationApi = {
  dashboard: async (params?: { day?: string }) => {
    const { data } = await api.get("/resource-segregation/dashboard", { params });
    return data as ResourceDashboard;
  },
  people: async () => {
    const { data } = await api.get("/resource-segregation/people");
    return data as { users: ResourcePerson[]; employees: ResourceEmployee[] };
  },
  createProject: async (payload: Record<string, unknown>) => {
    const { data } = await api.post("/resource-segregation/projects", payload);
    return data as ResourceProject;
  },
  updateProject: async (projectId: string, payload: Record<string, unknown>) => {
    const { data } = await api.patch(`/resource-segregation/projects/${projectId}`, payload);
    return data as ResourceProject;
  },
  deleteProject: async (projectId: string) => {
    const { data } = await api.delete(`/resource-segregation/projects/${projectId}`);
    return data as { message: string };
  },
  setLeads: async (projectId: string, payload: { userIds: string[]; roleLabel?: string }) => {
    const { data } = await api.post(`/resource-segregation/projects/${projectId}/leads`, payload);
    return data as ResourceProject;
  },
  uploadAssignments: async (projectId: string, file: File) => {
    const form = new FormData();
    form.append("file", file);
    const { data } = await api.post(
      `/resource-segregation/projects/${projectId}/assignments/upload`,
      form,
      { headers: { "Content-Type": "multipart/form-data" } },
    );
    return data as ResourceUploadResult;
  },
  transferAction: async (requestId: string, action: "approve" | "reject", comment?: string) => {
    const { data } = await api.post(`/resource-segregation/transfer-requests/${requestId}/action`, {
      action,
      comment,
    });
    return data as ResourceTransferRequest;
  },
};

// ─── Skill Tags ─────────────────────────────────────────────────────────────

export type SkillCatalogItem = { key: string; label: string };

export type EmployeeSkillEntry = { skill: string; label: string; rating: number };

export type SkillTaggedEmployee = {
  employeeProfileId: string;
  name: string | null;
  employeeCode: string | null;
  etharaEmail: string | null;
  department: string | null;
  designation: string | null;
  skills: EmployeeSkillEntry[];
  project: { id: string; name: string | null } | null;
};

export type SkillListFilters = {
  skill?: string;
  minRating?: number;
  assignment?: "all" | "assigned" | "unassigned";
  search?: string;
};

export type SkillBulkUploadResult = {
  total: number;
  created: number;
  updated: number;
  rejected: number;
  results: Array<{ row: number; identifier: string; skill: string; status: string; reason: string | null }>;
};

export const skillsApi = {
  catalog: async () => {
    const { data } = await api.get("/skills/catalog");
    return data as SkillCatalogItem[];
  },
  createSkill: async (payload: { label: string; key?: string }) => {
    const { data } = await api.post("/skills/catalog", payload);
    return data as SkillCatalogItem;
  },
  employees: async (params?: SkillListFilters) => {
    const { data } = await api.get("/skills/employees", { params });
    return data as SkillTaggedEmployee[];
  },
  setEmployeeSkills: async (employeeProfileId: string, skills: Array<{ skill: string; rating: number }>) => {
    const { data } = await api.put(`/skills/employees/${employeeProfileId}`, { skills });
    return data as { employeeProfileId: string; skills: EmployeeSkillEntry[] };
  },
  mySkills: async () => {
    const { data } = await api.get("/skills/me");
    return data as { skills: EmployeeSkillEntry[]; project: { id: string; name: string | null } | null };
  },
  downloadTemplate: async () => {
    const { data } = await api.get("/skills/template", { responseType: "blob" });
    downloadBlob(data as Blob, "skill_tags_template.csv");
  },
  bulkUpload: async (file: File) => {
    const form = new FormData();
    form.append("file", file);
    const { data } = await api.post("/skills/bulk-upload", form, {
      headers: { "Content-Type": "multipart/form-data" },
    });
    return data as SkillBulkUploadResult;
  },
  exportCsv: async (params?: SkillListFilters) => {
    const { data } = await api.get("/skills/export", { params, responseType: "blob" });
    downloadBlob(data as Blob, `skill_tags_${params?.assignment ?? "all"}_${new Date().toISOString().slice(0, 10)}.csv`);
  },
};

// ─── Employee Evaluation ──────────────────────────────────────────────────────

export type EmployeeEvaluationListItem = {
  id: string;
  name: string;
  employeeCode: string | null;
  department: string | null;
  designation: string | null;
  evaluationVerdict: string | null;
  skillCount: number;
  assessmentScore: number | null;
  assessmentVerdict: string | null;
  piScore: number | null;
  piVerdict: string | null;
  skills?: EmployeeSkillEntry[];
};

export type EmployeeEvaluationFilters = {
  search?: string;
  department?: string;
  designation?: string;
  verdict?: string;
  assessmentVerdict?: string;
  piVerdict?: string;
  skill?: string;
  minRating?: number;
  hasSkills?: boolean;
};

export type EmployeeEvaluationProfile = {
  employee: {
    id: string;
    name: string;
    employeeCode: string | null;
    etharaEmail: string | null;
    personalEmail: string | null;
    department: string | null;
    designation: string | null;
    evaluationVerdict: string | null;
  };
  linkedCandidateId: string | null;
  assessment: { score: number | null; verdict: string | null } | null;
  piScore: number | null;
  piVerdict: string | null;
  pms: {
    totalScore: number;
    averageScore: number;
    overallRating: string | null;
    submittedAt: string | null;
  } | null;
  skills: EmployeeSkillEntry[];
};

export type EmployeeEvaluationInsightPerson = {
  id: string;
  name: string;
  employeeCode: string | null;
  score: number | null;
};

export type EmployeeEvaluationHighlights = {
  totalEmployees: number;
  verdictDistribution: Record<string, number>;
  skillTaggedCount: number;
  skillTaggedPct: number;
  scoredCount: number;
  topPerformers: EmployeeEvaluationInsightPerson[];
  atRisk: EmployeeEvaluationInsightPerson[];
};

export type EmployeeEvaluationOverview = {
  stats: EmployeeEvaluationHighlights;
  overview: {
    summary: string;
    highlights: string[];
    recommendation: string;
  };
};

export type EmployeeEvaluationVerdict = "strong" | "solid" | "developing" | "at_risk";

export type EmployeeEvaluationInsight = {
  employeeId: string;
  analysis: {
    verdict: EmployeeEvaluationVerdict;
    headline: string;
    summary: string;
    strengths: string[];
    focusAreas: string[];
    recommendation: string;
  };
};

export type EmployeeEvaluationBulkResult = {
  blob: Blob;
  updated: number;
  failed: number;
};

function employeeEvaluationParams(filters: EmployeeEvaluationFilters = {}): Record<string, string | number | boolean> {
  const params: Record<string, string | number | boolean> = {};
  const str = (key: keyof EmployeeEvaluationFilters) => {
    const value = filters[key];
    if (typeof value === "string" && value.trim() !== "") params[key] = value.trim();
  };
  const num = (key: keyof EmployeeEvaluationFilters) => {
    const value = filters[key];
    if (typeof value === "number" && !Number.isNaN(value)) params[key] = value;
  };
  str("search");
  str("department");
  str("designation");
  str("verdict");
  str("assessmentVerdict");
  str("piVerdict");
  str("skill");
  num("minRating");
  if (typeof filters.hasSkills === "boolean") params.hasSkills = filters.hasSkills;
  return params;
}

export const employeeEvaluationApi = {
  listEmployees: async (filters: EmployeeEvaluationFilters = {}) => {
    const { data } = await api.get("/employee-evaluation/employees", {
      params: employeeEvaluationParams(filters),
    });
    return data as EmployeeEvaluationListItem[];
  },
  exportEmployees: async (filters: EmployeeEvaluationFilters = {}) => {
    const { data } = await api.get("/employee-evaluation/export", {
      params: employeeEvaluationParams(filters),
      responseType: "blob",
    });
    return data as Blob;
  },
  getHighlights: async () => {
    const { data } = await api.get("/employee-evaluation/insights/highlights");
    return data as EmployeeEvaluationHighlights;
  },
  generateOverview: async () => {
    const { data } = await api.post("/employee-evaluation/insights/overview");
    return data as EmployeeEvaluationOverview;
  },
  getProfile: async (employeeId: string) => {
    const { data } = await api.get(`/employee-evaluation/${employeeId}`);
    return data as EmployeeEvaluationProfile;
  },
  generateInsight: async (employeeId: string) => {
    const { data } = await api.post(`/employee-evaluation/${employeeId}/insight`);
    return data as EmployeeEvaluationInsight;
  },
  downloadBulkTemplate: async () => {
    const { data } = await api.get("/employee-evaluation/bulk-template", { responseType: "blob" });
    downloadBlob(data as Blob, "employee_evaluation_template.csv");
  },
  bulkUpload: async (file: File) => {
    const form = new FormData();
    form.append("file", file);
    try {
      const response = await api.post("/employee-evaluation/bulk-upload", form, {
        headers: { "Content-Type": "multipart/form-data" },
        responseType: "blob",
      });
      const updated = Number(response.headers["x-rows-updated"] ?? 0);
      const failed = Number(response.headers["x-rows-failed"] ?? 0);
      return {
        blob: response.data as Blob,
        updated: Number.isNaN(updated) ? 0 : updated,
        failed: Number.isNaN(failed) ? 0 : failed,
      } as EmployeeEvaluationBulkResult;
    } catch (err) {
      // responseType 'blob' means an error body is a Blob — decode it so the real
      // reason (e.g. "Upload a UTF-8 CSV file") reaches the UI instead of a generic
      // failure toast.
      const data = (err as { response?: { data?: unknown } })?.response?.data;
      if (data instanceof Blob) {
        const text = await data.text().catch(() => "");
        let detail = "";
        try {
          detail = (JSON.parse(text) as { detail?: string })?.detail ?? "";
        } catch {
          /* body was not JSON */
        }
        throw new Error(detail || text || "Upload failed.");
      }
      throw err;
    }
  },
};

// ─── Reimbursements ─────────────────────────────────────────────────────────

export type ReimbursementAuditEntry = {
  id: string;
  action: string;
  fromStatus?: string | null;
  toStatus?: string | null;
  comment?: string | null;
  performedBy?: string | null;
  performedByRole?: string | null;
  createdAt?: string | null;
};

export type ReimbursementReceiptOcr = {
  status?: string | null;
  summary?: string | null;
  vendor?: string | null;
  invoiceDate?: string | null;
  amount?: number | null;
  claimedAmount?: number | null;
  amountDifference?: number | null;
  validationStatus?: string | null;
  validationMessage?: string | null;
  lineCount?: number | null;
  textSnippet?: string | null;
  amountCandidates?: Array<{ amount?: number | null; line?: string | null; priority?: number | null }>;
};

export type ReimbursementRequest = {
  id: string;
  employeeProfileId: string;
  employeeName: string;
  employeeId: string;
  employeeCode: string;
  department?: string | null;
  projectName?: string | null;
  category?: string | null;
  expenseDate?: string | null;
  expenseAmount?: number | null;
  currency: string;
  reason?: string | null;
  paymentMethod?: string | null;
  receiptFileName?: string | null;
  receiptFileUrl?: string | null;
  receiptMimeType?: string | null;
  receiptFileSize?: number | null;
  receiptOcr?: ReimbursementReceiptOcr | null;
  declarationAccepted: boolean;
  status: string;
  statusLabel: string;
  missingFields: string[];
  managerId?: string | null;
  managerName?: string | null;
  managerReviewedBy?: string | null;
  managerReviewedAt?: string | null;
  managerComments?: string | null;
  financeReviewedBy?: string | null;
  financeReviewedAt?: string | null;
  financeComments?: string | null;
  paidBy?: string | null;
  paidAt?: string | null;
  submittedAt?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  auditTrail: ReimbursementAuditEntry[];
};

export type ReimbursementConfig = {
  categories: string[];
  approvalRules: string;
  expenseLimit?: number | null;
  defaultCurrency: string;
};

export const reimbursementsApi = {
  config: async (): Promise<ReimbursementConfig> => {
    const { data } = await api.get("/reimbursements/config");
    return data;
  },
  updateConfig: async (payload: Partial<ReimbursementConfig>): Promise<ReimbursementConfig> => {
    const { data } = await api.put("/reimbursements/config", payload);
    return data;
  },
  categories: async (): Promise<string[]> => {
    const { data } = await api.get("/reimbursements/categories");
    return data;
  },
  list: async (params?: { status?: string }): Promise<ReimbursementRequest[]> => {
    const { data } = await api.get("/reimbursements", { params });
    return data;
  },
  get: async (id: string): Promise<ReimbursementRequest> => {
    const { data } = await api.get(`/reimbursements/${id}`);
    return data;
  },
  create: async (payload: FormData): Promise<ReimbursementRequest> => {
    const { data } = await api.post("/reimbursements", payload, {
      headers: { "Content-Type": "multipart/form-data" },
      timeout: 180_000,
    });
    return data;
  },
  update: async (id: string, payload: FormData): Promise<ReimbursementRequest> => {
    const { data } = await api.patch(`/reimbursements/${id}`, payload, {
      headers: { "Content-Type": "multipart/form-data" },
      timeout: 180_000,
    });
    return data;
  },
  managerAction: async (id: string, action: "approve" | "reject" | "return", comment?: string) => {
    const { data } = await api.post(`/reimbursements/${id}/manager-action`, { action, comment });
    return data as ReimbursementRequest;
  },
  financeAction: async (id: string, action: "approve" | "reject" | "return", comment?: string) => {
    const { data } = await api.post(`/reimbursements/${id}/finance-action`, { action, comment });
    return data as ReimbursementRequest;
  },
  hrAction: async (id: string, action: "approve" | "reject" | "return", comment?: string) => {
    const { data } = await api.post(`/reimbursements/${id}/hr-action`, { action, comment });
    return data as ReimbursementRequest;
  },
  leadershipAction: async (id: string, action: "approve" | "reject" | "return", comment?: string) => {
    const { data } = await api.post(`/reimbursements/${id}/leadership-action`, { action, comment });
    return data as ReimbursementRequest;
  },
  markPaid: async (id: string, comment?: string) => {
    const { data } = await api.post(`/reimbursements/${id}/mark-paid`, { action: "paid", comment });
    return data as ReimbursementRequest;
  },
  acknowledge: async (id: string, comment?: string) => {
    const { data } = await api.post(`/reimbursements/${id}/acknowledge`, { action: "acknowledge", comment });
    return data as ReimbursementRequest;
  },
  revoke: async (id: string, comment?: string) => {
    const { data } = await api.post(`/reimbursements/${id}/revoke`, { action: "revoke", comment });
    return data as ReimbursementRequest;
  },
  remove: async (id: string): Promise<void> => {
    await api.delete(`/reimbursements/${id}`);
  },
  exportCsv: async () => {
    const { data } = await api.get("/reimbursements/export", {
      responseType: "blob",
      timeout: 180_000,
    });
    return data as Blob;
  },
  downloadExport: async () => {
    const blob = await reimbursementsApi.exportCsv();
    downloadBlob(blob, `reimbursement_report_${new Date().toISOString().slice(0, 10)}.csv`);
  },
};

// ─── Dinner Requests ────────────────────────────────────────────────────────

export type DinnerRequestAuditEntry = {
  id: string;
  action: string;
  fromStatus?: string | null;
  toStatus?: string | null;
  comment?: string | null;
  performedBy?: string | null;
  performedByRole?: string | null;
  createdAt?: string | null;
};

export type DinnerRequest = {
  id: string;
  requesterUserId: string;
  requesterEmployeeProfileId?: string | null;
  requesterName: string;
  requesterType: string;
  dinnerDate?: string | null;
  projectName?: string | null;
  teamMemberCount?: number | null;
  teamMemberEmails: string[];
  status: string;
  statusLabel: string;
  submittedAt?: string | null;
  reviewedBy?: string | null;
  reviewedAt?: string | null;
  reviewerComments?: string | null;
  completedBy?: string | null;
  completedAt?: string | null;
  missingFields: string[];
  createdAt?: string | null;
  updatedAt?: string | null;
  auditTrail: DinnerRequestAuditEntry[];
};

export const dinnerRequestsApi = {
  list: async (params?: { status?: string }): Promise<DinnerRequest[]> => {
    const { data } = await api.get("/dinner-requests", { params });
    return data;
  },
  get: async (id: string): Promise<DinnerRequest> => {
    const { data } = await api.get(`/dinner-requests/${id}`);
    return data;
  },
  create: async (payload: {
    requesterName: string;
    requesterType: string;
    dinnerDate: string;
    projectName: string;
    teamMemberCount: number | null;
    teamMemberEmails: string[];
    saveAsDraft: boolean;
  }): Promise<DinnerRequest> => {
    const { data } = await api.post("/dinner-requests", payload);
    return data;
  },
  update: async (
    id: string,
    payload: {
      requesterName: string;
      requesterType: string;
      dinnerDate: string;
      projectName: string;
      teamMemberCount: number | null;
      teamMemberEmails: string[];
      saveAsDraft: boolean;
    },
  ): Promise<DinnerRequest> => {
    const { data } = await api.patch(`/dinner-requests/${id}`, payload);
    return data;
  },
  review: async (id: string, action: "approve" | "reject" | "return", comment?: string) => {
    const { data } = await api.post(`/dinner-requests/${id}/review`, { action, comment });
    return data as DinnerRequest;
  },
  complete: async (id: string, comment?: string) => {
    const { data } = await api.post(`/dinner-requests/${id}/complete`, { action: "complete", comment });
    return data as DinnerRequest;
  },
  remove: async (id: string) => {
    await api.delete(`/dinner-requests/${id}`);
  },
  exportCsv: async () => {
    const { data } = await api.get("/dinner-requests/export", {
      responseType: "blob",
      timeout: 180_000,
    });
    return data as Blob;
  },
  downloadExport: async () => {
    const blob = await dinnerRequestsApi.exportCsv();
    downloadBlob(blob, `dinner_requests_${new Date().toISOString().slice(0, 10)}.csv`);
  },
};

// ─── Assets ──────────────────────────────────────────────────────────────────

export type EmployeeAsset = {
  id: string;
  employeeProfileId: string;
  employeeName?: string | null;
  employeeCode?: string | null;
  assetType: string;
  model?: string | null;
  serialNumber?: string | null;
  chargerIssued: boolean;
  assetTag?: string | null;
  status: string;
  assignedAt?: string | null;
  returnedAt?: string | null;
  returnCondition?: string | null;
  notes?: string | null;
  createdAt: string;
};

export type AssetBulkImportResult = {
  total: number;
  imported: number;
  failed: number;
  results: {
    id: string;
    employeeName: string;
    employeeCode: string;
    assetType: string;
    serialNumber?: string | null;
    assetTag?: string | null;
  }[];
  errors: {
    row: number;
    employeeCode: string;
    employeeEmail: string;
    assetType: string;
    serialNumber: string;
    assetTag: string;
    errors: string[];
  }[];
};

export type OffboardingChecklist = {
  id: string;
  separationId: string;
  employeeProfileId: string;
  laptopReturned: boolean;
  laptopReturnDate?: string | null;
  laptopCondition?: string | null;
  idCardReturned: boolean;
  idCardReturnDate?: string | null;
  itClearedBy?: string | null;
  itClearedAt?: string | null;
  officeAdminClearedBy?: string | null;
  officeAdminClearedAt?: string | null;
  hrClearedBy?: string | null;
  hrClearedAt?: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
};

export const assetsApi = {
  assign: async (payload: {
    employee_profile_id: string;
    asset_type: string;
    model?: string;
    serial_number?: string;
    charger_issued?: boolean;
    asset_tag?: string;
    notes?: string;
  }) => {
    const { data } = await api.post("/assets/assign", payload);
    return data as EmployeeAsset;
  },
  bulkImport: async (csvFile: File) => {
    const payload = new FormData();
    payload.append("csvFile", csvFile);
    const { data } = await api.post("/assets/bulk-import", payload, {
      headers: { "Content-Type": "multipart/form-data" },
      timeout: 180_000,
    });
    return data as AssetBulkImportResult;
  },
  list: async (params?: {
    employeeId?: string;
    assetType?: string;
    status?: string;
  }): Promise<EmployeeAsset[]> => {
    const { data } = await api.get("/assets/list", { params });
    return data;
  },
  update: async (
    assetId: string,
    payload: Partial<EmployeeAsset> & { status?: string },
  ) => {
    const { data } = await api.patch(`/assets/${assetId}`, payload);
    return data as EmployeeAsset;
  },
  reassign: async (
    assetId: string,
    payload: {
      employee_profile_id: string;
      charger_issued?: boolean;
      notes?: string;
    },
  ) => {
    const { data } = await api.patch(`/assets/${assetId}`, payload);
    return data as EmployeeAsset;
  },
  getByEmployee: async (employeeId: string): Promise<EmployeeAsset[]> => {
    const { data } = await api.get(`/assets/employee/${employeeId}`);
    return data;
  },
  getOffboardingChecklist: async (separationId: string) => {
    const { data } = await api.get(`/assets/offboarding/${separationId}`);
    return data as OffboardingChecklist;
  },
  updateOffboardingChecklist: async (
    checklistId: string,
    payload: {
      laptop_returned?: boolean;
      laptop_condition?: string;
      id_card_returned?: boolean;
      it_cleared?: boolean;
      office_admin_cleared?: boolean;
      hr_cleared?: boolean;
    },
  ) => {
    const { data } = await api.patch(
      `/assets/offboarding/${checklistId}`,
      payload,
    );
    return data as OffboardingChecklist;
  },
};

// ─── Manager ─────────────────────────────────────────────────────────────────

export type TeamMember = {
  id: string;
  fullName: string;
  employeeCode: string;
  etharaEmail: string;
  personalEmail?: string | null;
  phone?: string | null;
  department?: string | null;
  designation?: string | null;
  gender?: string | null;
  bloodGroup?: string | null;
  managerId?: string | null;
};

// ─── Assessment Templates ────────────────────────────────────────────────────

export type AssessmentTemplateRecord = {
  id: string;
  title: string;
  description?: string | null;
  instructions?: string | null;
  level: number;
  positionId?: string | null;
  positionTitle?: string | null;
  isActive: boolean;
  createdAt?: string | null;
  updatedAt?: string | null;
};

export const assessmentTemplatesApi = {
  list: async (): Promise<AssessmentTemplateRecord[]> => {
    const { data } = await api.get("/assessment-templates");
    return data;
  },
  create: async (payload: {
    title: string;
    description?: string;
    instructions?: string;
    level: number;
    positionId?: string;
    isActive?: boolean;
  }): Promise<AssessmentTemplateRecord> => {
    const { data } = await api.post("/assessment-templates", payload);
    return data;
  },
  update: async (
    id: string,
    payload: {
      title?: string;
      description?: string;
      instructions?: string;
      level?: number;
      positionId?: string;
      isActive?: boolean;
    },
  ): Promise<AssessmentTemplateRecord> => {
    const { data } = await api.patch(`/assessment-templates/${id}`, payload);
    return data;
  },
};

export const managerApi = {
  getTeam: async (): Promise<TeamMember[]> => {
    const { data } = await api.get("/manager/team");
    return data;
  },
  setManager: async (employeeId: string, managerId: string) => {
    const { data } = await api.patch(
      `/manager/employee/${employeeId}/set-manager`,
      null,
      {
        params: { managerId },
      },
    );
    return data;
  },
  updateEmployee: async (
    employeeId: string,
    payload: {
      blood_group?: string;
      emergency_contact_name?: string;
      emergency_contact_phone?: string;
      emergency_contact_relation?: string;
      manager_id?: string;
    },
  ) => {
    const { data } = await api.patch(
      `/manager/employee/${employeeId}/update`,
      payload,
    );
    return data as TeamMember;
  },
  getTeamLeaveRequests: async (status?: string): Promise<LeaveRequest[]> => {
    const { data } = await api.get("/manager/team/leave-requests", {
      params: status ? { status } : {},
    });
    return data;
  },
};

// ─── Assessment Platform ─────────────────────────────────────────────────────

export type ApQuestionType =
  | "mcq_single" | "mcq_multi" | "true_false" | "short_answer" | "long_answer"
  | "file_upload" | "url_submission" | "rating" | "form_text" | "form_date"
  | "form_dropdown" | "consent";

export type ApQuestionConfig = Record<string, unknown>;

export type ApQuestion = {
  id: string;
  assessmentId: string;
  sectionId: string;
  bankQuestionId?: string | null;
  type: ApQuestionType;
  prompt: string;
  config: ApQuestionConfig;
  marks: number;
  negativeMarks: number;
  orderIndex: number;
  isRequired: boolean;
  mediaUrl?: string | null;
  autoScored: boolean;
};

export type ApSection = {
  id: string;
  assessmentId: string;
  title: string;
  instructions?: string | null;
  orderIndex: number;
  timeLimitMinutes?: number | null;
  cutoffMark?: number | null;
  weightage?: number | null;
  lockAfterLeave: boolean;
  randomizeQuestions: boolean;
  pickCount?: number | null;
  questions?: ApQuestion[];
};

export type ApAssessment = {
  id: string;
  title: string;
  description?: string | null;
  instructions?: string | null;
  consentText?: string | null;
  status: "draft" | "published" | "archived";
  timeLimitMinutes?: number | null;
  attemptsAllowed: number;
  randomizeSections: boolean;
  randomizeQuestions: boolean;
  shuffleOptions: boolean;
  negativeMarking: boolean;
  negativeFactor: number;
  passPercentage?: number | null;
  totalMarks: number;
  showResultsToCandidate: boolean;
  availableFrom?: string | null;
  availableUntil?: string | null;
  settings?: Record<string, unknown> | null;
  positionId?: string | null;
  createdBy?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  sectionCount: number;
  questionCount: number;
  assignmentCount?: number;
  sections?: ApSection[];
};

export type ApAssessmentInput = Partial<{
  title: string;
  description: string | null;
  instructions: string | null;
  consentText: string | null;
  timeLimitMinutes: number | null;
  attemptsAllowed: number;
  randomizeSections: boolean;
  randomizeQuestions: boolean;
  shuffleOptions: boolean;
  negativeMarking: boolean;
  negativeFactor: number;
  passPercentage: number | null;
  showResultsToCandidate: boolean;
  availableFrom: string | null;
  availableUntil: string | null;
  settings: Record<string, unknown> | null;
  positionId: string | null;
}>;

export type ApProctoringConfig = {
  requireFullscreen: boolean;
  blockTabSwitch: boolean;
  blockCopyPaste: boolean;
  maxWarnings: number;
  enabled: boolean;
};

export type ApProctoringCounts = {
  tabSwitches: number;
  fullscreenExits: number;
  copyAttempts: number;
  blurEvents: number;
};

export type ApAttemptSummary = {
  id: string;
  assignmentId: string;
  assessmentId: string;
  userId: string;
  email?: string | null;
  name?: string | null;
  status: "in_progress" | "submitted" | "graded";
  startedAt?: string | null;
  submittedAt?: string | null;
  autoScore?: number | null;
  manualScore?: number | null;
  totalScore?: number | null;
  maxScore?: number | null;
  percentage?: number | null;
  resultStatus?: "pass" | "fail" | "pending" | null;
  gradedAt?: string | null;
  assessmentTitle?: string | null;
  proctoring?: ApProctoringCounts | null;
  overallFeedback?: string | null;
  resultFinalized?: boolean;
  resultReleased?: boolean;
  released?: boolean;
};

export type ApResultsUploadResult = {
  total: number;
  updated: number;
  skippedFinalized: number;
  notFound: number;
};

export type ApAssignment = {
  id: string;
  assessmentId: string;
  assessmentTitle?: string | null;
  assessmentStatus?: string | null;
  totalMarks?: number | null;
  email: string;
  userId?: string | null;
  candidateId?: string | null;
  name?: string | null;
  status: "invited" | "started" | "submitted" | "graded" | "revoked" | "expired";
  provisioned: boolean;
  attemptsUsed: number;
  invitedAt?: string | null;
  lastInvitedAt?: string | null;
  expiresAt?: string | null;
  hasAccount: boolean;
  attempt?: ApAttemptSummary | null;
};

export type ApBulkAssignResult = {
  created: number;
  linked: number;
  reinvited: number;
  invited: number;
  skipped: { email: string; reason: string }[];
};

export type ApAssessmentBypassPayload = {
  assignments: {
    assignmentId: string;
    score: number;
    feedback?: string | null;
  }[];
  notes?: string | null;
  manualPass?: boolean;
};

export type ApAssessmentBypassResult = {
  updated: ApAssignment[];
  advanced: boolean;
  allCleared: boolean;
};

export type ApBulkAssessmentBypassRow = {
  row: number;
  email?: string;
  candidateId?: string;
  status: "advanced" | "updated" | "failed" | "skipped";
  message: string;
  advanced?: boolean;
  assignments?: number;
};

export type ApBulkAssessmentBypassResult = {
  processed: number;
  advanced: number;
  failed: number;
  results: ApBulkAssessmentBypassRow[];
};

export type ApMyAssignment = {
  assignmentId: string;
  assessmentId: string;
  title: string;
  description?: string | null;
  timeLimitMinutes?: number | null;
  attemptsAllowed: number;
  attemptsUsed: number;
  status: string;
  availableUntil?: string | null;
  showResultsToCandidate: boolean;
  attempt?: ApAttemptSummary | null;
};

export type ApTakerQuestion = {
  id: string;
  type: ApQuestionType;
  prompt: string;
  marks: number;
  isRequired: boolean;
  mediaUrl?: string | null;
  config: ApQuestionConfig;
};

export type ApTakerSection = {
  id: string;
  title: string;
  instructions?: string | null;
  timeLimitMinutes?: number | null;
  lockAfterLeave: boolean;
  questions: ApTakerQuestion[];
};

export type ApTakerAnswer = {
  questionId: string;
  response?: Record<string, unknown> | null;
  clientRev: number;
  fileName?: string | null;
  fileUrl?: string | null;
};

export type ApTakerAttempt = {
  attemptId: string;
  assignmentId: string;
  assessmentId: string;
  title: string;
  instructions?: string | null;
  consentText?: string | null;
  timeLimitMinutes?: number | null;
  status: "in_progress" | "submitted" | "graded";
  remainingSeconds?: number | null;
  showResultsToCandidate: boolean;
  proctoring?: ApProctoringConfig | null;
  proctoringCounts?: ApProctoringCounts | null;
  sections: ApTakerSection[];
  answers: Record<string, ApTakerAnswer>;
  result?: ApAttemptSummary | null;
};

export type ApScorecardQuestion = {
  id: string;
  type: ApQuestionType;
  prompt: string;
  marks: number;
  scored: boolean;
  autoScored: boolean;
  config: ApQuestionConfig;
  response?: Record<string, unknown> | null;
  fileName?: string | null;
  fileUrl?: string | null;
  awardedMarks?: number | null;
  isCorrect?: boolean | null;
  feedback?: string | null;
  needsManual: boolean;
};

export type ApScorecardSection = {
  sectionId: string;
  title: string;
  awarded: number;
  maxMarks: number;
  cutoffMark?: number | null;
  cutoffMet: boolean;
  questions: ApScorecardQuestion[];
};

export type ApScorecard = {
  attempt: ApAttemptSummary;
  sections: ApScorecardSection[];
};

export type ApQuestionBankItem = {
  id: string;
  type: ApQuestionType;
  prompt: string;
  config: ApQuestionConfig;
  defaultMarks: number;
  tags: string[];
  difficulty?: string | null;
  skill?: string | null;
  isArchived: boolean;
  createdBy?: string | null;
  autoScored: boolean;
  createdAt?: string | null;
};

export type ApQuestionTypeMeta = {
  type: ApQuestionType;
  label: string;
  autoScored: boolean;
  manualOnly: boolean;
};

export type ApPaged<T> = { data: T[]; total: number; page: number; limit: number; totalPages: number };

const AP = "/assessment-platform";

export const assessmentPlatformApi = {
  questionTypes: async (): Promise<ApQuestionTypeMeta[]> => {
    const { data } = await api.get(`${AP}/question-types`);
    return data;
  },

  // ── builder ──
  list: async (params?: { status?: string; search?: string; page?: number; limit?: number }) => {
    const { data } = await api.get(`${AP}/assessments`, { params });
    return data as ApPaged<ApAssessment>;
  },
  get: async (id: string): Promise<ApAssessment> => {
    const { data } = await api.get(`${AP}/assessments/${id}`);
    return data;
  },
  create: async (payload: ApAssessmentInput & { title: string }): Promise<ApAssessment> => {
    const { data } = await api.post(`${AP}/assessments`, payload);
    return data;
  },
  update: async (id: string, payload: ApAssessmentInput): Promise<ApAssessment> => {
    const { data } = await api.patch(`${AP}/assessments/${id}`, payload);
    return data;
  },
  // Operational settings (Google Sheet sync, proctoring, result visibility) — allowed
  // even after publish, unlike the structure/snapshot fields in `update`.
  updateSettings: async (
    id: string,
    payload: { settings?: Record<string, unknown>; showResultsToCandidate?: boolean },
  ): Promise<ApAssessment> => {
    const { data } = await api.patch(`${AP}/assessments/${id}/settings`, payload);
    return data;
  },
  // Backfill: push every submitted attempt to the configured Google Sheet now.
  resyncSheet: async (id: string): Promise<{ synced: number; total: number; error?: string | null }> => {
    const { data } = await api.post(`${AP}/assessments/${id}/sheet-sync`);
    return data;
  },
  remove: async (id: string) => {
    const { data } = await api.delete(`${AP}/assessments/${id}`);
    return data;
  },
  clone: async (id: string): Promise<ApAssessment> => {
    const { data } = await api.post(`${AP}/assessments/${id}/clone`);
    return data;
  },
  publish: async (id: string): Promise<ApAssessment> => {
    const { data } = await api.post(`${AP}/assessments/${id}/publish`);
    return data;
  },
  unpublish: async (id: string): Promise<ApAssessment> => {
    const { data } = await api.post(`${AP}/assessments/${id}/unpublish`);
    return data;
  },

  // ── form-as-code (import / export) ──
  importSpec: async (spec: Record<string, unknown>): Promise<ApAssessment> => {
    const { data } = await api.post(`${AP}/assessments/import`, spec);
    return data;
  },
  exportSpec: async (id: string): Promise<Record<string, unknown>> => {
    const { data } = await api.get(`${AP}/assessments/${id}/export`);
    return data;
  },

  // ── sections ──
  createSection: async (assessmentId: string, payload: Record<string, unknown>): Promise<ApSection> => {
    const { data } = await api.post(`${AP}/assessments/${assessmentId}/sections`, payload);
    return data;
  },
  updateSection: async (assessmentId: string, sectionId: string, payload: Record<string, unknown>): Promise<ApSection> => {
    const { data } = await api.patch(`${AP}/assessments/${assessmentId}/sections/${sectionId}`, payload);
    return data;
  },
  deleteSection: async (assessmentId: string, sectionId: string) => {
    const { data } = await api.delete(`${AP}/assessments/${assessmentId}/sections/${sectionId}`);
    return data;
  },
  reorderSections: async (assessmentId: string, orderedIds: string[]): Promise<ApAssessment> => {
    const { data } = await api.post(`${AP}/assessments/${assessmentId}/sections/reorder`, { orderedIds });
    return data;
  },

  // ── questions ──
  createQuestion: async (assessmentId: string, sectionId: string, payload: Record<string, unknown>): Promise<ApQuestion> => {
    const { data } = await api.post(`${AP}/assessments/${assessmentId}/sections/${sectionId}/questions`, payload);
    return data;
  },
  updateQuestion: async (assessmentId: string, questionId: string, payload: Record<string, unknown>): Promise<ApQuestion> => {
    const { data } = await api.patch(`${AP}/assessments/${assessmentId}/questions/${questionId}`, payload);
    return data;
  },
  deleteQuestion: async (assessmentId: string, questionId: string) => {
    const { data } = await api.delete(`${AP}/assessments/${assessmentId}/questions/${questionId}`);
    return data;
  },
  reorderQuestions: async (assessmentId: string, sectionId: string, orderedIds: string[]): Promise<ApAssessment> => {
    const { data } = await api.post(`${AP}/assessments/${assessmentId}/sections/${sectionId}/questions/reorder`, { orderedIds });
    return data;
  },
  addFromBank: async (assessmentId: string, sectionId: string, bankQuestionIds: string[]): Promise<ApAssessment> => {
    const { data } = await api.post(`${AP}/assessments/${assessmentId}/questions/from-bank`, { sectionId, bankQuestionIds });
    return data;
  },

  // ── question bank ──
  bankList: async (params?: { search?: string; tag?: string; includeArchived?: boolean }): Promise<ApQuestionBankItem[]> => {
    const { data } = await api.get(`${AP}/question-bank`, { params });
    return data;
  },
  bankCreate: async (payload: Record<string, unknown>): Promise<ApQuestionBankItem> => {
    const { data } = await api.post(`${AP}/question-bank`, payload);
    return data;
  },
  bankUpdate: async (id: string, payload: Record<string, unknown>): Promise<ApQuestionBankItem> => {
    const { data } = await api.patch(`${AP}/question-bank/${id}`, payload);
    return data;
  },
  bankArchive: async (id: string) => {
    const { data } = await api.delete(`${AP}/question-bank/${id}`);
    return data;
  },

  // ── assignments ──
  assignments: async (assessmentId: string): Promise<ApAssignment[]> => {
    const { data } = await api.get(`${AP}/assessments/${assessmentId}/assignments`);
    return data;
  },
  assignEmails: async (assessmentId: string, emails: string[], expiresInDays?: number): Promise<ApBulkAssignResult> => {
    const { data } = await api.post(`${AP}/assessments/${assessmentId}/assignments`, { emails, expiresInDays });
    return data;
  },
  assignCsv: async (assessmentId: string, file: File): Promise<ApBulkAssignResult> => {
    const form = new FormData();
    form.append("file", file);
    const { data } = await api.post(`${AP}/assessments/${assessmentId}/assignments/bulk`, form, {
      headers: { "Content-Type": "multipart/form-data" },
      timeout: 180_000,
    });
    return data;
  },
  resendInvite: async (assignmentId: string) => {
    const { data } = await api.post(`${AP}/assignments/${assignmentId}/resend`);
    return data;
  },
  revokeAssignment: async (assignmentId: string) => {
    const { data } = await api.post(`${AP}/assignments/${assignmentId}/revoke`);
    return data;
  },
  candidateAssignments: async (candidateId: string): Promise<ApAssignment[]> => {
    const { data } = await api.get(`${AP}/candidates/${candidateId}/assignments`);
    return data;
  },
  bypassCandidateAssessments: async (
    candidateId: string,
    payload: ApAssessmentBypassPayload,
  ): Promise<ApAssessmentBypassResult> => {
    const { data } = await api.post(`${AP}/candidates/${candidateId}/bypass`, payload);
    return data;
  },
  bulkBypassCandidates: async (file: File): Promise<ApBulkAssessmentBypassResult> => {
    const form = new FormData();
    form.append("file", file);
    const { data } = await api.post(`${AP}/candidates/bulk-bypass`, form, {
      headers: { "Content-Type": "multipart/form-data" },
      timeout: 180_000,
    });
    return data;
  },

  // ── taker ──
  myAssignments: async (): Promise<ApMyAssignment[]> => {
    const { data } = await api.get(`${AP}/me/assignments`);
    return data;
  },
  startAttempt: async (assignmentId: string): Promise<ApTakerAttempt> => {
    const { data } = await api.post(`${AP}/me/assignments/${assignmentId}/start`);
    return data;
  },
  saveAnswer: async (attemptId: string, questionId: string, payload: { response: Record<string, unknown> | null; clientRev: number }) => {
    const { data } = await api.patch(`${AP}/me/attempts/${attemptId}/answers/${questionId}`, payload);
    return data as { saved: boolean; questionId: string; clientRev: number; remainingSeconds?: number | null };
  },
  uploadAnswerFile: async (attemptId: string, questionId: string, file: File) => {
    const form = new FormData();
    form.append("file", file);
    const { data } = await api.post(`${AP}/me/attempts/${attemptId}/answers/${questionId}/file`, form, {
      headers: { "Content-Type": "multipart/form-data" },
      timeout: 180_000,
    });
    return data as { saved: boolean; fileName: string; fileUrl: string; remainingSeconds?: number | null };
  },
  heartbeat: async (attemptId: string) => {
    const { data } = await api.get(`${AP}/me/attempts/${attemptId}/remaining`);
    return data as { remainingSeconds?: number | null; status: string };
  },
  submitAttempt: async (attemptId: string): Promise<ApTakerAttempt> => {
    const { data } = await api.post(`${AP}/me/attempts/${attemptId}/submit`);
    return data;
  },
  proctoringEvent: async (attemptId: string, type: "tab_switch" | "fullscreen_exit" | "copy" | "blur") => {
    const { data } = await api.post(`${AP}/me/attempts/${attemptId}/proctoring`, { type });
    return data as { counts: ApProctoringCounts };
  },

  // ── grading ──
  gradingQueue: async (assessmentId?: string): Promise<ApAttemptSummary[]> => {
    const { data } = await api.get(`${AP}/grading/queue`, { params: assessmentId ? { assessmentId } : {} });
    return data;
  },
  attemptForGrading: async (attemptId: string): Promise<ApScorecard> => {
    const { data } = await api.get(`${AP}/grading/attempts/${attemptId}`);
    return data;
  },
  gradeAnswer: async (attemptId: string, questionId: string, payload: { marks: number; feedback?: string }): Promise<ApScorecard> => {
    const { data } = await api.patch(`${AP}/grading/attempts/${attemptId}/answers/${questionId}`, payload);
    return data;
  },
  finalizeGrading: async (attemptId: string): Promise<ApScorecard> => {
    const { data } = await api.post(`${AP}/grading/attempts/${attemptId}/finalize`);
    return data;
  },

  // ── results ──
  results: async (assessmentId: string, params?: { status?: string; page?: number; limit?: number }) => {
    const { data } = await api.get(`${AP}/assessments/${assessmentId}/results`, { params });
    return data as ApPaged<ApAttemptSummary> & { assessment: ApAssessment };
  },
  scorecard: async (attemptId: string): Promise<ApScorecard> => {
    const { data } = await api.get(`${AP}/attempts/${attemptId}/scorecard`);
    return data;
  },
  exportResultsCsv: async (assessmentId: string) => {
    const response = await api.get(`${AP}/assessments/${assessmentId}/results/export`, {
      responseType: "blob",
      timeout: 180_000,
    });
    downloadBlob(response.data as Blob, `assessment_results_${new Date().toISOString().slice(0, 10)}.csv`);
  },
  uploadResults: async (assessmentId: string, file: File): Promise<ApResultsUploadResult> => {
    const form = new FormData();
    form.append("file", file);
    const { data } = await api.post(`${AP}/assessments/${assessmentId}/results/upload`, form, {
      headers: { "Content-Type": "multipart/form-data" },
      timeout: 180_000,
    });
    return data;
  },
  releaseResults: async (assessmentId: string): Promise<{ released: number; skippedPending: number }> => {
    const { data } = await api.post(`${AP}/assessments/${assessmentId}/results/release`);
    return data;
  },
  releaseAttempt: async (attemptId: string): Promise<ApAttemptSummary> => {
    const { data } = await api.post(`${AP}/attempts/${attemptId}/release`);
    return data;
  },
};

// ─── Campus Drive ────────────────────────────────────────────────────────────

export const campusApi = {
  config: async (): Promise<{ enabled: boolean }> => {
    const { data } = await api.get("/candidates/campus/config");
    return data;
  },
  setConfig: async (enabled: boolean): Promise<{ enabled: boolean }> => {
    const { data } = await api.put("/candidates/campus/config", { enabled });
    return data;
  },
  register: async (form: FormData): Promise<{ candidateId: string; email: string; message: string }> => {
    const { data } = await api.post("/candidates/campus/register", form, {
      headers: { "Content-Type": "multipart/form-data" },
    });
    return data;
  },
  complete: async (form: FormData): Promise<{ candidateId: string; message: string }> => {
    const { data } = await api.post("/candidates/campus/complete", form, {
      headers: { "Content-Type": "multipart/form-data" },
      timeout: 180_000,
    });
    return data;
  },
};

// --- Penny Drop / Bank account verification --------------------------------

export type BankVerificationStatus = "pending" | "validated" | "failed" | "missing_details";

export type BankVerificationRow = {
  employeeProfileId: string;
  employeeCode: string;
  name: string;
  etharaEmail: string;
  bankName: string;
  ifsc: string;
  accountLast4: string;
  accountHolderName: string;
  hasBankDetails: boolean;
  isHdfc: boolean;
  status: BankVerificationStatus;
  remark: string | null;
  exportedAt: string | null;
  validatedAt: string | null;
};

export type BankVerificationUploadResult = {
  validated: number;
  failed: number;
  notFound: string[];
};

export const bankVerificationApi = {
  list: async (): Promise<BankVerificationRow[]> => {
    const { data } = await api.get("/bank-verification");
    return data;
  },
  exportSheet: async (includeValidated = false): Promise<void> => {
    const { data } = await api.get("/bank-verification/export", {
      params: { include_validated: includeValidated },
      responseType: "blob",
      timeout: 120_000,
    });
    downloadBlob(data as Blob, `penny_drop_bank_sheet_${new Date().toISOString().slice(0, 10)}.csv`);
  },
  downloadTemplate: async (): Promise<void> => {
    const { data } = await api.get("/bank-verification/results-template", {
      responseType: "blob",
    });
    downloadBlob(data as Blob, "penny_drop_results_template.csv");
  },
  uploadResults: async (file: File): Promise<BankVerificationUploadResult> => {
    const form = new FormData();
    form.append("file", file);
    const { data } = await api.post("/bank-verification/results/upload", form, {
      headers: { "Content-Type": "multipart/form-data" },
      timeout: 120_000,
    });
    return data;
  },
};

// ---------------------------------------------------------------------------
// Project Governance & Budget Management
// ---------------------------------------------------------------------------
export type ProjectLead = { id: string; userId: string; name: string | null; role: "tpm" | "pl" };

export type ProjectRecord = {
  id: string;
  internalName: string;
  externalName: string | null;
  client: string | null;
  platform: string | null;
  projectType: "technical" | "generalist";
  rfpStatus: string;
  deliveryStatus: string;
  appsheetApproval: string | null;
  trajectoryCostApproval: string | null;
  aht: number | null;
  targetVolume: number | null;
  deliveredVolume: number | null;
  dateOfDelivery: string | null;
  tpmUserId: string | null;
  tpmName: string | null;
  fteDemand: number | null;
  fteCount: number | null;
  internCount: number | null;
  totalMembers: number | null;
  approvedBudget: number;
  consumedBudget: number;
  remainingBudget: number;
  currency: string;
  isArchived: boolean;
  customFields: Record<string, unknown>;
  notes: string | null;
  leads: ProjectLead[];
  plNames: string[];
  latestBudgetStatus: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

export type ProjectOption = { id: string; internalName: string; externalName: string | null; client: string | null };

export type ProjectFieldDef = {
  id: string;
  key: string;
  label: string;
  dataType: "text" | "number" | "currency" | "date" | "select" | "boolean";
  options: string[];
  group: string | null;
  orderIndex: number;
  isActive: boolean;
};

export type ProjectBudgetRecord = {
  id: string;
  projectId: string;
  version: number;
  amount: number;
  currency: string;
  period: string | null;
  justification: string | null;
  status: string;
  proposedBy: string | null;
  proposedById: string | null;
  submittedAt: string | null;
  functionalApprover: string | null;
  functionalApproverId: string | null;
  functionalDecision: string | null;
  functionalDecidedBy: string | null;
  functionalDecidedAt: string | null;
  functionalComment: string | null;
  leadershipDecision: string | null;
  leadershipDecidedBy: string | null;
  leadershipDecidedAt: string | null;
  leadershipComment: string | null;
  createdAt: string | null;
  auditTrail: Array<{
    id: string; action: string; stage: string | null; fromStatus: string | null;
    toStatus: string | null; comment: string | null; performedBy: string | null;
    performedByRole: string | null; createdAt: string | null;
  }>;
};

export type ProjectAnalytics = {
  totals: {
    totalProjects: number; activeProjects: number; deliveredProjects: number;
    totalApprovedBudget: number; totalConsumedBudget: number; remainingBudget: number;
    technical: number; generalist: number;
  };
  projects: Array<{
    id: string; internalName: string; client: string | null; projectType: string;
    approvedBudget: number; consumedBudget: number; remainingBudget: number;
    memberCount: number; reimbursementCount: number; dinnerCount: number;
  }>;
  monthlyExpenseTrend: Array<{ month: string; spend: number }>;
  tpmPortfolio: Array<{ name: string; projects: number; budget: number }>;
  plPortfolio: Array<{ name: string; projects: number; budget: number }>;
  clientPortfolio: Array<{ name: string; projects: number; budget: number }>;
  typeBreakdown: Array<{ name: string; value: number }>;
};

export type ProjectLeadershipView = {
  totals: ProjectAnalytics["totals"];
  topCosting: ProjectAnalytics["projects"];
  profitability: Array<{
    id: string; internalName: string; approvedBudget: number;
    consumedBudget: number; remainingBudget: number; utilization: number;
  }>;
  approvalQueue: ProjectBudgetRecord[];
};

export type ProjectSettings = {
  approvers: { technicalUserId: string | null; generalistUserId: string | null };
  sla: { budgetApprovalSlaHours: number; expenseApprovalSlaHours: number };
  emailEnabled: boolean;
};

export type ProjectBulkUploadResult = {
  total: number; created: number; updated: number; rejected: number;
  errors: Array<{ row: number; error: string }>;
};

export const projectsApi = {
  list: async (params?: { includeArchived?: boolean; mine?: boolean }) => {
    const { data } = await api.get("/projects", { params });
    return data as ProjectRecord[];
  },
  options: async () => {
    const { data } = await api.get("/projects/options");
    return data as ProjectOption[];
  },
  get: async (id: string) => {
    const { data } = await api.get(`/projects/${id}`);
    return data as ProjectRecord;
  },
  create: async (payload: Record<string, unknown>) => {
    const { data } = await api.post("/projects", payload);
    return data as ProjectRecord;
  },
  update: async (id: string, payload: Record<string, unknown>) => {
    const { data } = await api.patch(`/projects/${id}`, payload);
    return data as ProjectRecord;
  },
  archive: async (id: string, unarchive = false) => {
    const { data } = await api.post(`/projects/${id}/archive`, null, { params: { unarchive } });
    return data as ProjectRecord;
  },
  fieldDefs: async (includeInactive = false) => {
    const { data } = await api.get("/projects/field-defs/all", { params: { includeInactive } });
    return data as ProjectFieldDef[];
  },
  createFieldDef: async (payload: Record<string, unknown>) => {
    const { data } = await api.post("/projects/field-defs", payload);
    return data as ProjectFieldDef;
  },
  updateFieldDef: async (id: string, payload: Record<string, unknown>) => {
    const { data } = await api.patch(`/projects/field-defs/${id}`, payload);
    return data as ProjectFieldDef;
  },
  deleteFieldDef: async (id: string) => {
    await api.delete(`/projects/field-defs/${id}`);
  },
  reorderFieldDefs: async (orderedIds: string[]) => {
    const { data } = await api.post("/projects/field-defs/reorder", { orderedIds });
    return data as ProjectFieldDef[];
  },
  budgets: async (projectId: string) => {
    const { data } = await api.get(`/projects/${projectId}/budgets`);
    return data as ProjectBudgetRecord[];
  },
  createBudget: async (projectId: string, payload: { amount: number; currency?: string; period?: string; justification?: string }) => {
    const { data } = await api.post(`/projects/${projectId}/budgets`, payload);
    return data as ProjectBudgetRecord;
  },
  updateBudget: async (budgetId: string, payload: Record<string, unknown>) => {
    const { data } = await api.patch(`/projects/budgets/${budgetId}`, payload);
    return data as ProjectBudgetRecord;
  },
  submitBudget: async (budgetId: string) => {
    const { data } = await api.post(`/projects/budgets/${budgetId}/submit`);
    return data as ProjectBudgetRecord;
  },
  functionalDecision: async (budgetId: string, action: "approve" | "reject", comment?: string) => {
    const { data } = await api.post(`/projects/budgets/${budgetId}/functional-decision`, { action, comment });
    return data as ProjectBudgetRecord;
  },
  leadershipDecision: async (budgetId: string, action: "approve" | "reject", comment?: string) => {
    const { data } = await api.post(`/projects/budgets/${budgetId}/leadership-decision`, { action, comment });
    return data as ProjectBudgetRecord;
  },
  analytics: async () => {
    const { data } = await api.get("/projects/analytics/summary");
    return data as ProjectAnalytics;
  },
  leadership: async () => {
    const { data } = await api.get("/projects/analytics/leadership");
    return data as ProjectLeadershipView;
  },
  settings: async () => {
    const { data } = await api.get("/projects/settings/config");
    return data as ProjectSettings;
  },
  setApprovers: async (payload: { technicalUserId: string | null; generalistUserId: string | null }) => {
    const { data } = await api.put("/projects/settings/approvers", payload);
    return data as ProjectSettings;
  },
  setSla: async (payload: { budgetApprovalSlaHours?: number; expenseApprovalSlaHours?: number }) => {
    const { data } = await api.put("/projects/settings/sla", payload);
    return data as ProjectSettings;
  },
  runEscalations: async () => {
    const { data } = await api.post("/projects/escalations/run");
    return data as { pending: number; escalated: number };
  },
  bulkUpload: async (file: File) => {
    const form = new FormData();
    form.append("file", file);
    const { data } = await api.post("/projects/bulk-upload", form, {
      headers: { "Content-Type": "multipart/form-data" },
      timeout: 120_000,
    });
    return data as ProjectBulkUploadResult;
  },
  exportFile: async (format: "csv" | "xlsx" = "csv") => {
    const response = await api.get("/projects/export/file", { params: { format }, responseType: "blob" });
    const ext = format === "xlsx" ? "xlsx" : "csv";
    downloadBlob(response.data as Blob, `projects_${new Date().toISOString().slice(0, 10)}.${ext}`);
  },
};

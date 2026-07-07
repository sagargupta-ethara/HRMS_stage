import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./api-client", () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

import api from "./api-client";
import { assessmentPlatformApi, authApi, candidatesApi, employeesApi } from "./api";

const mockApi = vi.mocked(api);

describe("api wrappers", () => {
  beforeEach(() => {
    mockApi.get.mockResolvedValue({ data: {} });
    mockApi.post.mockResolvedValue({ data: {} });
    mockApi.patch.mockResolvedValue({ data: {} });
    mockApi.delete.mockResolvedValue({ data: {} });
  });

  it("normalizes auth emails before login and password reset requests", async () => {
    mockApi.post.mockResolvedValueOnce({ data: { accessToken: "token" } });

    await authApi.login("  HR@Ethara.AI  ", "secret");

    expect(mockApi.post).toHaveBeenCalledWith(
      "/auth/login",
      { email: "hr@ethara.ai", password: "secret" },
      { _skipRetry: true },
    );

    await authApi.requestPasswordReset(" USER@Example.COM ");
    expect(mockApi.post).toHaveBeenLastCalledWith("/auth/password-reset/request", {
      email: "user@example.com",
    });
  });

  it("uses Documenso employee compliance endpoints", async () => {
    mockApi.get.mockResolvedValueOnce({ data: [{ id: "form-1" }] });
    mockApi.post.mockResolvedValue({ data: [{ id: "form-1", status: "sent" }] });

    await employeesApi.listMyCompliance();
    await employeesApi.refreshMyComplianceEsign();
    await employeesApi.sendComplianceEsign("emp-001");

    expect(mockApi.get).toHaveBeenCalledWith("/employees/me/compliance");
    expect(mockApi.post).toHaveBeenCalledWith("/employees/me/compliance/refresh-esign");
    expect(mockApi.post).toHaveBeenCalledWith("/employees/emp-001/compliance/send-esign");
  });

  it("posts employee self compliance submissions in the legacy-safe shape", async () => {
    await employeesApi.submitMyCompliance("form-1", { acknowledgement: true });

    expect(mockApi.post).toHaveBeenCalledWith(
      "/employees/me/compliance/form-1/submit",
      { formData: { acknowledgement: true } },
    );
  });

  it("configures candidate OCR uploads without Gemini-specific behavior", async () => {
    const form = new FormData();

    await candidatesApi.extractAadhaar(form);
    await candidatesApi.extractPan(form);
    await candidatesApi.extractAddress(form);

    expect(mockApi.post).toHaveBeenCalledWith("/candidates/aadhaar/ocr", form, {
      headers: { "Content-Type": "multipart/form-data" },
      timeout: 60_000,
    });
    expect(mockApi.post).toHaveBeenCalledWith("/candidates/pan/ocr", form, {
      headers: { "Content-Type": "multipart/form-data" },
      timeout: 60_000,
    });
    expect(mockApi.post).toHaveBeenCalledWith("/candidates/address/ocr", form, {
      headers: { "Content-Type": "multipart/form-data" },
      timeout: 60_000,
    });
  });

  it("keeps assessment result release operations separate from upload", async () => {
    const csv = new File(["email,score\ncandidate@example.com,12\n"], "results.csv", {
      type: "text/csv",
    });

    await assessmentPlatformApi.uploadResults("assessment-1", csv);
    await assessmentPlatformApi.releaseResults("assessment-1");
    await assessmentPlatformApi.releaseAttempt("attempt-1");

    expect(mockApi.post).toHaveBeenCalledWith(
      "/assessment-platform/assessments/assessment-1/results/upload",
      expect.any(FormData),
      {
        headers: { "Content-Type": "multipart/form-data" },
        timeout: 180_000,
      },
    );
    expect(mockApi.post).toHaveBeenCalledWith(
      "/assessment-platform/assessments/assessment-1/results/release",
    );
    expect(mockApi.post).toHaveBeenCalledWith(
      "/assessment-platform/attempts/attempt-1/release",
    );
  });
});

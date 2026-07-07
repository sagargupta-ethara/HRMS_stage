import { screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import EmployeeCompliancePage from "./page";
import { renderWithQueryClient } from "@/test/render";
import { employeesApi } from "@/lib/api";

const useEmployeeDashboard = vi.fn();

vi.mock("@/lib/queries", () => ({
  useEmployeeDashboard: () => useEmployeeDashboard(),
}));

vi.mock("@/lib/api", () => ({
  employeesApi: {
    refreshMyComplianceEsign: vi.fn().mockResolvedValue([]),
  },
}));

describe("EmployeeCompliancePage", () => {
  it("renders only Documenso-backed compliance forms for existing employees", async () => {
    useEmployeeDashboard.mockReturnValue({
      isLoading: false,
      isError: false,
      data: {
        complianceForms: [
          {
            id: "form-11",
            formType: "form_11",
            formTitle: "Form 11",
            status: "sent",
            documensoId: "doc-11",
            signedUrl: "https://documenso.example/sign/form-11",
            sentAt: "2026-06-07T09:00:00.000Z",
          },
          {
            id: "manual-posh",
            formType: "posh",
            formTitle: "POSH Declaration",
            status: "pending",
            documensoId: null,
          },
          {
            id: "form-2",
            formType: "form_2",
            formTitle: "Form 2",
            status: "signed",
            documensoId: "doc-2",
            pdfUrl: "https://documenso.example/form-2.pdf",
            signedAt: "2026-06-07T10:00:00.000Z",
          },
        ],
      },
    });

    renderWithQueryClient(<EmployeeCompliancePage />);

    expect(screen.getByText("Compliance & Statutory Forms")).toBeInTheDocument();
    expect(screen.getByText("1/2 Signed")).toBeInTheDocument();
    expect(screen.getByText("Form 11")).toBeInTheDocument();
    expect(screen.getByText("Form 2")).toBeInTheDocument();
    expect(screen.queryByText("POSH Declaration")).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/uan/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/bank name/i)).not.toBeInTheDocument();

    expect(screen.getByRole("link", { name: /open & sign/i })).toHaveAttribute(
      "href",
      "https://documenso.example/sign/form-11",
    );
    expect(screen.getByRole("link", { name: /download/i })).toHaveAttribute(
      "href",
      "https://documenso.example/form-2.pdf",
    );

    await waitFor(() => {
      expect(employeesApi.refreshMyComplianceEsign).toHaveBeenCalledTimes(1);
    });
  });

  it("shows a clear no-forms state when HR has not assigned Documenso forms", () => {
    useEmployeeDashboard.mockReturnValue({
      isLoading: false,
      isError: false,
      data: {
        complianceForms: [],
      },
    });

    renderWithQueryClient(<EmployeeCompliancePage />);

    expect(screen.getByText("No compliance forms yet")).toBeInTheDocument();
    expect(screen.getByText(/Documenso forms will appear here/i)).toBeInTheDocument();
    expect(employeesApi.refreshMyComplianceEsign).not.toHaveBeenCalled();
  });

  it("marks all Documenso forms complete when every assigned form is signed or verified", () => {
    useEmployeeDashboard.mockReturnValue({
      isLoading: false,
      isError: false,
      data: {
        complianceForms: [
          {
            id: "form-11",
            formType: "form_11",
            formTitle: "Form 11",
            status: "signed",
            documensoId: "doc-11",
          },
          {
            id: "form-f",
            formType: "form_f",
            formTitle: "Form F",
            status: "verified",
            documensoId: "doc-f",
          },
        ],
      },
    });

    renderWithQueryClient(<EmployeeCompliancePage />);

    expect(screen.getByText("2/2 Signed")).toBeInTheDocument();
    expect(screen.getByText("All assigned statutory forms are signed.")).toBeInTheDocument();
  });

  it("renders loading and error states", () => {
    useEmployeeDashboard.mockReturnValueOnce({
      isLoading: true,
      isError: false,
      data: null,
    });

    const { unmount } = renderWithQueryClient(<EmployeeCompliancePage />);
    expect(document.querySelectorAll(".animate-shimmer").length).toBeGreaterThan(0);
    unmount();

    useEmployeeDashboard.mockReturnValueOnce({
      isLoading: false,
      isError: true,
      data: null,
    });
    renderWithQueryClient(<EmployeeCompliancePage />);
    expect(screen.getByText("Could not load compliance data.")).toBeInTheDocument();
  });
});

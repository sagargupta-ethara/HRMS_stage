import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { GeneralApplicationsCard } from "./general-applications-card";
import { renderWithQueryClient } from "@/test/render";
import { careerApplicationsApi } from "@/lib/api";

vi.mock("@/lib/api", () => ({
  careerApplicationsApi: {
    list: vi.fn(),
    downloadResume: vi.fn(),
    exportCsv: vi.fn(),
  },
}));

const mockApi = vi.mocked(careerApplicationsApi);

const application = {
  id: "app-1",
  fullName: "General Applicant",
  email: "general@example.com",
  phone: "9876543210",
  portfolioUrl: "https://portfolio.example.com",
  resumeFileName: "general-resume.pdf",
  resumeUrl: "/uploads/general-resume.pdf",
  status: "new",
  createdAt: "2026-06-07T09:00:00.000Z",
  updatedAt: "2026-06-07T09:00:00.000Z",
};

const makeApplication = (index: number) => ({
  ...application,
  id: `app-${index}`,
  fullName: `Applicant ${index}`,
  email: `applicant${index}@example.com`,
});

describe("GeneralApplicationsCard", () => {
  beforeEach(() => {
    mockApi.list.mockReset();
    mockApi.downloadResume.mockReset();
    mockApi.exportCsv.mockReset();
  });

  it("shows an empty state when no general applications exist", async () => {
    mockApi.list.mockResolvedValue([]);

    renderWithQueryClient(<GeneralApplicationsCard />);

    expect(await screen.findByText("No applications yet")).toBeInTheDocument();
    expect(mockApi.list).toHaveBeenCalledWith(21, 0);
  });

  it("renders applications and handles resume download, export, and refresh", async () => {
    const user = userEvent.setup();
    mockApi.list.mockResolvedValue([application]);
    mockApi.downloadResume.mockResolvedValue(undefined);
    mockApi.exportCsv.mockResolvedValue(undefined);

    renderWithQueryClient(<GeneralApplicationsCard />);

    expect(await screen.findByText("General Applicant")).toBeInTheDocument();
    expect(screen.getByText("general@example.com - 9876543210")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /portfolio/i })).toHaveAttribute(
      "href",
      "https://portfolio.example.com",
    );

    await user.click(screen.getByRole("button", { name: /resume/i }));
    expect(mockApi.downloadResume).toHaveBeenCalledWith("app-1", "general-resume.pdf");

    await user.click(screen.getByRole("button", { name: /export/i }));
    expect(mockApi.exportCsv).toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: /refresh/i }));
    await waitFor(() => expect(mockApi.list).toHaveBeenCalledTimes(2));
  });

  it("shows applications in 20-resume batches with next and previous controls", async () => {
    const user = userEvent.setup();
    const firstBatch = Array.from({ length: 21 }, (_, index) => makeApplication(index + 1));
    const secondBatch = [makeApplication(21), makeApplication(22)];
    mockApi.list.mockImplementation((_limit, offset) =>
      Promise.resolve(offset === 20 ? secondBatch : firstBatch),
    );

    renderWithQueryClient(<GeneralApplicationsCard />);

    expect(await screen.findByText("Applicant 1")).toBeInTheDocument();
    expect(screen.getByText("Applicant 20")).toBeInTheDocument();
    expect(screen.queryByText("Applicant 21")).not.toBeInTheDocument();
    expect(screen.getByText("Page 1 · Showing 1-20 · 20 resumes per page")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /next/i }));

    expect(await screen.findByText("Applicant 21")).toBeInTheDocument();
    expect(screen.getByText("Applicant 22")).toBeInTheDocument();
    expect(screen.getByText("Page 2 · Showing 21-22 · 20 resumes per page")).toBeInTheDocument();
    expect(mockApi.list).toHaveBeenCalledWith(21, 20);
    expect(screen.getByRole("button", { name: /next/i })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: /previous/i }));
    expect(await screen.findByText("Applicant 1")).toBeInTheDocument();
  });
});

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import MyAssessmentsPage from "./page";

const push = vi.fn();
const useMyAssignments = vi.fn();
const useAuth = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

vi.mock("@/lib/queries", () => ({
  useMyAssignments: () => useMyAssignments(),
}));

vi.mock("@/lib/auth-context", () => ({
  useAuth: () => useAuth(),
}));

function arrange(assignments: unknown[], profile: unknown = { type: "candidate" }) {
  useMyAssignments.mockReturnValue({ data: assignments, isLoading: false });
  useAuth.mockReturnValue({ profile });
}

describe("MyAssessmentsPage", () => {
  it("shows an empty state when nothing is assigned", () => {
    arrange([]);

    render(<MyAssessmentsPage />);

    expect(screen.getByText("No assessments assigned to you right now.")).toBeInTheDocument();
  });

  it("keeps submitted unreleased results under review without showing fail/pass or score", () => {
    arrange([
      {
        assignmentId: "assignment-1",
        title: "Backend Assessment",
        description: "API and database",
        timeLimitMinutes: 30,
        attemptsUsed: 1,
        attemptsAllowed: 1,
        attempt: {
          status: "graded",
          released: false,
          resultStatus: "fail",
          totalScore: 15,
          maxScore: 16,
        },
      },
    ]);

    render(<MyAssessmentsPage />);

    expect(screen.getByText("Backend Assessment")).toBeInTheDocument();
    expect(screen.getByText("Under review")).toBeInTheDocument();
    expect(screen.queryByText("Fail")).not.toBeInTheDocument();
    expect(screen.queryByText("15/16")).not.toBeInTheDocument();
  });

  it("shows released results and lets a campus candidate complete registration after passing", async () => {
    const user = userEvent.setup();
    arrange(
      [
        {
          assignmentId: "assignment-1",
          title: "Campus Assessment",
          attemptsUsed: 1,
          attemptsAllowed: 1,
          attempt: {
            status: "graded",
            released: true,
            resultStatus: "pass",
            totalScore: 14,
            maxScore: 16,
          },
        },
      ],
      { type: "candidate", campusLock: true },
    );

    render(<MyAssessmentsPage />);

    expect(screen.getByText("Pass")).toBeInTheDocument();
    expect(screen.getByText("14/16")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /complete registration/i }));
    expect(push).toHaveBeenCalledWith("/candidate/complete-registration");
  });

  it("routes start, resume, and retake actions to the assigned assessment", async () => {
    const user = userEvent.setup();
    arrange([
      {
        assignmentId: "new-assignment",
        title: "Fresh Test",
        attemptsUsed: 0,
        attemptsAllowed: 2,
        attempt: null,
      },
      {
        assignmentId: "resume-assignment",
        title: "Resume Test",
        attemptsUsed: 1,
        attemptsAllowed: 2,
        attempt: { status: "in_progress", released: false, resultStatus: null },
      },
      {
        assignmentId: "retake-assignment",
        title: "Retake Test",
        attemptsUsed: 1,
        attemptsAllowed: 2,
        attempt: { status: "submitted", released: false, resultStatus: null },
      },
    ]);

    render(<MyAssessmentsPage />);

    await user.click(screen.getByRole("button", { name: "Start" }));
    await user.click(screen.getByRole("button", { name: "Resume" }));
    await user.click(screen.getByRole("button", { name: "Retake" }));

    expect(push).toHaveBeenNthCalledWith(1, "/portal/my-assessments/new-assignment");
    expect(push).toHaveBeenNthCalledWith(2, "/portal/my-assessments/resume-assignment");
    expect(push).toHaveBeenNthCalledWith(3, "/portal/my-assessments/retake-assignment");
  });
});

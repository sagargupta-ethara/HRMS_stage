import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AttemptPlayer } from "./attempt-player";
import type { ApTakerAttempt } from "@/lib/api";

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    info: vi.fn(),
  },
}));

const baseAttempt: ApTakerAttempt = {
  attemptId: "attempt-1",
  assignmentId: "assignment-1",
  assessmentId: "assessment-1",
  title: "Backend Assessment",
  instructions: null,
  status: "submitted",
  timeLimitMinutes: 30,
  remainingSeconds: null,
  showResultsToCandidate: true,
  consentText: null,
  proctoring: null,
  proctoringCounts: null,
  answers: {},
  sections: [
    {
      id: "section-1",
      title: "Core",
      instructions: null,
      lockAfterLeave: false,
      questions: [],
    },
  ],
  result: null,
};

function resultSummary(released: boolean) {
  return {
    id: "attempt-1",
    assignmentId: "assignment-1",
    assessmentId: "assessment-1",
    userId: "candidate-1",
    status: "graded" as const,
    released,
    resultReleased: released,
    resultStatus: "fail" as const,
    totalScore: 15,
    maxScore: 16,
    percentage: 93.75,
  };
}

describe("AttemptPlayer result visibility", () => {
  it("hides fail/pass and score until HR releases the result", () => {
    render(
      <AttemptPlayer
        initial={{
          ...baseAttempt,
          result: resultSummary(false),
        }}
        onExit={vi.fn()}
      />,
    );

    expect(screen.getByText("Assessment submitted")).toBeInTheDocument();
    expect(screen.getByText(/under review/i)).toBeInTheDocument();
    expect(screen.queryByText("Fail")).not.toBeInTheDocument();
    expect(screen.queryByText("15/16")).not.toBeInTheDocument();
  });

  it("shows verdict and score after release", () => {
    render(
      <AttemptPlayer
        initial={{
          ...baseAttempt,
          result: resultSummary(true),
        }}
        onExit={vi.fn()}
      />,
    );

    expect(screen.getByText("Fail")).toBeInTheDocument();
    expect(screen.getByText("15/16")).toBeInTheDocument();
    expect(screen.getByText("(93.75%)")).toBeInTheDocument();
  });
});

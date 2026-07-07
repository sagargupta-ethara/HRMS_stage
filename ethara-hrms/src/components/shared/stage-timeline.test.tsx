import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { StageBadge, StageTimeline } from "./stage-timeline";

describe("StageTimeline", () => {
  it("renders the ordered candidate journey with the current stage label", () => {
    render(<StageTimeline currentStage="contract_signed" />);

    expect(screen.getByText("New Application")).toBeInTheDocument();
    expect(screen.getByText("Contract Signed")).toBeInTheDocument();
    expect(screen.getByText("Onboarding Completed")).toBeInTheDocument();
  });

  it("renders compact progress bars without textual noise", () => {
    const { container } = render(<StageTimeline currentStage="evaluation_passed" compact />);

    expect(screen.queryByText("Evaluation")).not.toBeInTheDocument();
    expect(container.querySelectorAll(".h-1\\.5").length).toBe(8);
  });

  it("renders known and rejected stage badges with readable labels", () => {
    render(
      <div>
        <StageBadge stage="statutory_forms_sent" />
        <StageBadge stage="evaluation_failed" />
      </div>,
    );

    expect(screen.getByText("Statutory Forms Sent")).toBeInTheDocument();
    expect(screen.getByText("Evaluation Failed")).toBeInTheDocument();
  });
});

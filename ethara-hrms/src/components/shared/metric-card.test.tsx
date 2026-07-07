import { render, screen } from "@testing-library/react";
import { Users } from "lucide-react";
import { describe, expect, it } from "vitest";

import { MetricCard, MetricGrid } from "./metric-card";

describe("MetricCard", () => {
  it("formats values and positive, negative, and flat changes", () => {
    render(
      <MetricGrid
        columns={3}
        metrics={[
          { label: "Applications", value: 12500, change: 12, changeLabel: "month", color: "primary", icon: Users },
          { label: "Drop-offs", value: 30, change: -5, color: "destructive", icon: Users },
          { label: "Stable", value: 7, change: 0, color: "info", icon: Users },
        ]}
      />,
    );

    expect(screen.getByText("Applications")).toBeInTheDocument();
    expect(screen.getByText("12,500")).toBeInTheDocument();
    expect(screen.getByText("+12% month")).toBeInTheDocument();
    expect(screen.getByText("-5% vs last week")).toBeInTheDocument();
    expect(screen.getByText("0% vs last week")).toBeInTheDocument();
  });

  it("renders without a change row when change is not supplied", () => {
    render(<MetricCard metric={{ label: "Open Roles", value: 4, color: "success" }} icon={Users} />);

    expect(screen.getByText("Open Roles")).toBeInTheDocument();
    expect(screen.getByText("4")).toBeInTheDocument();
    expect(screen.queryByText(/vs last week/i)).not.toBeInTheDocument();
  });
});

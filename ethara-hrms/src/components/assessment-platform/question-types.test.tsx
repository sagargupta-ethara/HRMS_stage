import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  ApStatusBadge,
  correctAnswerText,
  defaultConfigFor,
  summarizeResponse,
} from "./question-types";

describe("assessment question helpers", () => {
  it("creates sensible default configs for auto, manual, upload, and survey questions", () => {
    expect(defaultConfigFor("mcq_single")).toMatchObject({
      correctOptionId: null,
    });
    expect(defaultConfigFor("mcq_multi")).toMatchObject({
      correctOptionIds: [],
      partialMarking: false,
    });
    expect(defaultConfigFor("short_answer")).toEqual({
      acceptedAnswers: [],
      matchMode: "manual",
    });
    expect(defaultConfigFor("file_upload")).toEqual({ maxSizeMb: 10 });
    expect(defaultConfigFor("rating")).toEqual({ scaleMin: 1, scaleMax: 5 });
  });

  it("summarizes candidate responses for every important question family", () => {
    const config = {
      options: [
        { id: "a", text: "Alpha" },
        { id: "b", text: "Beta" },
      ],
    };

    expect(summarizeResponse("mcq_single", { optionId: "b" }, config)).toBe("Beta");
    expect(summarizeResponse("mcq_multi", { optionIds: ["a", "b"] }, config)).toBe("Alpha, Beta");
    expect(summarizeResponse("true_false", { value: false }, {})).toBe("False");
    expect(summarizeResponse("rating", { value: 4 }, {})).toBe("4");
    expect(summarizeResponse("url_submission", { url: "https://example.com" }, {})).toBe("https://example.com");
    expect(summarizeResponse("consent", { value: true }, {})).toBe("Agreed");
    expect(summarizeResponse("short_answer", { text: "Written answer" }, {})).toBe("Written answer");
    expect(summarizeResponse("short_answer", null, {})).toBe("—");
  });

  it("derives correct answer text without exposing unavailable answers", () => {
    const config = {
      options: [
        { id: "a", text: "Alpha" },
        { id: "b", text: "Beta" },
      ],
      correctOptionId: "a",
      correctOptionIds: ["a", "b"],
      correct: false,
      acceptedAnswers: ["yes", "y"],
    };

    expect(correctAnswerText("mcq_single", config)).toBe("Alpha");
    expect(correctAnswerText("mcq_multi", config)).toBe("Alpha, Beta");
    expect(correctAnswerText("true_false", config)).toBe("False");
    expect(correctAnswerText("short_answer", config)).toBe("yes / y");
    expect(correctAnswerText("long_answer", config)).toBeNull();
  });

  it("renders status badges with product labels", () => {
    render(
      <div>
        <ApStatusBadge status="pass" />
        <ApStatusBadge status="fail" />
        <ApStatusBadge status="pending" />
        <ApStatusBadge status="custom_status" />
      </div>,
    );

    expect(screen.getByText("Pass")).toBeInTheDocument();
    expect(screen.getByText("Fail")).toBeInTheDocument();
    expect(screen.getByText("Grading pending")).toBeInTheDocument();
    expect(screen.getByText("Custom Status")).toBeInTheDocument();
  });
});

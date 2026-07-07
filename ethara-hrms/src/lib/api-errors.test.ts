import { describe, expect, it } from "vitest";

import { apiErrorMessage } from "./api-errors";

describe("apiErrorMessage", () => {
  it("returns string error details", () => {
    const error = { response: { data: { detail: "Invalid verification code." } } };

    expect(apiErrorMessage(error, "Fallback")).toBe("Invalid verification code.");
  });

  it("returns pydantic validation messages without value-error prefixes", () => {
    const error = {
      response: {
        data: {
          detail: [
            { msg: "Value error, Password is too common. Please choose a stronger password." },
          ],
        },
      },
    };

    expect(apiErrorMessage(error, "Fallback")).toBe(
      "Password is too common. Please choose a stronger password.",
    );
  });

  it("falls back when no useful detail is available", () => {
    expect(apiErrorMessage({}, "Fallback")).toBe("Fallback");
  });
});

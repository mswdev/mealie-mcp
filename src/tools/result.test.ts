import { describe, expect, it } from "vitest";
import { MealieApiError } from "../client/MealieApiError.js";
import { errorResult, jsonResult, secretSafeErrorResult } from "./result.js";

function text(r: { content: { type: string }[] }): string {
  return (r.content[0] as { type: "text"; text: string }).text;
}

describe("jsonResult", () => {
  it("wraps data as pretty-printed JSON text content", () => {
    const r = jsonResult({ a: 1 });

    expect(r.isError).toBeUndefined();
    expect(text(r)).toBe('{\n  "a": 1\n}');
  });
});

describe("errorResult", () => {
  it("returns an isError result carrying the error message", () => {
    const r = errorResult(new Error("boom"), "recipe_create", "Failed to create recipe");

    expect(r.isError).toBe(true);
    expect(text(r)).toBe("Failed to create recipe: boom");
  });

  it("stringifies non-Error thrown values", () => {
    const r = errorResult("weird", "x", "Failed");

    expect(text(r)).toBe("Failed: weird");
  });
});

describe("secretSafeErrorResult", () => {
  it("surfaces the HTTP status but never the upstream body (Pydantic echoes rejected input)", () => {
    const error = new MealieApiError(
      422,
      "Unprocessable Entity",
      "/api/users/password",
      '{"detail":[{"msg":"too short","input":"pw-secret"}]}',
    );

    const r = secretSafeErrorResult(error, "user_password_write", "Password operation failed");

    expect(r.isError).toBe(true);
    expect(text(r)).toBe("Password operation failed (HTTP 422 Unprocessable Entity)");
    expect(text(r)).not.toContain("pw-secret");
  });

  it("never surfaces a non-API error's message (JSON.parse errors embed body snippets)", () => {
    const r = secretSafeErrorResult(
      new SyntaxError('Unexpected token, "pw-secret" is not valid JSON'),
      "user_register",
      "Registration failed",
    );

    expect(r.isError).toBe(true);
    expect(text(r)).toBe("Registration failed (SyntaxError)");
    expect(text(r)).not.toContain("pw-secret");
  });

  it("labels non-Error thrown values generically", () => {
    const r = secretSafeErrorResult("pw-secret leaked raw", "x", "Failed");

    expect(text(r)).toBe("Failed (unknown error)");
  });
});

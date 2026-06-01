import { describe, expect, it } from "vitest";
import { errorResult, jsonResult } from "./result.js";

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

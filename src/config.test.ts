import { describe, expect, it } from "vitest";
import { parseReadOnly, parseToolsets } from "./config.js";

describe("parseReadOnly", () => {
  it.each([
    ["true", true],
    ["1", true],
    ["yes", true],
    ["on", true],
    ["TRUE", true],
    ["  true  ", true],
    ["false", false],
    ["0", false],
    ["", false],
    [undefined, false],
  ])("maps %s -> %s", (input, expected) => {
    expect(parseReadOnly(input)).toBe(expected);
  });
});

describe("parseToolsets", () => {
  it("returns an empty set when unset or empty", () => {
    expect(parseToolsets(undefined).size).toBe(0);
    expect(parseToolsets("").size).toBe(0);
    expect(parseToolsets("  ,  ").size).toBe(0);
  });

  it("enables both recognized toolsets", () => {
    const enabled = parseToolsets("households,automation");

    expect(enabled.has("households")).toBe(true);
    expect(enabled.has("automation")).toBe(true);
    expect(enabled.size).toBe(2);
  });

  it("is case-insensitive, trims whitespace, and de-duplicates", () => {
    const enabled = parseToolsets(" Households , AUTOMATION , households ");

    expect([...enabled].sort()).toEqual(["automation", "households"]);
  });

  it("ignores unknown tokens while keeping valid ones (no throw)", () => {
    const enabled = parseToolsets("households,bogus");

    expect(enabled.has("households")).toBe(true);
    expect(enabled.size).toBe(1);
  });

  it("enables the groups toolset, alone and alongside the others", () => {
    expect(parseToolsets("groups")).toEqual(new Set(["groups"]));
    expect(parseToolsets("households,automation,groups")).toEqual(
      new Set(["households", "automation", "groups"]),
    );
  });
});

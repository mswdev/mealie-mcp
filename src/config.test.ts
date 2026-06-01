import { describe, expect, it } from "vitest";
import { parseReadOnly } from "./config.js";

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

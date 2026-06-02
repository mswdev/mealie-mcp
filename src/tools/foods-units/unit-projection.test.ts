import { describe, expect, it } from "vitest";
import { type UnitDetail, projectUnit } from "./unit-projection.js";

const full = {
  id: "u1",
  name: "tablespoon",
  pluralName: "tablespoons",
  abbreviation: "tbsp",
  useAbbreviation: true,
  fraction: true,
  description: "spoon",
  extras: { x: 1 },
  aliases: [{ name: "T" }],
  standardQuantity: 15,
} as unknown as UnitDetail;

describe("projectUnit", () => {
  it("concise keeps only the key fields", () => {
    expect(projectUnit(full, "concise")).toEqual({
      id: "u1",
      name: "tablespoon",
      pluralName: "tablespoons",
      abbreviation: "tbsp",
      useAbbreviation: true,
      fraction: true,
      description: "spoon",
    });
  });

  it("detailed returns the whole object", () => {
    expect(projectUnit(full, "detailed")).toBe(full);
  });
});

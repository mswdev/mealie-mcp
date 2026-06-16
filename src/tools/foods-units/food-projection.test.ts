import { describe, expect, it } from "vitest";
import { type FoodDetail, projectFood } from "./food-projection.js";

const full = {
  id: "f1",
  name: "Flour",
  pluralName: "Flours",
  description: "all-purpose",
  labelId: "l1",
  extras: { x: 1 },
  aliases: [{ name: "plain flour" }],
  householdsWithIngredientFood: ["h1"],
} as unknown as FoodDetail;

describe("projectFood", () => {
  it("concise keeps only the key fields", () => {
    expect(projectFood(full, "concise")).toEqual({
      id: "f1",
      name: "Flour",
      pluralName: "Flours",
      description: "all-purpose",
      labelId: "l1",
    });
  });

  it("detailed returns the whole object", () => {
    expect(projectFood(full, "detailed")).toBe(full);
  });
});

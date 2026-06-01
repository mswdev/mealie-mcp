import { describe, expect, it } from "vitest";
import { projectRecipe } from "./recipe-projection.js";

const FULL = {
  id: "u1",
  slug: "soup",
  name: "Soup",
  description: "d",
  recipeIngredient: [{ note: "salt" }],
  recipeInstructions: [{ text: "boil" }],
  nutrition: { calories: "100" },
  comments: [{ text: "yum" }],
} as never;

describe("projectRecipe", () => {
  it("concise keeps light fields, drops heavy ones", () => {
    const r = projectRecipe(FULL, "concise", []);

    expect(r.id).toBe("u1");
    expect(r.slug).toBe("soup");
    expect(r.name).toBe("Soup");
    expect(r.recipeIngredient).toBeUndefined();
    expect(r.nutrition).toBeUndefined();
  });

  it("include adds back requested heavy fields onto the concise view", () => {
    const r = projectRecipe(FULL, "concise", ["nutrition", "comments"]);

    expect(r.nutrition).toEqual({ calories: "100" });
    expect(r.comments).toEqual([{ text: "yum" }]);
    expect(r.recipeIngredient).toBeUndefined();
  });

  it("detailed returns the whole object and ignores include", () => {
    const r = projectRecipe(FULL, "detailed", ["nutrition"]);

    expect(r.recipeIngredient).toEqual([{ note: "salt" }]);
    expect(r.recipeInstructions).toEqual([{ text: "boil" }]);
  });
});

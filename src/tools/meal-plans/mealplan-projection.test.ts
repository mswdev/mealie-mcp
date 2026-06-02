import { describe, expect, it } from "vitest";
import { projectPlanEntry } from "./mealplan-projection.js";

describe("projectPlanEntry", () => {
  it("keeps scheduling fields and a recipe stub when present", () => {
    const full = {
      id: 7,
      date: "2026-06-02",
      entryType: "dinner",
      title: "Pasta night",
      text: "",
      recipeId: "r1",
      groupId: "g",
      userId: "u",
      householdId: "h",
      recipe: { id: "r1", slug: "pasta", name: "Pasta", description: "huge", ingredients: [] },
    };

    const concise = projectPlanEntry(full as never, "concise");

    expect(concise).toEqual({
      id: 7,
      date: "2026-06-02",
      entryType: "dinner",
      title: "Pasta night",
      text: "",
      recipeId: "r1",
      recipe: { id: "r1", slug: "pasta", name: "Pasta" },
    });
  });

  it("omits the recipe key when there is no recipe", () => {
    const full = {
      id: 8,
      date: "2026-06-03",
      entryType: "lunch",
      title: "",
      text: "",
      recipe: null,
    };

    const concise = projectPlanEntry(full as never, "concise");

    expect(concise).not.toHaveProperty("recipe");
  });

  it("returns the whole entry when detailed", () => {
    const full = { id: 9, recipe: { huge: true } };

    expect(projectPlanEntry(full as never, "detailed")).toBe(full);
  });
});

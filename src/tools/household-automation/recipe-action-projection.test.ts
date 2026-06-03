import { describe, expect, it } from "vitest";
import { type RecipeAction, projectRecipeAction } from "./recipe-action-projection.js";

const FULL: RecipeAction = {
  actionType: "post",
  title: "Notify",
  url: "https://e.test/a",
  groupId: "g1",
  householdId: "h1",
  id: "a1",
};

describe("projectRecipeAction", () => {
  it("returns the whole action when detailed", () => {
    expect(projectRecipeAction(FULL, "detailed")).toEqual(FULL);
  });

  it("trims to id/actionType/title/url when concise", () => {
    const concise = projectRecipeAction(FULL, "concise");

    expect(concise).toEqual({
      id: "a1",
      actionType: "post",
      title: "Notify",
      url: "https://e.test/a",
    });
  });
});

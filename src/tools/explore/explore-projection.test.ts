import { describe, expect, it } from "vitest";
import {
  exploreBasePath,
  exploreRecipesPath,
  projectExploreItem,
  projectExploreRecipe,
} from "./explore-projection.js";

describe("exploreBasePath", () => {
  it("builds each of the six group-scoped collection paths", () => {
    expect(exploreBasePath("cookbook", "home")).toBe("/api/explore/groups/home/cookbooks");
    expect(exploreBasePath("category", "home")).toBe(
      "/api/explore/groups/home/organizers/categories",
    );
    expect(exploreBasePath("tag", "home")).toBe("/api/explore/groups/home/organizers/tags");
    expect(exploreBasePath("tool", "home")).toBe("/api/explore/groups/home/organizers/tools");
    expect(exploreBasePath("food", "home")).toBe("/api/explore/groups/home/foods");
    expect(exploreBasePath("household", "home")).toBe("/api/explore/groups/home/households");
  });

  it("URI-encodes the group slug (externally discovered string)", () => {
    expect(exploreBasePath("food", "my group/x")).toBe("/api/explore/groups/my%20group%2Fx/foods");
  });
});

describe("exploreRecipesPath", () => {
  it("builds the group-scoped public recipes path, encoded", () => {
    expect(exploreRecipesPath("home")).toBe("/api/explore/groups/home/recipes");
    expect(exploreRecipesPath("a b")).toBe("/api/explore/groups/a%20b/recipes");
  });
});

describe("projectExploreItem", () => {
  it("trims to id/slug/name for catalog types", () => {
    const item = { id: "u1", slug: "dinner", name: "Dinner", position: 3, public: true };

    expect(projectExploreItem(item, "cookbook", "concise")).toEqual({
      id: "u1",
      slug: "dinner",
      name: "Dinner",
    });
  });

  it("trims foods to id/name/labelId (foods have no slug)", () => {
    const food = { id: "f1", name: "Flour", labelId: "l1", aliases: [] };

    expect(projectExploreItem(food, "food", "concise")).toEqual({
      id: "f1",
      name: "Flour",
      labelId: "l1",
    });
  });

  it("passes the full object through when detailed", () => {
    const item = { id: "h1", slug: "home", name: "Home", preferences: { privateGroup: false } };

    expect(projectExploreItem(item, "household", "detailed")).toEqual(item);
  });
});

describe("projectExploreRecipe", () => {
  it("keeps concise fields and drops heavy ones", () => {
    const recipe = {
      id: "r1",
      slug: "soup",
      name: "Soup",
      rating: 5,
      recipeIngredient: [{ note: "1 cup water" }],
      recipeInstructions: [{ text: "Boil" }],
      comments: [{ text: "yum" }],
      nutrition: { calories: "100" },
    };

    const concise = projectExploreRecipe(recipe, "concise", []);

    expect(concise).toMatchObject({ id: "r1", slug: "soup", name: "Soup", rating: 5 });
    expect(concise).not.toHaveProperty("recipeIngredient");
    expect(concise).not.toHaveProperty("comments");
    expect(concise).not.toHaveProperty("nutrition");
  });

  it("adds heavy fields back via include", () => {
    const recipe = { id: "r1", comments: [{ text: "yum" }], nutrition: { calories: "100" } };

    const concise = projectExploreRecipe(recipe, "concise", ["nutrition"]);

    expect(concise).toHaveProperty("nutrition");
    expect(concise).not.toHaveProperty("comments");
  });

  it("passes the full object through when detailed", () => {
    const recipe = { id: "r1", recipeIngredient: [{}] };

    expect(projectExploreRecipe(recipe, "detailed", [])).toEqual(recipe);
  });
});

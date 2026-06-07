import { describe, expect, it } from "vitest";
import { exploreRecipeGetHandler } from "./explore-recipe-get.js";

const FULL_RECIPE = {
  id: "r1",
  slug: "soup",
  name: "Soup",
  rating: 4,
  recipeIngredient: [{ note: "1 cup water" }],
  recipeInstructions: [{ text: "Boil" }],
  comments: [{ text: "yum" }],
  nutrition: { calories: "100" },
};

function fakeGetClient(calls: string[]) {
  return {
    async get<T>(path: string): Promise<T> {
      calls.push(path);
      return FULL_RECIPE as T;
    },
  };
}

describe("exploreRecipeGetHandler", () => {
  it("fetches a public recipe by slug with the concise projection", async () => {
    const calls: string[] = [];

    const result = await exploreRecipeGetHandler(fakeGetClient(calls), {
      group_slug: "home",
      slug: "soup",
    });

    expect(calls).toEqual(["/api/explore/groups/home/recipes/soup"]);
    const body = JSON.parse((result.content[0] as { text: string }).text);
    expect(body).toMatchObject({ id: "r1", slug: "soup", name: "Soup", rating: 4 });
    expect(body).not.toHaveProperty("recipeIngredient");
    expect(body).not.toHaveProperty("comments");
  });

  it("URI-encodes the recipe slug segment", async () => {
    const calls: string[] = [];

    await exploreRecipeGetHandler(fakeGetClient(calls), { group_slug: "home", slug: "a/b" });

    expect(calls).toEqual(["/api/explore/groups/home/recipes/a%2Fb"]);
  });

  it("adds heavy fields back via include", async () => {
    const result = await exploreRecipeGetHandler(fakeGetClient([]), {
      group_slug: "home",
      slug: "soup",
      include: ["comments"],
    });

    const body = JSON.parse((result.content[0] as { text: string }).text);
    expect(body).toHaveProperty("comments");
    expect(body).not.toHaveProperty("nutrition");
  });

  it("returns everything when detailed", async () => {
    const result = await exploreRecipeGetHandler(fakeGetClient([]), {
      group_slug: "home",
      slug: "soup",
      response_format: "detailed",
    });

    const body = JSON.parse((result.content[0] as { text: string }).text);
    expect(body).toHaveProperty("recipeIngredient");
    expect(body).toHaveProperty("nutrition");
  });

  it("returns an error result when the client throws", async () => {
    const client = {
      async get<T>(): Promise<T> {
        throw new Error("404 group not found");
      },
    };

    const result = await exploreRecipeGetHandler(client, { group_slug: "x", slug: "soup" });

    expect(result.isError).toBe(true);
  });
});

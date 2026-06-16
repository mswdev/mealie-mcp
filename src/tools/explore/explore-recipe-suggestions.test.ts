import { describe, expect, it } from "vitest";
import { exploreRecipeSuggestionsHandler } from "./explore-recipe-suggestions.js";

type Captured = { path: string; query: unknown };

function fakeGetClient(captured: Captured[]) {
  return {
    async get<T>(path: string, query?: unknown): Promise<T> {
      captured.push({ path, query });
      return {
        items: [
          {
            recipe: { id: "r1", slug: "soup", name: "Soup", rating: 5 },
            missingFoods: [{ id: "f1", name: "Leek" }],
            missingTools: [{ id: "t1", name: "Pot" }],
          },
        ],
      } as T;
    },
  };
}

describe("exploreRecipeSuggestionsHandler", () => {
  it("suggests public recipes with concise items and missing names", async () => {
    const captured: Captured[] = [];

    const result = await exploreRecipeSuggestionsHandler(fakeGetClient(captured), {
      group_slug: "home",
      foods: ["f2"],
      limit: 5,
    });

    expect(captured[0]?.path).toBe("/api/explore/groups/home/recipes/suggestions");
    expect(captured[0]?.query).toMatchObject({ foods: ["f2"], limit: 5 });
    expect(captured[0]?.query).not.toHaveProperty("group_slug");
    const body = JSON.parse((result.content[0] as { text: string }).text);
    expect(body.items).toEqual([
      {
        recipe: { id: "r1", slug: "soup", name: "Soup" },
        missingFoods: ["Leek"],
        missingTools: ["Pot"],
      },
    ]);
  });

  it("returns an error result when the client throws", async () => {
    const client = {
      async get<T>(): Promise<T> {
        throw new Error("404 group not found");
      },
    };

    const result = await exploreRecipeSuggestionsHandler(client, { group_slug: "nope" });

    expect(result.isError).toBe(true);
  });
});

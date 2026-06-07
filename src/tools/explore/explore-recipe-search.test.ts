import { describe, expect, it } from "vitest";
import { exploreRecipeSearchHandler } from "./explore-recipe-search.js";

type Captured = { path: string; query: unknown };

function fakePaginatedClient(captured: Captured[]) {
  return {
    async getPaginated<T>(path: string, query: unknown): Promise<T> {
      captured.push({ path, query });
      return {
        items: [{ id: "r1", slug: "soup", name: "Soup", rating: 5 }],
        total: 1,
        page: 1,
        perPage: 20,
        totalPages: 1,
      } as T;
    },
  };
}

describe("exploreRecipeSearchHandler", () => {
  it("searches the group's public recipes with concise items", async () => {
    const captured: Captured[] = [];

    const result = await exploreRecipeSearchHandler(fakePaginatedClient(captured), {
      group_slug: "home",
    });

    expect(captured[0]?.path).toBe("/api/explore/groups/home/recipes");
    expect(captured[0]?.query).toMatchObject({ perPage: 20 });
    const body = JSON.parse((result.content[0] as { text: string }).text);
    expect(body.items).toEqual([{ id: "r1", slug: "soup", name: "Soup" }]);
    expect(body).toMatchObject({ total: 1, page: 1, perPage: 20, totalPages: 1 });
  });

  it("passes filters through — including the cookbook filter", async () => {
    const captured: Captured[] = [];

    await exploreRecipeSearchHandler(fakePaginatedClient(captured), {
      group_slug: "home",
      search: "soup",
      categories: ["dinner"],
      tags: ["quick"],
      tools: ["pot"],
      foods: ["f1"],
      cookbook: "favorites",
      page: 2,
      perPage: 50,
      orderBy: "name",
      orderDirection: "desc",
    });

    expect(captured[0]?.query).toMatchObject({
      search: "soup",
      categories: ["dinner"],
      tags: ["quick"],
      tools: ["pot"],
      foods: ["f1"],
      cookbook: "favorites",
      page: 2,
      perPage: 50,
      orderBy: "name",
      orderDirection: "desc",
    });
  });

  it("does not leak group_slug into the query string", async () => {
    const captured: Captured[] = [];

    await exploreRecipeSearchHandler(fakePaginatedClient(captured), { group_slug: "home" });

    expect(captured[0]?.query).not.toHaveProperty("group_slug");
  });

  it("returns an error result when the client throws", async () => {
    const client = {
      async getPaginated<T>(): Promise<T> {
        throw new Error("404 group not found");
      },
    };

    const result = await exploreRecipeSearchHandler(client, { group_slug: "nope" });

    expect(result.isError).toBe(true);
  });
});

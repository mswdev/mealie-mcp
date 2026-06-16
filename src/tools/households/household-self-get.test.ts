import { describe, expect, it } from "vitest";
import { householdSelfGetHandler } from "./household-self-get.js";

type Captured = { method: string; path: string; query?: unknown };

const SELF = {
  id: "hh1",
  name: "Home",
  slug: "home",
  groupId: "g1",
  group: "Group",
  webhooks: [],
  preferences: { recipePublic: true },
};

function fakeClient(captured: Captured[]) {
  return {
    async get<T>(path: string): Promise<T> {
      captured.push({ method: "GET", path });
      if (path.endsWith("/preferences")) return { recipePublic: true } as T;
      if (path.endsWith("/statistics")) return { totalRecipes: 5 } as T;
      if (path.includes("/recipes/")) return { lastMade: null, recipeId: "r1" } as T;
      return SELF as T;
    },
    async getPaginated<T>(path: string, query: unknown): Promise<T> {
      captured.push({ method: "GETP", path, query });
      return { items: [{ id: "u1" }], total: 1, page: 1, perPage: 20, totalPages: 1 } as T;
    },
  };
}

function bodyOf(result: { content: unknown[] }): Record<string, unknown> {
  return JSON.parse((result.content[0] as { text: string }).text);
}

describe("householdSelfGetHandler", () => {
  it("defaults to the household view, concise", async () => {
    const captured: Captured[] = [];

    const result = await householdSelfGetHandler(fakeClient(captured), {});

    expect(captured[0]).toEqual({ method: "GET", path: "/api/households/self" });
    expect(bodyOf(result)).toEqual({ id: "hh1", name: "Home", slug: "home", groupId: "g1" });
  });

  it("returns the whole household when detailed", async () => {
    const result = await householdSelfGetHandler(fakeClient([]), { response_format: "detailed" });

    expect(bodyOf(result)).toHaveProperty("webhooks");
  });

  it("routes view=preferences and view=statistics to their endpoints", async () => {
    const captured: Captured[] = [];

    await householdSelfGetHandler(fakeClient(captured), { view: "preferences" });
    await householdSelfGetHandler(fakeClient(captured), { view: "statistics" });

    expect(captured[0]?.path).toBe("/api/households/preferences");
    expect(captured[1]?.path).toBe("/api/households/statistics");
  });

  it("paginates members with a default perPage", async () => {
    const captured: Captured[] = [];

    await householdSelfGetHandler(fakeClient(captured), { view: "members" });

    expect(captured[0]).toMatchObject({ method: "GETP", path: "/api/households/members" });
    expect((captured[0]?.query as Record<string, unknown>).perPage).toBe(20);
  });

  it("fetches the recipe pivot by slug", async () => {
    const captured: Captured[] = [];

    const result = await householdSelfGetHandler(fakeClient(captured), {
      view: "recipe",
      recipe_slug: "soup",
    });

    expect(captured[0]?.path).toBe("/api/households/self/recipes/soup");
    expect(bodyOf(result)).toEqual({ lastMade: null, recipeId: "r1" });
  });

  it("requires recipe_slug for view=recipe", async () => {
    const result = await householdSelfGetHandler(fakeClient([]), { view: "recipe" });

    expect(result.isError).toBe(true);
  });

  it("returns an error result when the client throws", async () => {
    const client = {
      async get<T>(): Promise<T> {
        throw new Error("401");
      },
      async getPaginated<T>(): Promise<T> {
        throw new Error("401");
      },
    };

    const result = await householdSelfGetHandler(client, {});

    expect(result.isError).toBe(true);
  });
});

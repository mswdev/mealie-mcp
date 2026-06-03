import { describe, expect, it } from "vitest";
import { recipeActionGetHandler } from "./recipe-action-get.js";

type Captured = { method: string; path: string; query?: unknown };

const FULL_ACTION = {
  actionType: "post",
  title: "Notify",
  url: "https://e.test/a",
  groupId: "g1",
  householdId: "h1",
  id: "a1",
};

function fakeClient(captured: Captured[]) {
  return {
    async get<T>(path: string): Promise<T> {
      captured.push({ method: "GET", path });
      return FULL_ACTION as T;
    },
    async getPaginated<T>(path: string, query: unknown): Promise<T> {
      captured.push({ method: "GETP", path, query });
      return { items: [FULL_ACTION], total: 1, page: 1, perPage: 20, totalPages: 1 } as T;
    },
  };
}

function bodyOf(result: { content: unknown[] }): Record<string, unknown> {
  return JSON.parse((result.content[0] as { text: string }).text);
}

describe("recipeActionGetHandler", () => {
  it("lists actions paginated with concise items", async () => {
    const captured: Captured[] = [];

    const result = await recipeActionGetHandler(fakeClient(captured), {});

    expect(captured[0]).toMatchObject({ method: "GETP", path: "/api/households/recipe-actions" });
    const body = bodyOf(result);
    expect(body.items).toEqual([
      { id: "a1", actionType: "post", title: "Notify", url: "https://e.test/a" },
    ]);
  });

  it("gets one action by id, concise by default", async () => {
    const captured: Captured[] = [];

    const result = await recipeActionGetHandler(fakeClient(captured), { item_id: "a1" });

    expect(captured[0]).toEqual({ method: "GET", path: "/api/households/recipe-actions/a1" });
    expect(bodyOf(result)).not.toHaveProperty("groupId");
  });

  it("returns the whole action when detailed", async () => {
    const result = await recipeActionGetHandler(fakeClient([]), {
      item_id: "a1",
      response_format: "detailed",
    });

    expect(bodyOf(result)).toHaveProperty("groupId", "g1");
  });

  it("returns an error result when the client throws", async () => {
    const client = {
      async get<T>(): Promise<T> {
        throw new Error("404");
      },
      async getPaginated<T>(): Promise<T> {
        throw new Error("401");
      },
    };

    const result = await recipeActionGetHandler(client, {});

    expect(result.isError).toBe(true);
  });
});

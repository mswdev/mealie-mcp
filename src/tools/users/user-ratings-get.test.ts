import { describe, expect, it } from "vitest";
import { userRatingsGetHandler } from "./user-ratings-get.js";

type Call = { method: string; path: string };

function fakeClient(single?: unknown) {
  const calls: Call[] = [];
  return {
    calls,
    async get<T>(path: string): Promise<T> {
      calls.push({ method: "GET", path });
      return single as T;
    },
  };
}

function bodyOf(result: { content: unknown[] }): Record<string, unknown> {
  return JSON.parse((result.content[0] as { text: string }).text);
}

describe("userRatingsGetHandler", () => {
  it("reads a user's ratings (default view) — unwraps the wrapper into items + count", async () => {
    const client = fakeClient({
      ratings: [{ recipeId: "r1", rating: 4, isFavorite: false, userId: "u1", id: "x1" }],
    });

    const result = await userRatingsGetHandler(client, { user_id: "u1" });

    expect(client.calls[0]).toEqual({ method: "GET", path: "/api/users/u1/ratings" });
    expect(bodyOf(result)).toEqual({
      items: [{ recipeId: "r1", rating: 4, isFavorite: false, userId: "u1", id: "x1" }],
      count: 1,
    });
  });

  it("reads a user's favorites when view=favorites", async () => {
    const client = fakeClient({ ratings: [] });

    const result = await userRatingsGetHandler(client, { user_id: "u1", view: "favorites" });

    expect(client.calls[0]).toEqual({ method: "GET", path: "/api/users/u1/favorites" });
    expect(bodyOf(result)).toEqual({ items: [], count: 0 });
  });

  it("passes the user id through raw (no uuid validation)", async () => {
    const client = fakeClient({ ratings: [] });

    await userRatingsGetHandler(client, { user_id: "not-a-uuid" });

    expect(client.calls[0]?.path).toBe("/api/users/not-a-uuid/ratings");
  });

  it("returns an error result when the client throws", async () => {
    const client = {
      async get<T>(): Promise<T> {
        throw new Error("boom");
      },
    };

    const result = await userRatingsGetHandler(client, { user_id: "u1" });

    expect(result.isError).toBe(true);
  });
});

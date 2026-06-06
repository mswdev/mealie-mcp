import { describe, expect, it } from "vitest";
import { userMeHandler } from "./user-me.js";

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

/** A full UserOut-shaped fake: concise must keep tokens but drop cacheKey/slugs. */
const FULL_USER = {
  id: "u1",
  username: "matt",
  fullName: "Matt",
  email: "m@x.io",
  admin: false,
  group: "Home",
  household: "Family",
  groupId: "g1",
  groupSlug: "home",
  householdId: "h1",
  householdSlug: "family",
  tokens: [{ id: 1, name: "ha-bridge", createdAt: "2026-01-01" }],
  cacheKey: "abc",
};

describe("userMeHandler", () => {
  it("reads the profile (default view), concise — keeps the token list, drops cacheKey", async () => {
    const client = fakeClient(FULL_USER);

    const result = await userMeHandler(client, {});

    expect(client.calls[0]).toEqual({ method: "GET", path: "/api/users/self" });
    const body = bodyOf(result);
    expect(body).toMatchObject({ id: "u1", username: "matt", email: "m@x.io" });
    expect(body.tokens).toEqual([{ id: 1, name: "ha-bridge", createdAt: "2026-01-01" }]);
    expect(body.cacheKey).toBeUndefined();
    expect(body.groupSlug).toBeUndefined();
  });

  it("returns the whole profile when detailed", async () => {
    const client = fakeClient(FULL_USER);

    const result = await userMeHandler(client, { response_format: "detailed" });

    expect(bodyOf(result)).toMatchObject({ cacheKey: "abc", groupSlug: "home" });
  });

  it("lists ratings — unwraps the {ratings: []} wrapper into items + count", async () => {
    const client = fakeClient({
      ratings: [{ recipeId: "r1", rating: 4.5, isFavorite: false }],
    });

    const result = await userMeHandler(client, { view: "ratings" });

    expect(client.calls[0]).toEqual({ method: "GET", path: "/api/users/self/ratings" });
    expect(bodyOf(result)).toEqual({
      items: [{ recipeId: "r1", rating: 4.5, isFavorite: false }],
      count: 1,
    });
  });

  it("gets one recipe's rating when recipe_id is set with view=ratings", async () => {
    const client = fakeClient({ recipeId: "r1", rating: 4.5, isFavorite: false });

    const result = await userMeHandler(client, { view: "ratings", recipe_id: "r1" });

    expect(client.calls[0]).toEqual({ method: "GET", path: "/api/users/self/ratings/r1" });
    expect(bodyOf(result)).toEqual({ recipeId: "r1", rating: 4.5, isFavorite: false });
  });

  it("lists favorites — same wrapper shape as ratings", async () => {
    const client = fakeClient({
      ratings: [{ recipeId: "r2", rating: null, isFavorite: true }],
    });

    const result = await userMeHandler(client, { view: "favorites" });

    expect(client.calls[0]).toEqual({ method: "GET", path: "/api/users/self/favorites" });
    expect(bodyOf(result)).toMatchObject({ count: 1 });
  });

  it("returns an error result when the client throws", async () => {
    const client = {
      async get<T>(): Promise<T> {
        throw new Error("boom");
      },
    };

    const result = await userMeHandler(client, {});

    expect(result.isError).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import { adminUserGetHandler } from "./admin-user-get.js";

type Call = { method: string; path: string; query?: Record<string, unknown> };

function fakeClient(single?: unknown, page?: { items: unknown[] }) {
  const calls: Call[] = [];
  return {
    calls,
    async get<T>(path: string): Promise<T> {
      calls.push({ method: "GET", path });
      return single as T;
    },
    async getPaginated<T>(
      path: string,
      query?: Record<string, unknown>,
    ): Promise<{ items: T[]; total: number; page: number; perPage: number; totalPages: number }> {
      calls.push({ method: "GET_PAGINATED", path, query: query ?? {} });
      const items = (page?.items ?? []) as T[];
      return { items, total: items.length, page: 1, perPage: 20, totalPages: 1 };
    },
  };
}

function bodyOf(result: { content: unknown[] }): Record<string, unknown> {
  return JSON.parse((result.content[0] as { text: string }).text);
}

/** UserOut-shaped fake — cacheKey must never reach any output. */
const FULL_USER = {
  id: "u1",
  username: "sam",
  fullName: "Sam",
  email: "s@x.io",
  admin: true,
  authMethod: "Mealie",
  group: "Home",
  household: "Family",
  groupId: "g1",
  groupSlug: "home",
  householdId: "h1",
  householdSlug: "family",
  tokens: [{ id: 3, name: "bridge", createdAt: "2026-01-01" }],
  cacheKey: "leak-me",
};

describe("adminUserGetHandler", () => {
  it("lists users paginated with slim items and meta", async () => {
    const client = fakeClient(undefined, { items: [FULL_USER] });

    const result = await adminUserGetHandler(client, { queryFilter: "email LIKE %x.io" });

    expect(client.calls[0]).toEqual({
      method: "GET_PAGINATED",
      path: "/api/admin/users",
      query: { queryFilter: "email LIKE %x.io", perPage: 20 },
    });
    expect(bodyOf(result)).toEqual({
      items: [{ id: "u1", username: "sam", fullName: "Sam", email: "s@x.io", admin: true }],
      total: 1,
      page: 1,
      perPage: 20,
      totalPages: 1,
    });
  });

  it("reads one user by id, concise — keeps tokens, drops cacheKey", async () => {
    const client = fakeClient(FULL_USER);

    const result = await adminUserGetHandler(client, { item_id: "u1" });

    expect(client.calls[0]).toEqual({ method: "GET", path: "/api/admin/users/u1" });
    const body = bodyOf(result);
    expect(body).toMatchObject({ id: "u1", username: "sam", admin: true });
    expect(body.tokens).toEqual([{ id: 3, name: "bridge", createdAt: "2026-01-01" }]);
    expect(body.cacheKey).toBeUndefined();
    expect(body.groupSlug).toBeUndefined();
  });

  it("returns everything except cacheKey when detailed", async () => {
    const client = fakeClient(FULL_USER);

    const result = await adminUserGetHandler(client, {
      item_id: "u1",
      response_format: "detailed",
    });

    const body = bodyOf(result);
    expect(body).toMatchObject({ groupSlug: "home", householdSlug: "family" });
    expect(body.cacheKey).toBeUndefined();
  });

  it("returns an error result when the client throws", async () => {
    const client = {
      async get<T>(): Promise<T> {
        throw new Error("boom");
      },
      async getPaginated<T>(): Promise<T> {
        throw new Error("boom");
      },
    };

    const result = await adminUserGetHandler(client, {});

    expect(result.isError).toBe(true);
  });
});

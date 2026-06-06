import { describe, expect, it } from "vitest";
import { adminGroupGetHandler } from "./admin-group-get.js";

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

/** GroupInDB-shaped fake (nested lists trimmed in concise reads). */
const FULL_GROUP = {
  id: "g1",
  name: "Home",
  slug: "home",
  categories: [],
  webhooks: [],
  households: [{ id: "h1", name: "Family" }],
  users: [{ id: "u1", username: "sam" }],
  preferences: { privateGroup: true },
};

describe("adminGroupGetHandler", () => {
  it("lists groups paginated with slim items and meta", async () => {
    const client = fakeClient(undefined, { items: [FULL_GROUP] });

    const result = await adminGroupGetHandler(client, {});

    expect(client.calls[0]).toEqual({
      method: "GET_PAGINATED",
      path: "/api/admin/groups",
      query: { perPage: 20 },
    });
    expect(bodyOf(result)).toMatchObject({
      items: [{ id: "g1", name: "Home", slug: "home" }],
      total: 1,
    });
  });

  it("reads one group by id, concise — drops nested lists", async () => {
    const client = fakeClient(FULL_GROUP);

    const result = await adminGroupGetHandler(client, { item_id: "g1" });

    expect(client.calls[0]).toEqual({ method: "GET", path: "/api/admin/groups/g1" });
    const body = bodyOf(result);
    expect(body).toMatchObject({ id: "g1", name: "Home", slug: "home" });
    expect(body.users).toBeUndefined();
    expect(body.households).toBeUndefined();
  });

  it("returns everything when detailed", async () => {
    const client = fakeClient(FULL_GROUP);

    const result = await adminGroupGetHandler(client, {
      item_id: "g1",
      response_format: "detailed",
    });

    expect(bodyOf(result).households).toEqual([{ id: "h1", name: "Family" }]);
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

    const result = await adminGroupGetHandler(client, {});

    expect(result.isError).toBe(true);
  });
});

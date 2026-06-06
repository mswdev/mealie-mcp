import { describe, expect, it } from "vitest";
import { adminHouseholdGetHandler } from "./admin-household-get.js";

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

/** HouseholdInDB-shaped fake (nested users/webhooks trimmed in concise reads). */
const FULL_HOUSEHOLD = {
  id: "h1",
  name: "Family",
  slug: "family",
  groupId: "g1",
  group: "Home",
  preferences: { id: "p1", privateHousehold: true },
  users: [{ id: "u1", username: "sam" }],
  webhooks: [],
};

describe("adminHouseholdGetHandler", () => {
  it("lists households paginated with slim items and meta", async () => {
    const client = fakeClient(undefined, { items: [FULL_HOUSEHOLD] });

    const result = await adminHouseholdGetHandler(client, {});

    expect(client.calls[0]).toEqual({
      method: "GET_PAGINATED",
      path: "/api/admin/households",
      query: { perPage: 20 },
    });
    expect(bodyOf(result)).toMatchObject({
      items: [{ id: "h1", name: "Family", slug: "family", groupId: "g1" }],
      total: 1,
    });
  });

  it("reads one household by id, concise — drops nested users/webhooks", async () => {
    const client = fakeClient(FULL_HOUSEHOLD);

    const result = await adminHouseholdGetHandler(client, { item_id: "h1" });

    expect(client.calls[0]).toEqual({ method: "GET", path: "/api/admin/households/h1" });
    const body = bodyOf(result);
    expect(body).toMatchObject({ id: "h1", name: "Family", groupId: "g1", group: "Home" });
    expect(body.users).toBeUndefined();
    expect(body.webhooks).toBeUndefined();
  });

  it("returns everything when detailed", async () => {
    const client = fakeClient(FULL_HOUSEHOLD);

    const result = await adminHouseholdGetHandler(client, {
      item_id: "h1",
      response_format: "detailed",
    });

    expect(bodyOf(result).users).toEqual([{ id: "u1", username: "sam" }]);
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

    const result = await adminHouseholdGetHandler(client, {});

    expect(result.isError).toBe(true);
  });
});

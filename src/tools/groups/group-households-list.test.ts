import { describe, expect, it } from "vitest";
import { groupHouseholdsListHandler } from "./group-households-list.js";

type Call = { method: string; path: string; query?: unknown };

function fakeClient(single?: unknown) {
  const calls: Call[] = [];
  return {
    calls,
    async get<T>(path: string): Promise<T> {
      calls.push({ method: "GET", path });
      return single as T;
    },
    async getPaginated<T>(path: string, query?: unknown): Promise<T> {
      calls.push({ method: "GET_PAGINATED", path, query });
      return {
        items: [{ id: "h1", slug: "home", name: "Home", groupId: "g1" }],
        total: 1,
        page: 1,
        perPage: 20,
        totalPages: 1,
      } as T;
    },
  };
}

function bodyOf(result: { content: unknown[] }): Record<string, unknown> {
  return JSON.parse((result.content[0] as { text: string }).text);
}

describe("groupHouseholdsListHandler", () => {
  it("lists households (paginated) when no slug is given", async () => {
    const client = fakeClient();

    const result = await groupHouseholdsListHandler(client, {});

    expect(client.calls[0]).toMatchObject({
      method: "GET_PAGINATED",
      path: "/api/groups/households",
    });
    expect(bodyOf(result)).toMatchObject({ total: 1 });
  });

  it("gets one household by slug, concise", async () => {
    const client = fakeClient({ id: "h1", slug: "home", name: "Home", groupId: "g1" });

    const result = await groupHouseholdsListHandler(client, { household_slug: "home" });

    expect(client.calls[0]).toEqual({ method: "GET", path: "/api/groups/households/home" });
    expect(bodyOf(result)).toEqual({ id: "h1", slug: "home", name: "Home" });
  });

  it("returns the whole household when detailed", async () => {
    const client = fakeClient({ id: "h1", slug: "home", name: "Home", groupId: "g1" });

    const result = await groupHouseholdsListHandler(client, {
      household_slug: "home",
      response_format: "detailed",
    });

    expect(bodyOf(result)).toMatchObject({ groupId: "g1" });
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

    const result = await groupHouseholdsListHandler(client, { household_slug: "home" });

    expect(result.isError).toBe(true);
  });
});

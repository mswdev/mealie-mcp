import { describe, expect, it } from "vitest";
import { groupSelfGetHandler } from "./group-self-get.js";

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
        items: [{ id: "u1", username: "alice" }],
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

describe("groupSelfGetHandler", () => {
  it("reads the group (default view), concise", async () => {
    const client = fakeClient({ id: "g1", slug: "home", name: "Home", preferences: { x: 1 } });

    const result = await groupSelfGetHandler(client, {});

    expect(client.calls[0]).toEqual({ method: "GET", path: "/api/groups/self" });
    expect(bodyOf(result)).toEqual({ id: "g1", slug: "home", name: "Home" });
  });

  it("returns the whole group when detailed", async () => {
    const client = fakeClient({ id: "g1", slug: "home", name: "Home", preferences: { x: 1 } });

    const result = await groupSelfGetHandler(client, {
      view: "group",
      response_format: "detailed",
    });

    expect(bodyOf(result)).toMatchObject({ preferences: { x: 1 } });
  });

  it("lists members (paginated), forwarding orderByNullPosition", async () => {
    const client = fakeClient();

    const result = await groupSelfGetHandler(client, {
      view: "members",
      orderByNullPosition: "last",
    });

    expect(client.calls[0]).toMatchObject({ method: "GET_PAGINATED", path: "/api/groups/members" });
    expect((client.calls[0]?.query as Record<string, unknown>).orderByNullPosition).toBe("last");
    expect(bodyOf(result)).toMatchObject({ total: 1 });
  });

  it("gets one member by username or id (raw string, no uuid validation)", async () => {
    const client = fakeClient({ id: "u1", username: "alice" });

    await groupSelfGetHandler(client, { view: "members", usernameOrId: "alice" });

    expect(client.calls[0]).toEqual({ method: "GET", path: "/api/groups/members/alice" });
  });

  it("reads preferences", async () => {
    const client = fakeClient({ privateGroup: true });

    await groupSelfGetHandler(client, { view: "preferences" });

    expect(client.calls[0]).toEqual({ method: "GET", path: "/api/groups/preferences" });
  });

  it("reads storage", async () => {
    const client = fakeClient({ usedStorageBytes: 1 });

    await groupSelfGetHandler(client, { view: "storage" });

    expect(client.calls[0]).toEqual({ method: "GET", path: "/api/groups/storage" });
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

    const result = await groupSelfGetHandler(client, { view: "storage" });

    expect(result.isError).toBe(true);
  });
});

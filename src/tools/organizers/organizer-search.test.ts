import { describe, expect, it } from "vitest";
import { organizerSearchHandler } from "./organizer-search.js";

type Captured = { path: string; query: unknown };

function fakePaginatedClient(captured: Captured[]) {
  return {
    async getPaginated<T>(path: string, query: unknown): Promise<T> {
      captured.push({ path, query });
      return {
        items: [{ id: "u1", slug: "quick", name: "Quick", recipes: [{}] }],
        total: 1,
        page: 1,
        perPage: 20,
        totalPages: 1,
      } as T;
    },
    async get<T>(): Promise<T> {
      throw new Error("get should not be called for a normal list");
    },
  };
}

describe("organizerSearchHandler", () => {
  it("lists the typed collection paginated with concise items", async () => {
    const captured: Captured[] = [];

    const result = await organizerSearchHandler(fakePaginatedClient(captured), { type: "tag" });

    expect(captured[0]?.path).toBe("/api/organizers/tags");
    expect(captured[0]?.query).toMatchObject({ perPage: 20 });
    const body = JSON.parse((result.content[0] as { text: string }).text);
    expect(body.items).toEqual([{ id: "u1", slug: "quick", name: "Quick" }]);
    expect(body.total).toBe(1);
  });

  it("empty_only fetches the un-enveloped /empty list for categories", async () => {
    const calls: string[] = [];
    const client = {
      async get<T>(path: string): Promise<T> {
        calls.push(path);
        return [{ id: "c1", slug: "unused", name: "Unused", extra: 1 }] as T;
      },
      async getPaginated<T>(): Promise<T> {
        throw new Error("getPaginated should not be called for empty_only");
      },
    };

    const result = await organizerSearchHandler(client, { type: "category", empty_only: true });

    expect(calls).toEqual(["/api/organizers/categories/empty"]);
    const body = JSON.parse((result.content[0] as { text: string }).text);
    expect(body).toEqual({ items: [{ id: "c1", slug: "unused", name: "Unused" }], count: 1 });
  });

  it("rejects empty_only for tools (no /empty endpoint)", async () => {
    const client = {
      async get<T>(): Promise<T> {
        throw new Error("must not call");
      },
      async getPaginated<T>(): Promise<T> {
        throw new Error("must not call");
      },
    };

    const result = await organizerSearchHandler(client, { type: "tool", empty_only: true });

    expect(result.isError).toBe(true);
  });

  it("returns an error result when the client throws", async () => {
    const client = {
      async get<T>(): Promise<T> {
        throw new Error("boom");
      },
      async getPaginated<T>(): Promise<T> {
        throw new Error("401");
      },
    };

    const result = await organizerSearchHandler(client, { type: "category" });

    expect(result.isError).toBe(true);
  });
});

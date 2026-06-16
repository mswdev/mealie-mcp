import { describe, expect, it } from "vitest";
import { labelGetHandler } from "./label-get.js";

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
        items: [{ id: "l1", name: "Produce", color: "#0f0", groupId: "g1" }],
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

describe("labelGetHandler", () => {
  it("lists labels (paginated) when no item_id is given", async () => {
    const client = fakeClient();

    const result = await labelGetHandler(client, {});

    expect(client.calls[0]).toMatchObject({ method: "GET_PAGINATED", path: "/api/groups/labels" });
    const body = bodyOf(result);
    expect(body.items).toHaveLength(1);
    expect(body).toMatchObject({ total: 1, page: 1, perPage: 20, totalPages: 1 });
  });

  it("gets one label by id, concise by default", async () => {
    const client = fakeClient({ id: "l1", name: "Produce", color: "#0f0", groupId: "g1" });

    const result = await labelGetHandler(client, { item_id: "l1" });

    expect(client.calls[0]).toEqual({ method: "GET", path: "/api/groups/labels/l1" });
    expect(bodyOf(result)).toEqual({ id: "l1", name: "Produce", color: "#0f0" });
  });

  it("returns the whole label when detailed", async () => {
    const client = fakeClient({ id: "l1", name: "Produce", color: "#0f0", groupId: "g1" });

    const result = await labelGetHandler(client, { item_id: "l1", response_format: "detailed" });

    expect(bodyOf(result)).toMatchObject({ groupId: "g1" });
  });

  it("returns an error result when the client throws", async () => {
    const client = {
      async get<T>(): Promise<T> {
        throw new Error("404");
      },
      async getPaginated<T>(): Promise<T> {
        throw new Error("boom");
      },
    };

    const result = await labelGetHandler(client, { item_id: "l1" });

    expect(result.isError).toBe(true);
  });
});

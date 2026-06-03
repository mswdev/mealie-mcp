import { describe, expect, it } from "vitest";
import { labelWriteHandler } from "./label-write.js";

type Call = { method: string; path: string; body?: unknown };

function fakeClient(current?: unknown) {
  const calls: Call[] = [];
  return {
    calls,
    async get<T>(path: string): Promise<T> {
      calls.push({ method: "GET", path });
      return current as T;
    },
    async post<T>(path: string, body: unknown): Promise<T> {
      calls.push({ method: "POST", path, body });
      return { id: "l-new", ...(body as object) } as T;
    },
    async put<T>(path: string, body: unknown): Promise<T> {
      calls.push({ method: "PUT", path, body });
      return { ...(current as object), ...(body as object) } as T;
    },
    async delete<T>(path: string): Promise<T> {
      calls.push({ method: "DELETE", path });
      return { id: "l1", name: "Produce", color: "#111", groupId: "g1" } as T;
    },
  };
}

function bodyOf(result: { content: unknown[] }): Record<string, unknown> {
  return JSON.parse((result.content[0] as { text: string }).text);
}

describe("labelWriteHandler", () => {
  it("creates with an explicit color", async () => {
    const client = fakeClient();

    await labelWriteHandler(client, { action: "create", name: "Produce", color: "#0f0" });

    expect(client.calls[0]).toMatchObject({ method: "POST", path: "/api/groups/labels" });
    expect(client.calls[0]?.body).toEqual({ name: "Produce", color: "#0f0" });
  });

  it("creates with the default color when omitted", async () => {
    const client = fakeClient();

    await labelWriteHandler(client, { action: "create", name: "Produce" });

    expect(client.calls[0]?.body).toEqual({ name: "Produce", color: "#959595" });
  });

  it("rejects create when name is missing", async () => {
    const result = await labelWriteHandler(fakeClient(), { action: "create", color: "#0f0" });

    expect(result.isError).toBe(true);
  });

  it("fetch-merges on update, preserving groupId/id and untouched fields", async () => {
    const client = fakeClient({ id: "l1", name: "old", color: "#111", groupId: "g1" });

    await labelWriteHandler(client, {
      action: "update",
      item_id: "l1",
      changes: { name: "new" },
    });

    expect(client.calls[0]).toMatchObject({ method: "GET", path: "/api/groups/labels/l1" });
    const put = client.calls.find((call) => call.method === "PUT");
    expect(put?.path).toBe("/api/groups/labels/l1");
    expect(put?.body).toEqual({ id: "l1", name: "new", color: "#111", groupId: "g1" });
  });

  it("rejects update when item_id or changes is missing", async () => {
    const result = await labelWriteHandler(fakeClient(), { action: "update", item_id: "l1" });

    expect(result.isError).toBe(true);
  });

  it("refuses to delete without confirm", async () => {
    const client = fakeClient();

    const result = await labelWriteHandler(client, { action: "delete", item_id: "l1" });

    expect(result.isError).toBe(true);
    expect(client.calls).toHaveLength(0);
  });

  it("deletes with confirm and synthesizes {deleted}", async () => {
    const client = fakeClient();

    const result = await labelWriteHandler(client, {
      action: "delete",
      item_id: "l1",
      confirm: true,
    });

    expect(client.calls[0]).toEqual({ method: "DELETE", path: "/api/groups/labels/l1" });
    expect(bodyOf(result)).toEqual({ deleted: "l1" });
  });

  it("returns an error result when the client throws", async () => {
    const client = {
      async get<T>(): Promise<T> {
        throw new Error("404");
      },
      async post<T>(): Promise<T> {
        throw new Error("boom");
      },
      async put<T>(): Promise<T> {
        throw new Error("boom");
      },
      async delete<T>(): Promise<T> {
        throw new Error("boom");
      },
    };

    const result = await labelWriteHandler(client, {
      action: "update",
      item_id: "l1",
      changes: { name: "x" },
    });

    expect(result.isError).toBe(true);
  });
});

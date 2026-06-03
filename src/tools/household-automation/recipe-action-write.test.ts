import { describe, expect, it } from "vitest";
import { recipeActionWriteHandler } from "./recipe-action-write.js";

type Call = { method: string; path: string; body?: unknown };

/** GET response carries groupId/householdId (server-injected) — the merge must resend them. */
const CURRENT = {
  actionType: "post",
  title: "Notify",
  url: "https://e.test/a",
  groupId: "g1",
  householdId: "h1",
  id: "a1",
};

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
      return { id: "a-new", groupId: "g1", householdId: "h1", ...(body as object) } as T;
    },
    async put<T>(path: string, body: unknown): Promise<T> {
      calls.push({ method: "PUT", path, body });
      return { ...(current as object), ...(body as object) } as T;
    },
    async delete<T>(path: string): Promise<T> {
      calls.push({ method: "DELETE", path });
      return current as T;
    },
  };
}

function bodyOf(result: { content: unknown[] }): Record<string, unknown> {
  return JSON.parse((result.content[0] as { text: string }).text);
}

describe("recipeActionWriteHandler", () => {
  it("creates with the 3-field body (groupId/householdId server-injected)", async () => {
    const client = fakeClient();

    await recipeActionWriteHandler(client, {
      action: "create",
      actionType: "link",
      title: "Open",
      url: "https://e.test/a",
    });

    expect(client.calls[0]).toMatchObject({
      method: "POST",
      path: "/api/households/recipe-actions",
    });
    expect(client.calls[0]?.body).toEqual({
      actionType: "link",
      title: "Open",
      url: "https://e.test/a",
    });
  });

  it("rejects create when required fields are missing", async () => {
    const result = await recipeActionWriteHandler(fakeClient(), { action: "create", title: "x" });

    expect(result.isError).toBe(true);
  });

  it("fetch-merges on update, carrying groupId+householdId into the PUT (superset)", async () => {
    const client = fakeClient(CURRENT);

    await recipeActionWriteHandler(client, {
      action: "update",
      item_id: "a1",
      changes: { title: "Renamed" },
    });

    expect(client.calls[0]).toMatchObject({
      method: "GET",
      path: "/api/households/recipe-actions/a1",
    });
    const put = client.calls[1]?.body as Record<string, unknown>;
    expect(put.title).toBe("Renamed");
    expect(put.groupId).toBe("g1");
    expect(put.householdId).toBe("h1");
    expect(put.url).toBe("https://e.test/a");
  });

  it("refuses to delete without confirm", async () => {
    const client = fakeClient();

    const result = await recipeActionWriteHandler(client, { action: "delete", item_id: "a1" });

    expect(result.isError).toBe(true);
    expect(client.calls).toHaveLength(0);
  });

  it("deletes with confirm and synthesizes {deleted} (despite the entity echo)", async () => {
    const client = fakeClient(CURRENT);

    const result = await recipeActionWriteHandler(client, {
      action: "delete",
      item_id: "a1",
      confirm: true,
    });

    expect(client.calls[0]).toEqual({
      method: "DELETE",
      path: "/api/households/recipe-actions/a1",
    });
    expect(bodyOf(result)).toEqual({ deleted: "a1" });
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

    const result = await recipeActionWriteHandler(client, {
      action: "update",
      item_id: "a1",
      changes: { title: "x" },
    });

    expect(result.isError).toBe(true);
  });
});

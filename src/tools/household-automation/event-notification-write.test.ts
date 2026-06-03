import { describe, expect, it } from "vitest";
import { eventNotificationWriteHandler } from "./event-notification-write.js";

type Call = { method: string; path: string; body?: unknown };

/** A realistic GET response: the full Out shape incl. the 27-toggle options + nested id. */
const CURRENT = {
  id: "n1",
  name: "Apprise",
  enabled: true,
  groupId: "g1",
  householdId: "h1",
  options: {
    id: "o1",
    testMessage: false,
    recipeCreated: true,
    recipeUpdated: false,
    mealplanEntryCreated: true,
  },
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
      return { id: "n-new", enabled: true, ...(body as object) } as T;
    },
    async put<T>(path: string, body: unknown): Promise<T> {
      calls.push({ method: "PUT", path, body });
      return { ...(current as object), ...(body as object) } as T;
    },
    async delete<T>(path: string): Promise<T> {
      calls.push({ method: "DELETE", path });
      return undefined as T;
    },
  };
}

function bodyOf(result: { content: unknown[] }): Record<string, unknown> {
  return JSON.parse((result.content[0] as { text: string }).text);
}

describe("eventNotificationWriteHandler", () => {
  it("creates with the minimal body (name only, no appriseUrl key when omitted)", async () => {
    const client = fakeClient();

    await eventNotificationWriteHandler(client, { action: "create", name: "Apprise" });

    expect(client.calls[0]).toMatchObject({
      method: "POST",
      path: "/api/households/events/notifications",
    });
    expect(client.calls[0]?.body).toEqual({ name: "Apprise" });
  });

  it("rejects create without a name", async () => {
    const client = fakeClient();

    const result = await eventNotificationWriteHandler(client, { action: "create" });

    expect(result.isError).toBe(true);
    expect(client.calls).toHaveLength(0);
  });

  it("includes appriseUrl in the create body only when supplied", async () => {
    const client = fakeClient();

    await eventNotificationWriteHandler(client, {
      action: "create",
      name: "Apprise",
      appriseUrl: "mailto://x",
    });

    expect(client.calls[0]?.body).toEqual({ name: "Apprise", appriseUrl: "mailto://x" });
  });

  it("fetch-merges on update, preserving the 27-toggle options (no silent reset)", async () => {
    const client = fakeClient(CURRENT);

    await eventNotificationWriteHandler(client, {
      action: "update",
      item_id: "n1",
      changes: { enabled: false },
    });

    expect(client.calls[0]).toMatchObject({
      method: "GET",
      path: "/api/households/events/notifications/n1",
    });
    const putCall = client.calls.find((call) => call.method === "PUT");
    expect(putCall?.path).toBe("/api/households/events/notifications/n1");
    const put = putCall?.body as Record<string, unknown>;
    expect(put.enabled).toBe(false);
    expect(put.options).toEqual(CURRENT.options);
    expect(put.groupId).toBe("g1");
    expect(put.householdId).toBe("h1");
  });

  it("refuses to delete without confirm", async () => {
    const client = fakeClient();

    const result = await eventNotificationWriteHandler(client, { action: "delete", item_id: "n1" });

    expect(result.isError).toBe(true);
    expect(client.calls).toHaveLength(0);
  });

  it("deletes with confirm and synthesizes {deleted} despite the 204 (no body)", async () => {
    const client = fakeClient();

    const result = await eventNotificationWriteHandler(client, {
      action: "delete",
      item_id: "n1",
      confirm: true,
    });

    expect(client.calls[0]).toEqual({
      method: "DELETE",
      path: "/api/households/events/notifications/n1",
    });
    expect(bodyOf(result)).toEqual({ deleted: "n1" });
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

    const result = await eventNotificationWriteHandler(client, {
      action: "update",
      item_id: "n1",
      changes: { enabled: false },
    });

    expect(result.isError).toBe(true);
  });
});

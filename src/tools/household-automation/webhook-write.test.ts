import { describe, expect, it } from "vitest";
import { webhookWriteHandler } from "./webhook-write.js";

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
      return { id: "w-new", ...(body as object) } as T;
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

describe("webhookWriteHandler", () => {
  it("creates with required-with-default fields filled", async () => {
    const client = fakeClient();

    await webhookWriteHandler(client, {
      action: "create",
      name: "Nightly",
      url: "https://e.test/h",
      scheduledTime: "06:00",
    });

    const post = client.calls[0];
    expect(post).toMatchObject({ method: "POST", path: "/api/households/webhooks" });
    expect(post?.body).toEqual({
      enabled: true,
      name: "Nightly",
      url: "https://e.test/h",
      webhookType: "mealplan",
      scheduledTime: "06:00",
    });
  });

  it("rejects create when required fields are missing", async () => {
    const result = await webhookWriteHandler(fakeClient(), { action: "create", name: "x" });

    expect(result.isError).toBe(true);
  });

  it("fetch-merges on update, preserving untouched fields (no silent reset)", async () => {
    const client = fakeClient({
      id: "w1",
      enabled: true,
      name: "Nightly",
      url: "https://e.test/h",
      webhookType: "mealplan",
      scheduledTime: "06:00",
      groupId: "g1",
      householdId: "h1",
    });

    await webhookWriteHandler(client, {
      action: "update",
      item_id: "w1",
      changes: { enabled: false },
    });

    expect(client.calls[0]).toMatchObject({ method: "GET", path: "/api/households/webhooks/w1" });
    const putCall = client.calls.find((call) => call.method === "PUT");
    expect(putCall?.path).toBe("/api/households/webhooks/w1");
    const put = putCall?.body as Record<string, unknown>;
    expect(put.enabled).toBe(false);
    expect(put.scheduledTime).toBe("06:00");
    expect(put.url).toBe("https://e.test/h");
  });

  it("refuses to delete without confirm", async () => {
    const client = fakeClient();

    const result = await webhookWriteHandler(client, { action: "delete", item_id: "w1" });

    expect(result.isError).toBe(true);
    expect(client.calls).toHaveLength(0);
  });

  it("deletes with confirm and returns a synthesized {deleted}", async () => {
    const client = fakeClient();

    const result = await webhookWriteHandler(client, {
      action: "delete",
      item_id: "w1",
      confirm: true,
    });

    expect(client.calls[0]).toEqual({ method: "DELETE", path: "/api/households/webhooks/w1" });
    expect(bodyOf(result)).toEqual({ deleted: "w1" });
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

    const result = await webhookWriteHandler(client, {
      action: "update",
      item_id: "w1",
      changes: { enabled: false },
    });

    expect(result.isError).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import { userApiTokenWriteHandler } from "./user-api-token-write.js";

type Call = { method: string; path: string; body?: unknown };

function fakeClient() {
  const calls: Call[] = [];
  return {
    calls,
    async post<T>(path: string, body: unknown): Promise<T> {
      calls.push({ method: "POST", path, body });
      return {
        name: "ha-bridge",
        id: 7,
        createdAt: "2026-01-01",
        token: "ey.raw.secret",
      } as T;
    },
    async delete<T>(path: string): Promise<T> {
      calls.push({ method: "DELETE", path });
      return { tokenDelete: "ha-bridge" } as T;
    },
  };
}

function bodyOf(result: { content: unknown[] }): Record<string, unknown> {
  return JSON.parse((result.content[0] as { text: string }).text);
}

describe("userApiTokenWriteHandler", () => {
  it("creates a token — supplies the default integrationId, echoes the raw token once with the shown-once note", async () => {
    const client = fakeClient();

    const result = await userApiTokenWriteHandler(client, { action: "create", name: "ha-bridge" });

    expect(client.calls[0]).toEqual({
      method: "POST",
      path: "/api/users/api-tokens",
      body: { name: "ha-bridge", integrationId: "generic" },
    });
    const body = bodyOf(result);
    expect(body.token).toBe("ey.raw.secret");
    expect(body.id).toBe(7);
    expect(String(body.note)).toMatch(/shown only once/i);
  });

  it("passes a custom integrationId through", async () => {
    const client = fakeClient();

    await userApiTokenWriteHandler(client, {
      action: "create",
      name: "n8n",
      integrationId: "n8n",
    });

    expect(client.calls[0]?.body).toEqual({ name: "n8n", integrationId: "n8n" });
  });

  it("rejects create without a name (no client calls)", async () => {
    const client = fakeClient();

    const result = await userApiTokenWriteHandler(client, { action: "create" });

    expect(result.isError).toBe(true);
    expect(client.calls).toHaveLength(0);
  });

  it("refuses delete without confirm (no client calls)", async () => {
    const client = fakeClient();

    const result = await userApiTokenWriteHandler(client, { action: "delete", token_id: 7 });

    expect(result.isError).toBe(true);
    expect(client.calls).toHaveLength(0);
  });

  it("deletes with confirm:true — integer id in the path, synthesizes {deleted}", async () => {
    const client = fakeClient();

    const result = await userApiTokenWriteHandler(client, {
      action: "delete",
      token_id: 7,
      confirm: true,
    });

    expect(client.calls[0]).toEqual({ method: "DELETE", path: "/api/users/api-tokens/7" });
    expect(bodyOf(result)).toEqual({ deleted: 7 });
  });

  it("rejects delete without a token_id (no client calls)", async () => {
    const client = fakeClient();

    const result = await userApiTokenWriteHandler(client, { action: "delete", confirm: true });

    expect(result.isError).toBe(true);
    expect(client.calls).toHaveLength(0);
  });

  it("returns an error result when the client throws", async () => {
    const client = {
      async post<T>(): Promise<T> {
        throw new Error("boom");
      },
      async delete<T>(): Promise<T> {
        return undefined as T;
      },
    };

    const result = await userApiTokenWriteHandler(client, { action: "create", name: "x" });

    expect(result.isError).toBe(true);
  });
});

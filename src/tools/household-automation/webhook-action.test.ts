import { describe, expect, it } from "vitest";
import { webhookActionHandler } from "./webhook-action.js";

type Call = { path: string; body: unknown };

function fakeClient(calls: Call[]) {
  return {
    async post<T>(path: string, body: unknown): Promise<T> {
      calls.push({ path, body });
      return undefined as T;
    },
  };
}

function bodyOf(result: { content: unknown[] }): Record<string, unknown> {
  return JSON.parse((result.content[0] as { text: string }).text);
}

describe("webhookActionHandler", () => {
  it("posts a test request for a single webhook and echoes success", async () => {
    const calls: Call[] = [];

    const result = await webhookActionHandler(fakeClient(calls), {
      action: "test",
      item_id: "w1",
    });

    expect(calls[0]?.path).toBe("/api/households/webhooks/w1/test");
    expect(bodyOf(result)).toEqual({ ok: true, action: "test", item_id: "w1" });
  });

  it("requires item_id for the test action", async () => {
    const calls: Call[] = [];

    const result = await webhookActionHandler(fakeClient(calls), { action: "test" });

    expect(result.isError).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it("posts to rerun for all of today's scheduled webhooks", async () => {
    const calls: Call[] = [];

    const result = await webhookActionHandler(fakeClient(calls), { action: "rerun" });

    expect(calls[0]?.path).toBe("/api/households/webhooks/rerun");
    expect(bodyOf(result)).toEqual({ ok: true, action: "rerun" });
  });

  it("returns an error result when the client throws", async () => {
    const client = {
      async post<T>(): Promise<T> {
        throw new Error("500");
      },
    };

    const result = await webhookActionHandler(client, { action: "rerun" });

    expect(result.isError).toBe(true);
  });
});

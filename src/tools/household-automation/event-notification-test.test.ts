import { describe, expect, it } from "vitest";
import { eventNotificationTestHandler } from "./event-notification-test.js";

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

describe("eventNotificationTestHandler", () => {
  it("posts a test send to the notifier and echoes success", async () => {
    const calls: Call[] = [];

    const result = await eventNotificationTestHandler(fakeClient(calls), { item_id: "n1" });

    expect(calls[0]?.path).toBe("/api/households/events/notifications/n1/test");
    expect(bodyOf(result)).toEqual({ ok: true, action: "test", item_id: "n1" });
  });

  it("returns an error result when the client throws", async () => {
    const client = {
      async post<T>(): Promise<T> {
        throw new Error("500");
      },
    };

    const result = await eventNotificationTestHandler(client, { item_id: "n1" });

    expect(result.isError).toBe(true);
  });
});

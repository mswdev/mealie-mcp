import { describe, expect, it } from "vitest";
import { eventNotificationGetHandler } from "./event-notification-get.js";

type Captured = { method: string; path: string; query?: unknown };

const FULL_NOTIFIER = {
  id: "n1",
  name: "Apprise",
  enabled: true,
  groupId: "g1",
  householdId: "h1",
  options: { testMessage: false, recipeCreated: true, id: "o1" },
};

function fakeClient(captured: Captured[]) {
  return {
    async get<T>(path: string): Promise<T> {
      captured.push({ method: "GET", path });
      return FULL_NOTIFIER as T;
    },
    async getPaginated<T>(path: string, query: unknown): Promise<T> {
      captured.push({ method: "GETP", path, query });
      return { items: [FULL_NOTIFIER], total: 1, page: 1, perPage: 20, totalPages: 1 } as T;
    },
  };
}

function bodyOf(result: { content: unknown[] }): Record<string, unknown> {
  return JSON.parse((result.content[0] as { text: string }).text);
}

describe("eventNotificationGetHandler", () => {
  it("lists notifiers paginated with concise items (no options)", async () => {
    const captured: Captured[] = [];

    const result = await eventNotificationGetHandler(fakeClient(captured), {});

    expect(captured[0]).toMatchObject({
      method: "GETP",
      path: "/api/households/events/notifications",
    });
    const body = bodyOf(result);
    expect(body.items).toEqual([{ id: "n1", name: "Apprise", enabled: true }]);
  });

  it("gets one notifier by id, concise by default (drops options)", async () => {
    const captured: Captured[] = [];

    const result = await eventNotificationGetHandler(fakeClient(captured), { item_id: "n1" });

    expect(captured[0]).toEqual({
      method: "GET",
      path: "/api/households/events/notifications/n1",
    });
    expect(bodyOf(result)).not.toHaveProperty("options");
  });

  it("returns the whole notifier when detailed", async () => {
    const result = await eventNotificationGetHandler(fakeClient([]), {
      item_id: "n1",
      response_format: "detailed",
    });

    expect(bodyOf(result)).toHaveProperty("options");
  });

  it("returns an error result when the client throws", async () => {
    const client = {
      async get<T>(): Promise<T> {
        throw new Error("404");
      },
      async getPaginated<T>(): Promise<T> {
        throw new Error("401");
      },
    };

    const result = await eventNotificationGetHandler(client, {});

    expect(result.isError).toBe(true);
  });
});

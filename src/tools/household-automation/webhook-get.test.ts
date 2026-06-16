import { describe, expect, it } from "vitest";
import { webhookGetHandler } from "./webhook-get.js";

type Captured = { method: string; path: string; query?: unknown };

function fakeClient(captured: Captured[]) {
  return {
    async get<T>(path: string): Promise<T> {
      captured.push({ method: "GET", path });
      return {
        id: "w1",
        name: "Nightly",
        url: "https://e.test/h",
        enabled: true,
        webhookType: "mealplan",
        scheduledTime: "06:00",
        groupId: "g1",
        householdId: "h1",
      } as T;
    },
    async getPaginated<T>(path: string, query: unknown): Promise<T> {
      captured.push({ method: "GETP", path, query });
      return {
        items: [
          {
            id: "w1",
            name: "Nightly",
            url: "https://e.test/h",
            enabled: true,
            webhookType: "mealplan",
            scheduledTime: "06:00",
            groupId: "g1",
            householdId: "h1",
          },
        ],
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

describe("webhookGetHandler", () => {
  it("lists webhooks paginated with default perPage and concise items", async () => {
    const captured: Captured[] = [];

    const result = await webhookGetHandler(fakeClient(captured), {});

    expect(captured[0]).toMatchObject({ method: "GETP", path: "/api/households/webhooks" });
    expect((captured[0]?.query as Record<string, unknown>).perPage).toBe(20);
    const body = bodyOf(result);
    expect(body.items).toEqual([
      {
        id: "w1",
        name: "Nightly",
        url: "https://e.test/h",
        enabled: true,
        webhookType: "mealplan",
        scheduledTime: "06:00",
      },
    ]);
    expect(body).toMatchObject({ total: 1, page: 1, perPage: 20, totalPages: 1 });
  });

  it("gets one webhook by id and projects concise by default", async () => {
    const captured: Captured[] = [];

    const result = await webhookGetHandler(fakeClient(captured), { item_id: "w1" });

    expect(captured[0]).toEqual({ method: "GET", path: "/api/households/webhooks/w1" });
    const body = bodyOf(result);
    expect(body).not.toHaveProperty("groupId");
    expect(body.id).toBe("w1");
  });

  it("returns the whole webhook when response_format is detailed", async () => {
    const result = await webhookGetHandler(fakeClient([]), {
      item_id: "w1",
      response_format: "detailed",
    });

    expect(bodyOf(result)).toHaveProperty("groupId", "g1");
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

    const result = await webhookGetHandler(client, {});

    expect(result.isError).toBe(true);
  });
});

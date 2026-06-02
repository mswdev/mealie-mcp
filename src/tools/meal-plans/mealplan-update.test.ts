import { describe, expect, it } from "vitest";
import { mealplanUpdateHandler } from "./mealplan-update.js";

type Call = { method: string; path: string; body?: unknown };

function fakeClient(current: unknown) {
  const calls: Call[] = [];
  return {
    calls,
    async get<T>(path: string): Promise<T> {
      calls.push({ method: "GET", path });
      return current as T;
    },
    async put<T>(path: string, body: unknown): Promise<T> {
      calls.push({ method: "PUT", path, body });
      return undefined as T;
    },
  };
}

describe("mealplanUpdateHandler", () => {
  it("merges changes onto the current entry and PUTs the full object, then re-fetches", async () => {
    const client = fakeClient({
      id: 7,
      date: "2026-06-02",
      entryType: "dinner",
      title: "Old",
      text: "",
      groupId: "g",
      userId: "u",
      householdId: "h",
    });

    await mealplanUpdateHandler(client, { planId: 7, changes: { title: "New" } });

    const put = client.calls.find((c) => c.method === "PUT");
    expect(put?.path).toBe("/api/households/mealplans/7");
    const body = put?.body as Record<string, unknown>;
    // changed field applied, untouched fields preserved (merge, not replace)
    expect(body.title).toBe("New");
    expect(body).toMatchObject({ id: 7, groupId: "g", userId: "u", entryType: "dinner" });
    // re-fetches after the PUT
    expect(client.calls.filter((c) => c.method === "GET")).toHaveLength(2);
  });

  it("returns an error result when the client throws", async () => {
    const client = {
      async get<T>(): Promise<T> {
        throw new Error("404");
      },
      async put<T>(): Promise<T> {
        return undefined as T;
      },
    };

    const result = await mealplanUpdateHandler(client, { planId: 99, changes: {} });

    expect(result.isError).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import { groupSelfUpdateHandler } from "./group-self-update.js";

type Call = { method: string; path: string; body?: unknown };

function fakeClient(current?: unknown) {
  const calls: Call[] = [];
  return {
    calls,
    async get<T>(path: string): Promise<T> {
      calls.push({ method: "GET", path });
      return current as T;
    },
    async put<T>(path: string, body: unknown): Promise<T> {
      calls.push({ method: "PUT", path, body });
      return body as T;
    },
  };
}

describe("groupSelfUpdateHandler", () => {
  it("fetch-merges preferences, preserving both fields and stripping groupId/id", async () => {
    const client = fakeClient({
      privateGroup: true,
      showAnnouncements: true,
      groupId: "g1",
      id: "p1",
    });

    await groupSelfUpdateHandler(client, { changes: { showAnnouncements: false } });

    expect(client.calls[0]).toEqual({ method: "GET", path: "/api/groups/preferences" });
    const put = client.calls.find((call) => call.method === "PUT");
    expect(put?.path).toBe("/api/groups/preferences");
    // Both prefs present (no silent reset); groupId/id stripped (absent from UpdateGroupPreferences).
    expect(put?.body).toEqual({ privateGroup: true, showAnnouncements: false });
  });

  it("rejects when changes is missing", async () => {
    const result = await groupSelfUpdateHandler(fakeClient(), {});

    expect(result.isError).toBe(true);
  });

  it("returns an error result when the client throws", async () => {
    const client = {
      async get<T>(): Promise<T> {
        throw new Error("boom");
      },
      async put<T>(): Promise<T> {
        throw new Error("boom");
      },
    };

    const result = await groupSelfUpdateHandler(client, { changes: { privateGroup: false } });

    expect(result.isError).toBe(true);
  });
});

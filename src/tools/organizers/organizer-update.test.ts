import { describe, expect, it } from "vitest";
import { organizerUpdateHandler } from "./organizer-update.js";

type Call = { method: string; path: string; body: unknown };

function fakeClient(current: unknown) {
  const calls: Call[] = [];
  return {
    calls,
    async get<T>(path: string): Promise<T> {
      calls.push({ method: "GET", path, body: undefined });
      return current as T;
    },
    async put<T>(path: string, body: unknown): Promise<T> {
      calls.push({ method: "PUT", path, body });
      return { ...(current as object), ...(body as object) } as T;
    },
  };
}

describe("organizerUpdateHandler", () => {
  it("fetch-merges changes and PUTs to the item path", async () => {
    const client = fakeClient({ id: "u1", slug: "s", name: "Old" });

    const result = await organizerUpdateHandler(client, {
      type: "tag",
      id: "u1",
      changes: { name: "New" },
    });

    expect(client.calls[0]).toMatchObject({ method: "GET", path: "/api/organizers/tags/u1" });
    expect(client.calls[1]).toMatchObject({ method: "PUT", path: "/api/organizers/tags/u1" });
    expect((client.calls[1]?.body as { name: string }).name).toBe("New");
    expect(result.isError).toBeUndefined();
  });

  it("preserves a tool's householdsWithTool when only renaming (no silent reset)", async () => {
    const client = fakeClient({
      id: "u1",
      groupId: "g1",
      slug: "wok",
      name: "Wok",
      householdsWithTool: ["h1", "h2"],
    });

    await organizerUpdateHandler(client, { type: "tool", id: "u1", changes: { name: "Big Wok" } });

    const putBody = client.calls[1]?.body as { name: string; householdsWithTool: string[] };
    expect(putBody.name).toBe("Big Wok");
    expect(putBody.householdsWithTool).toEqual(["h1", "h2"]);
  });

  it("returns an error result when the client throws", async () => {
    const client = {
      async get<T>(): Promise<T> {
        throw new Error("404");
      },
      async put<T>(): Promise<T> {
        throw new Error("unused");
      },
    };

    const result = await organizerUpdateHandler(client, {
      type: "tool",
      id: "x",
      changes: { name: "y" },
    });

    expect(result.isError).toBe(true);
  });
});

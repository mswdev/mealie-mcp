import { describe, expect, it } from "vitest";
import { shoppingListUpdateHandler } from "./shopping-list-update.js";

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
      return body as T;
    },
  };
}

describe("shoppingListUpdateHandler", () => {
  it("merges changes onto the fetched list (preserving items) and PUTs the full object", async () => {
    const client = fakeClient({
      id: "L1",
      name: "Old",
      groupId: "g",
      userId: "u",
      listItems: [{ id: "i1", display: "eggs" }],
      recipeReferences: [],
    });

    const result = await shoppingListUpdateHandler(client, {
      listId: "L1",
      changes: { name: "New" },
    });

    expect(client.calls[0]).toMatchObject({
      method: "GET",
      path: "/api/households/shopping/lists/L1",
    });
    const put = client.calls[1];
    expect(put).toMatchObject({ method: "PUT", path: "/api/households/shopping/lists/L1" });
    const body = put?.body as Record<string, unknown>;
    expect(body.name).toBe("New");
    expect(body.listItems).toHaveLength(1);
    const out = JSON.parse((result.content[0] as { text: string }).text);
    expect(out).toMatchObject({ id: "L1", name: "New", itemCount: 1 });
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

    const result = await shoppingListUpdateHandler(client, { listId: "x", changes: {} });

    expect(result.isError).toBe(true);
  });
});

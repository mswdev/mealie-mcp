import { describe, expect, it } from "vitest";
import { shoppingItemUpdateHandler } from "./shopping-item-update.js";

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
      return { createdItems: [], updatedItems: [{ id: "i1" }], deletedItems: [] } as T;
    },
  };
}

describe("shoppingItemUpdateHandler", () => {
  it("single: fetch-merges changes and PUTs to the item path", async () => {
    const client = fakeClient({ id: "i1", shoppingListId: "L1", display: "eggs", checked: false });

    const result = await shoppingItemUpdateHandler(client, { itemId: "i1", changes: { checked: true } });

    expect(client.calls[0]).toMatchObject({ method: "GET", path: "/api/households/shopping/items/i1" });
    const put = client.calls[1];
    expect(put).toMatchObject({ method: "PUT", path: "/api/households/shopping/items/i1" });
    expect((put?.body as { checked: boolean }).checked).toBe(true);
    const body = JSON.parse((result.content[0] as { text: string }).text);
    expect(body.updated).toEqual(["i1"]);
  });

  it("bulk: PUTs the items array to /items", async () => {
    const client = fakeClient(undefined);
    const items = [{ id: "i1", display: "a" }];

    await shoppingItemUpdateHandler(client, { items });

    expect(client.calls[0]).toMatchObject({ method: "PUT", path: "/api/households/shopping/items" });
    expect(client.calls[0]?.body).toEqual(items);
  });

  it("errors when neither itemId nor items is provided", async () => {
    const result = await shoppingItemUpdateHandler(fakeClient(undefined), {});

    expect(result.isError).toBe(true);
  });
});

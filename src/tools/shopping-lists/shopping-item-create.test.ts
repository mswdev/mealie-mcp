import { describe, expect, it } from "vitest";
import { shoppingItemCreateHandler } from "./shopping-item-create.js";

type Captured = { path: string; body: unknown };

function fakeClient(captured: Captured[]) {
  return {
    async post<T>(path: string, body: unknown): Promise<T> {
      captured.push({ path, body });
      return { createdItems: [{ id: "i1" }], updatedItems: [], deletedItems: [] } as T;
    },
  };
}

describe("shoppingItemCreateHandler", () => {
  it("single → POST /items and summarizes the collection", async () => {
    const captured: Captured[] = [];
    const item = { shoppingListId: "L1", display: "2 eggs", quantity: 2 };

    const result = await shoppingItemCreateHandler(fakeClient(captured), { item });

    expect(captured[0]?.path).toBe("/api/households/shopping/items");
    expect(captured[0]?.body).toEqual(item);
    const body = JSON.parse((result.content[0] as { text: string }).text);
    expect(body).toEqual({ created: ["i1"], updated: [], deleted: [] });
  });

  it("bulk → POST /items/create-bulk", async () => {
    const captured: Captured[] = [];
    const items = [{ shoppingListId: "L1", display: "a" }, { shoppingListId: "L1", display: "b" }];

    await shoppingItemCreateHandler(fakeClient(captured), { items });

    expect(captured[0]?.path).toBe("/api/households/shopping/items/create-bulk");
    expect(captured[0]?.body).toEqual(items);
  });

  it("errors when neither item nor items is provided", async () => {
    const result = await shoppingItemCreateHandler(fakeClient([]), {});

    expect(result.isError).toBe(true);
  });
});

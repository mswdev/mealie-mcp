import { describe, expect, it } from "vitest";
import { shoppingListCreateHandler } from "./shopping-list-create.js";

type Captured = { path: string; body: unknown };

function fakeClient(captured: Captured[]) {
  return {
    async post<T>(path: string, body: unknown): Promise<T> {
      captured.push({ path, body });
      return {
        id: "L1",
        name: (body as { name: string }).name,
        listItems: [],
        recipeReferences: [],
      } as T;
    },
  };
}

describe("shoppingListCreateHandler", () => {
  it("posts ShoppingListCreate (with extras) and returns concise", async () => {
    const captured: Captured[] = [];

    const result = await shoppingListCreateHandler(fakeClient(captured), { name: "Groceries" });

    expect(captured[0]?.path).toBe("/api/households/shopping/lists");
    expect(captured[0]?.body).toEqual({ name: "Groceries", extras: {} });
    const body = JSON.parse((result.content[0] as { text: string }).text);
    expect(body).toMatchObject({ id: "L1", name: "Groceries", itemCount: 0 });
  });

  it("returns an error result when the client throws", async () => {
    const client = {
      async post<T>(): Promise<T> {
        throw new Error("422");
      },
    };

    const result = await shoppingListCreateHandler(client, { name: "x" });

    expect(result.isError).toBe(true);
  });
});

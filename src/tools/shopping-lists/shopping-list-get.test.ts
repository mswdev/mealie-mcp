import { describe, expect, it } from "vitest";
import { shoppingListGetHandler } from "./shopping-list-get.js";

const fullList = {
  id: "L1",
  name: "Groceries",
  groupId: "g",
  listItems: [{ id: "i1", display: "2 eggs", quantity: 2, checked: false, note: "" }],
  recipeReferences: [{ recipeId: "r1" }],
  labelSettings: [{ id: "lab1" }],
};

function fakeClient(captured: string[]) {
  return {
    async get<T>(path: string): Promise<T> {
      captured.push(path);
      return fullList as T;
    },
  };
}

describe("shoppingListGetHandler", () => {
  it("returns the concise (aggregated) projection by default", async () => {
    const captured: string[] = [];

    const result = await shoppingListGetHandler(fakeClient(captured), { listId: "L1" });

    expect(captured[0]).toBe("/api/households/shopping/lists/L1");
    const body = JSON.parse((result.content[0] as { text: string }).text);
    expect(body).toMatchObject({ id: "L1", name: "Groceries", itemCount: 1 });
    expect(body.items).toHaveLength(1);
  });

  it("returns the whole list when detailed", async () => {
    const result = await shoppingListGetHandler(fakeClient([]), {
      listId: "L1",
      response_format: "detailed",
    });

    const body = JSON.parse((result.content[0] as { text: string }).text);
    expect(body.labelSettings).toEqual([{ id: "lab1" }]);
  });

  it("returns an error result when the client throws", async () => {
    const client = {
      async get<T>(): Promise<T> {
        throw new Error("404");
      },
    };

    const result = await shoppingListGetHandler(client, { listId: "missing" });

    expect(result.isError).toBe(true);
  });
});

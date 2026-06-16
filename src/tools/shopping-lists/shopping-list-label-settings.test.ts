import { describe, expect, it } from "vitest";
import { shoppingListLabelSettingsHandler } from "./shopping-list-label-settings.js";

type Captured = { path: string; body: unknown };

function fakeClient(captured: Captured[]) {
  return {
    async put<T>(path: string, body: unknown): Promise<T> {
      captured.push({ path, body });
      return { id: "L1", name: "Groceries", listItems: [], recipeReferences: [] } as T;
    },
  };
}

describe("shoppingListLabelSettingsHandler", () => {
  it("PUTs the labels array to the label-settings path and returns concise", async () => {
    const captured: Captured[] = [];
    const labels = [{ id: "x", shoppingListId: "L1", labelId: "lab1", position: 0 }];

    const result = await shoppingListLabelSettingsHandler(fakeClient(captured), {
      listId: "L1",
      labels,
    });

    expect(captured[0]?.path).toBe("/api/households/shopping/lists/L1/label-settings");
    expect(captured[0]?.body).toEqual(labels);
    const body = JSON.parse((result.content[0] as { text: string }).text);
    expect(body).toMatchObject({ id: "L1" });
  });

  it("returns an error result when the client throws", async () => {
    const client = {
      async put<T>(): Promise<T> {
        throw new Error("boom");
      },
    };

    const result = await shoppingListLabelSettingsHandler(client, { listId: "L1", labels: [] });

    expect(result.isError).toBe(true);
  });
});

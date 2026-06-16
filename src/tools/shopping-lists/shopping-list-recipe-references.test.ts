import { describe, expect, it } from "vitest";
import { recipeReferencesHandler } from "./shopping-list-recipe-references.js";

type Captured = { path: string; body: unknown };

function fakeClient(captured: Captured[]) {
  return {
    async post<T>(path: string, body: unknown): Promise<T> {
      captured.push({ path, body });
      return { id: "L", name: "n", listItems: [], recipeReferences: [] } as T;
    },
  };
}

describe("recipeReferencesHandler", () => {
  it("add → POST /recipe with a bulk params array", async () => {
    const captured: Captured[] = [];

    await recipeReferencesHandler(fakeClient(captured), {
      action: "add",
      listId: "L",
      recipeId: "r1",
      quantity: 2,
    });

    expect(captured[0]?.path).toBe("/api/households/shopping/lists/L/recipe");
    expect(captured[0]?.body).toEqual([{ recipeId: "r1", recipeIncrementQuantity: 2 }]);
  });

  it("add_by_recipe → POST /recipe/{recipeId} (deprecated path form)", async () => {
    const captured: Captured[] = [];

    await recipeReferencesHandler(fakeClient(captured), {
      action: "add_by_recipe",
      listId: "L",
      recipeId: "r1",
    });

    expect(captured[0]?.path).toBe("/api/households/shopping/lists/L/recipe/r1");
    expect(captured[0]?.body).toEqual({ recipeIncrementQuantity: 1 });
  });

  it("remove → POST /recipe/{recipeId}/delete (not a DELETE verb)", async () => {
    const captured: Captured[] = [];

    await recipeReferencesHandler(fakeClient(captured), {
      action: "remove",
      listId: "L",
      recipeId: "r1",
    });

    expect(captured[0]?.path).toBe("/api/households/shopping/lists/L/recipe/r1/delete");
    expect(captured[0]?.body).toEqual({ recipeDecrementQuantity: 1 });
  });

  it("errors when recipeId is missing", async () => {
    const result = await recipeReferencesHandler(fakeClient([]), { action: "add", listId: "L" });

    expect(result.isError).toBe(true);
  });
});

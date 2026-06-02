import { describe, expect, it } from "vitest";
import { projectItemsCollection, projectShoppingList } from "./shopping-projection.js";

describe("projectShoppingList", () => {
  it("returns id, name, item count, concise items, and recipe refs", () => {
    const list = {
      id: "L1",
      name: "Groceries",
      groupId: "g",
      userId: "u",
      householdId: "h",
      listItems: [
        {
          id: "i1",
          display: "2 eggs",
          quantity: 2,
          checked: false,
          note: "",
          foodId: "f",
          unitId: "un",
          labelId: "l",
          extras: { huge: true },
        },
      ],
      recipeReferences: [{ recipeId: "r1", recipeQuantity: 1 }],
      labelSettings: [],
    };

    const concise = projectShoppingList(list as never, "concise");

    expect(concise).toEqual({
      id: "L1",
      name: "Groceries",
      itemCount: 1,
      items: [
        {
          id: "i1",
          display: "2 eggs",
          quantity: 2,
          checked: false,
          note: "",
          foodId: "f",
          unitId: "un",
          labelId: "l",
        },
      ],
      recipeReferences: [{ recipeId: "r1" }],
    });
  });

  it("returns the whole list when detailed", () => {
    const list = { id: "L1", listItems: [], recipeReferences: [], labelSettings: [{ big: true }] };

    expect(projectShoppingList(list as never, "detailed")).toBe(list);
  });
});

describe("projectItemsCollection", () => {
  it("summarizes created/updated/deleted ids", () => {
    const collection = {
      createdItems: [{ id: "a" }, { id: "b" }],
      updatedItems: [{ id: "c" }],
      deletedItems: [],
    };

    expect(projectItemsCollection(collection as never)).toEqual({
      created: ["a", "b"],
      updated: ["c"],
      deleted: [],
    });
  });
});

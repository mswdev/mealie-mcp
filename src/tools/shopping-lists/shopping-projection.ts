import type { components } from "../../types/mealie.js";

/** Full shopping list (with items, recipe refs, label settings). */
export type ShoppingList = components["schemas"]["ShoppingListOut"];
/** A single shopping list item. */
export type ShoppingItem = components["schemas"]["ShoppingListItemOut-Output"];
/** The container returned by bulk/single item writes. */
export type ItemsCollection = components["schemas"]["ShoppingListItemsCollectionOut"];

/** Lightweight fields kept per item in the concise list projection. */
const ITEM_CONCISE = ["id", "display", "quantity", "checked", "note", "foodId", "unitId", "labelId"] as const;

/** Projects one shopping item to a concise view. */
function projectItem(item: Record<string, unknown>): Record<string, unknown> {
  const concise: Record<string, unknown> = {};
  for (const field of ITEM_CONCISE) concise[field] = item[field];
  return concise;
}

/**
 * Projects a full shopping list to a concise view (id, name, item count, concise
 * items + recipe refs), or returns it whole when detailed. Shared by the list
 * read/write tools that echo a list.
 *
 * @param list - The full ShoppingListOut
 * @param format - "concise" trims items; "detailed" returns everything
 * @returns The projected list as a plain record
 */
export function projectShoppingList(
  list: ShoppingList,
  format: "concise" | "detailed",
): Record<string, unknown> {
  if (format === "detailed") return list as unknown as Record<string, unknown>;
  const source = list as unknown as Record<string, unknown>;
  const items = (source.listItems as Record<string, unknown>[] | undefined) ?? [];
  const refs = (source.recipeReferences as { recipeId?: string }[] | undefined) ?? [];
  return {
    id: source.id,
    name: source.name,
    itemCount: items.length,
    items: items.map(projectItem),
    recipeReferences: refs.map((r) => ({ recipeId: r.recipeId })),
  };
}

/**
 * Summarizes an item-write collection into concise counts + affected ids.
 *
 * @param collection - The ShoppingListItemsCollectionOut returned by item writes
 * @returns The created/updated/deleted item ids
 */
export function projectItemsCollection(collection: ItemsCollection): Record<string, unknown> {
  const source = collection as unknown as Record<string, Record<string, unknown>[]>;
  const ids = (group: string) => (source[group] ?? []).map((item) => item.id);
  return {
    created: ids("createdItems"),
    updated: ids("updatedItems"),
    deleted: ids("deletedItems"),
  };
}

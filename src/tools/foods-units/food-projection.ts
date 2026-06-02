import type { components } from "../../types/mealie.js";

/** The full food object returned by Mealie's food endpoints. */
export type FoodDetail = components["schemas"]["IngredientFood-Output"];

/** Lightweight fields kept in the concise projection. */
const CONCISE_FIELDS = ["id", "name", "pluralName", "description", "labelId"] as const;

/**
 * Projects a full food to a concise view, or returns it whole when detailed.
 * Shared by every food tool that echoes a food.
 *
 * @param food - The full IngredientFood object
 * @param format - "concise" trims to the key fields; "detailed" returns everything
 * @returns The projected food as a plain record
 */
export function projectFood(
  food: FoodDetail,
  format: "concise" | "detailed",
): Record<string, unknown> {
  if (format === "detailed") return food as unknown as Record<string, unknown>;
  const source = food as unknown as Record<string, unknown>;
  const concise: Record<string, unknown> = {};
  for (const field of CONCISE_FIELDS) concise[field] = source[field];
  return concise;
}

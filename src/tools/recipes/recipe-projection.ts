import type { components } from "../../types/mealie.js";

/** The full recipe object returned by Mealie's recipe read/write endpoints. */
export type RecipeDetail = components["schemas"]["Recipe-Output"];

/** Heavy fields that can be added back onto the concise projection via `include`. */
export type Includable = "comments" | "nutrition";

/** Lightweight fields kept in the concise projection (design §1.3). Exported only so the
 *  explore toolset's duplicated copy can be drift-guarded by a test (sibling imports are
 *  otherwise forbidden — see .claude/rules/file-organization.md). */
export const CONCISE_FIELDS = [
  "id",
  "slug",
  "name",
  "description",
  "image",
  "rating",
  "recipeServings",
  "recipeYield",
  "recipeYieldQuantity",
  "totalTime",
  "prepTime",
  "cookTime",
  "performTime",
  "recipeCategory",
  "tags",
  "tools",
  "dateUpdated",
  "lastMade",
] as const;

/**
 * Projects a full recipe to a concise view (plus optional heavy includes), or
 * returns it whole when detailed. Shared by every recipe tool that echoes a recipe.
 *
 * @param recipe - The full Recipe-Output object
 * @param format - "concise" trims heavy fields; "detailed" returns everything
 * @param include - Heavy fields to add back onto the concise view (ignored when detailed)
 * @returns The projected recipe as a plain record
 */
export function projectRecipe(
  recipe: RecipeDetail,
  format: "concise" | "detailed",
  include: Includable[],
): Record<string, unknown> {
  if (format === "detailed") return recipe as unknown as Record<string, unknown>;
  const source = recipe as unknown as Record<string, unknown>;
  const concise: Record<string, unknown> = {};
  for (const field of CONCISE_FIELDS) concise[field] = source[field];
  for (const field of include) concise[field] = source[field];
  return concise;
}

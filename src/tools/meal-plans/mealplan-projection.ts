import type { components } from "../../types/mealie.js";

/** A meal-plan entry as returned by Mealie. */
export type PlanEntry = components["schemas"]["ReadPlanEntry"];
/** A meal-plan rule as returned by Mealie. */
export type PlanRule = components["schemas"]["PlanRulesOut"];

/** Scheduling fields kept in the concise meal-plan-entry projection. */
const ENTRY_CONCISE = ["id", "date", "entryType", "title", "text", "recipeId"] as const;

/**
 * Projects a meal-plan entry to a concise view (adds a recipe {id,slug,name}
 * stub when present), or returns it whole when detailed. Shared by every
 * meal-plan tool that echoes an entry.
 *
 * @param entry - The full ReadPlanEntry
 * @param format - "concise" trims to scheduling fields; "detailed" returns everything
 * @returns The projected entry as a plain record
 */
export function projectPlanEntry(
  entry: PlanEntry,
  format: "concise" | "detailed",
): Record<string, unknown> {
  if (format === "detailed") return entry as unknown as Record<string, unknown>;
  const source = entry as unknown as Record<string, unknown>;
  const concise: Record<string, unknown> = {};
  for (const field of ENTRY_CONCISE) concise[field] = source[field];
  const recipe = source.recipe as { id?: string; slug?: string; name?: string } | null | undefined;
  if (recipe) concise.recipe = { id: recipe.id, slug: recipe.slug, name: recipe.name };
  return concise;
}

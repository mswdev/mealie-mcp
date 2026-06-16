import type { components } from "../../types/mealie.js";

/** A recipe action as returned by Mealie's recipe-action endpoints. */
export type RecipeAction = components["schemas"]["GroupRecipeActionOut"];

/** Concise fields (omit groupId/householdId). */
const CONCISE_FIELDS = ["id", "actionType", "title", "url"] as const;

/**
 * Projects a full recipe action to a concise view, or returns it whole when
 * detailed. Shared by every recipe-action tool that echoes an action.
 *
 * @param action - The full GroupRecipeActionOut object
 * @param format - "concise" trims to the key fields; "detailed" returns everything
 * @returns The projected recipe action as a plain record
 */
export function projectRecipeAction(
  action: RecipeAction,
  format: "concise" | "detailed",
): Record<string, unknown> {
  if (format === "detailed") return action as unknown as Record<string, unknown>;
  const source = action as unknown as Record<string, unknown>;
  const concise: Record<string, unknown> = {};
  for (const field of CONCISE_FIELDS) concise[field] = source[field];
  return concise;
}

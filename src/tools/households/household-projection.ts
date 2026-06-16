import type { components } from "../../types/mealie.js";

/** The current user's household, as returned by GET /api/households/self. */
export type Household = components["schemas"]["HouseholdInDB"];

/** Concise fields — drops the heavy preferences/users/webhooks blocks. */
const CONCISE_FIELDS = ["id", "name", "slug", "groupId"] as const;

/**
 * Projects the household to a concise view, or returns it whole when detailed.
 *
 * @param household - The full HouseholdInDB object
 * @param format - "concise" trims to id/name/slug/groupId; "detailed" returns everything
 * @returns The projected household as a plain record
 */
export function projectHousehold(
  household: Household,
  format: "concise" | "detailed",
): Record<string, unknown> {
  if (format === "detailed") return household as unknown as Record<string, unknown>;
  const source = household as unknown as Record<string, unknown>;
  const concise: Record<string, unknown> = {};
  for (const field of CONCISE_FIELDS) concise[field] = source[field];
  return concise;
}

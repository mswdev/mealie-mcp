import type { components } from "../../types/mealie.js";

/** The full cookbook object returned by Mealie's cookbook endpoints. */
export type CookbookDetail = components["schemas"]["ReadCookBook"];

/** Lightweight fields kept in the concise projection. */
const CONCISE_FIELDS = [
  "id",
  "slug",
  "name",
  "description",
  "public",
  "position",
  "queryFilterString",
] as const;

/**
 * Projects a full cookbook to a concise view, or returns it whole when detailed.
 * Shared by every cookbook tool that echoes a cookbook.
 *
 * @param cookbook - The full ReadCookBook object
 * @param format - "concise" trims heavy fields (queryFilter, household); "detailed" returns everything
 * @returns The projected cookbook as a plain record
 */
export function projectCookbook(
  cookbook: CookbookDetail,
  format: "concise" | "detailed",
): Record<string, unknown> {
  if (format === "detailed") return cookbook as unknown as Record<string, unknown>;
  const source = cookbook as unknown as Record<string, unknown>;
  const concise: Record<string, unknown> = {};
  for (const field of CONCISE_FIELDS) concise[field] = source[field];
  return concise;
}

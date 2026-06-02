import type { components } from "../../types/mealie.js";

/** The full unit object returned by Mealie's unit endpoints. */
export type UnitDetail = components["schemas"]["IngredientUnit-Output"];

/** Lightweight fields kept in the concise projection. */
const CONCISE_FIELDS = [
  "id",
  "name",
  "pluralName",
  "abbreviation",
  "useAbbreviation",
  "fraction",
  "description",
] as const;

/**
 * Projects a full unit to a concise view, or returns it whole when detailed.
 * Shared by every unit tool that echoes a unit.
 *
 * @param unit - The full IngredientUnit object
 * @param format - "concise" trims to the key fields; "detailed" returns everything
 * @returns The projected unit as a plain record
 */
export function projectUnit(
  unit: UnitDetail,
  format: "concise" | "detailed",
): Record<string, unknown> {
  if (format === "detailed") return unit as unknown as Record<string, unknown>;
  const source = unit as unknown as Record<string, unknown>;
  const concise: Record<string, unknown> = {};
  for (const field of CONCISE_FIELDS) concise[field] = source[field];
  return concise;
}

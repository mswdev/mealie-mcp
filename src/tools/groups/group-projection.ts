import type { components } from "../../types/mealie.js";

/** A MultiPurpose label as returned by Mealie's group label endpoints. */
export type Label = components["schemas"]["MultiPurposeLabelOut"];

/** Fields kept in a label's concise projection. */
const LABEL_CONCISE_FIELDS = ["id", "name", "color"] as const;

/**
 * Projects a full label to a concise view, or returns it whole when detailed.
 *
 * @param label - The full MultiPurposeLabelOut object
 * @param format - "concise" trims to id/name/color; "detailed" returns everything
 * @returns The projected label as a plain record
 */
export function projectLabel(
  label: Label,
  format: "concise" | "detailed",
): Record<string, unknown> {
  if (format === "detailed") return label as unknown as Record<string, unknown>;
  const source = label as unknown as Record<string, unknown>;
  const concise: Record<string, unknown> = {};
  for (const field of LABEL_CONCISE_FIELDS) concise[field] = source[field];
  return concise;
}

import type { components } from "../../types/mealie.js";

/** An event notifier as returned by Mealie's notification endpoints. */
export type EventNotifier = components["schemas"]["GroupEventNotifierOut"];

/** Concise fields — omit the heavy 27-boolean `options` object. */
const CONCISE_FIELDS = ["id", "name", "enabled"] as const;

/**
 * Projects a full event notifier to a concise view, or returns it whole when
 * detailed. Concise drops the large `options` block (27 event toggles).
 *
 * @param notifier - The full GroupEventNotifierOut object
 * @param format - "concise" trims to id/name/enabled; "detailed" returns everything
 * @returns The projected notifier as a plain record
 */
export function projectEventNotifier(
  notifier: EventNotifier,
  format: "concise" | "detailed",
): Record<string, unknown> {
  if (format === "detailed") return notifier as unknown as Record<string, unknown>;
  const source = notifier as unknown as Record<string, unknown>;
  const concise: Record<string, unknown> = {};
  for (const field of CONCISE_FIELDS) concise[field] = source[field];
  return concise;
}

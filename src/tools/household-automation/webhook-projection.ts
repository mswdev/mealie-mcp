import type { components } from "../../types/mealie.js";

/** A webhook as returned by Mealie's webhook endpoints. */
export type Webhook = components["schemas"]["ReadWebhook"];

/** Lightweight fields kept in the concise projection (omits groupId/householdId). */
const CONCISE_FIELDS = ["id", "name", "url", "enabled", "webhookType", "scheduledTime"] as const;

/**
 * Projects a full webhook to a concise view, or returns it whole when detailed.
 * Shared by every webhook tool that echoes a webhook.
 *
 * @param hook - The full ReadWebhook object
 * @param format - "concise" trims to the key fields; "detailed" returns everything
 * @returns The projected webhook as a plain record
 */
export function projectWebhook(
  hook: Webhook,
  format: "concise" | "detailed",
): Record<string, unknown> {
  if (format === "detailed") return hook as unknown as Record<string, unknown>;
  const source = hook as unknown as Record<string, unknown>;
  const concise: Record<string, unknown> = {};
  for (const field of CONCISE_FIELDS) concise[field] = source[field];
  return concise;
}

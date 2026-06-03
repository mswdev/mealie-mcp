import type { components } from "../../types/mealie.js";

/** The logged-in user's group, as returned by GET /api/groups/self. */
export type GroupSummary = components["schemas"]["GroupSummary"];

/** Fields kept in a group's concise projection (drops embedded preferences/aiProviderSettings). */
const GROUP_CONCISE_FIELDS = ["id", "slug", "name"] as const;

/**
 * Projects a group summary to a concise view, or returns it whole when detailed.
 *
 * @param group - The full GroupSummary object
 * @param format - "concise" trims to id/slug/name; "detailed" returns everything
 * @returns The projected group as a plain record
 */
export function projectGroup(
  group: GroupSummary,
  format: "concise" | "detailed",
): Record<string, unknown> {
  if (format === "detailed") return group as unknown as Record<string, unknown>;
  const source = group as unknown as Record<string, unknown>;
  const concise: Record<string, unknown> = {};
  for (const field of GROUP_CONCISE_FIELDS) concise[field] = source[field];
  return concise;
}

/** A household as listed under a group (GET /api/groups/households). */
export type HouseholdSummary = components["schemas"]["HouseholdSummary"];

/** Fields kept in a household summary's concise projection. */
const HOUSEHOLD_CONCISE_FIELDS = ["id", "slug", "name"] as const;

/**
 * Projects a household summary to a concise view, or returns it whole when detailed.
 *
 * @param household - The full HouseholdSummary object
 * @param format - "concise" trims to id/slug/name; "detailed" returns everything
 * @returns The projected household as a plain record
 */
export function projectHouseholdSummary(
  household: HouseholdSummary,
  format: "concise" | "detailed",
): Record<string, unknown> {
  if (format === "detailed") return household as unknown as Record<string, unknown>;
  const source = household as unknown as Record<string, unknown>;
  const concise: Record<string, unknown> = {};
  for (const field of HOUSEHOLD_CONCISE_FIELDS) concise[field] = source[field];
  return concise;
}

/** A report summary, as listed by GET /api/groups/reports. */
export type ReportSummary = components["schemas"]["ReportSummary"];

/** Fields kept in a report's concise projection (drops the heavy entries[] on detail). */
const REPORT_CONCISE_FIELDS = ["id", "name", "category", "status", "timestamp"] as const;

/**
 * Projects a report (summary or detail) to a concise view, or returns it whole.
 *
 * @param report - A ReportSummary or ReportOut object
 * @param format - "concise" trims to id/name/category/status/timestamp; "detailed" returns everything
 * @returns The projected report as a plain record
 */
export function projectReport(
  report: Record<string, unknown>,
  format: "concise" | "detailed",
): Record<string, unknown> {
  if (format === "detailed") return report;
  const concise: Record<string, unknown> = {};
  for (const field of REPORT_CONCISE_FIELDS) concise[field] = report[field];
  return concise;
}

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

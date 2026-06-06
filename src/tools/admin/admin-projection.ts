import type { components } from "../../types/mealie.js";

/** An admin-visible user, as returned by the /api/admin/users endpoints. */
export type AdminUser = components["schemas"]["UserOut"];

/** Instance diagnostics from GET /api/admin/about. */
export type AdminAbout = components["schemas"]["AdminAboutInfo"];

/** Mealie's generic write acknowledgement ({message, error} — error:true on a 200 IS a failure). */
export type SuccessResponse = components["schemas"]["SuccessResponse"];

/** An admin-visible household, as returned by the /api/admin/households endpoints. */
export type AdminHousehold = components["schemas"]["HouseholdInDB"];

/** An admin-visible group, as returned by the /api/admin/groups endpoints. */
export type AdminGroup = components["schemas"]["GroupInDB"];

/** dbUrl is a DB connection string that may embed credentials — never surfaced. */
const ABOUT_REDACTED_FIELDS = ["dbUrl"] as const;

/**
 * cacheKey is an opaque session-ish value — stripped from every model-facing
 * result, but NEVER from a fetch-merge base (the admin user PUT must round-trip it).
 */
const USER_REDACTED_FIELDS = ["cacheKey"] as const;

/**
 * Fields kept in a user's concise projection. `tokens` stays: LongLiveTokenOut[]
 * is metadata-only (id/name/createdAt — never the raw token value).
 */
const USER_CONCISE_FIELDS = [
  "id",
  "username",
  "fullName",
  "email",
  "admin",
  "authMethod",
  "group",
  "household",
  "groupId",
  "householdId",
  "tokens",
] as const;

/** Fields kept in a household's concise projection (nested users/webhooks trimmed). */
const HOUSEHOLD_CONCISE_FIELDS = ["id", "name", "slug", "groupId", "group", "preferences"] as const;

/** Fields kept in a group's concise projection (nested lists trimmed). */
const GROUP_CONCISE_FIELDS = ["id", "name", "slug", "preferences"] as const;

/**
 * Keeps only the named fields of a record (no `delete`, no destructure-discards — Biome).
 *
 * @param source - The record to project
 * @param fields - The field names to keep
 * @returns A new record containing only the named fields
 */
export function pickFields(
  source: Record<string, unknown>,
  fields: readonly string[],
): Record<string, unknown> {
  return Object.fromEntries(Object.entries(source).filter(([key]) => fields.includes(key)));
}

/**
 * Drops the named fields of a record (no `delete`, no destructure-discards — Biome).
 *
 * @param source - The record to project
 * @param fields - The field names to drop
 * @returns A new record without the named fields
 */
export function omitFields(
  source: Record<string, unknown>,
  fields: readonly string[],
): Record<string, unknown> {
  return Object.fromEntries(Object.entries(source).filter(([key]) => !fields.includes(key)));
}

/**
 * Projects the admin about payload for output, redacting the DB connection string.
 *
 * @param about - The full AdminAboutInfo object
 * @returns The about info without dbUrl
 */
export function projectAdminAbout(about: AdminAbout): Record<string, unknown> {
  return omitFields(about as unknown as Record<string, unknown>, ABOUT_REDACTED_FIELDS);
}

/**
 * Projects an admin-visible user for output. Both formats redact cacheKey;
 * concise trims to identity + permission basics + the token metadata list.
 *
 * @param user - The full UserOut object
 * @param format - "concise" trims; "detailed" returns everything except redactions
 * @returns The projected user as a plain record
 */
export function projectAdminUser(
  user: AdminUser,
  format: "concise" | "detailed",
): Record<string, unknown> {
  const source = user as unknown as Record<string, unknown>;
  if (format === "detailed") return omitFields(source, USER_REDACTED_FIELDS);
  return pickFields(source, USER_CONCISE_FIELDS);
}

/**
 * Projects an admin-visible household for output. Concise trims the nested
 * member/webhook lists; detailed returns everything.
 *
 * @param household - The full HouseholdInDB object
 * @param format - "concise" trims; "detailed" returns everything
 * @returns The projected household as a plain record
 */
export function projectAdminHousehold(
  household: AdminHousehold,
  format: "concise" | "detailed",
): Record<string, unknown> {
  const source = household as unknown as Record<string, unknown>;
  if (format === "detailed") return source;
  return pickFields(source, HOUSEHOLD_CONCISE_FIELDS);
}

/**
 * Projects an admin-visible group for output. Concise trims the nested
 * category/webhook/household/user lists; detailed returns everything.
 *
 * @param group - The full GroupInDB object
 * @param format - "concise" trims; "detailed" returns everything
 * @returns The projected group as a plain record
 */
export function projectAdminGroup(
  group: AdminGroup,
  format: "concise" | "detailed",
): Record<string, unknown> {
  const source = group as unknown as Record<string, unknown>;
  if (format === "detailed") return source;
  return pickFields(source, GROUP_CONCISE_FIELDS);
}

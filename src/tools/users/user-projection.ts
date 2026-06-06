import type { components } from "../../types/mealie.js";

/** The logged-in user, as returned by GET /api/users/self (and by registration). */
export type User = components["schemas"]["UserOut"];

/**
 * Fields kept in a user's concise projection. `tokens` MUST stay: UserOut.tokens
 * (LongLiveTokenOut[] — id/name/createdAt, never the raw token value) is the API's
 * only token enumeration, and user_api_token_write(delete) needs the integer id.
 */
const USER_CONCISE_FIELDS = [
  "id",
  "username",
  "fullName",
  "email",
  "admin",
  "group",
  "household",
  "groupId",
  "householdId",
  "tokens",
] as const;

/**
 * Projects a user to a concise view, or returns it whole when detailed.
 *
 * @param user - The full UserOut object
 * @param format - "concise" trims to identity + permission basics + token list; "detailed" returns everything
 * @returns The projected user as a plain record
 */
export function projectUser(user: User, format: "concise" | "detailed"): Record<string, unknown> {
  if (format === "detailed") return user as unknown as Record<string, unknown>;
  const source = user as unknown as Record<string, unknown>;
  const concise: Record<string, unknown> = {};
  for (const field of USER_CONCISE_FIELDS) concise[field] = source[field];
  return concise;
}

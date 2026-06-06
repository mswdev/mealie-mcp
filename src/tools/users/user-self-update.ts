import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod";
import type { MealieClient } from "../../client/MealieClient.js";
import { errorResult, jsonResult } from "../result.js";

const SELF_PATH = "/api/users/self";

/**
 * The PUT body schema (mealie__schema__user__user__UserBase) field set. The PUT
 * reuses the base schema (no UserUpdate exists), so the body is whitelist-projected
 * from the fetched UserOut — which carries extra *Id/*Slug/tokens/cacheKey keys the
 * PUT schema does not accept.
 */
const USER_BASE_FIELDS = [
  "id",
  "username",
  "fullName",
  "email",
  "authMethod",
  "admin",
  "group",
  "household",
  "advanced",
  "showAnnouncements",
  "lastReadAnnouncement",
  "canInvite",
  "canManage",
  "canManageHousehold",
  "canOrganize",
] as const;

/** Minimal client surface the handler needs (eases test fakes). */
type UpdateClient = Pick<MealieClient, "get" | "put">;

const inputSchema = {
  changes: z
    .record(z.string(), z.unknown())
    .optional()
    .describe(
      "Fields to change (e.g. username, fullName, email). Permission flags (admin, can*) pass through but require admin rights; group/household are NAME strings, not ids.",
    ),
};

type SelfUpdateArgs = {
  changes?: Record<string, unknown> | undefined;
};

/**
 * Handles user_self_update: GET /api/users/self, project onto the UserBase field
 * set (the PUT schema is a full replace — partial bodies silently reset fields),
 * overlay the caller's changes, and PUT to the own user id.
 *
 * @param client - A MealieClient (or compatible fake)
 * @param args - Validated arguments ({ changes })
 * @returns An MCP result echoing { updated, user }, or an error result
 */
export async function userSelfUpdateHandler(
  client: UpdateClient,
  args: SelfUpdateArgs,
): Promise<CallToolResult> {
  if (!args.changes) return missingChanges();
  try {
    const current = await client.get<Record<string, unknown>>(SELF_PATH);
    const merged = projectOntoUserBase({ ...current, ...args.changes });
    await client.put(`/api/users/${current.id}`, merged);
    return jsonResult({ updated: current.id, user: merged });
  } catch (error) {
    return errorResult(error, "user_self_update", "Failed to update user");
  }
}

/** Keeps only the fields the UserBase PUT schema accepts (no delete/destructure — Biome). */
function projectOntoUserBase(source: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(source).filter(([key]) => (USER_BASE_FIELDS as readonly string[]).includes(key)),
  );
}

/** Returns an isError result for the missing changes record. */
function missingChanges(): CallToolResult {
  return {
    content: [{ type: "text", text: "user_self_update: changes is required" }],
    isError: true,
  };
}

/**
 * Registers the user_self_update tool on the server.
 *
 * @param server - The McpServer to register on
 * @param client - The MealieClient used by the handler
 */
export function registerUserSelfUpdate(server: McpServer, client: MealieClient): void {
  server.registerTool(
    "user_self_update",
    {
      title: "Update My User (Self)",
      description:
        "Update the current user's profile (username, fullName, email, showAnnouncements, …). Fetches the current profile and merges your changes — untouched fields are preserved. Permission flags require admin rights on the instance.",
      inputSchema,
      annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: true },
    },
    (args) => userSelfUpdateHandler(client, args),
  );
}

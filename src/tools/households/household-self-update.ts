import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod";
import type { MealieClient } from "../../client/MealieClient.js";
import type { components } from "../../types/mealie.js";
import { requireConfirmation } from "../confirm.js";
import { errorResult, jsonResult } from "../result.js";

const PREFERENCES_PATH = "/api/households/preferences";
const PERMISSIONS_PATH = "/api/households/permissions";
const MEMBERS_PATH = "/api/households/members";
/** Members fetched when locating the target of a permissions change (one page suffices for a household). */
const MEMBER_FETCH_LIMIT = 100;

/** A household member, carrying the four permission flags. */
type Member = components["schemas"]["UserOut"];

/** Minimal client surface the handler needs (eases test fakes). */
type UpdateClient = Pick<MealieClient, "get" | "getPaginated" | "put">;

const inputSchema = {
  target: z.enum(["preferences", "permissions"]).describe("What to update"),
  changes: z
    .record(z.unknown())
    .optional()
    .describe("Preference fields to change, merged onto current preferences (target=preferences)"),
  userId: z.string().optional().describe("Member id whose permissions to set (target=permissions)"),
  canManageHousehold: z.boolean().optional().describe("Grant household-management rights"),
  canManage: z.boolean().optional().describe("Grant management rights"),
  canInvite: z.boolean().optional().describe("Grant invite rights"),
  canOrganize: z.boolean().optional().describe("Grant organize rights"),
  confirm: z
    .boolean()
    .optional()
    .describe("Must be true to change permissions (privilege-elevating; target=permissions)"),
};

type UpdateArgs = {
  target: "preferences" | "permissions";
  changes?: Record<string, unknown> | undefined;
  userId?: string | undefined;
  canManageHousehold?: boolean | undefined;
  canManage?: boolean | undefined;
  canInvite?: boolean | undefined;
  canOrganize?: boolean | undefined;
  confirm?: boolean | undefined;
};

/**
 * Handles household_self_update: update household preferences (fetch-merge), or
 * set a member's permissions (privilege-elevating → confirm-gated).
 *
 * @param client - A MealieClient (or compatible fake)
 * @param args - Validated arguments (target + target-specific fields)
 * @returns An MCP result with the updated resource, or an error result
 */
export async function householdSelfUpdateHandler(
  client: UpdateClient,
  args: UpdateArgs,
): Promise<CallToolResult> {
  if (args.target === "permissions") return updatePermissions(client, args);
  try {
    return await updatePreferences(client, args);
  } catch (error) {
    return errorResult(error, "household_self_update", "Failed to update household preferences");
  }
}

/**
 * Fetch-merges household preferences. UpdateHouseholdPreferences is a distinct
 * schema but a FULL replace (all 9 fields required), so an omitted field would
 * silently reset to its default — hence the merge onto the current preferences.
 */
async function updatePreferences(client: UpdateClient, args: UpdateArgs): Promise<CallToolResult> {
  if (!args.changes) return missing("target=preferences requires changes");
  const current = await client.get<Record<string, unknown>>(PREFERENCES_PATH);
  const merged = { ...current, ...args.changes };
  return jsonResult(await client.put(PREFERENCES_PATH, merged));
}

/** Confirm-gates the privilege-elevating permissions change before doing any work. */
async function updatePermissions(client: UpdateClient, args: UpdateArgs): Promise<CallToolResult> {
  if (!args.userId) return missing("target=permissions requires userId");
  const unconfirmed = requireConfirmation(
    args.confirm,
    `change permissions for member ${args.userId}`,
  );
  if (unconfirmed) return unconfirmed;
  try {
    return await setPermissions(client, args, args.userId);
  } catch (error) {
    return errorResult(error, "household_self_update", "Failed to set member permissions");
  }
}

/**
 * Sets a member's permission flags. SetPermissions is full-replace (omitted flags
 * default to false), so we fetch the member's current flags and overlay only the
 * supplied ones — otherwise an unspecified flag would silently downgrade access.
 */
async function setPermissions(
  client: UpdateClient,
  args: UpdateArgs,
  userId: string,
): Promise<CallToolResult> {
  const member = await findMember(client, userId);
  if (!member) return missing(`member ${userId} not found in this household`);
  const body: components["schemas"]["SetPermissions"] = {
    userId,
    canManageHousehold: args.canManageHousehold ?? member.canManageHousehold,
    canManage: args.canManage ?? member.canManage,
    canInvite: args.canInvite ?? member.canInvite,
    canOrganize: args.canOrganize ?? member.canOrganize,
  };
  const updated = await client.put<Member>(PERMISSIONS_PATH, body);
  return jsonResult({ userId, permissions: pickFlags(updated) });
}

/** Finds the target member in the household roster (one page covers a household). */
async function findMember(client: UpdateClient, userId: string): Promise<Member | undefined> {
  const page = await client.getPaginated<Member>(MEMBERS_PATH, { perPage: MEMBER_FETCH_LIMIT });
  return page.items.find((member) => member.id === userId);
}

/** Extracts the four permission flags from a member for the echoed response. */
function pickFlags(member: Member): Record<string, boolean> {
  return {
    canManageHousehold: member.canManageHousehold,
    canManage: member.canManage,
    canInvite: member.canInvite,
    canOrganize: member.canOrganize,
  };
}

/** Returns an isError result describing the missing requirement for the target. */
function missing(requirement: string): CallToolResult {
  return {
    content: [{ type: "text", text: `household_self_update: ${requirement}` }],
    isError: true,
  };
}

/**
 * Registers the household_self_update tool on the server.
 *
 * @param server - The McpServer to register on
 * @param client - The MealieClient used by the handler
 */
export function registerHouseholdSelfUpdate(server: McpServer, client: MealieClient): void {
  server.registerTool(
    "household_self_update",
    {
      title: "Update Household (Self)",
      description:
        "Update your household. target=preferences merges changes onto current preferences (full replace). target=permissions sets a member's flags — privilege-elevating, so it requires confirm:true and preserves unspecified flags (no silent downgrade).",
      inputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    (args) => householdSelfUpdateHandler(client, args),
  );
}

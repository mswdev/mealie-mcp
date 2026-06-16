import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod";
import type { MealieClient } from "../../../client/MealieClient.js";
import type { components } from "../../../types/mealie.js";
import { requireConfirmation } from "../../confirm.js";
import { jsonResult, secretSafeErrorResult } from "../../result.js";
import { type AdminUser, projectAdminUser } from "../admin-projection.js";

const USERS_PATH = "/api/admin/users";
/** UserIn.authMethod's required-with-default value. */
const DEFAULT_AUTH_METHOD = "Mealie";
/** The args a create cannot proceed without (UserIn's truly-required fields). */
const CREATE_REQUIRED_FIELDS = ["username", "fullName", "email", "password"] as const;

/** The admin create body — password is a plaintext request secret, never echoed/logged. */
type UserIn = components["schemas"]["UserIn"];

/** Minimal client surface the handler needs (eases test fakes). */
type WriteClient = Pick<MealieClient, "get" | "post" | "put" | "delete">;

const inputSchema = {
  action: z.enum(["create", "update", "delete"]).describe("What to do"),
  username: z.string().optional().describe("Login name (create)"),
  fullName: z.string().optional().describe("Display name (create)"),
  email: z.string().optional().describe("Email address (create)"),
  password: z.string().optional().describe("Initial password (create; never echoed)"),
  admin: z.boolean().optional().describe("Grant site-admin rights (create, default false)"),
  advanced: z.boolean().optional().describe("Enable advanced features (create, default false)"),
  group: z.string().optional().describe("Group NAME to join (create; not an id)"),
  household: z.string().optional().describe("Household NAME to join (create; not an id)"),
  item_id: z.string().optional().describe("The user id (update/delete)"),
  changes: z
    .record(z.string(), z.unknown())
    .optional()
    .describe(
      "Fields to change (update) — merged onto the current user; cannot change passwords (use admin_user_actions password_reset_token). Do not set server-derived fields (id, groupId/householdId, slugs, cacheKey, tokens) — they round-trip automatically.",
    ),
  confirm: z.boolean().optional().describe("Must be true to delete"),
};

type UserWriteArgs = {
  action: "create" | "update" | "delete";
  username?: string | undefined;
  fullName?: string | undefined;
  email?: string | undefined;
  password?: string | undefined;
  admin?: boolean | undefined;
  advanced?: boolean | undefined;
  group?: string | undefined;
  household?: string | undefined;
  item_id?: string | undefined;
  changes?: Record<string, unknown> | undefined;
  confirm?: boolean | undefined;
};

/**
 * Handles admin_user_write: site-admin create/update/delete of user accounts.
 * Update is a straight fetch-merge round-trip — the PUT body IS UserOut (no
 * Update schema exists upstream), so server-derived fields are sent back as-is.
 *
 * @param client - A MealieClient (or compatible fake)
 * @param args - Validated arguments (action + action fields)
 * @returns An MCP result for the action, or a sanitized error result
 */
export async function adminUserWriteHandler(
  client: WriteClient,
  args: UserWriteArgs,
): Promise<CallToolResult> {
  const refusal = validate(args);
  if (refusal) return refusal;
  try {
    if (args.action === "create") return await create(client, args);
    if (args.action === "update") return await update(client, args);
    return await remove(client, args);
  } catch (error) {
    // secretSafe: the create body carries a plaintext password (422s echo input).
    return secretSafeErrorResult(error, "admin_user_write", "Failed to write user");
  }
}

/** Validates per-action required args; returns an isError result or null. */
function validate(args: UserWriteArgs): CallToolResult | null {
  if (args.action === "create") return validateCreate(args);
  if (!args.item_id) return missing(`item_id is required for ${args.action}`);
  if (args.action === "update") {
    return args.changes ? null : missing("changes is required for update");
  }
  return requireConfirmation(args.confirm, `delete user ${args.item_id}`);
}

/** Requires UserIn's truly-required fields before any client call. */
function validateCreate(args: UserWriteArgs): CallToolResult | null {
  for (const field of CREATE_REQUIRED_FIELDS) {
    if (!args[field]) return missing(`${field} is required for create`);
  }
  return null;
}

/** Creates the user with UserIn's required-with-default fields supplied. */
async function create(client: WriteClient, args: UserWriteArgs): Promise<CallToolResult> {
  const body: UserIn = {
    username: args.username ?? "",
    fullName: args.fullName ?? "",
    email: args.email ?? "",
    password: args.password ?? "",
    authMethod: DEFAULT_AUTH_METHOD,
    admin: args.admin ?? false,
    advanced: args.advanced ?? false,
    showAnnouncements: true,
    canInvite: false,
    canManage: false,
    canManageHousehold: false,
    canOrganize: false,
    ...(args.group !== undefined && { group: args.group }),
    ...(args.household !== undefined && { household: args.household }),
  };
  const created = await client.post<AdminUser>(USERS_PATH, body);
  return jsonResult(projectAdminUser(created, "concise"));
}

/**
 * Fetch-merge update: the PUT schema IS UserOut, so the merged object — including
 * server-derived id/groupId/slugs/cacheKey/tokens — is sent back whole (a partial
 * body would silently reset permission flags).
 */
async function update(client: WriteClient, args: UserWriteArgs): Promise<CallToolResult> {
  const current = await client.get<Record<string, unknown>>(`${USERS_PATH}/${args.item_id}`);
  const merged = { ...current, ...args.changes };
  await client.put(`${USERS_PATH}/${args.item_id}`, merged);
  return jsonResult({
    updated: args.item_id,
    user: projectAdminUser(merged as AdminUser, "concise"),
  });
}

/** Deletes the user; the echoed entity is discarded for a uniform {deleted}. */
async function remove(client: WriteClient, args: UserWriteArgs): Promise<CallToolResult> {
  await client.delete(`${USERS_PATH}/${args.item_id}`);
  return jsonResult({ deleted: args.item_id });
}

/** Returns an isError result describing the missing requirement. */
function missing(requirement: string): CallToolResult {
  return {
    content: [{ type: "text", text: `admin_user_write: ${requirement}` }],
    isError: true,
  };
}

/**
 * Registers the admin_user_write tool on the server.
 *
 * @param server - The McpServer to register on
 * @param client - The MealieClient used by the handler
 */
export function registerAdminUserWrite(server: McpServer, client: MealieClient): void {
  server.registerTool(
    "admin_user_write",
    {
      title: "Admin: Write Users",
      description:
        "Create, update, or delete (confirm required) user accounts as the site admin. Create takes username/fullName/email/password (+ optional admin flag, group/household names). Update merges changes onto the current account — passwords cannot be changed here (use admin_user_actions password_reset_token).",
      inputSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    },
    (args) => adminUserWriteHandler(client, args),
  );
}

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod";
import type { MealieClient } from "../../../client/MealieClient.js";
import type { components } from "../../../types/mealie.js";
import { requireConfirmation } from "../../confirm.js";
import { errorResult, jsonResult } from "../../result.js";
import { type AdminHousehold, pickFields, projectAdminHousehold } from "../admin-projection.js";

const HOUSEHOLDS_PATH = "/api/admin/households";

/**
 * UpdateHouseholdAdmin's scalar field set — the PUT accepts nothing else
 * (read-side slug/group/users/webhooks would 422 or be ignored; id is REQUIRED
 * in the body, duplicated from the path param). preferences is handled apart.
 */
const HOUSEHOLD_UPDATE_FIELDS = ["id", "groupId", "name"] as const;

/** UpdateHouseholdPreferences' exact field set (the read shape carries extra keys). */
const HOUSEHOLD_PREFS_FIELDS = [
  "privateHousehold",
  "showAnnouncements",
  "lockRecipeEditsFromOtherHouseholds",
  "firstDayOfWeek",
  "recipePublic",
  "recipeShowNutrition",
  "recipeShowAssets",
  "recipeLandscapeView",
  "recipeDisableComments",
] as const;

type HouseholdCreate = components["schemas"]["HouseholdCreate"];

/** Minimal client surface the handler needs (eases test fakes). */
type WriteClient = Pick<MealieClient, "get" | "post" | "put" | "delete">;

const inputSchema = {
  action: z.enum(["create", "update", "delete"]).describe("What to do"),
  name: z.string().optional().describe("Household name (create)"),
  group_id: z.string().optional().describe("Group id to create the household in (create)"),
  item_id: z.string().optional().describe("The household id (update/delete)"),
  changes: z
    .record(z.string(), z.unknown())
    .optional()
    .describe(
      "Fields to change (update): name, groupId (moves it between groups), preferences (merged onto current)",
    ),
  confirm: z.boolean().optional().describe("Must be true to delete"),
};

type HouseholdWriteArgs = {
  action: "create" | "update" | "delete";
  name?: string | undefined;
  group_id?: string | undefined;
  item_id?: string | undefined;
  changes?: Record<string, unknown> | undefined;
  confirm?: boolean | undefined;
};

/**
 * Handles admin_household_write: site-admin create/update/delete of households.
 * Update whitelist-projects onto UpdateHouseholdAdmin (a full replace narrower
 * than the read shape); nested preferences are merged and projected only when
 * the caller changes them — omitting the key leaves them untouched upstream.
 *
 * @param client - A MealieClient (or compatible fake)
 * @param args - Validated arguments (action + action fields)
 * @returns An MCP result for the action, or an error result
 */
export async function adminHouseholdWriteHandler(
  client: WriteClient,
  args: HouseholdWriteArgs,
): Promise<CallToolResult> {
  const refusal = validate(args);
  if (refusal) return refusal;
  try {
    if (args.action === "create") return await create(client, args);
    if (args.action === "update") return await update(client, args);
    return await remove(client, args);
  } catch (error) {
    return errorResult(error, "admin_household_write", "Failed to write household");
  }
}

/** Validates per-action required args; returns an isError result or null. */
function validate(args: HouseholdWriteArgs): CallToolResult | null {
  if (args.action === "create") {
    return args.name ? null : missing("name is required for create");
  }
  if (!args.item_id) return missing(`item_id is required for ${args.action}`);
  if (args.action === "update") {
    return args.changes ? null : missing("changes is required for update");
  }
  return requireConfirmation(args.confirm, `delete household ${args.item_id}`);
}

/** Creates the household (typed HouseholdCreate; groupId only when given). */
async function create(client: WriteClient, args: HouseholdWriteArgs): Promise<CallToolResult> {
  const body: HouseholdCreate = {
    name: args.name ?? "",
    ...(args.group_id !== undefined && { groupId: args.group_id }),
  };
  const created = await client.post<AdminHousehold>(HOUSEHOLDS_PATH, body);
  return jsonResult(projectAdminHousehold(created, "concise"));
}

/** Fetch-merge update projected onto the UpdateHouseholdAdmin whitelist. */
async function update(client: WriteClient, args: HouseholdWriteArgs): Promise<CallToolResult> {
  const current = await client.get<Record<string, unknown>>(`${HOUSEHOLDS_PATH}/${args.item_id}`);
  const body = buildUpdateBody(current, args);
  await client.put(`${HOUSEHOLDS_PATH}/${args.item_id}`, body);
  return jsonResult({ updated: args.item_id, household: body });
}

/** Builds the PUT body: scalar whitelist + id-from-path + prefs only when changed. */
function buildUpdateBody(
  current: Record<string, unknown>,
  args: HouseholdWriteArgs,
): Record<string, unknown> {
  const changes = args.changes ?? {};
  const body = pickFields({ ...current, ...changes, id: args.item_id }, HOUSEHOLD_UPDATE_FIELDS);
  if (changes.preferences !== undefined) {
    body.preferences = mergePreferences(current.preferences, changes.preferences);
  }
  return body;
}

/** Merges current + changed preferences, projected onto the Update field set. */
function mergePreferences(current: unknown, changes: unknown): Record<string, unknown> {
  const base = (current ?? {}) as Record<string, unknown>;
  const overlay = (changes ?? {}) as Record<string, unknown>;
  return pickFields({ ...base, ...overlay }, HOUSEHOLD_PREFS_FIELDS);
}

/** Deletes the household; the echoed entity is discarded for a uniform {deleted}. */
async function remove(client: WriteClient, args: HouseholdWriteArgs): Promise<CallToolResult> {
  await client.delete(`${HOUSEHOLDS_PATH}/${args.item_id}`);
  return jsonResult({ deleted: args.item_id });
}

/** Returns an isError result describing the missing requirement. */
function missing(requirement: string): CallToolResult {
  return {
    content: [{ type: "text", text: `admin_household_write: ${requirement}` }],
    isError: true,
  };
}

/**
 * Registers the admin_household_write tool on the server.
 *
 * @param server - The McpServer to register on
 * @param client - The MealieClient used by the handler
 */
export function registerAdminHouseholdWrite(server: McpServer, client: MealieClient): void {
  server.registerTool(
    "admin_household_write",
    {
      title: "Admin: Write Households",
      description:
        "Create, update, or delete (confirm required) households as the site admin. Update merges changes onto the current household; set changes.groupId to move it between groups; changes.preferences merges onto current preferences.",
      inputSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    },
    (args) => adminHouseholdWriteHandler(client, args),
  );
}

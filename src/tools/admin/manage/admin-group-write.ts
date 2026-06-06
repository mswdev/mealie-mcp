import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod";
import type { MealieClient } from "../../../client/MealieClient.js";
import type { components } from "../../../types/mealie.js";
import { requireConfirmation } from "../../confirm.js";
import { errorResult, jsonResult } from "../../result.js";
import { type AdminGroup, pickFields, projectAdminGroup } from "../admin-projection.js";

const GROUPS_PATH = "/api/admin/groups";

/**
 * GroupAdminUpdate's scalar field set — the PUT accepts nothing else (read-side
 * slug/categories/webhooks/households/users are not in the schema; id is
 * REQUIRED in the body, duplicated from the path param). The two optional
 * nested objects are handled apart.
 */
const GROUP_UPDATE_FIELDS = ["id", "name"] as const;

/** UpdateGroupPreferences' exact field set (the read shape carries extra keys). */
const GROUP_PREFS_FIELDS = ["privateGroup", "showAnnouncements"] as const;

/**
 * AIProviderSettingsUpdate's exact field set — three nullable pointers. The
 * read shape (AIProviderSettingsOut) adds providers/*Enabled which the PUT
 * must never carry (PR #8 settings semantics).
 */
const AI_SETTINGS_FIELDS = ["defaultProviderId", "audioProviderId", "imageProviderId"] as const;

type GroupBase = components["schemas"]["GroupBase"];

/** Minimal client surface the handler needs (eases test fakes). */
type WriteClient = Pick<MealieClient, "get" | "post" | "put" | "delete">;

const inputSchema = {
  action: z.enum(["create", "update", "delete"]).describe("What to do"),
  name: z.string().optional().describe("Group name (create)"),
  item_id: z.string().optional().describe("The group id (update/delete)"),
  changes: z
    .record(z.string(), z.unknown())
    .optional()
    .describe(
      "Fields to change (update): name, preferences (merged), aiProviderSettings (pointer fields merged; explicit null clears a pointer)",
    ),
  confirm: z.boolean().optional().describe("Must be true to delete"),
};

type GroupWriteArgs = {
  action: "create" | "update" | "delete";
  name?: string | undefined;
  item_id?: string | undefined;
  changes?: Record<string, unknown> | undefined;
  confirm?: boolean | undefined;
};

/**
 * Handles admin_group_write: site-admin create/update/delete of groups. Update
 * whitelist-projects onto GroupAdminUpdate; the nested preferences and
 * aiProviderSettings are merged + projected onto their Update field sets only
 * when the caller changes them — omitting the keys leaves them untouched.
 *
 * @param client - A MealieClient (or compatible fake)
 * @param args - Validated arguments (action + action fields)
 * @returns An MCP result for the action, or an error result
 */
export async function adminGroupWriteHandler(
  client: WriteClient,
  args: GroupWriteArgs,
): Promise<CallToolResult> {
  const refusal = validate(args);
  if (refusal) return refusal;
  try {
    if (args.action === "create") return await create(client, args);
    if (args.action === "update") return await update(client, args);
    return await remove(client, args);
  } catch (error) {
    return errorResult(error, "admin_group_write", "Failed to write group");
  }
}

/** Validates per-action required args; returns an isError result or null. */
function validate(args: GroupWriteArgs): CallToolResult | null {
  if (args.action === "create") {
    return args.name ? null : missing("name is required for create");
  }
  if (!args.item_id) return missing(`item_id is required for ${args.action}`);
  if (args.action === "update") {
    return args.changes ? null : missing("changes is required for update");
  }
  return requireConfirmation(args.confirm, `delete group ${args.item_id}`);
}

/** Creates the group (GroupBase — name is the whole schema). */
async function create(client: WriteClient, args: GroupWriteArgs): Promise<CallToolResult> {
  const body: GroupBase = { name: args.name ?? "" };
  const created = await client.post<AdminGroup>(GROUPS_PATH, body);
  return jsonResult(projectAdminGroup(created, "concise"));
}

/** Fetch-merge update projected onto the GroupAdminUpdate whitelist. */
async function update(client: WriteClient, args: GroupWriteArgs): Promise<CallToolResult> {
  const current = await client.get<Record<string, unknown>>(`${GROUPS_PATH}/${args.item_id}`);
  const body = buildUpdateBody(current, args);
  await client.put(`${GROUPS_PATH}/${args.item_id}`, body);
  return jsonResult({ updated: args.item_id, group: body });
}

/** Builds the PUT body: scalar whitelist + id-from-path + nests only when changed. */
function buildUpdateBody(
  current: Record<string, unknown>,
  args: GroupWriteArgs,
): Record<string, unknown> {
  const changes = args.changes ?? {};
  const body = pickFields({ ...current, ...changes, id: args.item_id }, GROUP_UPDATE_FIELDS);
  if (changes.preferences !== undefined) {
    body.preferences = mergeOntoFields(
      current.preferences,
      changes.preferences,
      GROUP_PREFS_FIELDS,
    );
  }
  if (changes.aiProviderSettings !== undefined) {
    body.aiProviderSettings = mergeProviderSettings(
      current.aiProviderSettings,
      changes.aiProviderSettings,
    );
  }
  return body;
}

/**
 * Builds a complete three-pointer settings body. The pointers are
 * required-WITHOUT-default upstream, so every key must be present even when
 * the fetched base is null (fresh group) and the overlay partial — missing
 * values fall back to null. `key in overlay` (not truthiness) so an explicit
 * null clears a pointer.
 */
function mergeProviderSettings(current: unknown, changes: unknown): Record<string, unknown> {
  const base = (current ?? {}) as Record<string, unknown>;
  const overlay = (changes ?? {}) as Record<string, unknown>;
  return Object.fromEntries(
    AI_SETTINGS_FIELDS.map((key) => [key, (key in overlay ? overlay[key] : base[key]) ?? null]),
  );
}

/** Merges current + changed nested objects, projected onto an Update field set. */
function mergeOntoFields(
  current: unknown,
  changes: unknown,
  fields: readonly string[],
): Record<string, unknown> {
  const base = (current ?? {}) as Record<string, unknown>;
  const overlay = (changes ?? {}) as Record<string, unknown>;
  return pickFields({ ...base, ...overlay }, fields);
}

/** Deletes the group; the echoed entity is discarded for a uniform {deleted}. */
async function remove(client: WriteClient, args: GroupWriteArgs): Promise<CallToolResult> {
  await client.delete(`${GROUPS_PATH}/${args.item_id}`);
  return jsonResult({ deleted: args.item_id });
}

/** Returns an isError result describing the missing requirement. */
function missing(requirement: string): CallToolResult {
  return {
    content: [{ type: "text", text: `admin_group_write: ${requirement}` }],
    isError: true,
  };
}

/**
 * Registers the admin_group_write tool on the server.
 *
 * @param server - The McpServer to register on
 * @param client - The MealieClient used by the handler
 */
export function registerAdminGroupWrite(server: McpServer, client: MealieClient): void {
  server.registerTool(
    "admin_group_write",
    {
      title: "Admin: Write Groups",
      description:
        "Create, update, or delete (confirm required) groups as the site admin. Update merges changes onto the current group; changes.aiProviderSettings carries the three pointer fields (defaultProviderId/audioProviderId/imageProviderId) — unset ones are preserved, explicit null clears.",
      inputSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    },
    (args) => adminGroupWriteHandler(client, args),
  );
}

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod";
import type { MealieClient } from "../../client/MealieClient.js";
import type { components } from "../../types/mealie.js";
import { requireConfirmation } from "../confirm.js";
import { errorResult, jsonResult } from "../result.js";
import { type RecipeAction, projectRecipeAction } from "./recipe-action-projection.js";

/** Base path for the household recipe-actions resource. */
const BASE_PATH = "/api/households/recipe-actions";
/** Must match components["schemas"]["GroupRecipeActionType"] exactly. */
const ACTION_TYPES = ["link", "post"] as const;

/** Minimal client surface the handler needs (eases test fakes). */
type WriteClient = Pick<MealieClient, "get" | "post" | "put" | "delete">;

const inputSchema = {
  action: z.enum(["create", "update", "delete"]).describe("Recipe action write operation"),
  item_id: z.string().optional().describe("Recipe action id, a UUID (action=update/delete)"),
  actionType: z
    .enum(ACTION_TYPES)
    .optional()
    .describe("How the action runs: link (open URL) or post (POST to URL) (action=create)"),
  title: z.string().optional().describe("Action title (action=create)"),
  url: z.string().optional().describe("Target URL (action=create)"),
  changes: z
    .record(z.unknown())
    .optional()
    .describe("Fields to change, merged onto the current action (action=update)"),
  confirm: z.boolean().optional().describe("Must be true to delete (action=delete)"),
};

type WriteArgs = {
  action: "create" | "update" | "delete";
  item_id?: string | undefined;
  actionType?: (typeof ACTION_TYPES)[number] | undefined;
  title?: string | undefined;
  url?: string | undefined;
  changes?: Record<string, unknown> | undefined;
  confirm?: boolean | undefined;
};

/**
 * Handles recipe_action_write: create, update (fetch-merge), or delete
 * (confirm-gated) a household recipe action.
 *
 * @param client - A MealieClient (or compatible fake)
 * @param args - Validated arguments (action + action-specific fields)
 * @returns An MCP result with the affected action, or an error result
 */
export async function recipeActionWriteHandler(
  client: WriteClient,
  args: WriteArgs,
): Promise<CallToolResult> {
  if (args.action === "delete") return remove(client, args);
  try {
    return args.action === "create" ? await create(client, args) : await update(client, args);
  } catch (error) {
    return errorResult(error, "recipe_action_write", "Failed to write recipe action");
  }
}

/** POSTs a new recipe action (groupId/householdId are server-injected). */
async function create(client: WriteClient, args: WriteArgs): Promise<CallToolResult> {
  if (!args.actionType || !args.title || !args.url) {
    return missing("create requires actionType, title, and url");
  }
  const body: components["schemas"]["CreateGroupRecipeAction"] = {
    actionType: args.actionType,
    title: args.title,
    url: args.url,
  };
  return jsonResult(
    projectRecipeAction(await client.post<RecipeAction>(BASE_PATH, body), "concise"),
  );
}

/**
 * PUTs an edited action. The endpoint reuses SaveGroupRecipeAction (full replace,
 * no distinct Update schema), a SUPERSET of create requiring groupId+householdId.
 * Those are server-injected on create, so we fetch the current action (which
 * carries them) and merge changes — a partial PUT would otherwise be rejected or
 * clobber them.
 */
async function update(client: WriteClient, args: WriteArgs): Promise<CallToolResult> {
  if (!args.item_id || !args.changes) return missing("update requires item_id and changes");
  const path = `${BASE_PATH}/${args.item_id}`;
  const current = await client.get<Record<string, unknown>>(path);
  const merged = { ...current, ...args.changes };
  return jsonResult(projectRecipeAction(await client.put<RecipeAction>(path, merged), "concise"));
}

/** DELETEs an action (confirm-gated). Mealie echoes the entity; we synthesize {deleted}. */
async function remove(client: WriteClient, args: WriteArgs): Promise<CallToolResult> {
  if (!args.item_id) return missing("delete requires item_id");
  const unconfirmed = requireConfirmation(args.confirm, `delete recipe action "${args.item_id}"`);
  if (unconfirmed) return unconfirmed;
  try {
    await client.delete(`${BASE_PATH}/${args.item_id}`);
    return jsonResult({ deleted: args.item_id });
  } catch (error) {
    return errorResult(error, "recipe_action_write", "Failed to delete recipe action");
  }
}

/** Returns an isError result describing the missing requirement for the action. */
function missing(requirement: string): CallToolResult {
  return {
    content: [{ type: "text", text: `recipe_action_write: ${requirement}` }],
    isError: true,
  };
}

/**
 * Registers the recipe_action_write tool on the server.
 *
 * @param server - The McpServer to register on
 * @param client - The MealieClient used by the handler
 */
export function registerRecipeActionWrite(server: McpServer, client: MealieClient): void {
  server.registerTool(
    "recipe_action_write",
    {
      title: "Write Recipe Action",
      description:
        "Create, edit, or delete a household recipe action. create needs actionType/title/url; update merges changes onto the current action (full replace). Delete is destructive (confirm:true).",
      inputSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    },
    (args) => recipeActionWriteHandler(client, args),
  );
}

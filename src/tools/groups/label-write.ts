import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod";
import type { MealieClient } from "../../client/MealieClient.js";
import type { components } from "../../types/mealie.js";
import { requireConfirmation } from "../confirm.js";
import { errorResult, jsonResult } from "../result.js";
import { type Label, projectLabel } from "./group-projection.js";

/** Base path for the group MultiPurpose labels resource. */
const BASE_PATH = "/api/groups/labels";
/** Default label color (matches MultiPurposeLabelCreate's @default). */
const DEFAULT_COLOR = "#959595";

/** Minimal client surface the handler needs (eases test fakes). */
type WriteClient = Pick<MealieClient, "get" | "post" | "put" | "delete">;

const inputSchema = {
  action: z.enum(["create", "update", "delete"]).describe("Label write operation"),
  item_id: z.string().optional().describe("Label id, a UUID (action=update/delete)"),
  name: z.string().optional().describe("Label name (action=create)"),
  color: z.string().optional().describe("Hex color, e.g. #959595 (action=create, default #959595)"),
  changes: z
    .record(z.unknown())
    .optional()
    .describe("Fields to change, merged onto the current label (action=update)"),
  confirm: z.boolean().optional().describe("Must be true to delete (action=delete)"),
};

type WriteArgs = {
  action: "create" | "update" | "delete";
  item_id?: string | undefined;
  name?: string | undefined;
  color?: string | undefined;
  changes?: Record<string, unknown> | undefined;
  confirm?: boolean | undefined;
};

/**
 * Handles label_write: create, update (fetch-merge), or delete (confirm-gated)
 * a MultiPurpose label.
 *
 * @param client - A MealieClient (or compatible fake)
 * @param args - Validated arguments (action + action-specific fields)
 * @returns An MCP result with the affected label, or an error result
 */
export async function labelWriteHandler(
  client: WriteClient,
  args: WriteArgs,
): Promise<CallToolResult> {
  if (args.action === "delete") return remove(client, args);
  try {
    return args.action === "create" ? await create(client, args) : await update(client, args);
  } catch (error) {
    return errorResult(error, "label_write", "Failed to write label");
  }
}

/** POSTs a new label, defaulting color to the schema default. */
async function create(client: WriteClient, args: WriteArgs): Promise<CallToolResult> {
  if (!args.name) return missing("create requires name");
  const body: components["schemas"]["MultiPurposeLabelCreate"] = {
    name: args.name,
    color: args.color ?? DEFAULT_COLOR,
  };
  return jsonResult(projectLabel(await client.post<Label>(BASE_PATH, body), "concise"));
}

/**
 * PUTs an edited label. MultiPurposeLabelUpdate is a distinct schema but a FULL
 * replace (name/color/groupId/id all required), so we fetch the current label and
 * merge changes — otherwise groupId/id are missing (422) or fields silently reset.
 */
async function update(client: WriteClient, args: WriteArgs): Promise<CallToolResult> {
  if (!args.item_id || !args.changes) return missing("update requires item_id and changes");
  const path = `${BASE_PATH}/${args.item_id}`;
  const current = await client.get<Record<string, unknown>>(path);
  const merged = { ...current, ...args.changes };
  return jsonResult(projectLabel(await client.put<Label>(path, merged), "concise"));
}

/** DELETEs a label (confirm-gated). Mealie echoes the entity; we synthesize {deleted}. */
async function remove(client: WriteClient, args: WriteArgs): Promise<CallToolResult> {
  if (!args.item_id) return missing("delete requires item_id");
  const unconfirmed = requireConfirmation(args.confirm, `delete label "${args.item_id}"`);
  if (unconfirmed) return unconfirmed;
  try {
    await client.delete(`${BASE_PATH}/${args.item_id}`);
    return jsonResult({ deleted: args.item_id });
  } catch (error) {
    return errorResult(error, "label_write", "Failed to delete label");
  }
}

/** Returns an isError result describing the missing requirement for the action. */
function missing(requirement: string): CallToolResult {
  return { content: [{ type: "text", text: `label_write: ${requirement}` }], isError: true };
}

/**
 * Registers the label_write tool on the server.
 *
 * @param server - The McpServer to register on
 * @param client - The MealieClient used by the handler
 */
export function registerLabelWrite(server: McpServer, client: MealieClient): void {
  server.registerTool(
    "label_write",
    {
      title: "Write Label",
      description:
        "Create, edit, or delete a MultiPurpose label. create needs name (color defaults #959595); update merges changes onto the current label (full replace). Delete is destructive (confirm:true).",
      inputSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    },
    (args) => labelWriteHandler(client, args),
  );
}

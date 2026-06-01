import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod";
import type { MealieClient } from "../../../client/MealieClient.js";
import type { components } from "../../../types/mealie.js";
import { requireConfirmation } from "../../confirm.js";
import { errorResult, jsonResult } from "../../result.js";

/** Minimal client surface the handler needs (eases test fakes). */
type CommentWriteClient = Pick<MealieClient, "post" | "put" | "delete">;

const inputSchema = {
  action: z.enum(["create", "update", "delete"]).describe("Comment write operation"),
  recipeId: z.string().optional().describe("Recipe UUID to comment on (action=create)"),
  text: z.string().optional().describe("Comment text (action=create/update)"),
  commentId: z.string().optional().describe("Comment id (action=update/delete)"),
  confirm: z.boolean().optional().describe("Must be true to delete (action=delete)"),
};

type CommentWriteArgs = {
  action: "create" | "update" | "delete";
  recipeId?: string | undefined;
  text?: string | undefined;
  commentId?: string | undefined;
  confirm?: boolean | undefined;
};

/**
 * Handles recipe_comment_write: create, update, or delete a recipe comment via
 * the group-level /api/comments resource. Delete is confirm-gated.
 *
 * @param client - A MealieClient (or compatible fake)
 * @param args - Validated arguments (action + action-specific fields)
 * @returns An MCP result with the affected comment, or an error result
 */
export async function recipeCommentWriteHandler(
  client: CommentWriteClient,
  args: CommentWriteArgs,
): Promise<CallToolResult> {
  if (args.action === "delete") return remove(client, args);
  try {
    return args.action === "create" ? await create(client, args) : await update(client, args);
  } catch (error) {
    return errorResult(error, "recipe_comment_write", "Failed to write comment");
  }
}

/** POST a new comment. */
async function create(client: CommentWriteClient, args: CommentWriteArgs): Promise<CallToolResult> {
  if (!args.recipeId) return missing("recipeId");
  if (!args.text) return missing("text");
  const body: components["schemas"]["RecipeCommentCreate"] = {
    recipeId: args.recipeId,
    text: args.text,
  };
  return jsonResult(await client.post("/api/comments", body));
}

/** PUT an edited comment. */
async function update(client: CommentWriteClient, args: CommentWriteArgs): Promise<CallToolResult> {
  if (!args.commentId) return missing("commentId");
  if (!args.text) return missing("text");
  const body: components["schemas"]["RecipeCommentUpdate"] = {
    id: args.commentId,
    text: args.text,
  };
  return jsonResult(await client.put(`/api/comments/${args.commentId}`, body));
}

/** DELETE a comment (confirm-gated). */
async function remove(client: CommentWriteClient, args: CommentWriteArgs): Promise<CallToolResult> {
  if (!args.commentId) return missing("commentId");
  const unconfirmed = requireConfirmation(args.confirm, `delete comment ${args.commentId}`);
  if (unconfirmed) return unconfirmed;
  try {
    await client.delete(`/api/comments/${args.commentId}`);
    return jsonResult({ deleted: args.commentId });
  } catch (error) {
    return errorResult(error, "recipe_comment_write", "Failed to delete comment");
  }
}

/** Returns an isError result naming the field the chosen action requires. */
function missing(field: string): CallToolResult {
  return {
    content: [{ type: "text", text: `recipe_comment_write: action requires "${field}"` }],
    isError: true,
  };
}

/**
 * Registers the recipe_comment_write tool on the server.
 *
 * @param server - The McpServer to register on
 * @param client - The MealieClient used by the handler
 */
export function registerRecipeCommentWrite(server: McpServer, client: MealieClient): void {
  server.registerTool(
    "recipe_comment_write",
    {
      title: "Write Recipe Comment",
      description:
        "Create, edit, or delete a recipe comment. Delete is destructive (confirm:true).",
      inputSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    },
    (args) => recipeCommentWriteHandler(client, args),
  );
}

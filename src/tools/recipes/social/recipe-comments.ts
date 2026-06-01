import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod";
import type { MealieClient } from "../../../client/MealieClient.js";
import { errorResult, jsonResult } from "../../result.js";

/** Default page size for the group-level comments list. */
const DEFAULT_PER_PAGE = 20;
/** Maximum allowed page size. */
const MAX_PER_PAGE = 100;

/** Minimal client surface the handler needs (eases test fakes). */
type CommentsClient = Pick<MealieClient, "get" | "getPaginated">;

const inputSchema = {
  action: z
    .enum(["by_recipe", "list", "get"])
    .optional()
    .describe("by_recipe (comments on one recipe), list (all, paginated), or get (one by id)"),
  slug: z.string().optional().describe("Recipe slug (action=by_recipe)"),
  commentId: z.string().optional().describe("Comment id (action=get)"),
  page: z.number().int().positive().optional().describe("1-based page number (action=list)"),
  perPage: z
    .number()
    .int()
    .positive()
    .max(MAX_PER_PAGE)
    .optional()
    .describe(`Items per page (default ${DEFAULT_PER_PAGE}, action=list)`),
};

type CommentsArgs = {
  action?: "by_recipe" | "list" | "get" | undefined;
  slug?: string | undefined;
  commentId?: string | undefined;
  page?: number | undefined;
  perPage?: number | undefined;
};

/**
 * Handles recipe_comments (reads): comments for one recipe, the paginated group
 * list, or a single comment by id.
 *
 * @param client - A MealieClient (or compatible fake)
 * @param args - Validated arguments (action + action-specific fields)
 * @returns An MCP result with the requested comments, or an error result
 */
export async function recipeCommentsHandler(
  client: CommentsClient,
  args: CommentsArgs,
): Promise<CallToolResult> {
  try {
    return await read(client, args);
  } catch (error) {
    return errorResult(error, "recipe_comments", "Failed to read comments");
  }
}

/** Routes the comment reads. */
async function read(client: CommentsClient, args: CommentsArgs): Promise<CallToolResult> {
  const action = args.action ?? "list";
  if (action === "by_recipe") {
    if (!args.slug) return missing("slug");
    return jsonResult(await client.get(`/api/recipes/${args.slug}/comments`));
  }
  if (action === "get") {
    if (!args.commentId) return missing("commentId");
    return jsonResult(await client.get(`/api/comments/${args.commentId}`));
  }
  const page = await client.getPaginated("/api/comments", {
    page: args.page,
    perPage: args.perPage ?? DEFAULT_PER_PAGE,
  });
  return jsonResult(page);
}

/** Returns an isError result naming the field the chosen action requires. */
function missing(field: string): CallToolResult {
  return {
    content: [{ type: "text", text: `recipe_comments: action requires "${field}"` }],
    isError: true,
  };
}

/**
 * Registers the recipe_comments read tool on the server.
 *
 * @param server - The McpServer to register on
 * @param client - The MealieClient used by the handler
 */
export function registerRecipeComments(server: McpServer, client: MealieClient): void {
  server.registerTool(
    "recipe_comments",
    {
      title: "Read Recipe Comments",
      description:
        "Read comments: by_recipe (one recipe's comments), list (all, paginated), or get (one by id). Use recipe_comment_write to add/edit/delete.",
      inputSchema,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    (args) => recipeCommentsHandler(client, args),
  );
}

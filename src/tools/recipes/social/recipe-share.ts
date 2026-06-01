import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod";
import type { MealieClient } from "../../../client/MealieClient.js";
import { errorResult, jsonResult } from "../../result.js";
import { type RecipeDetail, projectRecipe } from "../recipe-projection.js";

/** Minimal client surface the handler needs (eases test fakes). */
type ShareClient = Pick<MealieClient, "get" | "baseUrl">;

const inputSchema = {
  action: z
    .enum(["list", "get", "view", "view_zip"])
    .optional()
    .describe("list/get share tokens, or view/view_zip a publicly shared recipe by token"),
  recipeId: z.string().optional().describe("Filter tokens by recipe UUID (action=list)"),
  tokenId: z.string().optional().describe("Share token id (action=get)"),
  token: z.string().optional().describe("Public share token (action=view/view_zip)"),
};

type ShareArgs = {
  action?: "list" | "get" | "view" | "view_zip" | undefined;
  recipeId?: string | undefined;
  tokenId?: string | undefined;
  token?: string | undefined;
};

/**
 * Handles recipe_share (reads): list/get share tokens, view a publicly shared
 * recipe (concise), or get a reference URL for the shared-recipe zip.
 *
 * @param client - A MealieClient (or compatible fake)
 * @param args - Validated arguments (action + action-specific fields)
 * @returns An MCP result with the requested share data, or an error result
 */
export async function recipeShareHandler(
  client: ShareClient,
  args: ShareArgs,
): Promise<CallToolResult> {
  if (args.action === "view_zip") return viewZip(client, args);
  try {
    return await read(client, args);
  } catch (error) {
    return errorResult(error, "recipe_share", "Failed to read share data");
  }
}

/** Routes the network-backed share reads. */
async function read(client: ShareClient, args: ShareArgs): Promise<CallToolResult> {
  const action = args.action ?? "list";
  if (action === "get") {
    if (!args.tokenId) return missing("tokenId");
    return jsonResult(await client.get(`/api/shared/recipes/${args.tokenId}`));
  }
  if (action === "view") {
    if (!args.token) return missing("token");
    const recipe = await client.get<RecipeDetail>(`/api/recipes/shared/${args.token}`);
    return jsonResult(projectRecipe(recipe, "concise", []));
  }
  return jsonResult(
    await client.get(
      "/api/shared/recipes",
      args.recipeId ? { recipe_id: args.recipeId } : undefined,
    ),
  );
}

/** Builds a reference URL for the shared-recipe zip (a file download). */
function viewZip(client: ShareClient, args: ShareArgs): CallToolResult {
  if (!args.token) return missing("token");
  return jsonResult({ url: `${client.baseUrl}/api/recipes/shared/${args.token}/zip` });
}

/** Returns an isError result naming the field the chosen action requires. */
function missing(field: string): CallToolResult {
  return {
    content: [{ type: "text", text: `recipe_share: action requires "${field}"` }],
    isError: true,
  };
}

/**
 * Registers the recipe_share read tool on the server.
 *
 * @param server - The McpServer to register on
 * @param client - The MealieClient used by the handler
 */
export function registerRecipeShare(server: McpServer, client: MealieClient): void {
  server.registerTool(
    "recipe_share",
    {
      title: "Read Recipe Shares",
      description:
        "List/get recipe share tokens, view a publicly shared recipe (concise), or get the shared-recipe zip URL. Use recipe_share_write to create/revoke tokens.",
      inputSchema,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    (args) => recipeShareHandler(client, args),
  );
}

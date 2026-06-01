import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod";
import type { MealieClient } from "../../../client/MealieClient.js";
import type { components } from "../../../types/mealie.js";
import { requireConfirmation } from "../../confirm.js";
import { errorResult, jsonResult } from "../../result.js";

/** Minimal client surface the handler needs (eases test fakes). */
type ShareWriteClient = Pick<MealieClient, "post" | "delete">;

const inputSchema = {
  action: z.enum(["create", "revoke"]).describe("create a share token or revoke one"),
  recipeId: z.string().optional().describe("Recipe UUID to share (action=create)"),
  expiresAt: z.string().optional().describe("ISO 8601 expiry datetime (action=create)"),
  tokenId: z.string().optional().describe("Share token id to revoke (action=revoke)"),
  confirm: z.boolean().optional().describe("Must be true to revoke (action=revoke)"),
};

type ShareWriteArgs = {
  action: "create" | "revoke";
  recipeId?: string | undefined;
  expiresAt?: string | undefined;
  tokenId?: string | undefined;
  confirm?: boolean | undefined;
};

/**
 * Handles recipe_share_write: create or revoke a recipe share token. Revoke is
 * confirm-gated.
 *
 * @param client - A MealieClient (or compatible fake)
 * @param args - Validated arguments (action + action-specific fields)
 * @returns An MCP result with the created/revoked token, or an error result
 */
export async function recipeShareWriteHandler(
  client: ShareWriteClient,
  args: ShareWriteArgs,
): Promise<CallToolResult> {
  if (args.action === "revoke") return revoke(client, args);
  try {
    if (!args.recipeId) return missing("recipeId");
    const body: components["schemas"]["RecipeShareTokenCreate"] = {
      recipeId: args.recipeId,
      ...(args.expiresAt ? { expiresAt: args.expiresAt } : {}),
    };
    return jsonResult(await client.post("/api/shared/recipes", body));
  } catch (error) {
    return errorResult(error, "recipe_share_write", "Failed to create share token");
  }
}

/** DELETE (revoke) a share token (confirm-gated). */
async function revoke(client: ShareWriteClient, args: ShareWriteArgs): Promise<CallToolResult> {
  if (!args.tokenId) return missing("tokenId");
  const unconfirmed = requireConfirmation(args.confirm, `revoke share token ${args.tokenId}`);
  if (unconfirmed) return unconfirmed;
  try {
    await client.delete(`/api/shared/recipes/${args.tokenId}`);
    return jsonResult({ revoked: args.tokenId });
  } catch (error) {
    return errorResult(error, "recipe_share_write", "Failed to revoke share token");
  }
}

/** Returns an isError result naming the field the chosen action requires. */
function missing(field: string): CallToolResult {
  return {
    content: [{ type: "text", text: `recipe_share_write: action requires "${field}"` }],
    isError: true,
  };
}

/**
 * Registers the recipe_share_write tool on the server.
 *
 * @param server - The McpServer to register on
 * @param client - The MealieClient used by the handler
 */
export function registerRecipeShareWrite(server: McpServer, client: MealieClient): void {
  server.registerTool(
    "recipe_share_write",
    {
      title: "Write Recipe Share",
      description:
        "Create a recipe share token (optionally with an expiry) or revoke one. Revoke is destructive (confirm:true).",
      inputSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    },
    (args) => recipeShareWriteHandler(client, args),
  );
}

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod";
import type { MealieClient } from "../../../client/MealieClient.js";
import type { components } from "../../../types/mealie.js";
import { errorResult, jsonResult } from "../../result.js";
import { type RecipeDetail, projectRecipe } from "./recipe-projection.js";

/** Minimal client surface the handler needs (eases test fakes). */
type DuplicateClient = Pick<MealieClient, "post">;

const inputSchema = {
  slug: z.string().describe("The recipe slug to duplicate"),
  name: z.string().optional().describe("Optional name for the copy (defaults to a suffixed name)"),
};

type DuplicateArgs = { slug: string; name?: string | undefined };

/**
 * Handles recipe_duplicate: copies a recipe (optionally renaming the copy). The
 * endpoint returns the full new recipe, which is projected to concise.
 *
 * @param client - A MealieClient (or compatible fake)
 * @param args - Validated arguments (slug, name)
 * @returns An MCP result with the concise new recipe, or an error result
 */
export async function recipeDuplicateHandler(
  client: DuplicateClient,
  args: DuplicateArgs,
): Promise<CallToolResult> {
  try {
    const body: components["schemas"]["RecipeDuplicate"] =
      args.name === undefined ? {} : { name: args.name };
    const created = await client.post<RecipeDetail>(`/api/recipes/${args.slug}/duplicate`, body);
    return jsonResult(projectRecipe(created, "concise", []));
  } catch (error) {
    return errorResult(error, "recipe_duplicate", "Failed to duplicate recipe");
  }
}

/**
 * Registers the recipe_duplicate tool on the server.
 *
 * @param server - The McpServer to register on
 * @param client - The MealieClient used by the handler
 */
export function registerRecipeDuplicate(server: McpServer, client: MealieClient): void {
  server.registerTool(
    "recipe_duplicate",
    {
      title: "Duplicate Recipe",
      description:
        "Duplicate a recipe by slug, optionally naming the copy. Returns the new recipe (concise).",
      inputSchema,
      annotations: { readOnlyHint: false, openWorldHint: true },
    },
    (args) => recipeDuplicateHandler(client, args),
  );
}

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod";
import type { MealieClient } from "../../../client/MealieClient.js";
import { errorResult, jsonResult } from "../../result.js";
import { type Includable, type RecipeDetail, projectRecipe } from "../recipe-projection.js";

/** Minimal client surface the handler needs (eases test fakes). */
type GetClient = Pick<MealieClient, "get">;

const inputSchema = {
  slug: z.string().describe("The recipe slug (from recipe_search results)"),
  response_format: z
    .enum(["concise", "detailed"])
    .optional()
    .describe("concise (default) trims heavy fields; detailed returns everything"),
  include: z
    .array(z.enum(["comments", "nutrition"]))
    .optional()
    .describe("Add specific heavy fields onto the concise view"),
};

type GetArgs = {
  slug: string;
  response_format?: "concise" | "detailed" | undefined;
  include?: Includable[] | undefined;
};

/**
 * Handles the recipe_get tool: fetches one recipe and projects it per response_format.
 *
 * @param client - A MealieClient (or compatible fake)
 * @param args - Validated arguments (slug, response_format, include)
 * @returns An MCP result with the projected recipe (always includes id + slug)
 */
export async function recipeGetHandler(client: GetClient, args: GetArgs): Promise<CallToolResult> {
  try {
    const recipe = await client.get<RecipeDetail>(`/api/recipes/${args.slug}`);
    const projected = projectRecipe(recipe, args.response_format ?? "concise", args.include ?? []);
    return jsonResult(projected);
  } catch (error) {
    return errorResult(error, "recipe_get", "Failed to get recipe");
  }
}

/**
 * Registers the recipe_get tool on the server.
 *
 * @param server - The McpServer to register on
 * @param client - The MealieClient used by the handler
 */
export function registerRecipeGet(server: McpServer, client: MealieClient): void {
  server.registerTool(
    "recipe_get",
    {
      title: "Get Recipe",
      description:
        "Fetch a recipe by slug. Concise by default; use response_format=detailed or include=[comments,nutrition] for more.",
      inputSchema,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    (args) => recipeGetHandler(client, args),
  );
}

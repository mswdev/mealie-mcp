import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod";
import type { MealieClient } from "../../../client/MealieClient.js";
import type { components } from "../../../types/mealie.js";
import { errorResult, jsonResult } from "../../result.js";
import { type RecipeDetail, projectRecipe } from "../recipe-projection.js";

/** Minimal client surface the handler needs (eases test fakes). */
type CreateClient = Pick<MealieClient, "post" | "get">;

const inputSchema = {
  name: z.string().min(1).describe("Name of the new recipe"),
};

type CreateArgs = { name: string };

/**
 * Handles recipe_create: creates a stub recipe, then re-fetches it (the API
 * returns only a slug) and returns the concise projection.
 *
 * @param client - A MealieClient (or compatible fake)
 * @param args - Validated arguments (name)
 * @returns An MCP result with the concise created recipe, or an error result
 */
export async function recipeCreateHandler(
  client: CreateClient,
  args: CreateArgs,
): Promise<CallToolResult> {
  try {
    const body: components["schemas"]["CreateRecipe"] = { name: args.name };
    const slug = await client.post<string>("/api/recipes", body);
    const recipe = await client.get<RecipeDetail>(`/api/recipes/${slug}`);
    return jsonResult(projectRecipe(recipe, "concise", []));
  } catch (error) {
    return errorResult(error, "recipe_create", "Failed to create recipe");
  }
}

/**
 * Registers the recipe_create tool on the server.
 *
 * @param server - The McpServer to register on
 * @param client - The MealieClient used by the handler
 */
export function registerRecipeCreate(server: McpServer, client: MealieClient): void {
  server.registerTool(
    "recipe_create",
    {
      title: "Create Recipe",
      description:
        "Create a new recipe by name. Returns the created recipe (concise). Use recipe_update to fill in ingredients, instructions, and other details.",
      inputSchema,
      annotations: { readOnlyHint: false, openWorldHint: true },
    },
    (args) => recipeCreateHandler(client, args),
  );
}

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod";
import type { MealieClient } from "../../../client/MealieClient.js";
import { errorResult, jsonResult } from "../../result.js";
import { type RecipeDetail, projectRecipe } from "../recipe-projection.js";

/** Minimal client surface the handler needs (eases test fakes). */
type UpdateClient = Pick<MealieClient, "get" | "put" | "patch">;

const inputSchema = {
  slug: z.string().describe("The recipe slug to update (from recipe_search/recipe_get)"),
  changes: z
    .record(z.unknown())
    .describe(
      "Fields to change. Only the provided fields are modified — the tool merges them onto the current recipe before sending, so untouched fields (ingredients, instructions, etc.) are preserved.",
    ),
  method: z
    .enum(["put", "patch"])
    .optional()
    .describe("HTTP method (default patch); both replace the full recipe in Mealie"),
};

type UpdateArgs = {
  slug: string;
  changes: Record<string, unknown>;
  method?: "put" | "patch" | undefined;
};

/**
 * Handles recipe_update: fetches the current recipe, merges the requested changes
 * onto it, then sends the full merged object. Mealie's PUT and PATCH both perform
 * full-object replacement, so sending only the changed fields would wipe the rest —
 * the fetch-merge guards against that data loss. The write response (the updated
 * recipe) is returned directly: renaming regenerates the slug server-side, so
 * re-fetching by the original slug would 404.
 *
 * @param client - A MealieClient (or compatible fake)
 * @param args - Validated arguments (slug, changes, method)
 * @returns An MCP result with the concise updated recipe, or an error result
 */
export async function recipeUpdateHandler(
  client: UpdateClient,
  args: UpdateArgs,
): Promise<CallToolResult> {
  try {
    const path = `/api/recipes/${args.slug}`;
    const current = await client.get<RecipeDetail>(path);
    const merged = { ...(current as Record<string, unknown>), ...args.changes };
    const method = args.method ?? "patch";
    const updated = await client[method]<RecipeDetail>(path, merged);
    return jsonResult(projectRecipe(updated, "concise", []));
  } catch (error) {
    return errorResult(error, "recipe_update", "Failed to update recipe");
  }
}

/**
 * Registers the recipe_update tool on the server.
 *
 * @param server - The McpServer to register on
 * @param client - The MealieClient used by the handler
 */
export function registerRecipeUpdate(server: McpServer, client: MealieClient): void {
  server.registerTool(
    "recipe_update",
    {
      title: "Update Recipe",
      description:
        "Update a recipe by slug. Pass only the fields you want to change in `changes`; the tool merges them onto the current recipe so nothing else is lost. Returns the concise updated recipe.",
      inputSchema,
      annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: true },
    },
    (args) => recipeUpdateHandler(client, args),
  );
}

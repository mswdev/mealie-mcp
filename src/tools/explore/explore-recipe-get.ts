import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod";
import type { MealieClient } from "../../client/MealieClient.js";
import { errorResult, jsonResult } from "../result.js";
import {
  type ExploreIncludable,
  GROUP_SLUG_DESCRIPTION,
  PUBLIC_GROUP_HINT,
  exploreRecipesPath,
  projectExploreRecipe,
} from "./explore-projection.js";

/** Minimal client surface the handler needs (eases test fakes). */
type GetClient = Pick<MealieClient, "get">;

const inputSchema = {
  group_slug: z.string().describe(GROUP_SLUG_DESCRIPTION),
  slug: z.string().describe("The recipe slug (from explore_recipe_search results)"),
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
  group_slug: string;
  slug: string;
  response_format?: "concise" | "detailed" | undefined;
  include?: ExploreIncludable[] | undefined;
};

/**
 * Handles explore_recipe_get: fetches one public recipe by slug and projects it
 * per response_format (mirrors recipe_get).
 *
 * @param client - A MealieClient (or compatible fake)
 * @param args - Validated arguments (group_slug, slug, response_format, include)
 * @returns An MCP result with the projected recipe (always includes id + slug)
 */
export async function exploreRecipeGetHandler(
  client: GetClient,
  args: GetArgs,
): Promise<CallToolResult> {
  try {
    const path = `${exploreRecipesPath(args.group_slug)}/${encodeURIComponent(args.slug)}`;
    const recipe = await client.get<unknown>(path);
    const projected = projectExploreRecipe(
      recipe,
      args.response_format ?? "concise",
      args.include ?? [],
    );
    return jsonResult(projected);
  } catch (error) {
    return errorResult(error, "explore_recipe_get", "Failed to get public recipe");
  }
}

/**
 * Registers the explore_recipe_get tool on the server.
 *
 * @param server - The McpServer to register on
 * @param client - The MealieClient used by the handler
 */
export function registerExploreRecipeGet(server: McpServer, client: MealieClient): void {
  server.registerTool(
    "explore_recipe_get",
    {
      title: "Get Public Recipe",
      description: `Fetch a public recipe by slug. Concise by default; use response_format=detailed or include=[comments,nutrition] for more. ${PUBLIC_GROUP_HINT}`,
      inputSchema,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    (args) => exploreRecipeGetHandler(client, args),
  );
}

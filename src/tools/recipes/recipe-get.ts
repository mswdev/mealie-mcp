import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod";
import type { MealieClient } from "../../client/MealieClient.js";
import type { components } from "../../types/mealie.js";

/** Indentation width (in spaces) for JSON-formatted tool output. */
const JSON_INDENT = 2;

type RecipeDetail = components["schemas"]["Recipe-Output"];
type Includable = "comments" | "nutrition";
/** Minimal client surface the handler needs (eases test fakes). */
type GetClient = Pick<MealieClient, "get">;

/** Lightweight fields kept in the concise projection (design §1.3). */
const CONCISE_FIELDS = [
  "id",
  "slug",
  "name",
  "description",
  "image",
  "rating",
  "recipeServings",
  "recipeYield",
  "recipeYieldQuantity",
  "totalTime",
  "prepTime",
  "cookTime",
  "performTime",
  "recipeCategory",
  "tags",
  "tools",
  "dateUpdated",
  "lastMade",
] as const;

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
    const projected = project(recipe, args.response_format ?? "concise", args.include ?? []);
    return {
      content: [{ type: "text", text: JSON.stringify(projected, null, JSON_INDENT) }],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: "text", text: `Failed to get recipe: ${message}` }],
      isError: true,
    };
  }
}

/** Projects a full recipe to concise (+ optional includes) or returns it whole when detailed. */
function project(
  recipe: RecipeDetail,
  format: "concise" | "detailed",
  include: Includable[],
): Record<string, unknown> {
  if (format === "detailed") return recipe as unknown as Record<string, unknown>;
  const source = recipe as unknown as Record<string, unknown>;
  const concise: Record<string, unknown> = {};
  for (const field of CONCISE_FIELDS) concise[field] = source[field];
  for (const field of include) concise[field] = source[field];
  return concise;
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

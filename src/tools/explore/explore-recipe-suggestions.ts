import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod";
import type { MealieClient } from "../../client/MealieClient.js";
import type { QueryParams } from "../../client/pagination.js";
import type { components } from "../../types/mealie.js";
import { errorResult, jsonResult } from "../result.js";
import {
  GROUP_SLUG_DESCRIPTION,
  PUBLIC_GROUP_HINT,
  exploreRecipesPath,
} from "./explore-projection.js";

type SuggestionResponse = components["schemas"]["RecipeSuggestionResponse"];
/** Minimal client surface the handler needs (eases test fakes). */
type SuggestionsClient = Pick<MealieClient, "get">;

const inputSchema = {
  group_slug: z.string().describe(GROUP_SLUG_DESCRIPTION),
  foods: z.array(z.string()).optional().describe("Food ids you have on hand"),
  tools: z.array(z.string()).optional().describe("Tool ids you have on hand"),
  limit: z.number().int().positive().optional().describe("Max number of suggestions"),
  maxMissingFoods: z.number().int().min(0).optional().describe("Allow up to N missing foods"),
  maxMissingTools: z.number().int().min(0).optional().describe("Allow up to N missing tools"),
  orderBy: z.string().optional().describe("Field to sort by"),
  orderDirection: z.enum(["asc", "desc"]).optional().describe("Sort direction"),
};

type SuggestionsArgs = {
  group_slug: string;
  foods?: string[] | undefined;
  tools?: string[] | undefined;
  limit?: number | undefined;
  maxMissingFoods?: number | undefined;
  maxMissingTools?: number | undefined;
  orderBy?: string | undefined;
  orderDirection?: "asc" | "desc" | undefined;
};

/**
 * Handles explore_recipe_suggestions: recommends a public group's recipes given
 * foods/tools on hand (mirrors recipe_suggestions).
 *
 * @param client - A MealieClient (or compatible fake)
 * @param args - Validated query arguments (group_slug + suggestion filters)
 * @returns An MCP result with concise suggestions, or an error result
 */
export async function exploreRecipeSuggestionsHandler(
  client: SuggestionsClient,
  args: SuggestionsArgs,
): Promise<CallToolResult> {
  try {
    const response = await client.get<SuggestionResponse>(
      `${exploreRecipesPath(args.group_slug)}/suggestions`,
      toQuery(args),
    );
    return jsonResult({ items: response.items.map(toConcise) });
  } catch (error) {
    return errorResult(error, "explore_recipe_suggestions", "Failed to suggest public recipes");
  }
}

/** Builds the query params — group_slug stays in the path, never the query. */
function toQuery(args: SuggestionsArgs): QueryParams {
  return {
    foods: args.foods,
    tools: args.tools,
    limit: args.limit,
    maxMissingFoods: args.maxMissingFoods,
    maxMissingTools: args.maxMissingTools,
    orderBy: args.orderBy,
    orderDirection: args.orderDirection,
  };
}

/** Projects a suggestion item to a concise recipe ref + missing-food/tool names. */
function toConcise(item: SuggestionResponse["items"][number]): Record<string, unknown> {
  const recipe = item.recipe as { id?: unknown; slug?: unknown; name?: unknown };
  return {
    recipe: { id: recipe.id, slug: recipe.slug, name: recipe.name },
    missingFoods: item.missingFoods.map((food) => food.name),
    missingTools: item.missingTools.map((tool) => tool.name),
  };
}

/**
 * Registers the explore_recipe_suggestions tool on the server.
 *
 * @param server - The McpServer to register on
 * @param client - The MealieClient used by the handler
 */
export function registerExploreRecipeSuggestions(server: McpServer, client: MealieClient): void {
  server.registerTool(
    "explore_recipe_suggestions",
    {
      title: "Suggest Public Recipes",
      description: `Suggest recipes from a public group given foods/tools you have on hand. Returns concise items plus any missing foods/tools. ${PUBLIC_GROUP_HINT}`,
      inputSchema,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    (args) => exploreRecipeSuggestionsHandler(client, args),
  );
}

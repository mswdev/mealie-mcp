import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod";
import type { MealieClient } from "../../../client/MealieClient.js";
import { errorResult, jsonResult } from "../../result.js";

/** Minimal client surface the handler needs (eases test fakes). */
type ParseClient = Pick<MealieClient, "post">;

const inputSchema = {
  ingredients: z
    .array(z.string().min(1))
    .min(1)
    .describe("Free-text ingredient strings to parse (e.g. '1 tsp salt')"),
  parser: z.enum(["nlp", "brute", "openai"]).optional().describe("Parser to use (default nlp)"),
};

type ParseArgs = {
  ingredients: string[];
  parser?: "nlp" | "brute" | "openai" | undefined;
};

/**
 * Handles recipe_parse_ingredients: parses free-text ingredient strings into
 * structured ingredients. Stateless (no Mealie data is written), so it is a read
 * tool that stays available under the read-only switch.
 *
 * @param client - A MealieClient (or compatible fake)
 * @param args - Validated arguments (ingredients, parser)
 * @returns An MCP result with the parsed ingredient(s), or an error result
 */
export async function recipeParseIngredientsHandler(
  client: ParseClient,
  args: ParseArgs,
): Promise<CallToolResult> {
  try {
    const result = await parse(client, args);
    return jsonResult(result);
  } catch (error) {
    return errorResult(error, "recipe_parse_ingredients", "Failed to parse ingredients");
  }
}

/** Single ingredients hit the single endpoint (wrapped to an array); many use bulk. */
async function parse(client: ParseClient, args: ParseArgs): Promise<unknown> {
  const parser = args.parser;
  const first = args.ingredients[0];
  if (args.ingredients.length === 1 && first !== undefined) {
    const single = await client.post<unknown>("/api/parser/ingredient", {
      ingredient: first,
      ...(parser ? { parser } : {}),
    });
    return [single];
  }
  return client.post<unknown>("/api/parser/ingredients", {
    ingredients: args.ingredients,
    ...(parser ? { parser } : {}),
  });
}

/**
 * Registers the recipe_parse_ingredients tool on the server.
 *
 * @param server - The McpServer to register on
 * @param client - The MealieClient used by the handler
 */
export function registerRecipeParseIngredients(server: McpServer, client: MealieClient): void {
  server.registerTool(
    "recipe_parse_ingredients",
    {
      title: "Parse Ingredients",
      description:
        "Parse free-text ingredient strings into structured quantity/unit/food/note. Does not modify any recipe.",
      inputSchema,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    (args) => recipeParseIngredientsHandler(client, args),
  );
}

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod";
import type { MealieClient } from "../../client/MealieClient.js";
import type { components } from "../../types/mealie.js";
import { errorResult, jsonResult } from "../result.js";

/** Base path for the household recipe-actions resource. */
const BASE_PATH = "/api/households/recipe-actions";
/** Default recipe scale when the caller omits it (matches the schema @default). */
const DEFAULT_RECIPE_SCALE = 1;

/** Minimal client surface the handler needs (eases test fakes). */
type TriggerClient = Pick<MealieClient, "post">;

const inputSchema = {
  item_id: z.string().describe("Recipe action id, a UUID — the action to fire"),
  recipe_slug: z.string().describe("Slug of the recipe to run the action against"),
  recipe_scale: z
    .number()
    .positive()
    .optional()
    .describe(`Scale factor passed to the action (default ${DEFAULT_RECIPE_SCALE})`),
};

type TriggerArgs = {
  item_id: string;
  recipe_slug: string;
  recipe_scale?: number | undefined;
};

/**
 * Handles recipe_action_trigger: fires a recipe action (link/post) against a
 * recipe. The endpoint returns 202 Accepted with no typed body, so we return a
 * generic acknowledgement rather than parsing a result.
 *
 * @param client - A MealieClient (or compatible fake)
 * @param args - Validated arguments (item_id, recipe_slug, optional recipe_scale)
 * @returns An MCP result acknowledging the trigger, or an error result
 */
export async function recipeActionTriggerHandler(
  client: TriggerClient,
  args: TriggerArgs,
): Promise<CallToolResult> {
  try {
    const body: components["schemas"]["Body_trigger_action_api_households_recipe_actions__item_id__trigger__recipe_slug__post"] =
      { recipe_scale: args.recipe_scale ?? DEFAULT_RECIPE_SCALE };
    await client.post(`${BASE_PATH}/${args.item_id}/trigger/${args.recipe_slug}`, body);
    return jsonResult({
      ok: true,
      action: "trigger",
      item_id: args.item_id,
      recipe_slug: args.recipe_slug,
    });
  } catch (error) {
    return errorResult(error, "recipe_action_trigger", "Failed to trigger recipe action");
  }
}

/**
 * Registers the recipe_action_trigger tool on the server.
 *
 * @param server - The McpServer to register on
 * @param client - The MealieClient used by the handler
 */
export function registerRecipeActionTrigger(server: McpServer, client: MealieClient): void {
  server.registerTool(
    "recipe_action_trigger",
    {
      title: "Trigger Recipe Action",
      description:
        "Fire a household recipe action (link/post) against a recipe by slug. Non-destructive but hits the network (executes the action's URL). Accepts an optional recipe_scale.",
      inputSchema,
      annotations: { readOnlyHint: false, openWorldHint: true },
    },
    (args) => recipeActionTriggerHandler(client, args),
  );
}

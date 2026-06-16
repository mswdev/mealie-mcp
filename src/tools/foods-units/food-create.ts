import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod";
import type { MealieClient } from "../../client/MealieClient.js";
import type { components } from "../../types/mealie.js";
import { errorResult, jsonResult } from "../result.js";
import { type FoodDetail, projectFood } from "./food-projection.js";

/** Minimal client surface the handler needs (eases test fakes). */
type CreateClient = Pick<MealieClient, "post">;

const inputSchema = {
  name: z.string().min(1).describe("Food name (e.g. flour)"),
  pluralName: z.string().optional().describe("Plural form"),
  description: z.string().optional().describe("Optional description"),
  labelId: z.string().optional().describe("MultiPurposeLabel id (from the groups domain)"),
};

type CreateArgs = {
  name: string;
  pluralName?: string | undefined;
  description?: string | undefined;
  labelId?: string | undefined;
};

/**
 * Handles food_create: creates an ingredient food. Mealie's CreateIngredientFood
 * marks description/extras/aliases/householdsWithIngredientFood required (they sit
 * in the schema's `required` array despite having defaults), so the handler
 * supplies safe defaults for any the caller omits.
 *
 * @param client - A MealieClient (or compatible fake)
 * @param args - Validated arguments (name + optional fields)
 * @returns An MCP result with the concise created food, or an error result
 */
export async function foodCreateHandler(
  client: CreateClient,
  args: CreateArgs,
): Promise<CallToolResult> {
  try {
    const body: components["schemas"]["CreateIngredientFood"] = {
      name: args.name,
      description: args.description ?? "",
      extras: {},
      aliases: [],
      householdsWithIngredientFood: [],
      ...(args.pluralName ? { pluralName: args.pluralName } : {}),
      ...(args.labelId ? { labelId: args.labelId } : {}),
    };
    const created = await client.post<FoodDetail>("/api/foods", body);
    return jsonResult(projectFood(created, "concise"));
  } catch (error) {
    return errorResult(error, "food_create", "Failed to create food");
  }
}

/**
 * Registers the food_create tool on the server.
 *
 * @param server - The McpServer to register on
 * @param client - The MealieClient used by the handler
 */
export function registerFoodCreate(server: McpServer, client: MealieClient): void {
  server.registerTool(
    "food_create",
    {
      title: "Create Food",
      description:
        "Create an ingredient food. name is required; pluralName/description/labelId are optional.",
      inputSchema,
      annotations: { readOnlyHint: false, openWorldHint: true },
    },
    (args) => foodCreateHandler(client, args),
  );
}

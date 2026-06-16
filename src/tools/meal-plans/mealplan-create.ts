import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod";
import type { MealieClient } from "../../client/MealieClient.js";
import type { components } from "../../types/mealie.js";
import { errorResult, jsonResult } from "../result.js";
import { type PlanEntry, projectPlanEntry } from "./mealplan-projection.js";

/** Minimal client surface the handler needs (eases test fakes). */
type CreateClient = Pick<MealieClient, "post">;

/** Must match components["schemas"]["PlanEntryType"] exactly (verified in src/types). */
const ENTRY_TYPES = ["breakfast", "lunch", "dinner", "side", "snack", "drink", "dessert"] as const;

const inputSchema = {
  mode: z
    .enum(["entry", "random"])
    .optional()
    .describe(
      "entry (explicit, default) or random (Mealie picks a recipe per the household's rules)",
    ),
  date: z.string().describe("Date for the meal (YYYY-MM-DD)"),
  entryType: z.enum(ENTRY_TYPES).describe("Meal slot"),
  title: z.string().optional().describe("Entry title (entry mode; defaults from the recipe)"),
  text: z.string().optional().describe("Free-text note (entry mode)"),
  recipeId: z.string().optional().describe("Recipe UUID to schedule (entry mode)"),
};

type CreateArgs = {
  mode?: "entry" | "random" | undefined;
  date: string;
  entryType: (typeof ENTRY_TYPES)[number];
  title?: string | undefined;
  text?: string | undefined;
  recipeId?: string | undefined;
};

/**
 * Handles mealplan_create: schedules an explicit entry, or a random recipe that
 * respects the household's meal-plan rules. Both modes return a ReadPlanEntry.
 *
 * @param client - A MealieClient (or compatible fake)
 * @param args - Validated arguments (mode + scheduling fields)
 * @returns An MCP result with the concise created entry, or an error result
 */
export async function mealplanCreateHandler(
  client: CreateClient,
  args: CreateArgs,
): Promise<CallToolResult> {
  if (args.mode === "random" && args.recipeId) {
    return {
      content: [
        {
          type: "text",
          text: "mealplan_create: mode=random picks a recipe by the household's rules and ignores recipeId. Use mode=entry to schedule a specific recipe.",
        },
      ],
      isError: true,
    };
  }
  try {
    const created =
      args.mode === "random" ? await createRandom(client, args) : await createEntry(client, args);
    return jsonResult(projectPlanEntry(created, "concise"));
  } catch (error) {
    return errorResult(error, "mealplan_create", "Failed to create meal plan entry");
  }
}

/** POST an explicit CreatePlanEntry. */
async function createEntry(client: CreateClient, args: CreateArgs): Promise<PlanEntry> {
  const body: components["schemas"]["CreatePlanEntry"] = {
    date: args.date,
    entryType: args.entryType,
    title: args.title ?? "",
    text: args.text ?? "",
    ...(args.recipeId ? { recipeId: args.recipeId } : {}),
  };
  return client.post<PlanEntry>("/api/households/mealplans", body);
}

/** POST a CreateRandomEntry (date + entryType only). */
async function createRandom(client: CreateClient, args: CreateArgs): Promise<PlanEntry> {
  const body: components["schemas"]["CreateRandomEntry"] = {
    date: args.date,
    entryType: args.entryType,
  };
  return client.post<PlanEntry>("/api/households/mealplans/random", body);
}

/**
 * Registers the mealplan_create tool on the server.
 *
 * @param server - The McpServer to register on
 * @param client - The MealieClient used by the handler
 */
export function registerMealplanCreate(server: McpServer, client: MealieClient): void {
  server.registerTool(
    "mealplan_create",
    {
      title: "Create Meal Plan Entry",
      description:
        "Add a meal to the plan. mode=entry schedules a specific recipe/title; mode=random lets Mealie pick a recipe matching the household's meal-plan rules for that day/slot.",
      inputSchema,
      annotations: { readOnlyHint: false, openWorldHint: true },
    },
    (args) => mealplanCreateHandler(client, args),
  );
}

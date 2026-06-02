import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod";
import type { MealieClient } from "../../client/MealieClient.js";
import { errorResult, jsonResult } from "../result.js";

/** Default page size for the rules list. */
const DEFAULT_PER_PAGE = 20;
/** Maximum allowed page size. */
const MAX_PER_PAGE = 100;

/** Minimal client surface the handler needs (eases test fakes). */
type RulesClient = Pick<MealieClient, "get" | "getPaginated">;

const inputSchema = {
  action: z
    .enum(["list", "get"])
    .optional()
    .describe("list (all rules, paginated) or get (one rule by id)"),
  ruleId: z.string().optional().describe("Rule id, a UUID (action=get)"),
  page: z.number().int().positive().optional().describe("1-based page number (action=list)"),
  perPage: z
    .number()
    .int()
    .positive()
    .max(MAX_PER_PAGE)
    .optional()
    .describe(`Items per page (default ${DEFAULT_PER_PAGE}, action=list)`),
};

type RulesArgs = {
  action?: "list" | "get" | undefined;
  ruleId?: string | undefined;
  page?: number | undefined;
  perPage?: number | undefined;
};

/**
 * Handles mealplan_rules (reads): the paginated rule list, or a single rule by id.
 * Rules drive mealplan_create's random mode. Use mealplan_rule_write to mutate.
 *
 * @param client - A MealieClient (or compatible fake)
 * @param args - Validated arguments (action + action-specific fields)
 * @returns An MCP result with the requested rule(s), or an error result
 */
export async function mealplanRulesHandler(
  client: RulesClient,
  args: RulesArgs,
): Promise<CallToolResult> {
  try {
    return await read(client, args);
  } catch (error) {
    return errorResult(error, "mealplan_rules", "Failed to read meal plan rules");
  }
}

/** Routes the rule reads. */
async function read(client: RulesClient, args: RulesArgs): Promise<CallToolResult> {
  if ((args.action ?? "list") === "get") {
    if (!args.ruleId) return missing("ruleId");
    return jsonResult(await client.get(`/api/households/mealplans/rules/${args.ruleId}`));
  }
  const page = await client.getPaginated("/api/households/mealplans/rules", {
    page: args.page,
    perPage: args.perPage ?? DEFAULT_PER_PAGE,
  });
  return jsonResult(page);
}

/** Returns an isError result naming the field the chosen action requires. */
function missing(field: string): CallToolResult {
  return {
    content: [{ type: "text", text: `mealplan_rules: action requires "${field}"` }],
    isError: true,
  };
}

/**
 * Registers the mealplan_rules read tool on the server.
 *
 * @param server - The McpServer to register on
 * @param client - The MealieClient used by the handler
 */
export function registerMealplanRules(server: McpServer, client: MealieClient): void {
  server.registerTool(
    "mealplan_rules",
    {
      title: "Read Meal Plan Rules",
      description:
        "Read meal-plan rules (which recipe categories/tags Mealie may pick per day/slot for random meals): list (paginated) or get (one by id). Use mealplan_rule_write to add/edit/delete.",
      inputSchema,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    (args) => mealplanRulesHandler(client, args),
  );
}

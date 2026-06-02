import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod";
import type { MealieClient } from "../../client/MealieClient.js";
import type { components } from "../../types/mealie.js";
import { requireConfirmation } from "../confirm.js";
import { errorResult, jsonResult } from "../result.js";
import type { PlanRule } from "./mealplan-projection.js";

/** Minimal client surface the handler needs (eases test fakes). */
type RuleWriteClient = Pick<MealieClient, "get" | "post" | "put" | "delete">;

/** Must match components["schemas"]["PlanRulesDay"] exactly. */
const RULE_DAYS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
  "unset",
] as const;
/** Must match components["schemas"]["PlanRulesType"] exactly. */
const RULE_TYPES = [
  "breakfast",
  "lunch",
  "dinner",
  "side",
  "snack",
  "drink",
  "dessert",
  "unset",
] as const;

const inputSchema = {
  action: z.enum(["create", "update", "delete"]).describe("Rule write operation"),
  ruleId: z.string().optional().describe("Rule id, a UUID (action=update/delete)"),
  day: z.enum(RULE_DAYS).optional().describe("Day the rule applies to (use unset for any day)"),
  entryType: z
    .enum(RULE_TYPES)
    .optional()
    .describe("Meal slot the rule applies to (use unset for any slot)"),
  queryFilterString: z
    .string()
    .optional()
    .describe("Mealie filter expression selecting eligible recipes"),
  confirm: z.boolean().optional().describe("Must be true to delete (action=delete)"),
};

type RuleWriteArgs = {
  action: "create" | "update" | "delete";
  ruleId?: string | undefined;
  day?: (typeof RULE_DAYS)[number] | undefined;
  entryType?: (typeof RULE_TYPES)[number] | undefined;
  queryFilterString?: string | undefined;
  confirm?: boolean | undefined;
};

/**
 * Handles mealplan_rule_write: create, update, or delete a meal-plan rule.
 * Delete is confirm-gated.
 *
 * @param client - A MealieClient (or compatible fake)
 * @param args - Validated arguments (action + action-specific fields)
 * @returns An MCP result with the affected rule, or an error result
 */
export async function mealplanRuleWriteHandler(
  client: RuleWriteClient,
  args: RuleWriteArgs,
): Promise<CallToolResult> {
  if (args.action === "delete") return remove(client, args);
  try {
    return args.action === "create" ? await create(client, args) : await update(client, args);
  } catch (error) {
    return errorResult(error, "mealplan_rule_write", "Failed to write meal plan rule");
  }
}

/** Builds a fresh PlanRulesCreate body (create has nothing to merge onto). */
function buildBody(args: RuleWriteArgs): components["schemas"]["PlanRulesCreate"] {
  return {
    day: args.day ?? "unset",
    entryType: args.entryType ?? "unset",
    queryFilterString: args.queryFilterString ?? "",
  };
}

/** POST a new rule. */
async function create(client: RuleWriteClient, args: RuleWriteArgs): Promise<CallToolResult> {
  return jsonResult(await client.post("/api/households/mealplans/rules", buildBody(args)));
}

/**
 * PUT an edited rule. The endpoint takes the full PlanRulesCreate (replace, not
 * patch), so we fetch the current rule and overlay only the provided fields —
 * otherwise an omitted day/entryType/queryFilterString would be silently reset.
 */
async function update(client: RuleWriteClient, args: RuleWriteArgs): Promise<CallToolResult> {
  if (!args.ruleId) return missing("ruleId");
  const path = `/api/households/mealplans/rules/${args.ruleId}`;
  const current = await client.get<PlanRule>(path);
  const body: components["schemas"]["PlanRulesCreate"] = {
    day: args.day ?? current.day,
    entryType: args.entryType ?? current.entryType,
    queryFilterString: args.queryFilterString ?? current.queryFilterString,
  };
  return jsonResult(await client.put(path, body));
}

/** DELETE a rule (confirm-gated). */
async function remove(client: RuleWriteClient, args: RuleWriteArgs): Promise<CallToolResult> {
  if (!args.ruleId) return missing("ruleId");
  const unconfirmed = requireConfirmation(args.confirm, `delete meal plan rule ${args.ruleId}`);
  if (unconfirmed) return unconfirmed;
  try {
    await client.delete(`/api/households/mealplans/rules/${args.ruleId}`);
    return jsonResult({ deleted: args.ruleId });
  } catch (error) {
    return errorResult(error, "mealplan_rule_write", "Failed to delete meal plan rule");
  }
}

/** Returns an isError result naming the field the chosen action requires. */
function missing(field: string): CallToolResult {
  return {
    content: [{ type: "text", text: `mealplan_rule_write: action requires "${field}"` }],
    isError: true,
  };
}

/**
 * Registers the mealplan_rule_write tool on the server.
 *
 * @param server - The McpServer to register on
 * @param client - The MealieClient used by the handler
 */
export function registerMealplanRuleWrite(server: McpServer, client: MealieClient): void {
  server.registerTool(
    "mealplan_rule_write",
    {
      title: "Write Meal Plan Rule",
      description:
        "Create, edit, or delete a meal-plan rule (constrains which recipes Mealie's random meals may pick per day/slot). Delete is destructive (confirm:true).",
      inputSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    },
    (args) => mealplanRuleWriteHandler(client, args),
  );
}

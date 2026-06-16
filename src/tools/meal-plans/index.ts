import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { MealieClient } from "../../client/MealieClient.js";
import { registerMealplanCreate } from "./mealplan-create.js";
import { registerMealplanDelete } from "./mealplan-delete.js";
import { registerMealplanGet } from "./mealplan-get.js";
import { registerMealplanRuleWrite } from "./mealplan-rule-write.js";
import { registerMealplanRules } from "./mealplan-rules.js";
import { registerMealplanSearch } from "./mealplan-search.js";
import { registerMealplanToday } from "./mealplan-today.js";
import { registerMealplanUpdate } from "./mealplan-update.js";

/** Options controlling which meal-plan tools are registered. */
export type RegisterOptions = { readOnly: boolean };

/**
 * Registers the meal-plans toolset (entries + rules). Reads are always
 * registered; writes are registered only when not running in read-only mode.
 *
 * @param server - The McpServer to register on
 * @param client - The MealieClient passed to each handler
 * @param options - Registration options (read-only switch)
 */
export function registerMealPlanTools(
  server: McpServer,
  client: MealieClient,
  options: RegisterOptions,
): void {
  registerMealplanSearch(server, client);
  registerMealplanGet(server, client);
  registerMealplanToday(server, client);
  registerMealplanRules(server, client);

  if (options.readOnly) return;
  registerMealplanCreate(server, client);
  registerMealplanUpdate(server, client);
  registerMealplanDelete(server, client);
  registerMealplanRuleWrite(server, client);
}

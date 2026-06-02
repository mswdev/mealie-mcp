import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { MealieClient } from "../../client/MealieClient.js";
import { registerFoodCreate } from "./food-create.js";
import { registerFoodDelete } from "./food-delete.js";
import { registerFoodGet } from "./food-get.js";
import { registerFoodMerge } from "./food-merge.js";
import { registerFoodSearch } from "./food-search.js";
import { registerFoodUpdate } from "./food-update.js";
import { registerUnitCreate } from "./unit-create.js";
import { registerUnitDelete } from "./unit-delete.js";
import { registerUnitGet } from "./unit-get.js";
import { registerUnitMerge } from "./unit-merge.js";
import { registerUnitSearch } from "./unit-search.js";
import { registerUnitUpdate } from "./unit-update.js";

/** Options controlling which food/unit tools are registered. */
export type RegisterOptions = { readOnly: boolean };

/**
 * Registers the foods/units toolset (the ingredient catalog primitives). Reads
 * are always registered; writes (create/update/merge/delete) are registered only
 * when not running in read-only mode.
 *
 * @param server - The McpServer to register on
 * @param client - The MealieClient passed to each handler
 * @param options - Registration options (read-only switch)
 */
export function registerFoodsUnitsTools(
  server: McpServer,
  client: MealieClient,
  options: RegisterOptions,
): void {
  registerFoodSearch(server, client);
  registerFoodGet(server, client);
  registerUnitSearch(server, client);
  registerUnitGet(server, client);

  if (options.readOnly) return;
  registerFoodCreate(server, client);
  registerFoodUpdate(server, client);
  registerFoodMerge(server, client);
  registerFoodDelete(server, client);
  registerUnitCreate(server, client);
  registerUnitUpdate(server, client);
  registerUnitMerge(server, client);
  registerUnitDelete(server, client);
}

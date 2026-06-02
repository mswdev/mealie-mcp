import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { MealieClient } from "../../client/MealieClient.js";
import { registerShoppingItemCreate } from "./shopping-item-create.js";
import { registerShoppingItemDelete } from "./shopping-item-delete.js";
import { registerShoppingItemGet } from "./shopping-item-get.js";
import { registerShoppingItemUpdate } from "./shopping-item-update.js";
import { registerShoppingListCreate } from "./shopping-list-create.js";
import { registerShoppingListDelete } from "./shopping-list-delete.js";
import { registerShoppingListGet } from "./shopping-list-get.js";
import { registerShoppingListLabelSettings } from "./shopping-list-label-settings.js";
import { registerRecipeReferences } from "./shopping-list-recipe-references.js";
import { registerShoppingListSearch } from "./shopping-list-search.js";
import { registerShoppingListUpdate } from "./shopping-list-update.js";

/** Options controlling which shopping tools are registered. */
export type RegisterOptions = { readOnly: boolean };

/**
 * Registers the shopping-lists toolset (lists + items). Reads are always
 * registered; writes are registered only when not running in read-only mode.
 *
 * @param server - The McpServer to register on
 * @param client - The MealieClient passed to each handler
 * @param options - Registration options (read-only switch)
 */
export function registerShoppingTools(
  server: McpServer,
  client: MealieClient,
  options: RegisterOptions,
): void {
  registerShoppingListSearch(server, client);
  registerShoppingListGet(server, client);
  registerShoppingItemGet(server, client);

  if (options.readOnly) return;
  registerShoppingListCreate(server, client);
  registerShoppingListUpdate(server, client);
  registerShoppingListDelete(server, client);
  registerShoppingListLabelSettings(server, client);
  registerRecipeReferences(server, client);
  registerShoppingItemCreate(server, client);
  registerShoppingItemUpdate(server, client);
  registerShoppingItemDelete(server, client);
}

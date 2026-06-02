import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { MealieClient } from "./client/MealieClient.js";
import { createServer } from "./server.js";

/** All mutating tools — none of these may appear when read-only is on. */
const WRITE_TOOLS = [
  "recipe_create",
  "recipe_update",
  "recipe_delete",
  "recipe_update_many",
  "recipe_duplicate",
  "recipe_mark_made",
  "recipe_import",
  "recipe_image",
  "recipe_assets",
  "recipe_bulk_actions",
  "recipe_export_run",
  "recipe_comment_write",
  "recipe_timeline_write",
  "recipe_share_write",
  // cookbooks
  "cookbook_create",
  "cookbook_update",
  "cookbook_delete",
  // meal plans
  "mealplan_create",
  "mealplan_update",
  "mealplan_delete",
  "mealplan_rule_write",
  // shopping lists
  "shopping_list_create",
  "shopping_list_update",
  "shopping_list_delete",
  "shopping_list_label_settings",
  "shopping_list_recipe_references",
  "shopping_item_create",
  "shopping_item_update",
  "shopping_item_delete",
];

/** A representative set of reads that must always be present. */
const READ_TOOLS = [
  "recipe_search",
  "recipe_get",
  "recipe_suggestions",
  "recipe_media",
  "recipe_comments",
  "recipe_timeline",
  "recipe_share",
  "recipe_export",
  "recipe_parse_ingredients",
  // cookbooks
  "cookbook_search",
  "cookbook_get",
  // meal plans
  "mealplan_search",
  "mealplan_get",
  "mealplan_today",
  "mealplan_rules",
  // shopping lists
  "shopping_list_search",
  "shopping_list_get",
  "shopping_item_get",
];

async function listToolNames(readOnly: boolean): Promise<string[]> {
  const server = createServer(new MealieClient("https://m.test", "tok"), { readOnly });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  const { tools } = await client.listTools();
  await client.close();
  return tools.map((tool) => tool.name);
}

describe("read-only switch", () => {
  it("hides every mutating tool when MEALIE_READ_ONLY is on", async () => {
    const names = await listToolNames(true);

    for (const read of READ_TOOLS) expect(names).toContain(read);
    for (const write of WRITE_TOOLS) expect(names).not.toContain(write);
    // get_about + 18 reads (9 recipe + 2 cookbook + 4 meal-plan + 3 shopping), no writes
    expect(names).toHaveLength(19);
  });

  it("exposes mutating tools when not read-only", async () => {
    const names = await listToolNames(false);

    for (const read of READ_TOOLS) expect(names).toContain(read);
    for (const write of WRITE_TOOLS) expect(names).toContain(write);
    // get_about + 18 reads (9 recipe + 2 cookbook + 4 meal-plan + 3 shopping) + 29 writes (14 recipe + 3 cookbook + 4 meal-plan + 8 shopping)
    expect(names).toHaveLength(48);
  });
});

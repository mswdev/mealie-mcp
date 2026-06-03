import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { MealieClient } from "./client/MealieClient.js";
import type { ToolsetName } from "./config.js";
import { createServer } from "./server.js";

/** No opt-in toolsets enabled — the default surface. */
const NO_TOOLSETS: ReadonlySet<ToolsetName> = new Set();

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
  // organizers
  "organizer_create",
  "organizer_update",
  "organizer_delete",
  // foods + units
  "food_create",
  "food_update",
  "food_merge",
  "food_delete",
  "unit_create",
  "unit_update",
  "unit_merge",
  "unit_delete",
];

/** A representative set of reads that must always be present. */
const READ_TOOLS = [
  // app
  "app_get_info",
  "app_download_file",
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
  // organizers
  "organizer_search",
  "organizer_get",
  // foods + units
  "food_search",
  "food_get",
  "unit_search",
  "unit_get",
];

async function listToolNames(options: {
  readOnly: boolean;
  toolsets?: ReadonlySet<ToolsetName>;
}): Promise<string[]> {
  const server = createServer(new MealieClient("https://m.test", "tok"), {
    readOnly: options.readOnly,
    toolsets: options.toolsets ?? NO_TOOLSETS,
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  const { tools } = await client.listTools();
  await client.close();
  return tools.map((tool) => tool.name);
}

describe("read-only switch", () => {
  it("hides every mutating tool when MEALIE_READ_ONLY is on", async () => {
    const names = await listToolNames({ readOnly: true });

    for (const read of READ_TOOLS) expect(names).toContain(read);
    for (const write of WRITE_TOOLS) expect(names).not.toContain(write);
    // 26 reads (2 app + 9 recipe + 2 cookbook + 4 meal-plan + 3 shopping + 2 organizer
    // + 4 foods/units), no writes
    expect(names).toHaveLength(26);
  });

  it("exposes mutating tools when not read-only", async () => {
    const names = await listToolNames({ readOnly: false });

    for (const read of READ_TOOLS) expect(names).toContain(read);
    for (const write of WRITE_TOOLS) expect(names).toContain(write);
    // 26 reads (2 app + 9 recipe + 2 cookbook + 4 meal-plan + 3 shopping + 2 organizer + 4 foods/units)
    // + 40 writes (14 recipe + 3 cookbook + 4 meal-plan + 8 shopping + 3 organizer + 8 foods/units)
    expect(names).toHaveLength(66);
  });
});

// Opt-in toolset tools, grown per resource as they land (finalized in the e2e below).
const HOUSEHOLDS_READS = ["household_self_get", "household_invitations_list"];
const HOUSEHOLDS_WRITES = ["household_self_update", "household_invite"];
const AUTOMATION_READS = ["webhook_get", "event_notification_get", "recipe_action_get"];
const AUTOMATION_WRITES = [
  "webhook_write",
  "webhook_action",
  "event_notification_write",
  "event_notification_test",
  "recipe_action_write",
  "recipe_action_trigger",
];

const ALL_OPTIN = [
  ...HOUSEHOLDS_READS,
  ...HOUSEHOLDS_WRITES,
  ...AUTOMATION_READS,
  ...AUTOMATION_WRITES,
];

describe("opt-in toolsets", () => {
  const AUTOMATION: ReadonlySet<ToolsetName> = new Set(["automation"]);
  const HOUSEHOLDS: ReadonlySet<ToolsetName> = new Set(["households"]);

  it("omits every opt-in tool when no toolset is enabled", async () => {
    const names = await listToolNames({ readOnly: false });

    for (const tool of ALL_OPTIN) expect(names).not.toContain(tool);
  });

  it("exposes only the households tools when households is enabled", async () => {
    const names = await listToolNames({ readOnly: false, toolsets: HOUSEHOLDS });

    for (const tool of [...HOUSEHOLDS_READS, ...HOUSEHOLDS_WRITES]) expect(names).toContain(tool);
    for (const tool of [...AUTOMATION_READS, ...AUTOMATION_WRITES])
      expect(names).not.toContain(tool);
  });

  it("exposes automation reads + writes when the toolset is enabled", async () => {
    const names = await listToolNames({ readOnly: false, toolsets: AUTOMATION });

    for (const tool of [...AUTOMATION_READS, ...AUTOMATION_WRITES]) expect(names).toContain(tool);
  });

  it("strips opt-in writes within enabled toolsets under read-only", async () => {
    const names = await listToolNames({
      readOnly: true,
      toolsets: new Set(["households", "automation"]),
    });

    for (const read of [...HOUSEHOLDS_READS, ...AUTOMATION_READS]) expect(names).toContain(read);
    for (const write of [...HOUSEHOLDS_WRITES, ...AUTOMATION_WRITES]) {
      expect(names).not.toContain(write);
    }
  });
});

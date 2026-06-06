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

const GROUPS_READS = [
  "group_self_get",
  "group_households_list",
  "label_get",
  "group_ai_provider_get",
  "group_report_get",
];
const GROUPS_WRITES = [
  "group_self_update",
  "label_write",
  "group_ai_provider_write",
  "group_ai_provider_settings_update",
  "group_seed",
  "group_start_migration",
  "group_report_delete",
];

const USERS_READS = ["user_me", "user_ratings_get"];
const USERS_WRITES = [
  "user_self_update",
  "user_ratings_write",
  "user_api_token_write",
  "user_password_write",
  "user_register",
  "user_avatar_upload",
];

const ADMIN_READS = [
  "admin_about",
  "admin_user_get",
  "admin_household_get",
  "admin_group_get",
  "admin_ai_provider_get",
  "admin_maintenance_get",
  "admin_backup_get",
];
const ADMIN_WRITES = [
  "admin_user_write",
  "admin_user_actions",
  "admin_household_write",
  "admin_group_write",
  "admin_ai_provider_write",
  "admin_backup_write",
  "admin_backup_restore",
  "admin_maintenance_clean",
  "admin_email_test",
  "admin_debug_openai",
];

/** Explore is all reads — there is deliberately NO EXPLORE_WRITES array (design §6). */
const EXPLORE_READS = [
  "explore_recipe_search",
  "explore_recipe_get",
  "explore_recipe_suggestions",
  "explore_list",
  "explore_get",
];

const ALL_OPTIN = [
  ...HOUSEHOLDS_READS,
  ...HOUSEHOLDS_WRITES,
  ...AUTOMATION_READS,
  ...AUTOMATION_WRITES,
  ...GROUPS_READS,
  ...GROUPS_WRITES,
  ...USERS_READS,
  ...USERS_WRITES,
  ...ADMIN_READS,
  ...ADMIN_WRITES,
  ...EXPLORE_READS,
];

describe("opt-in toolsets", () => {
  const AUTOMATION: ReadonlySet<ToolsetName> = new Set(["automation"]);
  const HOUSEHOLDS: ReadonlySet<ToolsetName> = new Set(["households"]);
  const GROUPS: ReadonlySet<ToolsetName> = new Set(["groups"]);
  const USERS: ReadonlySet<ToolsetName> = new Set(["users"]);
  const ADMIN: ReadonlySet<ToolsetName> = new Set(["admin"]);
  const EXPLORE: ReadonlySet<ToolsetName> = new Set(["explore"]);
  const ALL: ReadonlySet<ToolsetName> = new Set([
    "households",
    "automation",
    "groups",
    "users",
    "admin",
    "explore",
  ]);

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

  it("exposes only the automation tools when automation is enabled", async () => {
    const names = await listToolNames({ readOnly: false, toolsets: AUTOMATION });

    for (const tool of [...AUTOMATION_READS, ...AUTOMATION_WRITES]) expect(names).toContain(tool);
    for (const tool of [...HOUSEHOLDS_READS, ...HOUSEHOLDS_WRITES])
      expect(names).not.toContain(tool);
  });

  it("adds exactly 13 opt-in tools (79 full) when both toolsets are enabled", async () => {
    const names = await listToolNames({
      readOnly: false,
      toolsets: new Set(["households", "automation"]),
    });

    for (const tool of [
      ...HOUSEHOLDS_READS,
      ...HOUSEHOLDS_WRITES,
      ...AUTOMATION_READS,
      ...AUTOMATION_WRITES,
    ]) {
      expect(names).toContain(tool);
    }
    for (const tool of [...GROUPS_READS, ...GROUPS_WRITES]) expect(names).not.toContain(tool);
    // 66 default + 5 opt-in reads (2 households + 3 automation) + 8 opt-in writes
    // (2 households + 6 automation) = 79
    expect(names).toHaveLength(79);
  });

  it("strips opt-in writes within enabled toolsets under read-only (31 reads)", async () => {
    const names = await listToolNames({
      readOnly: true,
      toolsets: new Set(["households", "automation"]),
    });

    for (const read of [...HOUSEHOLDS_READS, ...AUTOMATION_READS]) expect(names).toContain(read);
    for (const write of [...HOUSEHOLDS_WRITES, ...AUTOMATION_WRITES]) {
      expect(names).not.toContain(write);
    }
    // 26 default reads + 5 opt-in reads; all 48 writes stripped
    expect(names).toHaveLength(31);
  });

  it("exposes only the groups tools when groups is enabled", async () => {
    const names = await listToolNames({ readOnly: false, toolsets: GROUPS });

    for (const tool of [...GROUPS_READS, ...GROUPS_WRITES]) expect(names).toContain(tool);
    for (const tool of [
      ...HOUSEHOLDS_READS,
      ...AUTOMATION_READS,
      ...HOUSEHOLDS_WRITES,
      ...AUTOMATION_WRITES,
    ]) {
      expect(names).not.toContain(tool);
    }
  });

  it("adds exactly 12 opt-in tools (78 full) when groups is enabled", async () => {
    const names = await listToolNames({ readOnly: false, toolsets: GROUPS });

    // 66 default + 5 group reads + 7 group writes = 78
    expect(names).toHaveLength(78);
  });

  it("strips group writes under read-only (31 reads)", async () => {
    const names = await listToolNames({ readOnly: true, toolsets: GROUPS });

    for (const read of GROUPS_READS) expect(names).toContain(read);
    for (const write of GROUPS_WRITES) expect(names).not.toContain(write);
    // 26 default reads + 5 group reads; all writes stripped
    expect(names).toHaveLength(31);
  });

  it("exposes only the users tools when users is enabled", async () => {
    const names = await listToolNames({ readOnly: false, toolsets: USERS });

    for (const tool of [...USERS_READS, ...USERS_WRITES]) expect(names).toContain(tool);
    for (const tool of [
      ...HOUSEHOLDS_READS,
      ...HOUSEHOLDS_WRITES,
      ...AUTOMATION_READS,
      ...AUTOMATION_WRITES,
      ...GROUPS_READS,
      ...GROUPS_WRITES,
    ]) {
      expect(names).not.toContain(tool);
    }
  });

  it("adds exactly 8 opt-in tools (74 full) when users is enabled", async () => {
    const names = await listToolNames({ readOnly: false, toolsets: USERS });

    // 66 default + 2 user reads + 6 user writes = 74
    expect(names).toHaveLength(74);
  });

  it("strips user writes under read-only (28 reads)", async () => {
    const names = await listToolNames({ readOnly: true, toolsets: USERS });

    for (const read of USERS_READS) expect(names).toContain(read);
    for (const write of USERS_WRITES) expect(names).not.toContain(write);
    // 26 default reads + 2 user reads; all writes stripped
    expect(names).toHaveLength(28);
  });

  it("exposes only the admin tools when admin is enabled", async () => {
    const names = await listToolNames({ readOnly: false, toolsets: ADMIN });

    for (const tool of [...ADMIN_READS, ...ADMIN_WRITES]) expect(names).toContain(tool);
    for (const tool of [
      ...HOUSEHOLDS_READS,
      ...HOUSEHOLDS_WRITES,
      ...AUTOMATION_READS,
      ...AUTOMATION_WRITES,
      ...GROUPS_READS,
      ...GROUPS_WRITES,
      ...USERS_READS,
      ...USERS_WRITES,
    ]) {
      expect(names).not.toContain(tool);
    }
  });

  it("adds exactly 17 opt-in tools (83 full) when admin is enabled", async () => {
    const names = await listToolNames({ readOnly: false, toolsets: ADMIN });

    // 66 default + 7 admin reads + 10 admin writes = 83
    expect(names).toHaveLength(83);
  });

  it("strips admin writes under read-only (33 reads)", async () => {
    const names = await listToolNames({ readOnly: true, toolsets: ADMIN });

    for (const read of ADMIN_READS) expect(names).toContain(read);
    for (const write of ADMIN_WRITES) expect(names).not.toContain(write);
    // 26 default reads + 7 admin reads; all writes stripped
    expect(names).toHaveLength(33);
  });

  it("exposes only the explore tools when explore is enabled", async () => {
    const names = await listToolNames({ readOnly: false, toolsets: EXPLORE });

    for (const tool of EXPLORE_READS) expect(names).toContain(tool);
    for (const tool of [
      ...HOUSEHOLDS_READS,
      ...HOUSEHOLDS_WRITES,
      ...AUTOMATION_READS,
      ...AUTOMATION_WRITES,
      ...GROUPS_READS,
      ...GROUPS_WRITES,
      ...USERS_READS,
      ...USERS_WRITES,
      ...ADMIN_READS,
      ...ADMIN_WRITES,
    ]) {
      expect(names).not.toContain(tool);
    }
  });

  it("adds exactly 5 opt-in tools (71 full) when explore is enabled", async () => {
    const names = await listToolNames({ readOnly: false, toolsets: EXPLORE });

    // 66 default + 5 explore reads + 0 explore writes = 71
    expect(names).toHaveLength(71);
  });

  it("keeps every explore tool under read-only (31 reads) — explore has no writes to strip", async () => {
    const names = await listToolNames({ readOnly: true, toolsets: EXPLORE });

    // The first toolset that fully survives read-only: all 5 explore tools remain.
    for (const tool of EXPLORE_READS) expect(names).toContain(tool);
    // 26 default reads + 5 explore reads; nothing stripped from explore itself
    expect(names).toHaveLength(31);
  });

  it("composes orthogonally — all six toolsets enabled (121 full)", async () => {
    const names = await listToolNames({ readOnly: false, toolsets: ALL });

    for (const tool of ALL_OPTIN) expect(names).toContain(tool);
    // 66 default + 13 households/automation + 12 groups + 8 users + 17 admin + 5 explore = 121
    expect(names).toHaveLength(121);
  });
});

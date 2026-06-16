import { expect, runCheck, snippet } from "../assert.js";
import type { CheckContext } from "./context.js";

/** PR #4 owed: meal-plans + shopping-lists + cookbooks — fetch-merge survival, integer ids, Output-variant round-trip. */
export async function run(ctx: CheckContext): Promise<void> {
  await mealplan(ctx);
  await shoppingListUpdate(ctx);
  await shoppingItem(ctx);
  await cookbook(ctx);
}

/** mealplan_create returns an integer id; update preserves untouched `text` across a title rename. */
async function mealplan(ctx: CheckContext): Promise<void> {
  await runCheck(
    {
      id: "C-MEALPLAN",
      owedPr: "#4",
      title: "mealplan_update preserves text across rename (integer id)",
    },
    async () => {
      const created = await ctx.mcp.call("mealplan_create", {
        date: "2026-06-20",
        entryType: "dinner",
        title: "VerifyMeal",
        text: "keep-this-note",
      });
      expect(!created.isError, `create failed: ${created.text}`);
      const planId = (created.json as { id: number }).id;
      expect(typeof planId === "number", `id should be an integer: ${snippet(created.json)}`);

      const upd = await ctx.mcp.call("mealplan_update", {
        planId,
        changes: { title: "VerifyMealRenamed" },
      });
      expect(!upd.isError, `update failed: ${upd.text}`);
      const after = await ctx.mcp.call("mealplan_get", { planId });
      expect(
        (after.json as { title?: string }).title === "VerifyMealRenamed",
        "title did not change",
      );
      expect(
        (after.json as { text?: string }).text === "keep-this-note",
        `text reset on rename: ${snippet(after.json)}`,
      );
      return `integer id=${planId}; text survived rename`;
    },
  );
}

/** shopping_list_update fetch-merge re-sends the Output-variant listItems into the Input body with no 422. */
async function shoppingListUpdate(ctx: CheckContext): Promise<void> {
  await runCheck(
    {
      id: "C-SHOPLIST-UPDATE",
      owedPr: "#4",
      title: "shopping_list_update round-trips listItems (no 422) + rename",
    },
    async () => {
      const list = await ctx.mcp.call("shopping_list_create", { name: "VerifyList" });
      const listId = (list.json as { id: string }).id;
      const item = await ctx.mcp.call("shopping_item_create", {
        item: { shoppingListId: listId, display: "1 milk" },
      });
      expect(!item.isError, `item seed failed: ${item.text}`);

      const upd = await ctx.mcp.call("shopping_list_update", {
        listId,
        changes: { name: "VerifyListRenamed" },
      });
      expect(!upd.isError, `update failed (Output-variant listItems rejected?): ${upd.text}`);
      const after = await ctx.mcp.call("shopping_list_get", { listId });
      const body = after.json as { name?: string; itemCount?: number };
      expect(body.name === "VerifyListRenamed", "rename did not apply");
      expect(body.itemCount === 1, `listItems lost through the update PUT: ${snippet(after.json)}`);
      return "rename applied; 1 item survived the Output->Input PUT";
    },
  );
}

/** shopping_item_create (single+bulk) returns id arrays; update preserves untouched fields. */
async function shoppingItem(ctx: CheckContext): Promise<void> {
  await runCheck(
    {
      id: "C-SHOPITEM",
      owedPr: "#4",
      title: "shopping_item create/update fetch-merge preserves note+quantity",
    },
    async () => {
      const list = await ctx.mcp.call("shopping_list_create", { name: "VerifyShopList" });
      const listId = (list.json as { id: string }).id;
      const created = await ctx.mcp.call("shopping_item_create", {
        item: { shoppingListId: listId, display: "2 eggs", note: "keepme", quantity: 2 },
      });
      const itemId = (created.json as { created?: string[] }).created?.[0];
      expect(typeof itemId === "string", `expected created[0] id: ${snippet(created.json)}`);
      const bulk = await ctx.mcp.call("shopping_item_create", {
        items: [
          {
            shoppingListId: listId,
            display: "1 bread",
            quantity: 1,
            position: 0,
            checked: false,
            note: "",
            extras: {},
            recipeReferences: [],
          },
        ],
      });
      expect(
        (bulk.json as { created?: string[] }).created?.length === 1,
        `bulk create failed: ${bulk.text}`,
      );

      const upd = await ctx.mcp.call("shopping_item_update", {
        itemId,
        changes: { checked: true },
      });
      expect(!upd.isError, `item update failed: ${upd.text}`);
      const after = await ctx.mcp.call("shopping_item_get", { action: "get", itemId });
      const body = after.json as { note?: string; quantity?: number; checked?: boolean };
      expect(
        body.note === "keepme" && body.quantity === 2,
        `note/quantity reset on update: ${snippet(after.json)}`,
      );
      expect(body.checked === true, "checked change did not apply");
      return "single+bulk created; note/quantity survived; checked applied";
    },
  );
}

/** cookbook_update fetch-merge preserves queryFilterString across a rename. */
async function cookbook(ctx: CheckContext): Promise<void> {
  await runCheck(
    {
      id: "C-COOKBOOK",
      owedPr: "#4",
      title: "cookbook_update preserves queryFilterString across rename",
    },
    async () => {
      const created = await ctx.mcp.call("cookbook_create", {
        name: "VerifyBook",
        queryFilterString: 'tags.name CONTAINS ALL ["quick"]',
      });
      expect(!created.isError, `create failed: ${created.text}`);
      const id = (created.json as { id: string }).id;
      const upd = await ctx.mcp.call("cookbook_update", {
        id,
        changes: { name: "VerifyBookRenamed" },
      });
      expect(!upd.isError, `update failed (422?): ${upd.text}`);
      const after = await ctx.mcp.call("cookbook_get", { id });
      const body = after.json as { name?: string; queryFilterString?: string };
      expect(body.name === "VerifyBookRenamed", "rename did not apply");
      expect(
        Boolean(body.queryFilterString) && body.queryFilterString?.includes("quick") === true,
        `queryFilterString lost on rename: ${snippet(after.json)}`,
      );
      return `rename applied; queryFilterString survived: ${snippet(body.queryFilterString)}`;
    },
  );
}

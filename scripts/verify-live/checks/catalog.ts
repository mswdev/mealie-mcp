import { expect, runCheck, snippet } from "../assert.js";
import type { CheckContext } from "./context.js";

/** PR #5 owed: organizers + foods/units — fetch-merge survival, merge, confirm-gated delete, empty_only branch. */
export async function run(ctx: CheckContext): Promise<void> {
  await foodMerge(ctx);
  await foodDelete(ctx);
  await organizerMerge(ctx);
  await organizerEmpty(ctx);
  await unitMergeAndUpdate(ctx);
}

/** food_update fetch-merge must preserve aliases across a rename (the canonical shape). */
async function foodMerge(ctx: CheckContext): Promise<void> {
  await runCheck(
    { id: "C-FOOD-MERGE", owedPr: "#5", title: "food_update preserves aliases across rename" },
    async () => {
      // food_create only accepts name/pluralName/description/labelId — aliases are
      // seeded via a first update (Mealie persists aliases on PUT, verified live).
      const created = await ctx.mcp.call("food_create", { name: "VerifyLeek" });
      expect(!created.isError, `create failed: ${created.text}`);
      const id = (created.json as { id: string }).id;
      const seeded = await ctx.mcp.call("food_update", {
        id,
        changes: { aliases: [{ name: "scallion-ish" }] },
      });
      expect(!seeded.isError, `seeding aliases failed: ${seeded.text}`);

      const renamed = await ctx.mcp.call("food_update", {
        id,
        changes: { name: "VerifyLeekRenamed" },
      });
      expect(!renamed.isError, `rename failed (422?): ${renamed.text}`); // superset-body acceptance proof

      const after = await ctx.mcp.call("food_get", { id, response_format: "detailed" });
      const aliases = (after.json as { aliases?: Array<{ name: string }> }).aliases ?? [];
      expect(
        aliases.some((a) => a.name === "scallion-ish"),
        `aliases LOST on rename: ${snippet(after.json)}`,
      );
      return `seeded aliases survived rename: ${snippet(aliases)}`;
    },
  );
}

/** food_delete confirm gate fires both ways; success synthesizes {deleted:id} and the food is gone. */
async function foodDelete(ctx: CheckContext): Promise<void> {
  await runCheck(
    { id: "C-FOOD-DELETE", owedPr: "#5", title: "food_delete confirm gate + {deleted:id} + gone" },
    async () => {
      const created = await ctx.mcp.call("food_create", { name: "VerifyFoodDelete" });
      const id = (created.json as { id: string }).id;

      const refused = await ctx.mcp.call("food_delete", { id });
      expect(refused.isError, `unconfirmed delete should refuse: ${refused.text}`);
      const stillThere = await ctx.mcp.call("food_get", { id });
      expect(!stillThere.isError, "refused delete should leave the food intact");

      const deleted = await ctx.mcp.call("food_delete", { id, confirm: true });
      expect(!deleted.isError, `confirmed delete failed: ${deleted.text}`);
      expect(
        (deleted.json as { deleted?: string }).deleted === id,
        `expected {deleted:${id}}: ${deleted.text}`,
      );
      const gone = await ctx.mcp.call("food_get", { id });
      expect(gone.isError, "food should be gone after delete");
      return `confirm gate held; deleted ${id}; re-fetch 404'd`;
    },
  );
}

/** organizer_update fetch-merge mechanism: the full-replace PUT is accepted and the name changes.
 *  (householdsWithTool is NOT settable via Mealie's tool endpoints — verified live: create and
 *  PUT both return [] — so its "survival" is vacuous; the fetch-merge concern reduces to no-422.) */
async function organizerMerge(ctx: CheckContext): Promise<void> {
  await runCheck(
    {
      id: "C-ORG-MERGE",
      owedPr: "#5",
      title: "organizer_update full-replace PUT accepted (rename)",
    },
    async () => {
      const created = await ctx.mcp.call("organizer_create", {
        type: "tool",
        name: "VerifyToolMerge",
      });
      expect(!created.isError, `create failed: ${created.text}`);
      const id = (created.json as { id: string }).id;

      const renamed = await ctx.mcp.call("organizer_update", {
        type: "tool",
        id,
        changes: { name: "VerifyToolMergeRenamed" },
      });
      expect(!renamed.isError, `update failed (422?): ${renamed.text}`); // full RecipeToolCreate superset accepted

      const after = await ctx.mcp.call("organizer_get", {
        type: "tool",
        id,
        response_format: "detailed",
      });
      expect(
        (after.json as { name?: string }).name === "VerifyToolMergeRenamed",
        `rename did not apply: ${snippet(after.json)}`,
      );
      return "rename applied; full-replace PUT accepted (householdsWithTool not Mealie-settable — see report note)";
    },
  );
}

/** organizer_search empty_only returns the un-enveloped {items,count}; tools reject empty_only. */
async function organizerEmpty(ctx: CheckContext): Promise<void> {
  await runCheck(
    {
      id: "C-ORG-EMPTY",
      owedPr: "#5",
      title: "organizer_search empty_only un-enveloped + tool guard",
    },
    async () => {
      await ctx.mcp.call("organizer_create", { type: "category", name: "VerifyEmptyCat" });
      const empty = await ctx.mcp.call("organizer_search", { type: "category", empty_only: true });
      const body = empty.json as {
        items?: Array<{ name: string }>;
        count?: number;
        total?: number;
      };
      expect(Array.isArray(body.items), `expected items array: ${empty.text}`);
      expect(
        typeof body.count === "number" && body.total === undefined,
        `expected {items,count} not paginated: ${snippet(empty.json)}`,
      );
      expect(
        body.items?.some((o) => o.name === "VerifyEmptyCat") === true,
        "new empty category should appear",
      );

      const toolGuard = await ctx.mcp.call("organizer_search", { type: "tool", empty_only: true });
      expect(
        toolGuard.isError && toolGuard.text.includes("not supported"),
        `tool empty_only should be rejected: ${toolGuard.text}`,
      );
      return `empty_only un-enveloped (count=${body.count}); tool guard fired`;
    },
  );
}

/** unit_update preserves fraction across rename; unit_merge (confirm) repoints + removes the source. */
async function unitMergeAndUpdate(ctx: CheckContext): Promise<void> {
  await runCheck(
    {
      id: "C-UNIT-MERGE",
      owedPr: "#5",
      title: "unit_update preserves fraction; unit_merge removes source",
    },
    async () => {
      const a = await ctx.mcp.call("unit_create", { name: "VerifyUnitA", fraction: false });
      const idA = (a.json as { id: string }).id;
      const renamed = await ctx.mcp.call("unit_update", {
        id: idA,
        changes: { name: "VerifyUnitARenamed" },
      });
      expect(!renamed.isError, `unit_update failed: ${renamed.text}`);
      const afterA = await ctx.mcp.call("unit_get", { id: idA, response_format: "detailed" });
      expect(
        (afterA.json as { fraction?: boolean }).fraction === false,
        `fraction reset on rename: ${snippet(afterA.json)}`,
      );

      const b = await ctx.mcp.call("unit_create", { name: "VerifyUnitB" });
      const idB = (b.json as { id: string }).id;
      const c = await ctx.mcp.call("unit_create", { name: "VerifyUnitC" });
      const idC = (c.json as { id: string }).id;
      const refused = await ctx.mcp.call("unit_merge", { fromUnit: idB, toUnit: idC });
      expect(
        refused.isError && refused.text.includes("without confirmation"),
        `merge should refuse unconfirmed: ${refused.text}`,
      );
      const merged = await ctx.mcp.call("unit_merge", {
        fromUnit: idB,
        toUnit: idC,
        confirm: true,
      });
      expect(!merged.isError, `merge failed: ${merged.text}`);
      const goneB = await ctx.mcp.call("unit_get", { id: idB });
      expect(goneB.isError, "merged source unit should be gone");
      return `fraction survived rename; merge removed source ${idB}`;
    },
  );
}

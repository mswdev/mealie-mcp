import { expect, runCheck, snippet } from "../assert.js";
import type { CheckContext } from "./context.js";

/** PR #8 owed: groups — fetch-merge prefs/labels/AI-settings, write-only apiKey, seed error-on-200, multipart migration, report shapes. */
export async function run(ctx: CheckContext): Promise<void> {
  await groupSelf(ctx);
  await label(ctx);
  await aiProvider(ctx);
  await seed(ctx);
  await migration(ctx);
  await report(ctx);
}

/** group_self_update fetch-merge: changing showAnnouncements preserves the untouched privateGroup. */
async function groupSelf(ctx: CheckContext): Promise<void> {
  await runCheck(
    {
      id: "C-GROUP-SELF",
      owedPr: "#8",
      title: "group_self_update preserves privateGroup across a prefs change",
    },
    async () => {
      const before = await ctx.mcp.call("group_self_get", { view: "preferences" });
      const wasAnnounce = (before.json as { showAnnouncements?: boolean }).showAnnouncements;
      const wasPrivate = (before.json as { privateGroup?: boolean }).privateGroup;
      const upd = await ctx.mcp.call("group_self_update", {
        changes: { showAnnouncements: !wasAnnounce },
      });
      expect(!upd.isError, `update failed: ${upd.text}`);
      const after = await ctx.mcp.call("group_self_get", { view: "preferences" });
      const body = after.json as { showAnnouncements?: boolean; privateGroup?: boolean };
      expect(body.showAnnouncements === !wasAnnounce, "showAnnouncements change did not apply");
      expect(
        body.privateGroup === wasPrivate,
        `privateGroup reset by non-merging update: ${snippet(after.json)}`,
      );
      await ctx.mcp.call("group_self_update", { changes: { showAnnouncements: wasAnnounce } }); // restore
      return `showAnnouncements toggled; privateGroup (${wasPrivate}) preserved`;
    },
  );
}

/** label_write fetch-merge preserves color across a rename; detailed read carries all 4 fields. */
async function label(ctx: CheckContext): Promise<void> {
  await runCheck(
    { id: "C-LABEL", owedPr: "#8", title: "label_write preserves color across rename" },
    async () => {
      const created = await ctx.mcp.call("label_write", {
        action: "create",
        name: "VerifyLabel",
        color: "#112233",
      });
      const id = (created.json as { id: string }).id;
      const renamed = await ctx.mcp.call("label_write", {
        action: "update",
        item_id: id,
        changes: { name: "VerifyLabelRenamed" },
      });
      expect(!renamed.isError, `update failed (422?): ${renamed.text}`);
      const after = await ctx.mcp.call("label_get", { item_id: id, response_format: "detailed" });
      const body = after.json as { name?: string; color?: string; groupId?: string };
      expect(body.name === "VerifyLabelRenamed", "rename did not apply");
      expect(body.color === "#112233", `color reset on rename: ${snippet(after.json)}`);
      expect(typeof body.groupId === "string", "detailed should carry groupId");
      return "color survived rename; detailed has all 4 fields";
    },
  );
}

/** AI provider: write-only apiKey never echoed; settings_update preserves untouched pointers. */
async function aiProvider(ctx: CheckContext): Promise<void> {
  await runCheck(
    {
      id: "C-AIPROVIDER",
      owedPr: "#8",
      title: "AI provider apiKey never echoed + settings fetch-merge",
    },
    async () => {
      const secret = "sk-secret-xyz";
      const created = await ctx.mcp.call("group_ai_provider_write", {
        action: "create",
        name: "VerifyAI",
        model: "gpt-4",
        apiKey: secret,
      });
      expect(!created.isError, `create failed: ${created.text}`);
      const pid = (created.json as { id: string }).id;
      expect(!created.text.includes(secret), `apiKey leaked in create response: ${created.text}`);
      const upd = await ctx.mcp.call("group_ai_provider_write", {
        action: "update",
        provider_id: pid,
        name: "VerifyAI2",
        model: "gpt-4",
        apiKey: secret,
      });
      expect(
        !upd.isError && !upd.text.includes(secret),
        `apiKey leaked or update failed: ${upd.text}`,
      );

      // Seed a NON-NULL audio pointer first, so the survival assertion is not vacuous (null===null):
      // a non-merging full-replace on the defaultProviderId-only update would reset audio to null.
      await ctx.mcp.call("group_ai_provider_settings_update", {
        changes: { audioProviderId: pid },
      });
      const setUpd = await ctx.mcp.call("group_ai_provider_settings_update", {
        changes: { defaultProviderId: pid },
      });
      expect(!setUpd.isError, `settings update failed: ${setUpd.text}`);
      const after = await ctx.mcp.call("group_ai_provider_get", {});
      const body = after.json as { defaultProviderId?: string; audioProviderId?: string };
      expect(body.defaultProviderId === pid, "defaultProviderId did not apply");
      expect(
        body.audioProviderId === pid,
        `seeded audioProviderId reset by the defaultProviderId-only update: ${snippet(after.json)}`,
      );
      await ctx.mcp.call("group_ai_provider_settings_update", {
        changes: { defaultProviderId: null, audioProviderId: null },
      });
      await ctx.mcp.call("group_ai_provider_write", {
        action: "delete",
        provider_id: pid,
        confirm: true,
      });
      return "apiKey never echoed (create+update); seeded audioProviderId survived a defaultProviderId-only update";
    },
  );
}

/** group_seed maps SuccessResponse{error:false} to a non-error result (error-on-200 happy path). */
async function seed(ctx: CheckContext): Promise<void> {
  await runCheck(
    { id: "C-SEED", owedPr: "#8", title: "group_seed maps SuccessResponse to a non-error result" },
    async () => {
      const ok = await ctx.mcp.call("group_seed", { target: "labels", locale: "en-US" });
      expect(!ok.isError, `seed errored: ${ok.text}`);
      expect(
        (ok.json as { seeded?: string }).seeded === "labels",
        `expected {seeded:labels,...}: ${snippet(ok.json)}`,
      );
      return `seed labels mapped error:false -> success: ${snippet(ok.json)}`;
    },
  );
}

/** group_start_migration: confirm gate + multipart archive upload + synthesized {started,reportId}. */
async function migration(ctx: CheckContext): Promise<void> {
  await runCheck(
    {
      id: "C-MIGRATION",
      owedPr: "#8",
      title: "group_start_migration confirm gate + multipart archive",
    },
    async () => {
      const archive = `${ctx.fixturesDir}/migration.zip`;
      const refused = await ctx.mcp.call("group_start_migration", {
        migration_type: "mealie_alpha",
        filePath: archive,
      });
      expect(
        refused.isError && refused.text.includes("Refusing"),
        `should refuse unconfirmed: ${refused.text}`,
      );
      const started = await ctx.mcp.call("group_start_migration", {
        migration_type: "mealie_alpha",
        filePath: archive,
        confirm: true,
      });
      expect(!started.isError, `migration failed: ${started.text}`);
      const body = started.json as { started?: boolean; reportId?: string };
      expect(
        body.started === true && typeof body.reportId === "string",
        `expected {started,reportId}: ${snippet(started.json)}`,
      );
      ctx.scratch.migrationReportId = body.reportId ?? "";
      return `confirm gate held; multipart archive uploaded; reportId=${body.reportId}`;
    },
  );
}

/** group_report_get bare-array wrap {items,count}; confirm-gated delete synthesizes {deleted}. */
async function report(ctx: CheckContext): Promise<void> {
  await runCheck(
    {
      id: "C-REPORT",
      owedPr: "#8",
      title: "group_report list {items,count} + confirm-gated synth delete",
    },
    async () => {
      // Mealie's report list returns rows ONLY when report_type is supplied — assert the
      // unfiltered list is empty (backs the documented behavior), then the filtered one has rows.
      const unfiltered = await ctx.mcp.call("group_report_get", {});
      expect(
        ((unfiltered.json as { items?: unknown[] }).items?.length ?? 0) === 0,
        `unfiltered report list expected empty: ${snippet(unfiltered.json)}`,
      );
      // C-MIGRATION created a migration report.
      const listed = await ctx.mcp.call("group_report_get", { report_type: "migration" });
      const body = listed.json as {
        items?: Array<{ id: string }>;
        count?: number;
        total?: unknown;
      };
      expect(
        Array.isArray(body.items) && typeof body.count === "number" && body.total === undefined,
        `expected un-enveloped {items,count}: ${snippet(listed.json)}`,
      );
      const id = body.items?.[0]?.id;
      expect(typeof id === "string", `no migration report to act on: ${snippet(listed.json)}`);

      const refused = await ctx.mcp.call("group_report_delete", { item_id: id });
      expect(
        refused.isError && refused.text.includes("Refusing to delete report"),
        `delete should refuse unconfirmed: ${refused.text}`,
      );
      const del = await ctx.mcp.call("group_report_delete", { item_id: id, confirm: true });
      expect(
        (del.json as { deleted?: string }).deleted === id,
        `expected {deleted:${id}}: ${del.text}`,
      );
      const after = await ctx.mcp.call("group_report_get", { report_type: "migration" });
      expect(
        (after.json as { items?: Array<{ id: string }> }).items?.some((r) => r.id === id) !== true,
        "report should be gone",
      );
      return `list un-enveloped (count=${body.count}); confirm gate; synth {deleted}; gone`;
    },
  );
}

import { expect, runCheck, snippet } from "../assert.js";
import { waitHealthy } from "../docker.js";
import type { CheckContext } from "./context.js";

/** PR #10 owed (non-destructive): admin CRUD fetch-merge + cacheKey/dbUrl redaction, shown-once reset token, write-only apiKey. */
export async function runReads(ctx: CheckContext): Promise<void> {
  await crud(ctx);
  await about(ctx);
  await actions(ctx);
  await aiKey(ctx);
}

/** PR #10 owed (destructive, throwaway-only): backup create->restore round-trip, backup delete, maintenance clean, email/openai clean-failure. */
export async function runDestructive(ctx: CheckContext): Promise<void> {
  await backupRestore(ctx);
  await backupDelete(ctx);
  await maintenanceClean(ctx);
  await emailTest(ctx);
  await debugOpenai(ctx);
}

/** admin_user_write fetch-merge: email survives a fullName-only rename; cacheKey redacted from reads. */
async function crud(ctx: CheckContext): Promise<void> {
  await runCheck(
    {
      id: "C-ADMIN-RW",
      owedPr: "#10",
      title: "admin user/household/group round-trip + cacheKey redaction",
    },
    async () => {
      const groups = await ctx.mcp.call("admin_group_get", {});
      const grp = (groups.json as { items?: Array<{ id: string; name: string }> }).items?.[0];
      expect(grp !== undefined, `no admin group: ${groups.text}`);

      const created = await ctx.mcp.call("admin_user_write", {
        action: "create",
        username: "verifyadminuser",
        fullName: "Verify User",
        email: "verifyadminuser@example.com",
        password: "Sup3rSecret!",
        group: grp?.name,
      });
      expect(!created.isError, `user create failed: ${created.text}`);
      const uid = (created.json as { id: string }).id;
      const upd = await ctx.mcp.call("admin_user_write", {
        action: "update",
        item_id: uid,
        changes: { fullName: "Verify Renamed" },
      });
      expect(!upd.isError, `user update failed (422?): ${upd.text}`);
      const after = await ctx.mcp.call("admin_user_get", {
        item_id: uid,
        response_format: "detailed",
      });
      const body = after.json as { email?: string; fullName?: string };
      expect(
        body.email === "verifyadminuser@example.com",
        `email reset on rename: ${snippet(after.json)}`,
      );
      expect(body.fullName === "Verify Renamed", "fullName change did not apply");
      expect(
        !("cacheKey" in (after.json as object)),
        "cacheKey leaked from detailed admin user read",
      );

      const hh = await ctx.mcp.call("admin_household_write", {
        action: "create",
        name: "VerifyAdminHH",
        group_id: grp?.id,
      });
      const hhId = (hh.json as { id: string }).id;
      const hhUpd = await ctx.mcp.call("admin_household_write", {
        action: "update",
        item_id: hhId,
        changes: { name: "VerifyAdminHHRenamed" },
      });
      expect(!hhUpd.isError, `household update failed: ${hhUpd.text}`);
      const gc = await ctx.mcp.call("admin_group_write", {
        action: "create",
        name: "VerifyAdminGrp",
      });
      const gid = (gc.json as { id: string }).id;
      const gUpd = await ctx.mcp.call("admin_group_write", {
        action: "update",
        item_id: gid,
        changes: { name: "VerifyAdminGrpRenamed" },
      });
      expect(!gUpd.isError, `group update failed: ${gUpd.text}`);

      await ctx.mcp.call("admin_user_write", { action: "delete", item_id: uid, confirm: true });
      await ctx.mcp.call("admin_household_write", {
        action: "delete",
        item_id: hhId,
        confirm: true,
      });
      await ctx.mcp.call("admin_group_write", { action: "delete", item_id: gid, confirm: true });
      return "user email survived rename; cacheKey redacted; household+group round-tripped; cleaned up";
    },
  );
}

/** admin_about redacts dbUrl; include:[statistics] adds the statistics block. */
async function about(ctx: CheckContext): Promise<void> {
  await runCheck(
    { id: "C-ADMIN-ABOUT", owedPr: "#10", title: "admin_about redacts dbUrl + statistics include" },
    async () => {
      const res = await ctx.mcp.call("admin_about", { include: ["statistics"] });
      expect(!res.isError, `admin_about failed: ${res.text}`);
      const body = res.json as {
        about?: { dbUrl?: unknown; version?: unknown };
        statistics?: unknown;
      };
      expect(
        body.about !== undefined && body.about?.version !== undefined,
        "about block missing/empty",
      );
      expect(!("dbUrl" in (body.about as object)), "dbUrl leaked from admin_about");
      expect(
        body.statistics !== undefined && typeof body.statistics === "object",
        "statistics include did not populate",
      );
      return "about populated; dbUrl redacted; statistics included";
    },
  );
}

/** admin_user_actions password_reset_token is shown once; missing email is rejected pre-call. */
async function actions(ctx: CheckContext): Promise<void> {
  await runCheck(
    {
      id: "C-ADMIN-ACTIONS",
      owedPr: "#10",
      title: "admin reset-token shown-once + validation guard + unlock",
    },
    async () => {
      const ok = await ctx.mcp.call("admin_user_actions", {
        action: "password_reset_token",
        email: "changeme@example.com",
      });
      expect(!ok.isError, `reset token failed: ${ok.text}`);
      const body = ok.json as { token?: string; note?: string };
      expect(
        typeof body.token === "string" && body.token.length > 0 && typeof body.note === "string",
        `expected shown-once token+note: ${snippet(ok.json)}`,
      );

      const bad = await ctx.mcp.call("admin_user_actions", { action: "password_reset_token" });
      expect(
        bad.isError && bad.text.includes("email is required"),
        `missing email should be rejected: ${bad.text}`,
      );
      const unl = await ctx.mcp.call("admin_user_actions", { action: "unlock" });
      expect(
        !unl.isError && typeof (unl.json as { unlocked?: number }).unlocked === "number",
        `unlock failed: ${unl.text}`,
      );
      return "reset token shown-once; missing-email guarded; unlock returned a count";
    },
  );
}

/** admin_ai_provider write-only apiKey is never echoed (create/update/read). */
async function aiKey(ctx: CheckContext): Promise<void> {
  await runCheck(
    { id: "C-ADMIN-AIKEY", owedPr: "#10", title: "admin AI provider apiKey never echoed" },
    async () => {
      const groups = await ctx.mcp.call("admin_group_get", {});
      const gid = (groups.json as { items?: Array<{ id: string }> }).items?.[0]?.id;
      const secret = "sk-secret-xyz";
      const created = await ctx.mcp.call("admin_ai_provider_write", {
        action: "create",
        group_id: gid,
        name: "VerifyAI",
        model: "gpt-4",
        apiKey: secret,
      });
      expect(
        !created.isError && !created.text.includes(secret),
        `apiKey leaked or create failed: ${created.text}`,
      );
      const pid = (created.json as { id: string }).id;
      const upd = await ctx.mcp.call("admin_ai_provider_write", {
        action: "update",
        group_id: gid,
        provider_id: pid,
        name: "VerifyAI2",
        model: "gpt-4",
        apiKey: secret,
      });
      expect(!upd.isError && !upd.text.includes(secret), `apiKey leaked on update: ${upd.text}`);
      const read = await ctx.mcp.call("admin_ai_provider_get", {
        group_id: gid,
        provider_id: pid,
        response_format: "detailed",
      });
      expect(
        !read.text.includes(secret) && !("apiKey" in (read.json as object)),
        `apiKey leaked on read: ${read.text}`,
      );
      await ctx.mcp.call("admin_ai_provider_write", {
        action: "delete",
        group_id: gid,
        provider_id: pid,
        confirm: true,
      });
      return "apiKey absent from create/update/read; re-supply accepted";
    },
  );
}

/** admin_backup_restore round-trip: a deleted marker recipe reappears after restore (double-gated). */
async function backupRestore(ctx: CheckContext): Promise<void> {
  await runCheck(
    {
      id: "C-BACKUP-RESTORE",
      owedPr: "#10",
      title: "backup create->delete-marker->restore brings the marker back (double gate)",
    },
    async () => {
      const marker = await ctx.mcp.call("recipe_create", { name: "BackupMarkerRecipe" });
      const markerSlug = (marker.json as { slug: string }).slug;
      const bk = await ctx.mcp.call("admin_backup_write", { action: "create" });
      expect(!bk.isError, `backup create failed: ${bk.text}`);
      const list = await ctx.mcp.call("admin_backup_get", {});
      const imports = (list.json as { imports?: Array<{ name: string }> }).imports ?? [];
      const fname = imports[imports.length - 1]?.name;
      expect(typeof fname === "string", `no backup file listed: ${snippet(list.json)}`);

      await ctx.mcp.call("recipe_delete", { slug: markerSlug, confirm: true });
      expect(
        (await ctx.mcp.call("recipe_get", { slug: markerSlug })).isError,
        "marker should be gone before restore",
      );

      const halfGate = await ctx.mcp.call("admin_backup_restore", {
        file_name: fname,
        confirm: true,
      });
      expect(
        halfGate.isError && halfGate.text.includes("must exactly match"),
        `restore should require confirm_file_name: ${halfGate.text}`,
      );
      const restored = await ctx.mcp.call("admin_backup_restore", {
        file_name: fname,
        confirm: true,
        confirm_file_name: fname,
      });
      expect(!restored.isError, `restore failed: ${restored.text}`);
      expect(await waitHealthy(), "instance did not come back healthy after restore");

      const back = await ctx.mcp.call("recipe_get", { slug: markerSlug });
      expect(
        !back.isError && (back.json as { name?: string }).name === "BackupMarkerRecipe",
        `marker did not return after restore: ${back.text}`,
      );
      return "double gate held; restore brought the deleted marker back (state moved)";
    },
  );
}

/** admin_backup_write delete: confirm gate + the backup is gone from the list. */
async function backupDelete(ctx: CheckContext): Promise<void> {
  await runCheck(
    {
      id: "C-BACKUP-DELETE",
      owedPr: "#10",
      title: "admin_backup_write delete confirm gate + gone",
    },
    async () => {
      await ctx.mcp.call("admin_backup_write", { action: "create" });
      const list = await ctx.mcp.call("admin_backup_get", {});
      const imports = (list.json as { imports?: Array<{ name: string }> }).imports ?? [];
      const fname = imports[imports.length - 1]?.name;
      expect(typeof fname === "string", `no backup file: ${snippet(list.json)}`);
      const refused = await ctx.mcp.call("admin_backup_write", {
        action: "delete",
        file_name: fname,
      });
      expect(
        refused.isError && refused.text.includes("Refusing to delete backup"),
        `delete should refuse unconfirmed: ${refused.text}`,
      );
      const del = await ctx.mcp.call("admin_backup_write", {
        action: "delete",
        file_name: fname,
        confirm: true,
      });
      expect(
        (del.json as { deleted?: string }).deleted === fname,
        `expected {deleted:${fname}}: ${del.text}`,
      );
      const after = await ctx.mcp.call("admin_backup_get", {});
      expect(
        (after.json as { imports?: Array<{ name: string }> }).imports?.some(
          (b) => b.name === fname,
        ) !== true,
        "backup should be gone",
      );
      return `confirm gate held; backup ${fname} deleted and gone`;
    },
  );
}

/** admin_maintenance_clean: the MCP confirm gate is the sole guard (Mealie has none); success maps to non-error. */
async function maintenanceClean(ctx: CheckContext): Promise<void> {
  await runCheck(
    {
      id: "C-MAINT-CLEAN",
      owedPr: "#10",
      title: "admin_maintenance_clean confirm gate + SuccessResponse mapping",
    },
    async () => {
      const refused = await ctx.mcp.call("admin_maintenance_clean", { target: "temp" });
      expect(
        refused.isError && refused.text.includes("Refusing to clean temp"),
        `clean should refuse unconfirmed: ${refused.text}`,
      );
      const ok = await ctx.mcp.call("admin_maintenance_clean", { target: "temp", confirm: true });
      expect(
        !ok.isError && (ok.json as { cleaned?: string }).cleaned === "temp",
        `clean failed / not mapped: ${ok.text}`,
      );
      return "confirm gate held; SuccessResponse error:false -> {cleaned:temp}";
    },
  );
}

/** admin_email_test with no SMTP: EmailSuccess{success:false} maps to an isError result (error-on-200). */
async function emailTest(ctx: CheckContext): Promise<void> {
  await runCheck(
    {
      id: "C-EMAIL-TEST",
      owedPr: "#10",
      title: "admin_email_test no-SMTP maps success:false -> isError",
    },
    async () => {
      const res = await ctx.mcp.call("admin_email_test", { email: "nobody@example.com" });
      if (!res.isError)
        throw new Error(
          `DIVERGE: email test unexpectedly succeeded (SMTP configured?): ${res.text}`,
        );
      expect(res.text.includes("Email test failed"), `unexpected error text: ${res.text}`);
      return "no-SMTP success:false correctly mapped to isError";
    },
  );
}

/** admin_debug_openai against a bogus provider returns a clean isError (no crash). */
async function debugOpenai(ctx: CheckContext): Promise<void> {
  await runCheck(
    {
      id: "C-DEBUG-OPENAI",
      owedPr: "#10",
      title: "admin_debug_openai bogus provider -> clean isError",
    },
    async () => {
      const res = await ctx.mcp.call("admin_debug_openai", {
        provider_id: "00000000-0000-0000-0000-000000000000",
      });
      if (!res.isError)
        throw new Error(`DIVERGE: openai probe unexpectedly succeeded: ${res.text}`);
      expect(
        res.text.includes("Failed to probe AI provider"),
        `unexpected error text: ${res.text}`,
      );
      return "bogus provider -> clean isError (no crash)";
    },
  );
}

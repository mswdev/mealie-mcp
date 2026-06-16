import { expect, runCheck, snippet } from "../assert.js";
import type { CheckContext } from "./context.js";

/** PR #7 owed: households + automation — fetch-merge prefs, permissions no-downgrade, webhook/notifier merge + synth-delete, invite shapes. */
export async function run(ctx: CheckContext): Promise<void> {
  await householdPrefs(ctx);
  await householdPermissions(ctx);
  await webhook(ctx);
  await notifier(ctx);
  await invite(ctx);
}

/** household_self_update preferences is fetch-merge: a single-field change preserves untouched prefs. */
async function householdPrefs(ctx: CheckContext): Promise<void> {
  await runCheck(
    {
      id: "C-HH-PREFS",
      owedPr: "#7",
      title: "household_self_update preferences preserves untouched fields",
    },
    async () => {
      const before = await ctx.mcp.call("household_self_get", { view: "preferences" });
      const wasPrivate = (before.json as { privateHousehold?: boolean }).privateHousehold;
      const upd = await ctx.mcp.call("household_self_update", {
        target: "preferences",
        changes: { recipeShowNutrition: true },
      });
      expect(!upd.isError, `update failed: ${upd.text}`);
      const after = await ctx.mcp.call("household_self_get", { view: "preferences" });
      const body = after.json as { recipeShowNutrition?: boolean; privateHousehold?: boolean };
      expect(body.recipeShowNutrition === true, "recipeShowNutrition change did not apply");
      expect(
        body.privateHousehold === wasPrivate,
        `privateHousehold reset by non-merging update: ${snippet(after.json)}`,
      );
      return `recipeShowNutrition applied; privateHousehold (${wasPrivate}) preserved`;
    },
  );
}

/** Registers a throwaway second household member (Mealie forbids changing one's own permissions). */
async function addSecondMember(ctx: CheckContext): Promise<string> {
  const inv = await ctx.mcp.call("household_invite", { action: "create", uses: 1 });
  const token = (inv.json as { token?: string }).token;
  const pw = "Sup3rSecret!";
  await ctx.mcp.call("user_register", {
    email: "verify-perms-member@example.com",
    username: "verifypermsmember",
    fullName: "Verify Perms Member",
    password: pw,
    passwordConfirm: pw,
    groupToken: token,
  });
  const me = await ctx.mcp.call("user_me", {});
  const meId = (me.json as { id?: string }).id;
  const members = await ctx.mcp.call("household_self_get", { view: "members" });
  const other = (members.json as { items?: Array<{ id: string }> }).items?.find(
    (m) => m.id !== meId,
  );
  expect(other !== undefined, `second member not found: ${members.text}`);
  return other?.id ?? "";
}

/** household_self_update permissions overlays current flags (no silent downgrade) + member-not-found guard. */
async function householdPermissions(ctx: CheckContext): Promise<void> {
  await runCheck(
    {
      id: "C-HH-PERMS",
      owedPr: "#7",
      title: "household permissions no-downgrade + member-not-found guard",
    },
    async () => {
      const memberId = await addSecondMember(ctx);
      // Give the member canManage, then change ONLY canInvite — canManage must survive (no downgrade).
      await ctx.mcp.call("household_self_update", {
        target: "permissions",
        userId: memberId,
        canManage: true,
        confirm: true,
      });
      const elevate = await ctx.mcp.call("household_self_update", {
        target: "permissions",
        userId: memberId,
        canInvite: true,
        confirm: true,
      });
      expect(!elevate.isError, `permissions update failed: ${elevate.text}`);
      const perms = (elevate.json as { permissions?: { canInvite?: boolean; canManage?: boolean } })
        .permissions;
      expect(perms?.canInvite === true, "canInvite did not apply");
      expect(
        perms?.canManage === true,
        `canManage silently downgraded to false: ${snippet(elevate.json)}`,
      );

      const bad = await ctx.mcp.call("household_self_update", {
        target: "permissions",
        userId: "00000000-0000-0000-0000-000000000000",
        canInvite: true,
        confirm: true,
      });
      expect(
        bad.isError && bad.text.includes("not found"),
        `unknown member should error: ${bad.text}`,
      );

      await ctx.mcp.call("admin_user_write", {
        action: "delete",
        item_id: memberId,
        confirm: true,
      }); // cleanup
      return "canInvite elevated on a real member; canManage preserved (no downgrade); unknown member rejected";
    },
  );
}

/** webhook_write fetch-merge preserves untouched fields; delete synthesizes {deleted}. */
async function webhook(ctx: CheckContext): Promise<void> {
  await runCheck(
    { id: "C-WEBHOOK", owedPr: "#7", title: "webhook_write fetch-merge + synth delete" },
    async () => {
      const created = await ctx.mcp.call("webhook_write", {
        action: "create",
        name: "VerifyHook",
        url: "http://example.com/hook",
        scheduledTime: "08:30",
      });
      const id = (created.json as { id: string }).id;
      const upd = await ctx.mcp.call("webhook_write", {
        action: "update",
        item_id: id,
        changes: { enabled: false },
      });
      expect(!upd.isError, `update failed: ${upd.text}`);
      const after = await ctx.mcp.call("webhook_get", { item_id: id, response_format: "detailed" });
      const body = after.json as {
        enabled?: boolean;
        name?: string;
        url?: string;
        scheduledTime?: string;
      };
      expect(body.enabled === false, "enabled change did not apply");
      expect(
        body.name === "VerifyHook" &&
          body.url === "http://example.com/hook" &&
          body.scheduledTime?.startsWith("08:30") === true, // Mealie normalizes HH:MM -> HH:MM:SS
        `untouched fields reset: ${snippet(after.json)}`,
      );
      const del = await ctx.mcp.call("webhook_write", {
        action: "delete",
        item_id: id,
        confirm: true,
      });
      expect(
        (del.json as { deleted?: string }).deleted === id,
        `expected {deleted:${id}}: ${del.text}`,
      );
      const gone = await ctx.mcp.call("webhook_get", { item_id: id });
      expect(gone.isError, "webhook should be gone");
      return "fields survived single-field update; synth {deleted}; gone";
    },
  );
}

/** event_notification_write fetch-merge preserves the 27-toggle options block; delete synth from 204. */
async function notifier(ctx: CheckContext): Promise<void> {
  await runCheck(
    {
      id: "C-NOTIFY",
      owedPr: "#7",
      title: "event_notification_write preserves options block + synth delete",
    },
    async () => {
      const created = await ctx.mcp.call("event_notification_write", {
        action: "create",
        name: "VerifyNotifier",
        appriseUrl: "json://example.com/x",
      });
      const id = (created.json as { id: string }).id;
      // Seed a NON-default toggle so the survival assertion is not vacuous (defaults are all false).
      const fetched = await ctx.mcp.call("event_notification_get", {
        item_id: id,
        response_format: "detailed",
      });
      const options = (fetched.json as { options?: Record<string, unknown> }).options ?? {};
      const seed = await ctx.mcp.call("event_notification_write", {
        action: "update",
        item_id: id,
        changes: { options: { ...options, recipeCreated: true } },
      });
      expect(!seed.isError, `seeding option failed: ${seed.text}`);

      const upd = await ctx.mcp.call("event_notification_write", {
        action: "update",
        item_id: id,
        changes: { enabled: false },
      });
      expect(!upd.isError, `update failed: ${upd.text}`);
      const after = await ctx.mcp.call("event_notification_get", {
        item_id: id,
        response_format: "detailed",
      });
      const body = after.json as {
        enabled?: boolean;
        name?: string;
        options?: { recipeCreated?: boolean };
      };
      expect(
        body.enabled === false && body.name === "VerifyNotifier",
        "enabled/name not as expected",
      );
      expect(
        body.options?.recipeCreated === true,
        `seeded option lost on enabled-only update: ${snippet(after.json)}`,
      );
      const del = await ctx.mcp.call("event_notification_write", {
        action: "delete",
        item_id: id,
        confirm: true,
      });
      expect(
        (del.json as { deleted?: string }).deleted === id,
        `expected {deleted:${id}}: ${del.text}`,
      );
      return "options block (27 toggles) survived; synth {deleted} from 204";
    },
  );
}

/** household_invite create returns ReadInviteToken; list wraps a bare array; send_email surfaces EmailInitationResponse. */
async function invite(ctx: CheckContext): Promise<void> {
  await runCheck(
    {
      id: "C-INVITE",
      owedPr: "#7",
      title: "invite token shape + bare-array list + EmailInitationResponse",
    },
    async () => {
      const created = await ctx.mcp.call("household_invite", { action: "create", uses: 1 });
      const token = (created.json as { token?: string; usesLeft?: number }).token;
      expect(
        typeof token === "string" && (created.json as { usesLeft?: number }).usesLeft === 1,
        `unexpected ReadInviteToken: ${snippet(created.json)}`,
      );

      const list = await ctx.mcp.call("household_invitations_list", {});
      const body = list.json as { items?: Array<{ token: string }>; count?: number };
      expect(
        Array.isArray(body.items) && body.count === body.items?.length,
        `expected {items,count}: ${snippet(list.json)}`,
      );
      expect(body.items?.some((t) => t.token === token) === true, "created token not in the list");

      const emailed = await ctx.mcp.call("household_invite", {
        action: "send_email",
        email: "x@example.com",
        token,
      });
      const okShape = emailed.json !== undefined && "success" in (emailed.json as object);
      expect(
        okShape || emailed.isError,
        `send_email neither returned the success-shape nor failed cleanly: ${snippet(emailed.text)}`,
      );
      return `ReadInviteToken ok; list bare-array wrapped; send_email -> ${okShape ? "success-shape" : "clean failure (no SMTP)"}`;
    },
  );
}

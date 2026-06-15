import { expect, runCheck, snippet } from "../assert.js";
import type { CheckContext } from "./context.js";

/** PR #9 owed: users self-service — token enumeration, fetch-merge whitelist, shown-once token, ratings round-trip, secret-safe password/register, avatar multipart. */
export async function run(ctx: CheckContext): Promise<void> {
  await me(ctx);
  await selfUpdate(ctx);
  await apiToken(ctx);
  await ratings(ctx);
  await password(ctx);
  await register(ctx);
  await avatar(ctx);
}

/** user_me concise keeps the tokens list — the API's only token enumeration. */
async function me(ctx: CheckContext): Promise<void> {
  await runCheck(
    { id: "C-USER-ME", owedPr: "#9", title: "user_me concise enumerates tokens (no raw value)" },
    async () => {
      const result = await ctx.mcp.call("user_me", {});
      const body = result.json as {
        id?: string;
        username?: string;
        tokens?: Array<{ token?: string }>;
      };
      expect(
        typeof body.id === "string" && typeof body.username === "string",
        `missing identity: ${snippet(result.json)}`,
      );
      expect(
        Array.isArray(body.tokens) && (body.tokens?.length ?? 0) >= 1,
        `expected >=1 token (bootstrap minted one): ${snippet(result.json)}`,
      );
      expect(
        body.tokens?.every((t) => t.token === undefined) === true,
        "token list leaked a raw token value",
      );
      return `tokens enumerated (${body.tokens?.length}); no raw values`;
    },
  );
}

/** user_self_update whitelist fetch-merge: change fullName, untouched username/email survive (no 422). */
async function selfUpdate(ctx: CheckContext): Promise<void> {
  await runCheck(
    {
      id: "C-USER-UPDATE",
      owedPr: "#9",
      title: "user_self_update preserves untouched whitelist fields",
    },
    async () => {
      const baseline = await ctx.mcp.call("user_me", { response_format: "detailed" });
      const base = baseline.json as { username?: string; email?: string };
      const upd = await ctx.mcp.call("user_self_update", { changes: { fullName: "Verify QA" } });
      expect(!upd.isError, `update failed (UserOut-only keys rejected?): ${upd.text}`);
      const after = await ctx.mcp.call("user_me", { response_format: "detailed" });
      const body = after.json as { fullName?: string; username?: string; email?: string };
      expect(body.fullName === "Verify QA", "fullName change did not apply");
      expect(
        body.username === base.username && body.email === base.email,
        `username/email reset: ${snippet(after.json)}`,
      );
      return "fullName changed; username/email survived";
    },
  );
}

/** user_api_token_write: raw token shown once on create, absent from later reads; delete confirm + {deleted:id}. */
async function apiToken(ctx: CheckContext): Promise<void> {
  await runCheck(
    {
      id: "C-USER-TOKEN",
      owedPr: "#9",
      title: "api token shown-once + confirm-gated delete (integer id)",
    },
    async () => {
      const created = await ctx.mcp.call("user_api_token_write", {
        action: "create",
        name: "verify-tok",
      });
      const token = (created.json as { token?: string; id?: number }).token;
      const tokId = (created.json as { id?: number }).id;
      expect(
        typeof token === "string" && token.length > 0,
        `raw token missing on create: ${snippet(created.json)}`,
      );

      const me = await ctx.mcp.call("user_me", {});
      const entry = (me.json as { tokens?: Array<{ id: number; token?: string }> }).tokens?.find(
        (t) => t.id === tokId,
      );
      expect(
        entry !== undefined && entry.token === undefined,
        "token entry missing or leaked the raw value",
      );

      const refused = await ctx.mcp.call("user_api_token_write", {
        action: "delete",
        token_id: tokId,
      });
      expect(
        refused.isError && refused.text.includes("confirm: true"),
        `delete should refuse unconfirmed: ${refused.text}`,
      );
      const del = await ctx.mcp.call("user_api_token_write", {
        action: "delete",
        token_id: tokId,
        confirm: true,
      });
      expect(
        (del.json as { deleted?: number }).deleted === tokId,
        `expected {deleted:${tokId}}: ${del.text}`,
      );
      return `raw token shown once; absent after; confirm-gated delete -> {deleted:${tokId}}`;
    },
  );
}

/** user_ratings_write favorite round-trips into user_me favorites (keyed by recipeId). */
async function ratings(ctx: CheckContext): Promise<void> {
  await runCheck(
    {
      id: "C-USER-RATINGS",
      owedPr: "#9",
      title: "user_ratings_write favorite round-trips into user_me",
    },
    async () => {
      const recipe = await ctx.mcp.call("recipe_create", { name: "Verify Favorite Dish" });
      const slug = (recipe.json as { slug: string }).slug;
      const rid = (recipe.json as { id: string }).id;
      const fav = await ctx.mcp.call("user_ratings_write", {
        action: "favorite",
        recipe_slug: slug,
      });
      expect(!fav.isError, `favorite failed: ${fav.text}`);
      const favs = await ctx.mcp.call("user_me", { view: "favorites" });
      const items =
        (favs.json as { items?: Array<{ recipeId: string; isFavorite?: boolean }> }).items ?? [];
      expect(
        items.some((i) => i.recipeId === rid && i.isFavorite === true),
        `favorite not reflected: ${snippet(favs.json)}`,
      );
      return "favorite by slug round-tripped to favorites by recipeId";
    },
  );
}

/** user_password_write error path uses secretSafeErrorResult — status only, no secret leak. */
async function password(ctx: CheckContext): Promise<void> {
  await runCheck(
    {
      id: "C-USER-PW",
      owedPr: "#9",
      title: "user_password_write error leaks no secret (secretSafeErrorResult)",
    },
    async () => {
      const wrongPw = "WRONG-not-the-real-pw";
      const newPw = "NeverApplied123!";
      const res = await ctx.mcp.call("user_password_write", {
        action: "change",
        currentPassword: wrongPw,
        newPassword: newPw,
      });
      expect(res.isError, `wrong current password should fail: ${res.text}`);
      expect(
        !res.text.includes(wrongPw) && !res.text.includes(newPw),
        `secret leaked in error: ${res.text}`,
      );
      expect(
        res.text.includes("Password operation failed ("),
        `expected status-only secret-safe form: ${res.text}`,
      );
      return "error surfaced status-only; no secret leak";
    },
  );
}

/** user_register (public) with a fresh invite token creates an account; secrets never echoed. */
async function register(ctx: CheckContext): Promise<void> {
  await runCheck(
    {
      id: "C-USER-REG",
      owedPr: "#9",
      title: "user_register (public) creates an account via invite token",
    },
    async () => {
      const inv = await ctx.mcp.call("household_invite", { action: "create", uses: 1 });
      const token = (inv.json as { token?: string }).token;
      expect(typeof token === "string", `no invite token: ${inv.text}`);
      const pw = "Sup3rSecret!";
      const reg = await ctx.mcp.call("user_register", {
        email: "verify-newuser@example.com",
        username: "verifynewuser",
        fullName: "Verify New User",
        password: pw,
        passwordConfirm: pw,
        groupToken: token,
      });
      expect(!reg.isError, `register failed: ${reg.text}`);
      const body = reg.json as { registered?: boolean; user?: { username?: string } };
      expect(
        body.registered === true && body.user?.username === "verifynewuser",
        `unexpected register echo: ${snippet(reg.json)}`,
      );
      expect(!reg.text.includes(pw), "password leaked in register echo");
      return "account created via invite token; password not echoed";
    },
  );
}

/** user_avatar_upload multipart (FormData field "profile") succeeds. */
async function avatar(ctx: CheckContext): Promise<void> {
  await runCheck(
    { id: "C-AVATAR", owedPr: "#9", title: "user_avatar_upload multipart (profile field)" },
    async () => {
      const up = await ctx.mcp.call("user_avatar_upload", {
        filePath: `${ctx.fixturesDir}/recipe.jpg`,
      });
      expect(!up.isError, `avatar upload failed: ${up.text}`);
      const body = up.json as { uploaded?: boolean; userId?: string };
      expect(
        body.uploaded === true && typeof body.userId === "string",
        `unexpected avatar echo: ${snippet(up.json)}`,
      );
      return `avatar multipart accepted: ${snippet(up.json)}`;
    },
  );
}

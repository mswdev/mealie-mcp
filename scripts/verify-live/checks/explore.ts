import { expect, runCheck, snippet } from "../assert.js";
import { makeExplorable, setGroupPrivate } from "../mealie-rest.js";
import type { CheckContext } from "./context.js";

/** PR #11 owed: explore (first-ever live run) — public reads, food-branch projection, hh-search guard, 404 ambiguity. */
export async function run(ctx: CheckContext): Promise<void> {
  await makeExplorable(ctx.bearer); // re-assert public state (earlier checks may have toggled prefs)
  await list(ctx);
  await recipe(ctx);
  await householdGuard(ctx);
  await notFound(ctx); // LAST: flips the group private
  await makeExplorable(ctx.bearer); // restore public
}

/** explore_list routes per-type projections: foods are {id,name,labelId} (not the generic {id,slug,name}). */
async function list(ctx: CheckContext): Promise<void> {
  await runCheck(
    {
      id: "C-EXPLORE-LIST",
      owedPr: "#11",
      title: "explore_list food branch projects {id,name,labelId}",
    },
    async () => {
      const lbl = await ctx.mcp.call("label_write", {
        action: "create",
        name: "VerifyExploreLabel",
        color: "#ff0000",
      });
      const labelId = (lbl.json as { id: string }).id;
      const fd = await ctx.mcp.call("food_create", { name: "VerifyExploreFlour", labelId });
      const foodId = (fd.json as { id: string }).id;

      const foods = await ctx.mcp.call("explore_list", { type: "food", group_slug: ctx.groupSlug });
      expect(!foods.isError, `explore_list food failed: ${foods.text}`);
      const f = (
        foods.json as { items?: Array<{ id: string; labelId?: string; slug?: string }> }
      ).items?.find((x) => x.id === foodId);
      expect(f !== undefined, `seeded food not in explore list: ${snippet(foods.json)}`);
      expect(f?.labelId === labelId, `food branch lost labelId: ${snippet(f)}`);
      expect(
        !("slug" in (f as object)),
        "food item unexpectedly carries slug (generic projection leaked)",
      );
      return `food branch projected {id,name,labelId}; labelId=${labelId}`;
    },
  );
}

/** explore_recipe_* public reads: search finds the public recipe; get concise/detailed/include; suggestions. */
async function recipe(ctx: CheckContext): Promise<void> {
  await runCheck(
    {
      id: "C-EXPLORE-RECIPE",
      owedPr: "#11",
      title: "explore recipe search/get/suggestions on the public surface",
    },
    async () => {
      const created = await ctx.mcp.call("recipe_create", { name: "VerifyPublicStew" }); // public via recipePublic default
      const slug = (created.json as { slug: string }).slug;
      const search = await ctx.mcp.call("explore_recipe_search", {
        group_slug: ctx.groupSlug,
        search: "VerifyPublicStew",
      });
      expect(
        (search.json as { items?: Array<{ slug: string }> }).items?.some((r) => r.slug === slug) ===
          true,
        `public recipe not found: ${snippet(search.json)}`,
      );

      const concise = await ctx.mcp.call("explore_recipe_get", { group_slug: ctx.groupSlug, slug });
      expect(
        !("recipeIngredient" in (concise.json as object)),
        "explore concise leaked recipeIngredient",
      );
      const detailed = await ctx.mcp.call("explore_recipe_get", {
        group_slug: ctx.groupSlug,
        slug,
        response_format: "detailed",
      });
      expect(
        "recipeIngredient" in (detailed.json as object),
        "explore detailed missing recipeIngredient",
      );
      const withComments = await ctx.mcp.call("explore_recipe_get", {
        group_slug: ctx.groupSlug,
        slug,
        include: ["comments"],
      });
      expect(
        "comments" in (withComments.json as object) &&
          !("nutrition" in (withComments.json as object)),
        `include[comments] not applied precisely: ${snippet(withComments.json)}`,
      );

      const sugg = await ctx.mcp.call("explore_recipe_suggestions", {
        group_slug: ctx.groupSlug,
        foods: [],
      });
      expect(
        !sugg.isError && Array.isArray((sugg.json as { items?: unknown[] }).items),
        `suggestions failed: ${sugg.text}`,
      );
      return "public search hit; concise/detailed/include correct; suggestions returned items";
    },
  );
}

/** explore_list rejects search for type=household (client-side guard), but allows it without search. */
async function householdGuard(ctx: CheckContext): Promise<void> {
  await runCheck(
    {
      id: "C-EXPLORE-HH-GUARD",
      owedPr: "#11",
      title: "explore_list household+search guard (search-specific)",
    },
    async () => {
      const rejected = await ctx.mcp.call("explore_list", {
        type: "household",
        group_slug: ctx.groupSlug,
        search: "x",
      });
      expect(
        rejected.isError && rejected.text.includes("not supported"),
        `household+search should be rejected: ${rejected.text}`,
      );
      const allowed = await ctx.mcp.call("explore_list", {
        type: "household",
        group_slug: ctx.groupSlug,
      });
      expect(!allowed.isError, `household without search should be allowed: ${allowed.text}`);
      return "household+search rejected; household (no search) allowed";
    },
  );
}

/** A private group and a nonexistent group both 404 — indistinguishable (no enumeration leak). */
async function notFound(ctx: CheckContext): Promise<void> {
  await runCheck(
    {
      id: "C-EXPLORE-404",
      owedPr: "#11",
      title: "private vs nonexistent group both 404 (indistinguishable)",
    },
    async () => {
      const bogus = await ctx.mcp.call("explore_recipe_search", {
        group_slug: "definitely-not-a-real-group-xyz",
        search: "x",
      });
      expect(
        bogus.isError && bogus.text.includes("404"),
        `nonexistent group should 404: ${bogus.text}`,
      );
      await setGroupPrivate(ctx.bearer, true);
      const priv = await ctx.mcp.call("explore_recipe_search", {
        group_slug: ctx.groupSlug,
        search: "x",
      });
      expect(priv.isError && priv.text.includes("404"), `private group should 404: ${priv.text}`);
      return "nonexistent -> 404; private -> 404 (indistinguishable, no enumeration leak)";
    },
  );
}

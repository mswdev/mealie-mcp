import { expect, runCheck, snippet } from "../assert.js";
import type { CheckContext } from "./context.js";

/** PR #2/#3 owed: recipe reads + writes (create/update/delete), multipart image/asset, hermetic import. */
export async function run(ctx: CheckContext): Promise<void> {
  await readProjection(ctx);
  await create(ctx);
  await updateMerge(ctx);
  await deleteConfirm(ctx);
  await imageUpload(ctx);
  await assetUpload(ctx);
  await hermeticImport(ctx);
}

/** recipe_get projection: concise trims heavy fields, detailed keeps them, include adds them back. */
async function readProjection(ctx: CheckContext): Promise<void> {
  await runCheck(
    { id: "C-RECIPE-RW", owedPr: "#2", title: "recipe_get concise/detailed/include projection" },
    async () => {
      const created = await ctx.mcp.call("recipe_create", { name: "VerifyRwRecipe" });
      const slug = (created.json as { slug: string }).slug;
      await ctx.mcp.call("recipe_update", {
        slug,
        changes: { recipeIngredient: [{ note: "2 cups flour" }], nutrition: { calories: "250" } },
      });

      const found = await ctx.mcp.call("recipe_search", { search: "VerifyRwRecipe" });
      const items = (found.json as { items?: Array<{ slug: string }> }).items ?? [];
      expect(
        items.some((r) => r.slug === slug),
        `search did not return ${slug}: ${snippet(found.json)}`,
      );

      const concise = await ctx.mcp.call("recipe_get", { slug });
      expect(!("recipeIngredient" in (concise.json as object)), "concise leaked recipeIngredient");
      expect(
        (concise.json as { nutrition?: unknown }).nutrition === undefined,
        "concise leaked nutrition",
      );
      const detailed = await ctx.mcp.call("recipe_get", { slug, response_format: "detailed" });
      expect(
        Array.isArray((detailed.json as { recipeIngredient?: unknown[] }).recipeIngredient),
        "detailed missing recipeIngredient",
      );
      const withNutr = await ctx.mcp.call("recipe_get", { slug, include: ["nutrition"] });
      expect(
        (withNutr.json as { nutrition?: unknown }).nutrition !== undefined,
        "include[nutrition] did not add nutrition",
      );
      return "search hit; concise trimmed; detailed full; include added nutrition";
    },
  );
}

/** recipe_create compensates for Mealie's bare-slug POST by re-fetching a full object. */
async function create(ctx: CheckContext): Promise<void> {
  await runCheck(
    {
      id: "C-RECIPE-CREATE",
      owedPr: "#3",
      title: "recipe_create re-fetches bare slug into full object",
    },
    async () => {
      const created = await ctx.mcp.call("recipe_create", { name: "VerifyCreateRecipe" });
      expect(!created.isError, `create failed: ${created.text}`);
      const obj = created.json as { id?: string; slug?: string; name?: string };
      expect(
        typeof obj === "object" && obj !== null,
        "create returned a bare value, not an object",
      );
      expect(
        typeof obj.id === "string" && typeof obj.slug === "string",
        `missing id/slug: ${snippet(created.json)}`,
      );
      const refetch = await ctx.mcp.call("recipe_get", { slug: obj.slug });
      expect(
        (refetch.json as { id?: string }).id === obj.id,
        "re-fetch id mismatch — create did not resolve the slug",
      );
      return `created object id=${obj.id} slug=${obj.slug}; re-fetch matched`;
    },
  );
}

/** recipe_update fetch-merge: a field set in update #1 survives a name-only update #2 (no 422). */
async function updateMerge(ctx: CheckContext): Promise<void> {
  await runCheck(
    {
      id: "C-RECIPE-UPDATE",
      owedPr: "#3",
      title: "recipe_update fetch-merge preserves recipeYield across rename",
    },
    async () => {
      const created = await ctx.mcp.call("recipe_create", { name: "VerifyUpdRecipe" });
      const slug = (created.json as { slug: string }).slug;
      await ctx.mcp.call("recipe_update", { slug, changes: { recipeYield: "4 servings" } });
      const rename = await ctx.mcp.call("recipe_update", {
        slug,
        changes: { name: "VerifyUpdRenamed" },
      });
      expect(!rename.isError, `rename failed (422?): ${rename.text}`);
      // renaming regenerates the slug server-side — re-fetch by the slug the write returned
      const newSlug = (rename.json as { slug: string }).slug;
      const after = await ctx.mcp.call("recipe_get", {
        slug: newSlug,
        response_format: "detailed",
      });
      expect(
        (after.json as { recipeYield?: string }).recipeYield === "4 servings",
        `recipeYield reset on rename: ${snippet(after.json)}`,
      );
      return `recipeYield survived rename; slug regenerated ${slug} -> ${newSlug} (no 422)`;
    },
  );
}

/** recipe_delete confirm gate fires both ways; success → {deleted:slug}; recipe then 404s. */
async function deleteConfirm(ctx: CheckContext): Promise<void> {
  await runCheck(
    {
      id: "C-RECIPE-DELETE",
      owedPr: "#3",
      title: "recipe_delete confirm gate + {deleted:slug} + gone",
    },
    async () => {
      const created = await ctx.mcp.call("recipe_create", { name: "VerifyDelRecipe" });
      const slug = (created.json as { slug: string }).slug;
      const refused = await ctx.mcp.call("recipe_delete", { slug, confirm: false });
      expect(
        refused.isError && refused.text.includes("confirm: true"),
        `delete should refuse unconfirmed: ${refused.text}`,
      );
      const stillThere = await ctx.mcp.call("recipe_get", { slug });
      expect(!stillThere.isError, "refused delete should leave recipe intact");
      const deleted = await ctx.mcp.call("recipe_delete", { slug, confirm: true });
      expect(
        (deleted.json as { deleted?: string }).deleted === slug,
        `expected {deleted:${slug}}: ${deleted.text}`,
      );
      const gone = await ctx.mcp.call("recipe_get", { slug });
      expect(gone.isError, "recipe should 404 after delete");
      return `confirm gate held; deleted ${slug}; re-fetch 404'd`;
    },
  );
}

/** recipe_image multipart upload populates recipe.image (durable proof via re-fetch). */
async function imageUpload(ctx: CheckContext): Promise<void> {
  await runCheck(
    { id: "C-RECIPE-IMAGE", owedPr: "#3", title: "recipe_image multipart upload attaches image" },
    async () => {
      const created = await ctx.mcp.call("recipe_create", { name: "VerifyImgRecipe" });
      const slug = (created.json as { slug: string }).slug;
      const before = await ctx.mcp.call("recipe_get", { slug });
      const up = await ctx.mcp.call("recipe_image", {
        slug,
        action: "upload",
        filePath: `${ctx.fixturesDir}/recipe.jpg`,
        extension: "jpg",
      });
      expect(!up.isError, `image upload failed: ${up.text}`);
      const after = await ctx.mcp.call("recipe_get", { slug });
      const beforeImg = (before.json as { image?: unknown }).image;
      const afterImg = (after.json as { image?: unknown }).image;
      expect(
        Boolean(afterImg) && afterImg !== beforeImg,
        `image not attached (before=${snippet(beforeImg)} after=${snippet(afterImg)})`,
      );
      return `image attached: ${snippet(afterImg)}`;
    },
  );
}

/** recipe_assets multipart upload creates the asset (the POST echo is the durable proof —
 *  Mealie does not reflect uploaded assets in recipe.recipeAssets on GET, verified live). */
async function assetUpload(ctx: CheckContext): Promise<void> {
  await runCheck(
    {
      id: "C-RECIPE-ASSET",
      owedPr: "#3",
      title: "recipe_assets multipart upload creates the asset",
    },
    async () => {
      const created = await ctx.mcp.call("recipe_create", { name: "VerifyAssetRecipe" });
      const slug = (created.json as { slug: string }).slug;
      const up = await ctx.mcp.call("recipe_assets", {
        slug,
        filePath: `${ctx.fixturesDir}/asset.txt`,
        name: "VerifyNote",
        extension: "txt",
      });
      expect(!up.isError, `asset upload failed: ${up.text}`);
      const asset = up.json as { name?: string; fileName?: string };
      expect(
        asset.name === "VerifyNote" && typeof asset.fileName === "string",
        `unexpected asset echo: ${snippet(up.json)}`,
      );
      return `multipart asset created: ${snippet(up.json)} (recipe.recipeAssets stays null — Mealie quirk)`;
    },
  );
}

/** recipe_import (html_or_json, hermetic schema.org payload) creates a real recipe. */
async function hermeticImport(ctx: CheckContext): Promise<void> {
  await runCheck(
    {
      id: "C-RECIPE-IMPORT",
      owedPr: "#3",
      title: "recipe_import html_or_json (hermetic) creates a recipe",
    },
    async () => {
      const data = JSON.stringify({
        "@context": "https://schema.org",
        "@type": "Recipe",
        name: "VerifyImportRecipe",
        recipeIngredient: ["1 cup sugar"],
        recipeInstructions: [{ "@type": "HowToStep", text: "Mix" }],
      });
      const imp = await ctx.mcp.call("recipe_import", { source: "html_or_json", data });
      expect(!imp.isError, `import failed: ${imp.text}`);
      const slug = (imp.json as { slug?: string }).slug;
      expect(
        typeof slug === "string" && slug.length > 0,
        `import returned no slug: ${snippet(imp.json)}`,
      );
      const refetch = await ctx.mcp.call("recipe_get", { slug, response_format: "detailed" });
      expect(!refetch.isError, "imported recipe not fetchable");
      return `imported recipe slug=${slug}`;
    },
  );
}

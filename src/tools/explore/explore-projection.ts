/** The six parallel public catalog resources behind explore_list/explore_get. */
export const EXPLORE_TYPES = ["cookbook", "category", "tag", "tool", "food", "household"] as const;

/** A single public explore resource type. */
export type ExploreType = (typeof EXPLORE_TYPES)[number];

/** Heavy recipe fields addable back onto the concise view via `include`. */
export type ExploreIncludable = "comments" | "nutrition";

/** Shared group_slug param description — the discovery story (design §3). */
export const GROUP_SLUG_DESCRIPTION =
  "Slug of the public group to browse. Find it in the instance's public URL (/g/{slug}), " +
  "via group_self_get (groups toolset), or admin_about's defaultGroupSlug (admin toolset).";

/** Shared description suffix: the public-group requirement and 404 ambiguity. */
export const PUBLIC_GROUP_HINT =
  "Requires the group to be public — private and nonexistent groups both return 404.";

/** Per-type URL segment under the group root — irregular, never naive pluralization. */
const SEGMENTS: Record<ExploreType, string> = {
  cookbook: "cookbooks",
  category: "organizers/categories",
  tag: "organizers/tags",
  tool: "organizers/tools",
  food: "foods",
  household: "households",
};

/** Concise fields for five of the six types (foods differ — they have no slug). */
const CONCISE_FIELDS = ["id", "slug", "name"] as const;

/** Food concise fields — no slug exists; labelId mirrors food_search's projection. */
const FOOD_CONCISE_FIELDS = ["id", "name", "labelId"] as const;

/** Lightweight fields kept in the concise public-recipe projection (mirrors recipe_get). */
const RECIPE_CONCISE_FIELDS = [
  "id",
  "slug",
  "name",
  "description",
  "image",
  "rating",
  "recipeServings",
  "recipeYield",
  "recipeYieldQuantity",
  "totalTime",
  "prepTime",
  "cookTime",
  "performTime",
  "recipeCategory",
  "tags",
  "tools",
  "dateUpdated",
  "lastMade",
] as const;

/** Group-scoped explore root with the externally discovered slug URI-encoded. */
function exploreGroupRoot(groupSlug: string): string {
  return `/api/explore/groups/${encodeURIComponent(groupSlug)}`;
}

/**
 * Builds the public collection path for an explore catalog type.
 *
 * @param type - The explore resource type
 * @param groupSlug - Slug of the public group (URI-encoded into the path)
 * @returns The `/api/explore/groups/{slug}/{segment}` collection path
 */
export function exploreBasePath(type: ExploreType, groupSlug: string): string {
  return `${exploreGroupRoot(groupSlug)}/${SEGMENTS[type]}`;
}

/**
 * Builds the public recipes path for a group (search root; append a recipe slug
 * or `/suggestions` for the sibling endpoints).
 *
 * @param groupSlug - Slug of the public group (URI-encoded into the path)
 * @returns The `/api/explore/groups/{slug}/recipes` path
 */
export function exploreRecipesPath(groupSlug: string): string {
  return `${exploreGroupRoot(groupSlug)}/recipes`;
}

/**
 * Projects a public catalog item to its concise view or returns it whole.
 * Foods project to id/name/labelId (no slug exists); all other types to id/slug/name.
 *
 * @param item - The item object (shape varies by type; may be untyped)
 * @param type - The explore resource type (selects the concise field set)
 * @param format - "concise" trims to key fields; "detailed" returns everything
 * @returns The projected item as a plain record
 */
export function projectExploreItem(
  item: unknown,
  type: ExploreType,
  format: "concise" | "detailed",
): Record<string, unknown> {
  if (format === "detailed") return item as Record<string, unknown>;
  const source = item as Record<string, unknown>;
  const fields = type === "food" ? FOOD_CONCISE_FIELDS : CONCISE_FIELDS;
  const concise: Record<string, unknown> = {};
  for (const field of fields) concise[field] = source[field];
  return concise;
}

/**
 * Projects a public recipe to the concise view (plus optional heavy includes),
 * or returns it whole when detailed. Explore's own copy of the recipe_get
 * projection — sibling cross-imports are forbidden (file-organization rules).
 *
 * @param recipe - The full public recipe object (Recipe-Output shaped; untyped)
 * @param format - "concise" trims heavy fields; "detailed" returns everything
 * @param include - Heavy fields to add back onto the concise view (ignored when detailed)
 * @returns The projected recipe as a plain record
 */
export function projectExploreRecipe(
  recipe: unknown,
  format: "concise" | "detailed",
  include: ExploreIncludable[],
): Record<string, unknown> {
  if (format === "detailed") return recipe as Record<string, unknown>;
  const source = recipe as Record<string, unknown>;
  const concise: Record<string, unknown> = {};
  for (const field of RECIPE_CONCISE_FIELDS) concise[field] = source[field];
  for (const field of include) concise[field] = source[field];
  return concise;
}

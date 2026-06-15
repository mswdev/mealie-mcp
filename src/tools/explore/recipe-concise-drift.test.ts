import { describe, expect, it } from "vitest";
// Test-only sibling cross-import: explore keeps its own copy of the recipe concise-field
// list (runtime sibling imports are forbidden — see .claude/rules/file-organization.md).
// This guard asserts the two duplicated lists never silently drift apart.
import { CONCISE_FIELDS as RECIPES_CONCISE_FIELDS } from "../recipes/recipe-projection.js";
import { RECIPE_CONCISE_FIELDS } from "./explore-projection.js";

describe("explore recipe concise projection", () => {
  it("stays in sync with the recipes/ concise field list (duplicated by design)", () => {
    expect([...RECIPE_CONCISE_FIELDS].sort()).toEqual([...RECIPES_CONCISE_FIELDS].sort());
  });
});

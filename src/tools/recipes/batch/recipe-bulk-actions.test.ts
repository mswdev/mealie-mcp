import { describe, expect, it } from "vitest";
import { recipeBulkActionsHandler } from "./recipe-bulk-actions.js";

type Captured = { path?: string; body?: unknown; called?: boolean };

function fakeClient(captured: Captured) {
  return {
    post: async <T>(path: string, body: unknown): Promise<T> => {
      captured.path = path;
      captured.body = body;
      captured.called = true;
      return undefined as T;
    },
  };
}

function parse(r: { content: { type: string }[] }): Record<string, unknown> {
  return JSON.parse((r.content[0] as { type: "text"; text: string }).text);
}

describe("recipeBulkActionsHandler", () => {
  it("tag forwards full tag objects (TagBase) unchanged", async () => {
    const captured: Captured = {};
    const tags = [{ id: "t1", slug: "quick", name: "Quick" }];

    const result = await recipeBulkActionsHandler(fakeClient(captured), {
      action: "tag",
      recipes: ["a", "b"],
      tags,
    });

    expect(captured.path).toBe("/api/recipes/bulk-actions/tag");
    expect(captured.body).toEqual({ recipes: ["a", "b"], tags });
    expect(parse(result)).toEqual({ action: "tag", count: 2 });
  });

  it("categorize forwards full category objects unchanged", async () => {
    const captured: Captured = {};
    const categories = [{ id: "c1", slug: "dinner", name: "Dinner" }];

    await recipeBulkActionsHandler(fakeClient(captured), {
      action: "categorize",
      recipes: ["a"],
      categories,
    });

    expect(captured.path).toBe("/api/recipes/bulk-actions/categorize");
    expect(captured.body).toEqual({ recipes: ["a"], categories });
  });

  it("settings forwards the settings object", async () => {
    const captured: Captured = {};

    await recipeBulkActionsHandler(fakeClient(captured), {
      action: "settings",
      recipes: ["a"],
      settings: { public: true },
    });

    expect(captured.path).toBe("/api/recipes/bulk-actions/settings");
    expect(captured.body).toEqual({ recipes: ["a"], settings: { public: true } });
  });

  it("delete requires confirm", async () => {
    const captured: Captured = {};

    const result = await recipeBulkActionsHandler(fakeClient(captured), {
      action: "delete",
      recipes: ["a", "b"],
    });

    expect(result.isError).toBe(true);
    expect(captured.called).toBeUndefined();
  });

  it("delete posts the recipe ids when confirmed", async () => {
    const captured: Captured = {};

    const result = await recipeBulkActionsHandler(fakeClient(captured), {
      action: "delete",
      recipes: ["a", "b"],
      confirm: true,
    });

    expect(captured.path).toBe("/api/recipes/bulk-actions/delete");
    expect(captured.body).toEqual({ recipes: ["a", "b"] });
    expect(parse(result)).toEqual({ action: "delete", count: 2 });
  });

  it("returns isError when the required field is missing", async () => {
    const result = await recipeBulkActionsHandler(fakeClient({}), {
      action: "tag",
      recipes: ["a"],
    });

    expect(result.isError).toBe(true);
  });
});

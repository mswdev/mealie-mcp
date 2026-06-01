import { describe, expect, it } from "vitest";
import { recipeExportRunHandler } from "./recipe-export-run.js";

type Captured = { path?: string; body?: unknown; method?: string };

function fakeClient(captured: Captured) {
  return {
    post: async <T>(path: string, body: unknown): Promise<T> => {
      captured.path = path;
      captured.body = body;
      captured.method = "POST";
      return undefined as T;
    },
    delete: async <T>(path: string): Promise<T> => {
      captured.path = path;
      captured.method = "DELETE";
      return { message: "purged" } as T;
    },
  };
}

function parse(r: { content: { type: string }[] }): Record<string, unknown> {
  return JSON.parse((r.content[0] as { type: "text"; text: string }).text);
}

describe("recipeExportRunHandler", () => {
  it("start posts an ExportRecipes job and reports accepted count", async () => {
    const captured: Captured = {};

    const result = await recipeExportRunHandler(fakeClient(captured), {
      action: "start",
      recipes: ["a", "b"],
    });

    expect(captured.path).toBe("/api/recipes/bulk-actions/export");
    expect(captured.body).toEqual({ recipes: ["a", "b"], exportType: "json" });
    expect(parse(result)).toEqual({ accepted: 2 });
  });

  it("purge requires confirm", async () => {
    const captured: Captured = {};

    const result = await recipeExportRunHandler(fakeClient(captured), { action: "purge" });

    expect(result.isError).toBe(true);
    expect(captured.method).toBeUndefined();
  });

  it("purge deletes export data when confirmed", async () => {
    const captured: Captured = {};

    const result = await recipeExportRunHandler(fakeClient(captured), {
      action: "purge",
      confirm: true,
    });

    expect(captured.path).toBe("/api/recipes/bulk-actions/export/purge");
    expect(captured.method).toBe("DELETE");
    expect(parse(result)).toEqual({ message: "purged" });
  });

  it("start without recipes returns isError", async () => {
    const result = await recipeExportRunHandler(fakeClient({}), { action: "start" });
    expect(result.isError).toBe(true);
  });
});

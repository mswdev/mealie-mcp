import { describe, expect, it } from "vitest";
import { recipeExportHandler } from "./recipe-export.js";

type Captured = { path?: string };

function fakeClient(response: unknown, captured: Captured) {
  return {
    baseUrl: "https://m.test",
    get: async <T>(path: string): Promise<T> => {
      captured.path = path;
      return response as T;
    },
  };
}

function parse(r: { content: { type: string }[] }): Record<string, unknown> {
  return JSON.parse((r.content[0] as { type: "text"; text: string }).text);
}

describe("recipeExportHandler", () => {
  it("formats lists the available export formats", async () => {
    const captured: Captured = {};
    const result = await recipeExportHandler(fakeClient({ json: ["recipes"] }, captured), {
      action: "formats",
    });

    expect(captured.path).toBe("/api/recipes/exports");
    expect(parse(result)).toEqual({ json: ["recipes"] });
  });

  it("list_jobs reads prior export jobs", async () => {
    const captured: Captured = {};
    await recipeExportHandler(fakeClient([], captured), { action: "list_jobs" });

    expect(captured.path).toBe("/api/recipes/bulk-actions/export");
  });

  it("render_one returns a reference URL without fetching bytes", async () => {
    const captured: Captured = {};
    const result = await recipeExportHandler(fakeClient(null, captured), {
      action: "render_one",
      slug: "soup",
      templateName: "recipes.md",
    });

    expect(captured.path).toBeUndefined(); // no GET performed
    expect(parse(result).url).toBe(
      "https://m.test/api/recipes/soup/exports?template_name=recipes.md",
    );
  });

  it("download_token fetches the export download token", async () => {
    const captured: Captured = {};
    await recipeExportHandler(fakeClient({ fileToken: "t" }, captured), {
      action: "download_token",
      exportId: "exp1",
    });

    expect(captured.path).toBe("/api/recipes/bulk-actions/export/exp1/download");
  });

  it("returns isError when a required field is missing", async () => {
    const result = await recipeExportHandler(fakeClient(null, {}), { action: "render_one" });
    expect(result.isError).toBe(true);
  });
});

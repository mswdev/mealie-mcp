import { describe, expect, it } from "vitest";
import { recipeImportHandler } from "./recipe-import.js";

type Captured = { path?: string; body?: unknown; query?: unknown; form?: FormData };

function fakeClient(captured: Captured, postReturn: unknown = "soup") {
  return {
    post: async <T>(path: string, body: unknown): Promise<T> => {
      captured.path = path;
      captured.body = body;
      return postReturn as T;
    },
    get: async <T>(): Promise<T> =>
      ({ id: "u1", slug: "soup", name: "Soup", recipeIngredient: [{ note: "x" }] }) as T,
    postMultipart: async <T>(path: string, form: FormData, query?: unknown): Promise<T> => {
      captured.path = path;
      captured.form = form;
      captured.query = query;
      return "soup" as T;
    },
  };
}

function parse(r: { content: { type: string }[] }): Record<string, unknown> {
  return JSON.parse((r.content[0] as { type: "text"; text: string }).text);
}

describe("recipeImportHandler", () => {
  it("source=url posts ScrapeRecipe then re-fetches concise", async () => {
    const captured: Captured = {};

    const result = await recipeImportHandler(fakeClient(captured), {
      source: "url",
      url: "https://example.com/r",
    });

    expect(captured.path).toBe("/api/recipes/create/url");
    expect(captured.body).toEqual({
      url: "https://example.com/r",
      includeTags: false,
      includeCategories: false,
    });
    const body = parse(result);
    expect(body.slug).toBe("soup");
    expect(body.recipeIngredient).toBeUndefined();
  });

  it("source=bulk_url posts the imports array and reports the count", async () => {
    const captured: Captured = {};

    const result = await recipeImportHandler(fakeClient(captured), {
      source: "bulk_url",
      urls: ["https://a.test", "https://b.test"],
    });

    expect(captured.path).toBe("/api/recipes/create/url/bulk");
    expect(captured.body).toEqual({
      imports: [{ url: "https://a.test" }, { url: "https://b.test" }],
    });
    expect(parse(result)).toEqual({ accepted: 2 });
  });

  it("source=html_or_json posts the data and re-fetches concise", async () => {
    const captured: Captured = {};

    await recipeImportHandler(fakeClient(captured), {
      source: "html_or_json",
      data: "<html>",
    });

    expect(captured.path).toBe("/api/recipes/create/html-or-json");
    expect(captured.body).toMatchObject({ data: "<html>" });
  });

  it("source=preview posts to test-scrape-url and returns the raw result without persisting", async () => {
    const captured: Captured = {};
    const result = await recipeImportHandler(fakeClient(captured, { name: "Preview" }), {
      source: "preview",
      url: "https://example.com/r",
    });

    expect(captured.path).toBe("/api/recipes/test-scrape-url");
    expect(captured.body).toEqual({ url: "https://example.com/r", useOpenAI: false });
    expect(parse(result)).toEqual({ name: "Preview" });
  });

  it("source=zip uploads the archive via multipart", async () => {
    const captured: Captured = {};
    const file = new Blob([new Uint8Array([1, 2])]);

    await recipeImportHandler(fakeClient(captured), { source: "zip", extension: "zip" }, file);

    expect(captured.path).toBe("/api/recipes/create/zip");
    expect(captured.form?.get("archive")).toBeInstanceOf(Blob);
  });

  it("source=image uploads images and passes translateLanguage as a query param", async () => {
    const captured: Captured = {};
    const file = new Blob([new Uint8Array([1, 2])]);

    await recipeImportHandler(
      fakeClient(captured, "soup"),
      { source: "image", translateLanguage: "en" },
      file,
    );

    expect(captured.path).toBe("/api/recipes/create/image");
    expect(captured.form?.get("images")).toBeInstanceOf(Blob);
    expect(captured.query).toEqual({ translateLanguage: "en" });
  });

  it("returns isError when a required field is missing", async () => {
    const result = await recipeImportHandler(fakeClient({}), { source: "url" });
    expect(result.isError).toBe(true);
  });

  it("returns isError when a file source has no file", async () => {
    const result = await recipeImportHandler(fakeClient({}), { source: "zip" });
    expect(result.isError).toBe(true);
  });

  it("returns isError when the client throws", async () => {
    const client = {
      post: async <T>(): Promise<T> => {
        throw new Error("scrape failed");
      },
      get: async <T>(): Promise<T> => ({}) as T,
      postMultipart: async <T>(): Promise<T> => ({}) as T,
    };

    const result = await recipeImportHandler(client, { source: "url", url: "https://x.test" });

    expect(result.isError).toBe(true);
  });
});

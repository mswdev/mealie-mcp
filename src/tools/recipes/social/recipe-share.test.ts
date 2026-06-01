import { describe, expect, it } from "vitest";
import { recipeShareHandler } from "./recipe-share.js";

type Captured = { path?: string; query?: unknown };

function fakeClient(response: unknown, captured: Captured) {
  return {
    baseUrl: "https://m.test",
    get: async <T>(path: string, query?: unknown): Promise<T> => {
      captured.path = path;
      captured.query = query;
      return response as T;
    },
  };
}

function parse(r: { content: { type: string }[] }): Record<string, unknown> {
  return JSON.parse((r.content[0] as { type: "text"; text: string }).text);
}

describe("recipeShareHandler", () => {
  it("list reads share tokens, optionally filtered by recipe", async () => {
    const captured: Captured = {};
    await recipeShareHandler(fakeClient([], captured), { action: "list", recipeId: "u1" });

    expect(captured.path).toBe("/api/shared/recipes");
    expect(captured.query).toMatchObject({ recipe_id: "u1" });
  });

  it("get reads one token by id", async () => {
    const captured: Captured = {};
    await recipeShareHandler(fakeClient({ id: "t1" }, captured), { action: "get", tokenId: "t1" });

    expect(captured.path).toBe("/api/shared/recipes/t1");
  });

  it("view fetches the public shared recipe and returns concise", async () => {
    const captured: Captured = {};
    const result = await recipeShareHandler(
      fakeClient(
        { id: "u1", slug: "soup", name: "Soup", recipeIngredient: [{ note: "x" }] },
        captured,
      ),
      { action: "view", token: "tok" },
    );

    expect(captured.path).toBe("/api/recipes/shared/tok");
    const body = parse(result);
    expect(body.slug).toBe("soup");
    expect(body.recipeIngredient).toBeUndefined();
  });

  it("view_zip returns a reference URL without fetching", async () => {
    const captured: Captured = {};
    const result = await recipeShareHandler(fakeClient(null, captured), {
      action: "view_zip",
      token: "tok",
    });

    expect(captured.path).toBeUndefined();
    expect(parse(result).url).toBe("https://m.test/api/recipes/shared/tok/zip");
  });

  it("view without a token returns isError", async () => {
    const result = await recipeShareHandler(fakeClient(null, {}), { action: "view" });
    expect(result.isError).toBe(true);
  });
});

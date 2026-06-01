import { describe, expect, it } from "vitest";
import { recipeParseIngredientsHandler } from "./recipe-parse-ingredients.js";

type Captured = { path?: string; body?: unknown };

function fakeClient(response: unknown, captured: Captured) {
  return {
    post: async <T>(path: string, body: unknown): Promise<T> => {
      captured.path = path;
      captured.body = body;
      return response as T;
    },
  };
}

function parse(r: { content: { type: string }[] }): unknown {
  return JSON.parse((r.content[0] as { type: "text"; text: string }).text);
}

describe("recipeParseIngredientsHandler", () => {
  it("uses the single-ingredient endpoint and wraps the result in an array", async () => {
    const captured: Captured = {};
    const client = fakeClient({ ingredient: { note: "salt" } }, captured);

    const result = await recipeParseIngredientsHandler(client, { ingredients: ["1 tsp salt"] });

    expect(captured.path).toBe("/api/parser/ingredient");
    expect(captured.body).toEqual({ ingredient: "1 tsp salt" });
    expect(parse(result)).toEqual([{ ingredient: { note: "salt" } }]);
  });

  it("uses the bulk endpoint for multiple ingredients and passes the parser", async () => {
    const captured: Captured = {};
    const client = fakeClient([{ a: 1 }, { b: 2 }], captured);

    await recipeParseIngredientsHandler(client, {
      ingredients: ["1 tsp salt", "2 cups flour"],
      parser: "brute",
    });

    expect(captured.path).toBe("/api/parser/ingredients");
    expect(captured.body).toEqual({
      ingredients: ["1 tsp salt", "2 cups flour"],
      parser: "brute",
    });
  });

  it("returns isError when the client throws", async () => {
    const client = {
      post: async <T>(): Promise<T> => {
        throw new Error("nope");
      },
    };

    const result = await recipeParseIngredientsHandler(client, { ingredients: ["x"] });

    expect(result.isError).toBe(true);
  });
});

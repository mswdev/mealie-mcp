import { describe, expect, it } from "vitest";
import { recipeSuggestionsHandler } from "./recipe-suggestions.js";

type Captured = { path?: string; query?: unknown };

function fakeClient(response: unknown, captured: Captured) {
  return {
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

describe("recipeSuggestionsHandler", () => {
  it("passes foods/tools/limit through and returns concise suggestions", async () => {
    const captured: Captured = {};
    const client = fakeClient(
      {
        items: [
          {
            recipe: { id: "u1", slug: "soup", name: "Soup", recipeIngredient: [{ note: "salt" }] },
            missingFoods: [{ name: "Onion" }],
            missingTools: [{ name: "Blender" }],
          },
        ],
      },
      captured,
    );

    const result = await recipeSuggestionsHandler(client, {
      foods: ["f1"],
      tools: ["t1"],
      limit: 5,
    });

    expect(captured.path).toBe("/api/recipes/suggestions");
    expect(captured.query).toMatchObject({ foods: ["f1"], tools: ["t1"], limit: 5 });
    const body = parse(result);
    expect(body.items).toEqual([
      {
        recipe: { id: "u1", slug: "soup", name: "Soup" },
        missingFoods: ["Onion"],
        missingTools: ["Blender"],
      },
    ]);
  });

  it("returns isError when the client throws", async () => {
    const client = {
      get: async <T>(): Promise<T> => {
        throw new Error("nope");
      },
    };

    const result = await recipeSuggestionsHandler(client, {});

    expect(result.isError).toBe(true);
  });
});

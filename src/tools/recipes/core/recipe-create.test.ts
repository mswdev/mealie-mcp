import { describe, expect, it } from "vitest";
import { recipeCreateHandler } from "./recipe-create.js";

type Captured = { path?: string; body?: unknown };

function fakeClient(slug: string, recipe: unknown, captured: Captured) {
  return {
    post: async <T>(path: string, body: unknown): Promise<T> => {
      captured.path = path;
      captured.body = body;
      return slug as T;
    },
    get: async <T>(): Promise<T> => recipe as T,
  };
}

function parse(r: { content: { type: string }[] }): Record<string, unknown> {
  return JSON.parse((r.content[0] as { type: "text"; text: string }).text);
}

describe("recipeCreateHandler", () => {
  it("posts the name, then re-fetches and returns the concise recipe", async () => {
    const captured: Captured = {};
    const client = fakeClient(
      "soup",
      { id: "u1", slug: "soup", name: "Soup", recipeIngredient: [{ note: "salt" }] },
      captured,
    );

    const result = await recipeCreateHandler(client, { name: "Soup" });

    expect(captured.path).toBe("/api/recipes");
    expect(captured.body).toEqual({ name: "Soup" });
    const body = parse(result);
    expect(body.slug).toBe("soup");
    expect(body.id).toBe("u1");
    expect(body.recipeIngredient).toBeUndefined(); // concise drops heavy fields
  });

  it("returns isError when the client throws", async () => {
    const client = {
      post: async <T>(): Promise<T> => {
        throw new Error("duplicate slug");
      },
      get: async <T>(): Promise<T> => ({}) as T,
    };

    const result = await recipeCreateHandler(client, { name: "x" });

    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain("duplicate slug");
  });
});

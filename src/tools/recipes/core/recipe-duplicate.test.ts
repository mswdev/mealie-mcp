import { describe, expect, it } from "vitest";
import { recipeDuplicateHandler } from "./recipe-duplicate.js";

type Captured = { path?: string; body?: unknown };

function fakeClient(result: unknown, captured: Captured) {
  return {
    post: async <T>(path: string, body: unknown): Promise<T> => {
      captured.path = path;
      captured.body = body;
      return result as T;
    },
  };
}

function parse(r: { content: { type: string }[] }): Record<string, unknown> {
  return JSON.parse((r.content[0] as { type: "text"; text: string }).text);
}

describe("recipeDuplicateHandler", () => {
  it("posts to the duplicate endpoint with the optional name and returns concise", async () => {
    const captured: Captured = {};
    const client = fakeClient(
      { id: "u2", slug: "soup-1", name: "Soup copy", recipeIngredient: [{ note: "salt" }] },
      captured,
    );

    const result = await recipeDuplicateHandler(client, { slug: "soup", name: "Soup copy" });

    expect(captured.path).toBe("/api/recipes/soup/duplicate");
    expect(captured.body).toEqual({ name: "Soup copy" });
    const body = parse(result);
    expect(body.slug).toBe("soup-1");
    expect(body.recipeIngredient).toBeUndefined();
  });

  it("omits name when not provided", async () => {
    const captured: Captured = {};
    const client = fakeClient({ id: "u2", slug: "soup-1", name: "Soup (1)" }, captured);

    await recipeDuplicateHandler(client, { slug: "soup" });

    expect(captured.body).toEqual({});
  });

  it("returns isError when the client throws", async () => {
    const client = {
      post: async <T>(): Promise<T> => {
        throw new Error("nope");
      },
    };

    const result = await recipeDuplicateHandler(client, { slug: "soup" });

    expect(result.isError).toBe(true);
  });
});

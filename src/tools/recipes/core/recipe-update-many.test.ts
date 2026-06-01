import { describe, expect, it } from "vitest";
import { recipeUpdateManyHandler } from "./recipe-update-many.js";

type Captured = { method?: string; path?: string; body?: unknown };

function fakeClient(captured: Captured) {
  const record = async <T>(method: string, path: string, body: unknown): Promise<T> => {
    captured.method = method;
    captured.path = path;
    captured.body = body;
    return undefined as T;
  };
  return {
    put: <T>(path: string, body: unknown): Promise<T> => record<T>("PUT", path, body),
    patch: <T>(path: string, body: unknown): Promise<T> => record<T>("PATCH", path, body),
  };
}

function parse(r: { content: { type: string }[] }): Record<string, unknown> {
  return JSON.parse((r.content[0] as { type: "text"; text: string }).text);
}

describe("recipeUpdateManyHandler", () => {
  it("PUTs the array to the collection by default and reports the count", async () => {
    const captured: Captured = {};
    const recipes = [{ slug: "a" }, { slug: "b" }];

    const result = await recipeUpdateManyHandler(fakeClient(captured), { recipes });

    expect(captured.method).toBe("PUT");
    expect(captured.path).toBe("/api/recipes");
    expect(captured.body).toEqual(recipes);
    expect(parse(result)).toEqual({ updated: 2 });
  });

  it("routes to PATCH when method=patch", async () => {
    const captured: Captured = {};

    await recipeUpdateManyHandler(fakeClient(captured), {
      recipes: [{ slug: "a" }],
      method: "patch",
    });

    expect(captured.method).toBe("PATCH");
  });

  it("returns isError when the client throws", async () => {
    const client = {
      put: async <T>(): Promise<T> => {
        throw new Error("bad");
      },
      patch: async <T>(): Promise<T> => undefined as T,
    };

    const result = await recipeUpdateManyHandler(client, { recipes: [{ slug: "a" }] });

    expect(result.isError).toBe(true);
  });
});

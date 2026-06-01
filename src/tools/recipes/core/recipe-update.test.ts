import { describe, expect, it } from "vitest";
import { recipeUpdateHandler } from "./recipe-update.js";

type Captured = { method?: string; path?: string; body?: unknown };

function fakeClient(current: Record<string, unknown>, captured: Captured) {
  const record = async <T>(method: string, path: string, body: unknown): Promise<T> => {
    captured.method = method;
    captured.path = path;
    captured.body = body;
    return undefined as T;
  };
  return {
    get: async <T>(): Promise<T> => current as T,
    put: <T>(path: string, body: unknown): Promise<T> => record<T>("PUT", path, body),
    patch: <T>(path: string, body: unknown): Promise<T> => record<T>("PATCH", path, body),
  };
}

function parse(r: { content: { type: string }[] }): Record<string, unknown> {
  return JSON.parse((r.content[0] as { type: "text"; text: string }).text);
}

const CURRENT = {
  id: "u1",
  slug: "soup",
  name: "Soup",
  description: "old",
  recipeIngredient: [{ note: "salt" }],
};

describe("recipeUpdateHandler", () => {
  it("merges changes onto the fetched recipe, preserving untouched fields", async () => {
    const captured: Captured = {};
    const client = fakeClient({ ...CURRENT }, captured);

    await recipeUpdateHandler(client, { slug: "soup", changes: { description: "new" } });

    expect(captured.method).toBe("PATCH"); // default
    expect(captured.path).toBe("/api/recipes/soup");
    expect(captured.body).toEqual({ ...CURRENT, description: "new" }); // ingredients retained
  });

  it("routes to PUT when method=put", async () => {
    const captured: Captured = {};
    const client = fakeClient({ ...CURRENT }, captured);

    await recipeUpdateHandler(client, { slug: "soup", changes: { name: "X" }, method: "put" });

    expect(captured.method).toBe("PUT");
  });

  it("returns the concise updated recipe", async () => {
    const client = fakeClient({ ...CURRENT }, {});

    const result = await recipeUpdateHandler(client, { slug: "soup", changes: {} });

    const body = parse(result);
    expect(body.slug).toBe("soup");
    expect(body.recipeIngredient).toBeUndefined(); // concise
  });

  it("returns isError when the client throws", async () => {
    const client = {
      get: async <T>(): Promise<T> => {
        throw new Error("not found");
      },
      put: async <T>(): Promise<T> => undefined as T,
      patch: async <T>(): Promise<T> => undefined as T,
    };

    const result = await recipeUpdateHandler(client, { slug: "missing", changes: {} });

    expect(result.isError).toBe(true);
  });
});

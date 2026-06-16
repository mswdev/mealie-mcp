import { describe, expect, it } from "vitest";
import { recipeGetHandler } from "./recipe-get.js";

const FULL = {
  id: "uuid-1",
  slug: "soup",
  name: "Soup",
  description: "Tasty",
  recipeIngredient: [{ note: "salt" }],
  recipeInstructions: [{ text: "boil" }],
  nutrition: { calories: "100" },
  comments: [{ text: "yum" }],
  notes: [{ title: "n" }],
};

function fakeClient(recipe: unknown) {
  return { get: async <T>(): Promise<T> => recipe as T };
}

function parse(result: { content: { type: string }[] }): Record<string, unknown> {
  return JSON.parse((result.content[0] as { type: "text"; text: string }).text) as Record<
    string,
    unknown
  >;
}

describe("recipeGetHandler", () => {
  it("concise (default) drops heavy fields but keeps id+slug+name", async () => {
    const result = await recipeGetHandler(fakeClient(FULL), { slug: "soup" });

    const body = parse(result);
    expect(body.id).toBe("uuid-1");
    expect(body.slug).toBe("soup");
    expect(body.name).toBe("Soup");
    expect(body.description).toBe("Tasty");
    expect(body.recipeIngredient).toBeUndefined();
    expect(body.nutrition).toBeUndefined();
    expect(body.comments).toBeUndefined();
  });

  it("include adds back requested heavy fields onto the concise view", async () => {
    const result = await recipeGetHandler(fakeClient(FULL), {
      slug: "soup",
      include: ["nutrition", "comments"],
    });

    const body = parse(result);
    expect(body.nutrition).toEqual({ calories: "100" });
    expect(body.comments).toEqual([{ text: "yum" }]);
    expect(body.recipeIngredient).toBeUndefined();
  });

  it("detailed returns the full object and ignores include", async () => {
    const result = await recipeGetHandler(fakeClient(FULL), {
      slug: "soup",
      response_format: "detailed",
      include: ["nutrition"],
    });

    const body = parse(result);
    expect(body.recipeIngredient).toEqual([{ note: "salt" }]);
    expect(body.recipeInstructions).toEqual([{ text: "boil" }]);
    expect(body.notes).toEqual([{ title: "n" }]);
  });

  it("returns isError when the client throws", async () => {
    const client = {
      get: async <T>(): Promise<T> => {
        throw new Error("not found");
      },
    };

    const result = await recipeGetHandler(client, { slug: "missing" });

    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain("not found");
  });
});

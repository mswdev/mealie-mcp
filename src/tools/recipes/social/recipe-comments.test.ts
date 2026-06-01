import { describe, expect, it } from "vitest";
import type { PaginatedResult } from "../../../client/pagination.js";
import { recipeCommentsHandler } from "./recipe-comments.js";

type Captured = { path?: string; query?: unknown };

function fakeClient(response: unknown, captured: Captured) {
  return {
    get: async <T>(path: string): Promise<T> => {
      captured.path = path;
      return response as T;
    },
    getPaginated: async <T>(path: string, query?: unknown): Promise<PaginatedResult<T>> => {
      captured.path = path;
      captured.query = query;
      return response as PaginatedResult<T>;
    },
  };
}

function parse(r: { content: { type: string }[] }): unknown {
  return JSON.parse((r.content[0] as { type: "text"; text: string }).text);
}

describe("recipeCommentsHandler", () => {
  it("by_recipe reads the recipe-scoped comments", async () => {
    const captured: Captured = {};
    const result = await recipeCommentsHandler(fakeClient([{ id: "c1", text: "yum" }], captured), {
      action: "by_recipe",
      slug: "soup",
    });

    expect(captured.path).toBe("/api/recipes/soup/comments");
    expect(parse(result)).toEqual([{ id: "c1", text: "yum" }]);
  });

  it("list reads the paginated group comments", async () => {
    const captured: Captured = {};
    await recipeCommentsHandler(
      fakeClient({ items: [], total: 0, page: 1, perPage: 20, totalPages: 0 }, captured),
      { action: "list", perPage: 20 },
    );

    expect(captured.path).toBe("/api/comments");
    expect(captured.query).toMatchObject({ perPage: 20 });
  });

  it("get reads a single comment by id", async () => {
    const captured: Captured = {};
    await recipeCommentsHandler(fakeClient({ id: "c1" }, captured), {
      action: "get",
      commentId: "c1",
    });

    expect(captured.path).toBe("/api/comments/c1");
  });

  it("by_recipe without a slug returns isError", async () => {
    const result = await recipeCommentsHandler(fakeClient([], {}), { action: "by_recipe" });
    expect(result.isError).toBe(true);
  });

  it("returns isError when the client throws", async () => {
    const client = {
      get: async <T>(): Promise<T> => {
        throw new Error("nope");
      },
      getPaginated: async <T>(): Promise<PaginatedResult<T>> => {
        throw new Error("nope");
      },
    };
    const result = await recipeCommentsHandler(client, { action: "get", commentId: "c1" });
    expect(result.isError).toBe(true);
  });
});

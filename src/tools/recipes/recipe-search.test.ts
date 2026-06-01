import { describe, expect, it } from "vitest";
import { MealieApiError } from "../../client/MealieApiError.js";
import type { PaginatedResult } from "../../client/pagination.js";
import { recipeSearchHandler } from "./recipe-search.js";

type Captured = { path: string; query: unknown };

function fakeClient(result: PaginatedResult<unknown>, captured: Captured) {
  return {
    getPaginated: async <T>(path: string, query?: unknown): Promise<PaginatedResult<T>> => {
      captured.path = path;
      captured.query = query;
      return result as PaginatedResult<T>;
    },
  };
}

function parse(result: { content: { type: string }[] }): Record<string, unknown> {
  const first = result.content[0];
  expect(first?.type).toBe("text");
  return JSON.parse((first as { type: "text"; text: string }).text) as Record<string, unknown>;
}

describe("recipeSearchHandler", () => {
  it("passes pagination + filters through and returns concise items with meta", async () => {
    const captured: Captured = { path: "", query: undefined };
    const client = fakeClient(
      {
        items: [{ id: "u1", slug: "soup", name: "Soup", extra: "drop" }],
        total: 1,
        page: 1,
        perPage: 20,
        totalPages: 1,
      },
      captured,
    );

    const result = await recipeSearchHandler(client, { search: "soup", tags: ["t1"], perPage: 20 });

    expect(captured.path).toBe("/api/recipes");
    expect(captured.query).toMatchObject({ search: "soup", tags: ["t1"], perPage: 20 });
    const body = parse(result);
    expect(body.total).toBe(1);
    expect(body.items).toEqual([{ id: "u1", slug: "soup", name: "Soup" }]);
  });

  it("applies the default perPage when omitted", async () => {
    const captured: Captured = { path: "", query: undefined };
    const client = fakeClient(
      { items: [], total: 0, page: 1, perPage: 20, totalPages: 0 },
      captured,
    );

    await recipeSearchHandler(client, {});

    expect(captured.query).toMatchObject({ perPage: 20 });
  });

  it("returns isError carrying the Mealie API error message", async () => {
    const client = {
      getPaginated: async <T>(): Promise<PaginatedResult<T>> => {
        throw new MealieApiError(401, "Unauthorized", "/api/recipes");
      },
    };

    const result = await recipeSearchHandler(client, {});

    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain("401");
  });
});

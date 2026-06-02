import { describe, expect, it } from "vitest";
import type { PaginatedResult } from "../../client/pagination.js";
import { mealplanSearchHandler } from "./mealplan-search.js";

type Captured = { path: string; query?: Record<string, unknown> | undefined };

function fakeClient(captured: Captured[]) {
  const page: PaginatedResult<unknown> = {
    items: [{ id: 7, date: "2026-06-02", entryType: "dinner", title: "Pasta", text: "", recipeId: "r1" }],
    total: 1,
    page: 1,
    perPage: 20,
    totalPages: 1,
  };
  return {
    async getPaginated<T>(
      path: string,
      query?: Record<string, unknown>,
    ): Promise<PaginatedResult<T>> {
      captured.push({ path, query });
      return page as PaginatedResult<T>;
    },
  };
}

describe("mealplanSearchHandler", () => {
  it("maps startDate/endDate to start_date/end_date and applies default perPage", async () => {
    const captured: Captured[] = [];

    const result = await mealplanSearchHandler(fakeClient(captured), {
      startDate: "2026-06-01",
      endDate: "2026-06-07",
    });

    expect(captured[0]?.path).toBe("/api/households/mealplans");
    expect(captured[0]?.query).toMatchObject({
      start_date: "2026-06-01",
      end_date: "2026-06-07",
      perPage: 20,
    });
    const body = JSON.parse((result.content[0] as { text: string }).text);
    expect(body.items).toEqual([
      { id: 7, date: "2026-06-02", entryType: "dinner", title: "Pasta", recipeId: "r1" },
    ]);
    expect(body).toMatchObject({ total: 1, totalPages: 1 });
  });

  it("returns an error result when the client throws", async () => {
    const client = {
      async getPaginated<T>(): Promise<PaginatedResult<T>> {
        throw new Error("boom");
      },
    };

    const result = await mealplanSearchHandler(client, {});

    expect(result.isError).toBe(true);
  });
});

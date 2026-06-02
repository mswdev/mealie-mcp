import { describe, expect, it } from "vitest";
import type { PaginatedResult } from "../../client/pagination.js";
import { shoppingListSearchHandler } from "./shopping-list-search.js";

type Captured = { path: string; query?: Record<string, unknown> | undefined };

function fakeClient(captured: Captured[]) {
  const page: PaginatedResult<unknown> = {
    items: [{ id: "L1", name: "Groceries", groupId: "g" }],
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

describe("shoppingListSearchHandler", () => {
  it("applies the default perPage and returns concise items + pagination meta", async () => {
    const captured: Captured[] = [];

    const result = await shoppingListSearchHandler(fakeClient(captured), {});

    expect(captured[0]?.path).toBe("/api/households/shopping/lists");
    expect(captured[0]?.query?.perPage).toBe(20);
    const body = JSON.parse((result.content[0] as { text: string }).text);
    expect(body.items).toEqual([{ id: "L1", name: "Groceries" }]);
    expect(body).toMatchObject({ total: 1, totalPages: 1 });
  });

  it("returns an error result when the client throws", async () => {
    const client = {
      async getPaginated<T>(): Promise<PaginatedResult<T>> {
        throw new Error("boom");
      },
    };

    const result = await shoppingListSearchHandler(client, {});

    expect(result.isError).toBe(true);
  });
});

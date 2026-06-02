import { describe, expect, it } from "vitest";
import type { PaginatedResult } from "../../client/pagination.js";
import { cookbookSearchHandler } from "./cookbook-search.js";

type Captured = { path: string; query?: Record<string, unknown> | undefined };

function fakeClient(page: PaginatedResult<unknown>, captured: Captured[]) {
  return {
    async getPaginated<T>(path: string, query?: Record<string, unknown>): Promise<PaginatedResult<T>> {
      captured.push({ path, query });
      return page as PaginatedResult<T>;
    },
  };
}

const samplePage: PaginatedResult<unknown> = {
  items: [{ id: "u1", slug: "weeknight", name: "Weeknight", queryFilterString: "x" }],
  total: 1,
  page: 1,
  perPage: 20,
  totalPages: 1,
};

describe("cookbookSearchHandler", () => {
  it("applies the default perPage and returns concise items + pagination meta", async () => {
    const captured: Captured[] = [];
    const client = fakeClient(samplePage, captured);

    const result = await cookbookSearchHandler(client, {});

    expect(captured[0]?.path).toBe("/api/households/cookbooks");
    expect(captured[0]?.query?.perPage).toBe(20);
    const body = JSON.parse((result.content[0] as { text: string }).text);
    expect(body.items).toEqual([{ id: "u1", slug: "weeknight", name: "Weeknight" }]);
    expect(body).toMatchObject({ total: 1, page: 1, perPage: 20, totalPages: 1 });
  });

  it("passes queryFilter through to the client", async () => {
    const captured: Captured[] = [];
    const client = fakeClient(samplePage, captured);

    await cookbookSearchHandler(client, { queryFilter: "tags.name = x", perPage: 5 });

    expect(captured[0]?.query?.queryFilter).toBe("tags.name = x");
    expect(captured[0]?.query?.perPage).toBe(5);
  });

  it("returns an error result when the client throws", async () => {
    const client = {
      async getPaginated<T>(): Promise<PaginatedResult<T>> {
        throw new Error("boom");
      },
    };

    const result = await cookbookSearchHandler(client, {});

    expect(result.isError).toBe(true);
  });
});

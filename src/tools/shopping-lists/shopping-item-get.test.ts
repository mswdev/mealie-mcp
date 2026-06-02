import { describe, expect, it } from "vitest";
import type { PaginatedResult } from "../../client/pagination.js";
import { shoppingItemGetHandler } from "./shopping-item-get.js";

type Captured = { method: string; path: string };

function fakeClient(captured: Captured[]) {
  return {
    async get<T>(path: string): Promise<T> {
      captured.push({ method: "GET", path });
      return { id: "i1", display: "2 eggs" } as T;
    },
    async getPaginated<T>(path: string): Promise<PaginatedResult<T>> {
      captured.push({ method: "GET_PAGINATED", path });
      return { items: [], total: 0, page: 1, perPage: 20, totalPages: 0 };
    },
  };
}

describe("shoppingItemGetHandler", () => {
  it("lists items (paginated) by default", async () => {
    const captured: Captured[] = [];

    await shoppingItemGetHandler(fakeClient(captured), {});

    expect(captured[0]).toEqual({ method: "GET_PAGINATED", path: "/api/households/shopping/items" });
  });

  it("gets one item by id", async () => {
    const captured: Captured[] = [];

    await shoppingItemGetHandler(fakeClient(captured), { action: "get", itemId: "i1" });

    expect(captured[0]).toEqual({ method: "GET", path: "/api/households/shopping/items/i1" });
  });

  it("errors when get is missing itemId", async () => {
    const result = await shoppingItemGetHandler(fakeClient([]), { action: "get" });

    expect(result.isError).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import type { PaginatedResult } from "../../client/pagination.js";
import { mealplanRulesHandler } from "./mealplan-rules.js";

type Captured = { method: string; path: string };

function fakeClient(captured: Captured[]) {
  return {
    async get<T>(path: string): Promise<T> {
      captured.push({ method: "GET", path });
      return { id: "rule-1", day: "monday", entryType: "dinner" } as T;
    },
    async getPaginated<T>(path: string): Promise<PaginatedResult<T>> {
      captured.push({ method: "GET_PAGINATED", path });
      return { items: [], total: 0, page: 1, perPage: 20, totalPages: 0 };
    },
  };
}

describe("mealplanRulesHandler", () => {
  it("lists rules (paginated) by default", async () => {
    const captured: Captured[] = [];

    await mealplanRulesHandler(fakeClient(captured), {});

    expect(captured[0]).toEqual({
      method: "GET_PAGINATED",
      path: "/api/households/mealplans/rules",
    });
  });

  it("gets one rule by id", async () => {
    const captured: Captured[] = [];

    await mealplanRulesHandler(fakeClient(captured), { action: "get", ruleId: "rule-1" });

    expect(captured[0]).toEqual({ method: "GET", path: "/api/households/mealplans/rules/rule-1" });
  });

  it("errors when get is missing ruleId", async () => {
    const result = await mealplanRulesHandler(fakeClient([]), { action: "get" });

    expect(result.isError).toBe(true);
  });
});

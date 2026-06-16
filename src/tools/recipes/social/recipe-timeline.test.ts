import { describe, expect, it } from "vitest";
import type { PaginatedResult } from "../../../client/pagination.js";
import { recipeTimelineHandler } from "./recipe-timeline.js";

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

describe("recipeTimelineHandler", () => {
  it("list reads the paginated events with the query filter", async () => {
    const captured: Captured = {};
    await recipeTimelineHandler(
      fakeClient({ items: [], total: 0, page: 1, perPage: 20, totalPages: 0 }, captured),
      { action: "list", queryFilter: 'recipe_id="u1"', perPage: 20 },
    );

    expect(captured.path).toBe("/api/recipes/timeline/events");
    expect(captured.query).toMatchObject({ queryFilter: 'recipe_id="u1"', perPage: 20 });
  });

  it("get reads a single event by id", async () => {
    const captured: Captured = {};
    const result = await recipeTimelineHandler(fakeClient({ id: "e1" }, captured), {
      action: "get",
      eventId: "e1",
    });

    expect(captured.path).toBe("/api/recipes/timeline/events/e1");
    expect(parse(result)).toEqual({ id: "e1" });
  });

  it("get without an eventId returns isError", async () => {
    const result = await recipeTimelineHandler(fakeClient(null, {}), { action: "get" });
    expect(result.isError).toBe(true);
  });
});

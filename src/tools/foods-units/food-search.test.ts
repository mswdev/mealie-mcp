import { describe, expect, it } from "vitest";
import { foodSearchHandler } from "./food-search.js";

type Captured = { path: string; query: unknown };

function fakeClient(captured: Captured[]) {
  return {
    async getPaginated<T>(path: string, query: unknown): Promise<T> {
      captured.push({ path, query });
      return {
        items: [{ id: "f1", name: "Flour", labelId: "l1", aliases: [] }],
        total: 1,
        page: 1,
        perPage: 20,
        totalPages: 1,
      } as T;
    },
  };
}

describe("foodSearchHandler", () => {
  it("lists foods paginated with a default perPage and concise items", async () => {
    const captured: Captured[] = [];

    const result = await foodSearchHandler(fakeClient(captured), { search: "flo" });

    expect(captured[0]?.path).toBe("/api/foods");
    expect(captured[0]?.query).toMatchObject({ search: "flo", perPage: 20 });
    const body = JSON.parse((result.content[0] as { text: string }).text);
    expect(body.items).toEqual([
      { id: "f1", name: "Flour", pluralName: undefined, description: undefined, labelId: "l1" },
    ]);
    expect(body.total).toBe(1);
  });

  it("returns an error result when the client throws", async () => {
    const client = {
      async getPaginated<T>(): Promise<T> {
        throw new Error("401");
      },
    };

    const result = await foodSearchHandler(client, {});

    expect(result.isError).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import { unitSearchHandler } from "./unit-search.js";

type Captured = { path: string; query: unknown };

function fakeClient(captured: Captured[]) {
  return {
    async getPaginated<T>(path: string, query: unknown): Promise<T> {
      captured.push({ path, query });
      return {
        items: [{ id: "u1", name: "tablespoon", abbreviation: "tbsp", fraction: true }],
        total: 1,
        page: 1,
        perPage: 20,
        totalPages: 1,
      } as T;
    },
  };
}

describe("unitSearchHandler", () => {
  it("lists units paginated with a default perPage and concise items", async () => {
    const captured: Captured[] = [];

    const result = await unitSearchHandler(fakeClient(captured), {});

    expect(captured[0]?.path).toBe("/api/units");
    expect(captured[0]?.query).toMatchObject({ perPage: 20 });
    const body = JSON.parse((result.content[0] as { text: string }).text);
    expect(body.items).toEqual([{ id: "u1", name: "tablespoon", abbreviation: "tbsp" }]);
    expect(body).toMatchObject({ total: 1, page: 1, perPage: 20, totalPages: 1 });
  });

  it("returns an error result when the client throws", async () => {
    const client = {
      async getPaginated<T>(): Promise<T> {
        throw new Error("401");
      },
    };

    const result = await unitSearchHandler(client, {});

    expect(result.isError).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import { mealplanTodayHandler } from "./mealplan-today.js";

describe("mealplanTodayHandler", () => {
  it("returns today's meals verbatim", async () => {
    const captured: string[] = [];
    const today = [{ id: 7, entryType: "dinner", recipeId: "r1" }];
    const client = {
      async get<T>(path: string): Promise<T> {
        captured.push(path);
        return today as T;
      },
    };

    const result = await mealplanTodayHandler(client, {});

    expect(captured[0]).toBe("/api/households/mealplans/today");
    const body = JSON.parse((result.content[0] as { text: string }).text);
    expect(body).toEqual(today);
  });

  it("returns an error result when the client throws", async () => {
    const client = {
      async get<T>(): Promise<T> {
        throw new Error("boom");
      },
    };

    const result = await mealplanTodayHandler(client, {});

    expect(result.isError).toBe(true);
  });
});

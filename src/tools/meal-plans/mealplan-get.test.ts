import { describe, expect, it } from "vitest";
import { mealplanGetHandler } from "./mealplan-get.js";

const entry = {
  id: 7,
  date: "2026-06-02",
  entryType: "dinner",
  title: "Pasta",
  text: "",
  recipeId: "r1",
  householdId: "h",
  recipe: { id: "r1", slug: "pasta", name: "Pasta" },
};

function fakeClient(captured: string[]) {
  return {
    async get<T>(path: string): Promise<T> {
      captured.push(path);
      return entry as T;
    },
  };
}

describe("mealplanGetHandler", () => {
  it("fetches by numeric id and returns the concise projection", async () => {
    const captured: string[] = [];

    const result = await mealplanGetHandler(fakeClient(captured), { planId: 7 });

    expect(captured[0]).toBe("/api/households/mealplans/7");
    const body = JSON.parse((result.content[0] as { text: string }).text);
    expect(body).toMatchObject({ id: 7, entryType: "dinner" });
    expect(body).not.toHaveProperty("householdId");
  });

  it("returns the whole entry when detailed", async () => {
    const result = await mealplanGetHandler(fakeClient([]), { planId: 7, response_format: "detailed" });

    const body = JSON.parse((result.content[0] as { text: string }).text);
    expect(body).toHaveProperty("householdId");
  });

  it("returns an error result when the client throws", async () => {
    const client = {
      async get<T>(): Promise<T> {
        throw new Error("404");
      },
    };

    const result = await mealplanGetHandler(client, { planId: 99 });

    expect(result.isError).toBe(true);
  });
});

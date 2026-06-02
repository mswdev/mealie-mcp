import { describe, expect, it } from "vitest";
import { mealplanCreateHandler } from "./mealplan-create.js";

type Captured = { path: string; body: unknown };

function fakeClient(captured: Captured[]) {
  return {
    async post<T>(path: string, body: unknown): Promise<T> {
      captured.push({ path, body });
      return { id: 1, date: "2026-06-02", entryType: "dinner", title: "", text: "" } as T;
    },
  };
}

describe("mealplanCreateHandler", () => {
  it("entry mode posts CreatePlanEntry to /mealplans with recipeId", async () => {
    const captured: Captured[] = [];

    await mealplanCreateHandler(fakeClient(captured), {
      mode: "entry",
      date: "2026-06-02",
      entryType: "dinner",
      recipeId: "r1",
    });

    expect(captured[0]?.path).toBe("/api/households/mealplans");
    expect(captured[0]?.body).toEqual({
      date: "2026-06-02",
      entryType: "dinner",
      title: "",
      text: "",
      recipeId: "r1",
    });
  });

  it("entry mode omits recipeId when not provided", async () => {
    const captured: Captured[] = [];

    await mealplanCreateHandler(fakeClient(captured), { date: "2026-06-02", entryType: "lunch" });

    expect(captured[0]?.body).not.toHaveProperty("recipeId");
  });

  it("random mode posts CreateRandomEntry to /mealplans/random", async () => {
    const captured: Captured[] = [];

    await mealplanCreateHandler(fakeClient(captured), {
      mode: "random",
      date: "2026-06-02",
      entryType: "dinner",
    });

    expect(captured[0]?.path).toBe("/api/households/mealplans/random");
    expect(captured[0]?.body).toEqual({ date: "2026-06-02", entryType: "dinner" });
  });

  it("returns an error result when the client throws", async () => {
    const client = {
      async post<T>(): Promise<T> {
        throw new Error("422");
      },
    };

    const result = await mealplanCreateHandler(client, { date: "2026-06-02", entryType: "dinner" });

    expect(result.isError).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import { recipeActionTriggerHandler } from "./recipe-action-trigger.js";

type Call = { path: string; body: unknown };

function fakeClient(calls: Call[]) {
  return {
    async post<T>(path: string, body: unknown): Promise<T> {
      calls.push({ path, body });
      return undefined as T;
    },
  };
}

function bodyOf(result: { content: unknown[] }): Record<string, unknown> {
  return JSON.parse((result.content[0] as { text: string }).text);
}

describe("recipeActionTriggerHandler", () => {
  it("posts to the two-path-param URL with the supplied recipe_scale", async () => {
    const calls: Call[] = [];

    const result = await recipeActionTriggerHandler(fakeClient(calls), {
      item_id: "a1",
      recipe_slug: "soup",
      recipe_scale: 2,
    });

    expect(calls[0]?.path).toBe("/api/households/recipe-actions/a1/trigger/soup");
    expect(calls[0]?.body).toEqual({ recipe_scale: 2 });
    expect(bodyOf(result)).toEqual({
      ok: true,
      action: "trigger",
      item_id: "a1",
      recipe_slug: "soup",
    });
  });

  it("defaults recipe_scale to 1 when omitted", async () => {
    const calls: Call[] = [];

    await recipeActionTriggerHandler(fakeClient(calls), { item_id: "a1", recipe_slug: "soup" });

    expect(calls[0]?.body).toEqual({ recipe_scale: 1 });
  });

  it("returns an error result when the client throws", async () => {
    const client = {
      async post<T>(): Promise<T> {
        throw new Error("500");
      },
    };

    const result = await recipeActionTriggerHandler(client, { item_id: "a1", recipe_slug: "soup" });

    expect(result.isError).toBe(true);
  });
});

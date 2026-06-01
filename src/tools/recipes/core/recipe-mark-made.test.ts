import { describe, expect, it } from "vitest";
import { recipeMarkMadeHandler } from "./recipe-mark-made.js";

type Captured = { path?: string; body?: unknown };

function fakeClient(captured: Captured) {
  return {
    patch: async <T>(path: string, body: unknown): Promise<T> => {
      captured.path = path;
      captured.body = body;
      return undefined as T;
    },
  };
}

function parse(r: { content: { type: string }[] }): Record<string, unknown> {
  return JSON.parse((r.content[0] as { type: "text"; text: string }).text);
}

describe("recipeMarkMadeHandler", () => {
  it("patches the last-made timestamp and returns a confirmation", async () => {
    const captured: Captured = {};

    const result = await recipeMarkMadeHandler(fakeClient(captured), {
      slug: "soup",
      timestamp: "2026-06-01T00:00:00Z",
    });

    expect(captured.path).toBe("/api/recipes/soup/last-made");
    expect(captured.body).toEqual({ timestamp: "2026-06-01T00:00:00Z" });
    expect(parse(result)).toEqual({ slug: "soup", lastMade: "2026-06-01T00:00:00Z" });
  });

  it("returns isError when the client throws", async () => {
    const client = {
      patch: async <T>(): Promise<T> => {
        throw new Error("nope");
      },
    };

    const result = await recipeMarkMadeHandler(client, {
      slug: "soup",
      timestamp: "2026-06-01T00:00:00Z",
    });

    expect(result.isError).toBe(true);
  });
});

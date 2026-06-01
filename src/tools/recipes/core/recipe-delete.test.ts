import { describe, expect, it } from "vitest";
import { recipeDeleteHandler } from "./recipe-delete.js";

function fakeClient(captured: { called: boolean; path?: string }) {
  return {
    delete: async <T>(path: string): Promise<T> => {
      captured.called = true;
      captured.path = path;
      return undefined as T;
    },
  };
}

function parse(r: { content: { type: string }[] }): Record<string, unknown> {
  return JSON.parse((r.content[0] as { type: "text"; text: string }).text);
}

describe("recipeDeleteHandler", () => {
  it("refuses without confirm and does not call delete", async () => {
    const captured = { called: false };

    const result = await recipeDeleteHandler(fakeClient(captured), { slug: "soup" });

    expect(result.isError).toBe(true);
    expect(captured.called).toBe(false);
    expect((result.content[0] as { text: string }).text).toContain("confirm: true");
  });

  it("deletes when confirmed and returns a confirmation", async () => {
    const captured: { called: boolean; path?: string } = { called: false };

    const result = await recipeDeleteHandler(fakeClient(captured), { slug: "soup", confirm: true });

    expect(captured.called).toBe(true);
    expect(captured.path).toBe("/api/recipes/soup");
    expect(parse(result)).toEqual({ deleted: "soup" });
  });

  it("returns isError when the client throws", async () => {
    const client = {
      delete: async <T>(): Promise<T> => {
        throw new Error("nope");
      },
    };

    const result = await recipeDeleteHandler(client, { slug: "soup", confirm: true });

    expect(result.isError).toBe(true);
  });
});

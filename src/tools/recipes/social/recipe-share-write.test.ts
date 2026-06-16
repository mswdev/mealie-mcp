import { describe, expect, it } from "vitest";
import { recipeShareWriteHandler } from "./recipe-share-write.js";

type Captured = { path?: string; body?: unknown; method?: string };

function fakeClient(captured: Captured) {
  return {
    post: async <T>(path: string, body: unknown): Promise<T> => {
      captured.path = path;
      captured.body = body;
      captured.method = "POST";
      return { id: "t1" } as T;
    },
    delete: async <T>(path: string): Promise<T> => {
      captured.path = path;
      captured.method = "DELETE";
      return undefined as T;
    },
  };
}

function parse(r: { content: { type: string }[] }): Record<string, unknown> {
  return JSON.parse((r.content[0] as { type: "text"; text: string }).text);
}

describe("recipeShareWriteHandler", () => {
  it("create posts the recipeId and optional expiry", async () => {
    const captured: Captured = {};
    await recipeShareWriteHandler(fakeClient(captured), {
      action: "create",
      recipeId: "u1",
      expiresAt: "2026-07-01T00:00:00Z",
    });

    expect(captured.method).toBe("POST");
    expect(captured.path).toBe("/api/shared/recipes");
    expect(captured.body).toEqual({ recipeId: "u1", expiresAt: "2026-07-01T00:00:00Z" });
  });

  it("revoke requires confirm", async () => {
    const captured: Captured = {};
    const result = await recipeShareWriteHandler(fakeClient(captured), {
      action: "revoke",
      tokenId: "t1",
    });

    expect(result.isError).toBe(true);
    expect(captured.method).toBeUndefined();
  });

  it("revoke deletes the token when confirmed", async () => {
    const captured: Captured = {};
    const result = await recipeShareWriteHandler(fakeClient(captured), {
      action: "revoke",
      tokenId: "t1",
      confirm: true,
    });

    expect(captured.method).toBe("DELETE");
    expect(captured.path).toBe("/api/shared/recipes/t1");
    expect(parse(result)).toEqual({ revoked: "t1" });
  });

  it("create without recipeId returns isError", async () => {
    const result = await recipeShareWriteHandler(fakeClient({}), { action: "create" });
    expect(result.isError).toBe(true);
  });
});

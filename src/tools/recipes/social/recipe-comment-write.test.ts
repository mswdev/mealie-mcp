import { describe, expect, it } from "vitest";
import { recipeCommentWriteHandler } from "./recipe-comment-write.js";

type Captured = { path?: string; body?: unknown; method?: string };

function fakeClient(captured: Captured) {
  return {
    post: async <T>(path: string, body: unknown): Promise<T> => {
      captured.path = path;
      captured.body = body;
      captured.method = "POST";
      return { id: "c1" } as T;
    },
    put: async <T>(path: string, body: unknown): Promise<T> => {
      captured.path = path;
      captured.body = body;
      captured.method = "PUT";
      return { id: "c1" } as T;
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

describe("recipeCommentWriteHandler", () => {
  it("create posts the recipeId + text", async () => {
    const captured: Captured = {};
    await recipeCommentWriteHandler(fakeClient(captured), {
      action: "create",
      recipeId: "u1",
      text: "yum",
    });

    expect(captured.method).toBe("POST");
    expect(captured.path).toBe("/api/comments");
    expect(captured.body).toEqual({ recipeId: "u1", text: "yum" });
  });

  it("update puts the id + text", async () => {
    const captured: Captured = {};
    await recipeCommentWriteHandler(fakeClient(captured), {
      action: "update",
      commentId: "c1",
      text: "edited",
    });

    expect(captured.method).toBe("PUT");
    expect(captured.path).toBe("/api/comments/c1");
    expect(captured.body).toEqual({ id: "c1", text: "edited" });
  });

  it("delete requires confirm", async () => {
    const captured: Captured = {};
    const result = await recipeCommentWriteHandler(fakeClient(captured), {
      action: "delete",
      commentId: "c1",
    });

    expect(result.isError).toBe(true);
    expect(captured.method).toBeUndefined();
  });

  it("delete removes the comment when confirmed", async () => {
    const captured: Captured = {};
    const result = await recipeCommentWriteHandler(fakeClient(captured), {
      action: "delete",
      commentId: "c1",
      confirm: true,
    });

    expect(captured.method).toBe("DELETE");
    expect(parse(result)).toEqual({ deleted: "c1" });
  });

  it("create without text returns isError", async () => {
    const result = await recipeCommentWriteHandler(fakeClient({}), {
      action: "create",
      recipeId: "u1",
    });
    expect(result.isError).toBe(true);
  });
});

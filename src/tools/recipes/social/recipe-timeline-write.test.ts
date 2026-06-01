import { describe, expect, it } from "vitest";
import { recipeTimelineWriteHandler } from "./recipe-timeline-write.js";

type Captured = { path?: string; body?: unknown; method?: string | undefined; form?: FormData };

function fakeClient(captured: Captured) {
  return {
    post: async <T>(path: string, body: unknown): Promise<T> => {
      captured.path = path;
      captured.body = body;
      captured.method = "POST";
      return { id: "e1" } as T;
    },
    put: async <T>(path: string, body: unknown): Promise<T> => {
      captured.path = path;
      captured.body = body;
      captured.method = "PUT";
      return { id: "e1" } as T;
    },
    delete: async <T>(path: string): Promise<T> => {
      captured.path = path;
      captured.method = "DELETE";
      return undefined as T;
    },
    postMultipart: async <T>(
      path: string,
      form: FormData,
      _q?: unknown,
      method?: string,
    ): Promise<T> => {
      captured.path = path;
      captured.form = form;
      captured.method = method;
      return { image: "abc" } as T;
    },
  };
}

function parse(r: { content: { type: string }[] }): Record<string, unknown> {
  return JSON.parse((r.content[0] as { type: "text"; text: string }).text);
}

describe("recipeTimelineWriteHandler", () => {
  it("create posts an event with subject + type", async () => {
    const captured: Captured = {};
    await recipeTimelineWriteHandler(fakeClient(captured), {
      action: "create",
      recipeId: "u1",
      subject: "Made it",
      eventType: "info",
    });

    expect(captured.method).toBe("POST");
    expect(captured.path).toBe("/api/recipes/timeline/events");
    expect(captured.body).toMatchObject({ recipeId: "u1", subject: "Made it", eventType: "info" });
  });

  it("update puts the subject", async () => {
    const captured: Captured = {};
    await recipeTimelineWriteHandler(fakeClient(captured), {
      action: "update",
      eventId: "e1",
      subject: "Edited",
    });

    expect(captured.method).toBe("PUT");
    expect(captured.path).toBe("/api/recipes/timeline/events/e1");
    expect(captured.body).toMatchObject({ subject: "Edited" });
  });

  it("delete requires confirm", async () => {
    const captured: Captured = {};
    const result = await recipeTimelineWriteHandler(fakeClient(captured), {
      action: "delete",
      eventId: "e1",
    });

    expect(result.isError).toBe(true);
    expect(captured.method).toBeUndefined();
  });

  it("delete removes the event when confirmed", async () => {
    const captured: Captured = {};
    const result = await recipeTimelineWriteHandler(fakeClient(captured), {
      action: "delete",
      eventId: "e1",
      confirm: true,
    });

    expect(captured.method).toBe("DELETE");
    expect(parse(result)).toEqual({ deleted: "e1" });
  });

  it("set_image uploads via multipart PUT", async () => {
    const captured: Captured = {};
    const file = new Blob([new Uint8Array([1])]);
    await recipeTimelineWriteHandler(
      fakeClient(captured),
      { action: "set_image", eventId: "e1", extension: "jpg" },
      file,
    );

    expect(captured.path).toBe("/api/recipes/timeline/events/e1/image");
    expect(captured.method).toBe("PUT");
    expect(captured.form?.get("extension")).toBe("jpg");
  });

  it("create without subject returns isError", async () => {
    const result = await recipeTimelineWriteHandler(fakeClient({}), {
      action: "create",
      recipeId: "u1",
      eventType: "info",
    });
    expect(result.isError).toBe(true);
  });
});

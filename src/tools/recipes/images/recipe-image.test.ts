import { describe, expect, it } from "vitest";
import { recipeImageHandler } from "./recipe-image.js";

type Captured = {
  path?: string;
  body?: unknown;
  form?: FormData;
  method?: string | undefined;
  deleted?: boolean;
};

function fakeClient(captured: Captured) {
  return {
    post: async <T>(path: string, body: unknown): Promise<T> => {
      captured.path = path;
      captured.body = body;
      return undefined as T;
    },
    delete: async <T>(path: string): Promise<T> => {
      captured.path = path;
      captured.deleted = true;
      return undefined as T;
    },
    postMultipart: async <T>(
      path: string,
      form: FormData,
      _query?: unknown,
      method?: string,
    ): Promise<T> => {
      captured.path = path;
      captured.form = form;
      captured.method = method;
      return { image: "abc.webp" } as T;
    },
  };
}

function parse(r: { content: { type: string }[] }): Record<string, unknown> {
  return JSON.parse((r.content[0] as { type: "text"; text: string }).text);
}

describe("recipeImageHandler", () => {
  it("uploads a file via multipart PUT", async () => {
    const captured: Captured = {};
    const file = new Blob([new Uint8Array([1])]);

    const result = await recipeImageHandler(
      fakeClient(captured),
      { slug: "soup", action: "upload", extension: "jpg" },
      file,
    );

    expect(captured.path).toBe("/api/recipes/soup/image");
    expect(captured.method).toBe("PUT");
    expect(captured.form?.get("image")).toBeInstanceOf(Blob);
    expect(captured.form?.get("extension")).toBe("jpg");
    expect(parse(result)).toEqual({ image: "abc.webp" });
  });

  it("set_url posts the scrape body and echoes the source url", async () => {
    const captured: Captured = {};

    const result = await recipeImageHandler(fakeClient(captured), {
      slug: "soup",
      action: "set_url",
      url: "https://img.test/a.jpg",
    });

    expect(captured.path).toBe("/api/recipes/soup/image");
    expect(captured.body).toEqual({
      url: "https://img.test/a.jpg",
      includeTags: false,
      includeCategories: false,
    });
    expect(parse(result)).toEqual({ slug: "soup", imageSource: "https://img.test/a.jpg" });
  });

  it("delete requires confirm", async () => {
    const captured: Captured = {};

    const result = await recipeImageHandler(fakeClient(captured), {
      slug: "soup",
      action: "delete",
    });

    expect(result.isError).toBe(true);
    expect(captured.deleted).toBeUndefined();
  });

  it("delete removes the image when confirmed", async () => {
    const captured: Captured = {};

    const result = await recipeImageHandler(fakeClient(captured), {
      slug: "soup",
      action: "delete",
      confirm: true,
    });

    expect(captured.deleted).toBe(true);
    expect(parse(result)).toEqual({ slug: "soup", imageDeleted: true });
  });

  it("upload without a file returns isError", async () => {
    const result = await recipeImageHandler(fakeClient({}), {
      slug: "soup",
      action: "upload",
      extension: "jpg",
    });

    expect(result.isError).toBe(true);
  });

  it("upload without an extension returns isError", async () => {
    const file = new Blob([new Uint8Array([1])]);
    const result = await recipeImageHandler(
      fakeClient({}),
      { slug: "soup", action: "upload" },
      file,
    );

    expect(result.isError).toBe(true);
  });

  it("returns isError when the client throws", async () => {
    const client = {
      post: async <T>(): Promise<T> => {
        throw new Error("nope");
      },
      delete: async <T>(): Promise<T> => undefined as T,
      postMultipart: async <T>(): Promise<T> => undefined as T,
    };

    const result = await recipeImageHandler(client, {
      slug: "soup",
      action: "set_url",
      url: "https://x.test/a.jpg",
    });

    expect(result.isError).toBe(true);
  });
});

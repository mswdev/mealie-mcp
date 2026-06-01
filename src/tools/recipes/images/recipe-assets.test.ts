import { describe, expect, it } from "vitest";
import { recipeAssetsHandler } from "./recipe-assets.js";

type Captured = { path?: string; form?: FormData };

function fakeClient(captured: Captured) {
  return {
    postMultipart: async <T>(path: string, form: FormData): Promise<T> => {
      captured.path = path;
      captured.form = form;
      return { name: "Doc", icon: "mdi-file", fileName: "doc.pdf" } as T;
    },
  };
}

function parse(r: { content: { type: string }[] }): Record<string, unknown> {
  return JSON.parse((r.content[0] as { type: "text"; text: string }).text);
}

describe("recipeAssetsHandler", () => {
  it("uploads the asset with all form fields", async () => {
    const captured: Captured = {};
    const file = new Blob([new Uint8Array([1, 2])]);

    const result = await recipeAssetsHandler(
      fakeClient(captured),
      { slug: "soup", name: "Doc", extension: "pdf" },
      file,
    );

    expect(captured.path).toBe("/api/recipes/soup/assets");
    expect(captured.form?.get("file")).toBeInstanceOf(Blob);
    expect(captured.form?.get("name")).toBe("Doc");
    expect(captured.form?.get("icon")).toBe("mdi-file");
    expect(captured.form?.get("extension")).toBe("pdf");
    expect(parse(result).fileName).toBe("doc.pdf");
  });

  it("returns isError when no file is provided", async () => {
    const result = await recipeAssetsHandler(fakeClient({}), {
      slug: "soup",
      name: "Doc",
      extension: "pdf",
    });

    expect(result.isError).toBe(true);
  });

  it("returns isError when the client throws", async () => {
    const client = {
      postMultipart: async <T>(): Promise<T> => {
        throw new Error("nope");
      },
    };

    const result = await recipeAssetsHandler(
      client,
      { slug: "soup", name: "Doc", extension: "pdf" },
      new Blob([new Uint8Array([1])]),
    );

    expect(result.isError).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import { recipeMediaHandler } from "./recipe-media.js";

const client = { baseUrl: "https://m.test" };

function parse(r: { content: { type: string }[] }): Record<string, unknown> {
  return JSON.parse((r.content[0] as { type: "text"; text: string }).text);
}

describe("recipeMediaHandler", () => {
  it("builds an image reference URL with the default filename", async () => {
    const result = await recipeMediaHandler(client, { recipeId: "u1" });

    expect(parse(result)).toEqual({
      url: "https://m.test/api/media/recipes/u1/images/original.webp",
    });
  });

  it("builds an image URL for a specific image type", async () => {
    const result = await recipeMediaHandler(client, {
      recipeId: "u1",
      kind: "image",
      fileName: "tiny-original.webp",
    });

    expect(parse(result).url).toBe("https://m.test/api/media/recipes/u1/images/tiny-original.webp");
  });

  it("builds an asset reference URL", async () => {
    const result = await recipeMediaHandler(client, {
      recipeId: "u1",
      kind: "asset",
      fileName: "doc.pdf",
    });

    expect(parse(result).url).toBe("https://m.test/api/media/recipes/u1/assets/doc.pdf");
  });

  it("returns isError when an asset is requested without a fileName", async () => {
    const result = await recipeMediaHandler(client, { recipeId: "u1", kind: "asset" });

    expect(result.isError).toBe(true);
  });
});

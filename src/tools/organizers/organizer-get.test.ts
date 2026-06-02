import { describe, expect, it } from "vitest";
import { organizerGetHandler } from "./organizer-get.js";

function fakeClient(paths: string[]) {
  return {
    async get<T>(path: string): Promise<T> {
      paths.push(path);
      return { id: "u1", slug: "quick", name: "Quick", recipes: [{}] } as T;
    },
  };
}

describe("organizerGetHandler", () => {
  it("gets by id at the item path and projects concise", async () => {
    const paths: string[] = [];

    const result = await organizerGetHandler(fakeClient(paths), { type: "tool", id: "u1" });

    expect(paths).toEqual(["/api/organizers/tools/u1"]);
    const body = JSON.parse((result.content[0] as { text: string }).text);
    expect(body).toEqual({ id: "u1", slug: "quick", name: "Quick" });
  });

  it("gets by slug when by_slug is set", async () => {
    const paths: string[] = [];

    await organizerGetHandler(fakeClient(paths), { type: "category", id: "quick", by_slug: true });

    expect(paths).toEqual(["/api/organizers/categories/slug/quick"]);
  });

  it("detailed returns the full object", async () => {
    const result = await organizerGetHandler(fakeClient([]), {
      type: "tag",
      id: "u1",
      response_format: "detailed",
    });

    const body = JSON.parse((result.content[0] as { text: string }).text);
    expect(body.recipes).toBeDefined();
  });

  it("returns an error result when the client throws", async () => {
    const client = {
      async get<T>(): Promise<T> {
        throw new Error("404");
      },
    };

    const result = await organizerGetHandler(client, { type: "tag", id: "x" });

    expect(result.isError).toBe(true);
  });
});

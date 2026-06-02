import { describe, expect, it } from "vitest";
import { organizerCreateHandler } from "./organizer-create.js";

type Captured = { path: string; body: unknown };

function fakeClient(captured: Captured[]) {
  return {
    async post<T>(path: string, body: unknown): Promise<T> {
      captured.push({ path, body });
      return { id: "u1", slug: "quick", name: (body as { name: string }).name } as T;
    },
  };
}

describe("organizerCreateHandler", () => {
  it("posts a bare { name } for category/tag to the typed path", async () => {
    const captured: Captured[] = [];

    const result = await organizerCreateHandler(fakeClient(captured), {
      type: "category",
      name: "Quick",
    });

    expect(captured[0]?.path).toBe("/api/organizers/categories");
    expect(captured[0]?.body).toEqual({ name: "Quick" });
    const body = JSON.parse((result.content[0] as { text: string }).text);
    expect(body).toEqual({ id: "u1", slug: "quick", name: "Quick" });
  });

  it("posts tool with default householdsWithTool", async () => {
    const captured: Captured[] = [];

    await organizerCreateHandler(fakeClient(captured), { type: "tool", name: "Wok" });

    expect(captured[0]?.path).toBe("/api/organizers/tools");
    expect(captured[0]?.body).toEqual({ name: "Wok", householdsWithTool: [] });
  });

  it("forwards a supplied householdsWithTool", async () => {
    const captured: Captured[] = [];

    await organizerCreateHandler(fakeClient(captured), {
      type: "tool",
      name: "Wok",
      householdsWithTool: ["h1"],
    });

    expect((captured[0]?.body as { householdsWithTool: string[] }).householdsWithTool).toEqual([
      "h1",
    ]);
  });

  it("returns an error result when the client throws", async () => {
    const client = {
      async post<T>(): Promise<T> {
        throw new Error("422");
      },
    };

    const result = await organizerCreateHandler(client, { type: "tag", name: "x" });

    expect(result.isError).toBe(true);
  });
});

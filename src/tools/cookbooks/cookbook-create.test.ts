import { describe, expect, it } from "vitest";
import { cookbookCreateHandler } from "./cookbook-create.js";

type Captured = { path: string; body: unknown };

function fakeClient(captured: Captured[]) {
  return {
    async post<T>(path: string, body: unknown): Promise<T> {
      captured.push({ path, body });
      return { id: "u1", slug: "weeknight", name: (body as { name: string }).name } as T;
    },
  };
}

describe("cookbookCreateHandler", () => {
  it("posts CreateCookBook with defaults filled and returns concise", async () => {
    const captured: Captured[] = [];

    const result = await cookbookCreateHandler(fakeClient(captured), { name: "Weeknight" });

    expect(captured[0]?.path).toBe("/api/households/cookbooks");
    expect(captured[0]?.body).toEqual({
      name: "Weeknight",
      description: "",
      public: false,
      position: 1,
      queryFilterString: "",
    });
    const body = JSON.parse((result.content[0] as { text: string }).text);
    expect(body).toMatchObject({ id: "u1", name: "Weeknight" });
  });

  it("forwards caller-supplied optional fields", async () => {
    const captured: Captured[] = [];

    await cookbookCreateHandler(fakeClient(captured), {
      name: "Quick",
      public: true,
      queryFilterString: "tags.name = quick",
    });

    expect(captured[0]?.body).toMatchObject({
      public: true,
      queryFilterString: "tags.name = quick",
    });
  });

  it("returns an error result when the client throws", async () => {
    const client = {
      async post<T>(): Promise<T> {
        throw new Error("422");
      },
    };

    const result = await cookbookCreateHandler(client, { name: "x" });

    expect(result.isError).toBe(true);
  });
});

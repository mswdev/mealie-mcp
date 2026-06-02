import { describe, expect, it } from "vitest";
import { cookbookGetHandler } from "./cookbook-get.js";

const fullCookbook = {
  id: "u1",
  slug: "weeknight",
  name: "Weeknight",
  description: "d",
  public: false,
  position: 1,
  queryFilterString: "x",
  queryFilter: { huge: true },
};

function fakeClient(captured: string[]) {
  return {
    async get<T>(path: string): Promise<T> {
      captured.push(path);
      return fullCookbook as T;
    },
  };
}

describe("cookbookGetHandler", () => {
  it("returns the concise projection by default", async () => {
    const captured: string[] = [];

    const result = await cookbookGetHandler(fakeClient(captured), { id: "u1" });

    expect(captured[0]).toBe("/api/households/cookbooks/u1");
    const body = JSON.parse((result.content[0] as { text: string }).text);
    expect(body).not.toHaveProperty("queryFilter");
    expect(body).toMatchObject({ id: "u1", name: "Weeknight" });
  });

  it("returns the whole cookbook when detailed", async () => {
    const result = await cookbookGetHandler(fakeClient([]), {
      id: "u1",
      response_format: "detailed",
    });

    const body = JSON.parse((result.content[0] as { text: string }).text);
    expect(body).toHaveProperty("queryFilter");
  });

  it("returns an error result when the client throws", async () => {
    const client = {
      async get<T>(): Promise<T> {
        throw new Error("404");
      },
    };

    const result = await cookbookGetHandler(client, { id: "missing" });

    expect(result.isError).toBe(true);
  });
});

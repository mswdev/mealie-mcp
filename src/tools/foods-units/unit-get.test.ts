import { describe, expect, it } from "vitest";
import { unitGetHandler } from "./unit-get.js";

function fakeClient(paths: string[]) {
  return {
    async get<T>(path: string): Promise<T> {
      paths.push(path);
      return { id: "u1", name: "tablespoon", abbreviation: "tbsp", extras: { a: 1 } } as T;
    },
  };
}

describe("unitGetHandler", () => {
  it("gets the unit by id and projects concise", async () => {
    const paths: string[] = [];

    const result = await unitGetHandler(fakeClient(paths), { id: "u1" });

    expect(paths).toEqual(["/api/units/u1"]);
    const body = JSON.parse((result.content[0] as { text: string }).text);
    expect(body).toMatchObject({ id: "u1", name: "tablespoon", abbreviation: "tbsp" });
    expect(body.extras).toBeUndefined();
  });

  it("detailed returns the whole unit", async () => {
    const result = await unitGetHandler(fakeClient([]), { id: "u1", response_format: "detailed" });

    const body = JSON.parse((result.content[0] as { text: string }).text);
    expect(body.extras).toEqual({ a: 1 });
  });

  it("returns an error result when the client throws", async () => {
    const client = {
      async get<T>(): Promise<T> {
        throw new Error("404");
      },
    };

    const result = await unitGetHandler(client, { id: "x" });

    expect(result.isError).toBe(true);
  });
});

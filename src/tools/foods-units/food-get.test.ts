import { describe, expect, it } from "vitest";
import { foodGetHandler } from "./food-get.js";

function fakeClient(paths: string[]) {
  return {
    async get<T>(path: string): Promise<T> {
      paths.push(path);
      return { id: "f1", name: "Flour", labelId: "l1", extras: { a: 1 } } as T;
    },
  };
}

describe("foodGetHandler", () => {
  it("gets the food by id and projects concise", async () => {
    const paths: string[] = [];

    const result = await foodGetHandler(fakeClient(paths), { id: "f1" });

    expect(paths).toEqual(["/api/foods/f1"]);
    const body = JSON.parse((result.content[0] as { text: string }).text);
    expect(body).toMatchObject({ id: "f1", name: "Flour", labelId: "l1" });
    expect(body.extras).toBeUndefined();
  });

  it("detailed returns the whole food", async () => {
    const result = await foodGetHandler(fakeClient([]), { id: "f1", response_format: "detailed" });

    const body = JSON.parse((result.content[0] as { text: string }).text);
    expect(body.extras).toEqual({ a: 1 });
  });

  it("returns an error result when the client throws", async () => {
    const client = {
      async get<T>(): Promise<T> {
        throw new Error("404");
      },
    };

    const result = await foodGetHandler(client, { id: "x" });

    expect(result.isError).toBe(true);
  });
});

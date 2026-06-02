import { describe, expect, it } from "vitest";
import { foodDeleteHandler } from "./food-delete.js";

describe("foodDeleteHandler", () => {
  it("refuses without confirm and makes no client call", async () => {
    let called = false;
    const client = {
      async delete<T>(): Promise<T> {
        called = true;
        return undefined as T;
      },
    };

    const result = await foodDeleteHandler(client, { id: "f1" });

    expect(result.isError).toBe(true);
    expect(called).toBe(false);
  });

  it("deletes the food path when confirmed", async () => {
    const paths: string[] = [];
    const client = {
      async delete<T>(path: string): Promise<T> {
        paths.push(path);
        return undefined as T;
      },
    };

    const result = await foodDeleteHandler(client, { id: "f1", confirm: true });

    expect(paths).toEqual(["/api/foods/f1"]);
    const body = JSON.parse((result.content[0] as { text: string }).text);
    expect(body).toEqual({ deleted: "f1" });
  });

  it("returns an error result when the client throws", async () => {
    const client = {
      async delete<T>(): Promise<T> {
        throw new Error("409");
      },
    };

    const result = await foodDeleteHandler(client, { id: "x", confirm: true });

    expect(result.isError).toBe(true);
  });
});

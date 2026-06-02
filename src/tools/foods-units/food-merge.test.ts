import { describe, expect, it } from "vitest";
import { foodMergeHandler } from "./food-merge.js";

type Captured = { path: string; body: unknown };

function fakeClient(captured: Captured[]) {
  return {
    async put<T>(path: string, body: unknown): Promise<T> {
      captured.push({ path, body });
      return { message: "ok" } as T;
    },
  };
}

describe("foodMergeHandler", () => {
  it("refuses without confirm and makes no client call", async () => {
    const captured: Captured[] = [];

    const result = await foodMergeHandler(fakeClient(captured), { fromFood: "a", toFood: "b" });

    expect(result.isError).toBe(true);
    expect(captured).toHaveLength(0);
  });

  it("PUTs MergeFood to /api/foods/merge when confirmed", async () => {
    const captured: Captured[] = [];

    const result = await foodMergeHandler(fakeClient(captured), {
      fromFood: "a",
      toFood: "b",
      confirm: true,
    });

    expect(captured[0]?.path).toBe("/api/foods/merge");
    expect(captured[0]?.body).toEqual({ fromFood: "a", toFood: "b" });
    const body = JSON.parse((result.content[0] as { text: string }).text);
    expect(body).toEqual({ message: "ok" });
  });

  it("returns an error result when the client throws", async () => {
    const client = {
      async put<T>(): Promise<T> {
        throw new Error("409");
      },
    };

    const result = await foodMergeHandler(client, { fromFood: "a", toFood: "b", confirm: true });

    expect(result.isError).toBe(true);
  });
});

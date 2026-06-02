import { describe, expect, it } from "vitest";
import { unitMergeHandler } from "./unit-merge.js";

type Captured = { path: string; body: unknown };

function fakeClient(captured: Captured[]) {
  return {
    async put<T>(path: string, body: unknown): Promise<T> {
      captured.push({ path, body });
      return { message: "ok" } as T;
    },
  };
}

describe("unitMergeHandler", () => {
  it("refuses without confirm and makes no client call", async () => {
    const captured: Captured[] = [];

    const result = await unitMergeHandler(fakeClient(captured), { fromUnit: "a", toUnit: "b" });

    expect(result.isError).toBe(true);
    expect(captured).toHaveLength(0);
  });

  it("PUTs MergeUnit to /api/units/merge when confirmed", async () => {
    const captured: Captured[] = [];

    const result = await unitMergeHandler(fakeClient(captured), {
      fromUnit: "a",
      toUnit: "b",
      confirm: true,
    });

    expect(captured[0]?.path).toBe("/api/units/merge");
    expect(captured[0]?.body).toEqual({ fromUnit: "a", toUnit: "b" });
    const body = JSON.parse((result.content[0] as { text: string }).text);
    expect(body).toEqual({ message: "ok" });
  });

  it("synthesizes a confirmation when the merge returns no body", async () => {
    const client = {
      async put<T>(): Promise<T> {
        return undefined as T;
      },
    };

    const result = await unitMergeHandler(client, { fromUnit: "a", toUnit: "b", confirm: true });

    const body = JSON.parse((result.content[0] as { text: string }).text);
    expect(body).toEqual({ merged: { from: "a", to: "b" } });
  });

  it("returns an error result when the client throws", async () => {
    const client = {
      async put<T>(): Promise<T> {
        throw new Error("409");
      },
    };

    const result = await unitMergeHandler(client, { fromUnit: "a", toUnit: "b", confirm: true });

    expect(result.isError).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import { groupSeedHandler } from "./group-seed.js";

type Call = { method: string; path: string; body?: unknown };

function fakeClient(response: unknown) {
  const calls: Call[] = [];
  return {
    calls,
    async post<T>(path: string, body: unknown): Promise<T> {
      calls.push({ method: "POST", path, body });
      return response as T;
    },
  };
}

describe("groupSeedHandler", () => {
  it("seeds foods with the locale body", async () => {
    const client = fakeClient({ message: "seeded", error: false });

    const result = await groupSeedHandler(client, { target: "foods", locale: "en-US" });

    expect(client.calls[0]).toEqual({
      method: "POST",
      path: "/api/groups/seeders/foods",
      body: { locale: "en-US" },
    });
    expect(result.isError).toBeFalsy();
  });

  it("routes labels and units to their endpoints", async () => {
    const labels = fakeClient({ message: "ok", error: false });
    const units = fakeClient({ message: "ok", error: false });

    await groupSeedHandler(labels, { target: "labels", locale: "en-US" });
    await groupSeedHandler(units, { target: "units", locale: "en-US" });

    expect(labels.calls[0]?.path).toBe("/api/groups/seeders/labels");
    expect(units.calls[0]?.path).toBe("/api/groups/seeders/units");
  });

  it("treats error:true on a 200 as a failure", async () => {
    const client = fakeClient({ message: "bad locale", error: true });

    const result = await groupSeedHandler(client, { target: "foods", locale: "xx" });

    expect(result.isError).toBe(true);
  });

  it("rejects when locale is missing", async () => {
    const result = await groupSeedHandler(fakeClient({}), { target: "foods" });

    expect(result.isError).toBe(true);
  });

  it("returns an error result when the client throws", async () => {
    const client = {
      async post<T>(): Promise<T> {
        throw new Error("boom");
      },
    };

    const result = await groupSeedHandler(client, { target: "foods", locale: "en-US" });

    expect(result.isError).toBe(true);
  });
});

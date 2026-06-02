import { describe, expect, it } from "vitest";
import { unitUpdateHandler } from "./unit-update.js";

type Call = { method: string; path: string; body: unknown };

function fakeClient(current: unknown) {
  const calls: Call[] = [];
  return {
    calls,
    async get<T>(path: string): Promise<T> {
      calls.push({ method: "GET", path, body: undefined });
      return current as T;
    },
    async put<T>(path: string, body: unknown): Promise<T> {
      calls.push({ method: "PUT", path, body });
      return { ...(current as object), ...(body as object) } as T;
    },
  };
}

describe("unitUpdateHandler", () => {
  it("fetch-merges changes and preserves required-with-default fields (no silent reset)", async () => {
    const client = fakeClient({
      id: "u1",
      name: "tablespoon",
      fraction: true,
      abbreviation: "tbsp",
      useAbbreviation: true,
      aliases: [{ name: "T" }],
    });

    await unitUpdateHandler(client, { id: "u1", changes: { name: "Tablespoon" } });

    expect(client.calls[0]).toMatchObject({ method: "GET", path: "/api/units/u1" });
    const putBody = client.calls[1]?.body as Record<string, unknown>;
    expect(putBody.name).toBe("Tablespoon");
    expect(putBody.abbreviation).toBe("tbsp");
    expect(putBody.useAbbreviation).toBe(true);
    expect(putBody.aliases).toEqual([{ name: "T" }]);
  });

  it("returns an error result when the client throws", async () => {
    const client = {
      async get<T>(): Promise<T> {
        throw new Error("404");
      },
      async put<T>(): Promise<T> {
        throw new Error("unused");
      },
    };

    const result = await unitUpdateHandler(client, { id: "x", changes: { name: "y" } });

    expect(result.isError).toBe(true);
  });
});

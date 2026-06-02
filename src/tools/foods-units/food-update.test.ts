import { describe, expect, it } from "vitest";
import { foodUpdateHandler } from "./food-update.js";

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

describe("foodUpdateHandler", () => {
  it("fetch-merges changes and preserves required-with-default fields (no silent reset)", async () => {
    const client = fakeClient({
      id: "f1",
      name: "Flour",
      description: "old",
      extras: { k: 1 },
      aliases: [{ name: "plain flour" }],
      householdsWithIngredientFood: ["h1"],
    });

    await foodUpdateHandler(client, { id: "f1", changes: { name: "Bread Flour" } });

    expect(client.calls[0]).toMatchObject({ method: "GET", path: "/api/foods/f1" });
    const putBody = client.calls[1]?.body as Record<string, unknown>;
    expect(putBody.name).toBe("Bread Flour");
    expect(putBody.aliases).toEqual([{ name: "plain flour" }]);
    expect(putBody.householdsWithIngredientFood).toEqual(["h1"]);
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

    const result = await foodUpdateHandler(client, { id: "x", changes: { name: "y" } });

    expect(result.isError).toBe(true);
  });
});

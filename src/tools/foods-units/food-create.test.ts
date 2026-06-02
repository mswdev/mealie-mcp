import { describe, expect, it } from "vitest";
import { foodCreateHandler } from "./food-create.js";

type Captured = { path: string; body: unknown };

function fakeClient(captured: Captured[]) {
  return {
    async post<T>(path: string, body: unknown): Promise<T> {
      captured.push({ path, body });
      return { id: "f1", name: (body as { name: string }).name } as T;
    },
  };
}

describe("foodCreateHandler", () => {
  it("posts CreateIngredientFood with required-with-default fields filled", async () => {
    const captured: Captured[] = [];

    const result = await foodCreateHandler(fakeClient(captured), { name: "Flour" });

    expect(captured[0]?.path).toBe("/api/foods");
    expect(captured[0]?.body).toEqual({
      name: "Flour",
      description: "",
      extras: {},
      aliases: [],
      householdsWithIngredientFood: [],
    });
    const body = JSON.parse((result.content[0] as { text: string }).text);
    expect(body).toMatchObject({ id: "f1", name: "Flour" });
  });

  it("includes optional pluralName/labelId only when provided", async () => {
    const captured: Captured[] = [];

    await foodCreateHandler(fakeClient(captured), {
      name: "Flour",
      pluralName: "Flours",
      labelId: "l1",
    });

    expect(captured[0]?.body).toMatchObject({ pluralName: "Flours", labelId: "l1" });
  });

  it("returns an error result when the client throws", async () => {
    const client = {
      async post<T>(): Promise<T> {
        throw new Error("422");
      },
    };

    const result = await foodCreateHandler(client, { name: "x" });

    expect(result.isError).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import { unitCreateHandler } from "./unit-create.js";

type Captured = { path: string; body: unknown };

function fakeClient(captured: Captured[]) {
  return {
    async post<T>(path: string, body: unknown): Promise<T> {
      captured.push({ path, body });
      return { id: "u1", name: (body as { name: string }).name } as T;
    },
  };
}

describe("unitCreateHandler", () => {
  it("posts CreateIngredientUnit with required-with-default fields filled", async () => {
    const captured: Captured[] = [];

    const result = await unitCreateHandler(fakeClient(captured), { name: "tablespoon" });

    expect(captured[0]?.path).toBe("/api/units");
    expect(captured[0]?.body).toEqual({
      name: "tablespoon",
      description: "",
      extras: {},
      fraction: true,
      abbreviation: "",
      pluralAbbreviation: "",
      useAbbreviation: false,
      aliases: [],
    });
    const body = JSON.parse((result.content[0] as { text: string }).text);
    expect(body).toMatchObject({ id: "u1", name: "tablespoon" });
  });

  it("forwards caller-supplied optional fields", async () => {
    const captured: Captured[] = [];

    await unitCreateHandler(fakeClient(captured), {
      name: "tablespoon",
      abbreviation: "tbsp",
      useAbbreviation: true,
      fraction: false,
      pluralName: "tablespoons",
    });

    expect(captured[0]?.body).toMatchObject({
      abbreviation: "tbsp",
      useAbbreviation: true,
      fraction: false,
      pluralName: "tablespoons",
    });
  });

  it("returns an error result when the client throws", async () => {
    const client = {
      async post<T>(): Promise<T> {
        throw new Error("422");
      },
    };

    const result = await unitCreateHandler(client, { name: "x" });

    expect(result.isError).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import type { AppAbout } from "../client/MealieClient.js";
import { getAboutHandler } from "./about.js";

const FAKE_ABOUT = {
  production: true,
  version: "v1.12.0",
  versionLatest: "v1.12.0",
  apiDocs: "/api/docs",
  allowSignup: false,
  enableOidc: false,
  enableLdap: false,
} as unknown as AppAbout;

const fakeClient = {
  getAbout: async (): Promise<AppAbout> => FAKE_ABOUT,
};

/**
 * Extracts the text from the first content item of a tool result.
 * Fails the test if the item is missing or not a text item.
 */
function firstText(content: { type: string }[]): string {
  const first = content[0];
  expect(first).toBeDefined();
  expect(first?.type).toBe("text");
  return (first as { type: "text"; text: string }).text;
}

describe("getAboutHandler", () => {
  it("returns a text content item with JSON-formatted about info", async () => {
    const result = await getAboutHandler(fakeClient);

    expect(result.content).toHaveLength(1);

    const parsed = JSON.parse(firstText(result.content)) as AppAbout;
    expect(parsed.version).toBe("v1.12.0");
    expect(parsed.production).toBe(true);
  });

  it("returns isError when getAbout throws", async () => {
    const errorClient = {
      getAbout: async (): Promise<AppAbout> => {
        throw new Error("connection refused");
      },
    };

    const result = await getAboutHandler(errorClient);

    expect(result.isError).toBe(true);
    expect(firstText(result.content)).toContain("connection refused");
  });
});

import { describe, expect, it } from "vitest";
import { parseAllowedHosts, parseReadOnly, parseToolsets } from "./config.js";

describe("parseReadOnly", () => {
  it.each([
    ["true", true],
    ["1", true],
    ["yes", true],
    ["on", true],
    ["TRUE", true],
    ["  true  ", true],
    ["false", false],
    ["0", false],
    ["", false],
    [undefined, false],
  ])("maps %s -> %s", (input, expected) => {
    expect(parseReadOnly(input)).toBe(expected);
  });
});

describe("parseToolsets", () => {
  it("returns an empty set when unset or empty", () => {
    expect(parseToolsets(undefined).size).toBe(0);
    expect(parseToolsets("").size).toBe(0);
    expect(parseToolsets("  ,  ").size).toBe(0);
  });

  it("enables both recognized toolsets", () => {
    const enabled = parseToolsets("households,automation");

    expect(enabled.has("households")).toBe(true);
    expect(enabled.has("automation")).toBe(true);
    expect(enabled.size).toBe(2);
  });

  it("is case-insensitive, trims whitespace, and de-duplicates", () => {
    const enabled = parseToolsets(" Households , AUTOMATION , households ");

    expect([...enabled].sort()).toEqual(["automation", "households"]);
  });

  it("ignores unknown tokens while keeping valid ones (no throw)", () => {
    const enabled = parseToolsets("households,bogus");

    expect(enabled.has("households")).toBe(true);
    expect(enabled.size).toBe(1);
  });

  it("enables the groups toolset, alone and alongside the others", () => {
    expect(parseToolsets("groups")).toEqual(new Set(["groups"]));
    expect(parseToolsets("households,automation,groups")).toEqual(
      new Set(["households", "automation", "groups"]),
    );
  });

  it("enables the users toolset, alone and alongside the others", () => {
    expect(parseToolsets("users")).toEqual(new Set(["users"]));
    expect(parseToolsets("households,automation,groups,users")).toEqual(
      new Set(["households", "automation", "groups", "users"]),
    );
  });

  it("enables the admin toolset, alone and alongside the others", () => {
    expect(parseToolsets("admin")).toEqual(new Set(["admin"]));
    expect(parseToolsets("households,automation,groups,users,admin")).toEqual(
      new Set(["households", "automation", "groups", "users", "admin"]),
    );
  });

  it("enables the explore toolset, alone and alongside the others", () => {
    expect(parseToolsets("explore")).toEqual(new Set(["explore"]));
    expect(parseToolsets("households,automation,groups,users,admin,explore")).toEqual(
      new Set(["households", "automation", "groups", "users", "admin", "explore"]),
    );
  });
});

describe("parseAllowedHosts", () => {
  it("returns undefined when unset or effectively empty", () => {
    expect(parseAllowedHosts(undefined)).toBeUndefined();
    expect(parseAllowedHosts("")).toBeUndefined();
    expect(parseAllowedHosts("  ,  ")).toBeUndefined();
  });

  it("merges configured hosts with the localhost trio (deduped, lowercased, trimmed)", () => {
    const hosts = parseAllowedHosts(" Mealie.Example.com , api.local ");

    expect(hosts).toEqual(
      expect.arrayContaining([
        "mealie.example.com",
        "api.local",
        "localhost",
        "127.0.0.1",
        "[::1]",
      ]),
    );
    expect(hosts).toHaveLength(5);
  });

  it("does not duplicate a localhost entry the user already supplied", () => {
    const hosts = parseAllowedHosts("localhost,mealie.example.com");

    expect(hosts).toEqual(
      expect.arrayContaining(["localhost", "127.0.0.1", "[::1]", "mealie.example.com"]),
    );
    expect(hosts).toHaveLength(4);
  });
});

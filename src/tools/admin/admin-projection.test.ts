import { describe, expect, it } from "vitest";
import {
  type AdminAbout,
  type AdminAiProvider,
  type AdminGroup,
  type AdminHousehold,
  type AdminUser,
  omitFields,
  pickFields,
  projectAdminAbout,
  projectAdminGroup,
  projectAdminHousehold,
  projectAdminProvider,
  projectAdminUser,
} from "./admin-projection.js";

describe("pickFields", () => {
  it("keeps only the named fields, ignoring names absent from the source", () => {
    const source = { a: 1, b: 2, c: 3 };

    const picked = pickFields(source, ["a", "c", "missing"]);

    expect(picked).toEqual({ a: 1, c: 3 });
  });

  it("returns an empty record for an empty field list", () => {
    expect(pickFields({ a: 1 }, [])).toEqual({});
  });
});

describe("omitFields", () => {
  it("drops only the named fields, leaving nested objects untouched", () => {
    const source = { a: 1, secret: "x", nested: { secret: "kept" } };

    const remaining = omitFields(source, ["secret"]);

    expect(remaining).toEqual({ a: 1, nested: { secret: "kept" } });
  });
});

describe("projectAdminAbout", () => {
  it("redacts dbUrl unconditionally", () => {
    const about = { version: "v2", dbUrl: "postgres://u:p@h/db" } as unknown as AdminAbout;

    const projected = projectAdminAbout(about);

    expect(projected.version).toBe("v2");
    expect("dbUrl" in projected).toBe(false);
  });
});

describe("projectAdminUser", () => {
  const user = {
    id: "u1",
    username: "sam",
    email: "s@x.io",
    groupSlug: "home",
    tokens: [{ id: 1, name: "t" }],
    cacheKey: "ck",
  } as unknown as AdminUser;

  it("concise keeps the token metadata list and drops cacheKey", () => {
    const projected = projectAdminUser(user, "concise");

    expect(projected.tokens).toEqual([{ id: 1, name: "t" }]);
    expect("cacheKey" in projected).toBe(false);
    expect("groupSlug" in projected).toBe(false);
  });

  it("detailed returns everything except cacheKey", () => {
    const projected = projectAdminUser(user, "detailed");

    expect(projected.groupSlug).toBe("home");
    expect("cacheKey" in projected).toBe(false);
  });
});

describe("projectAdminHousehold", () => {
  it("concise trims nested member/webhook lists; detailed keeps them", () => {
    const household = {
      id: "h1",
      name: "Family",
      slug: "family",
      groupId: "g1",
      users: [{ id: "u1" }],
      webhooks: [],
    } as unknown as AdminHousehold;

    expect("users" in projectAdminHousehold(household, "concise")).toBe(false);
    expect(projectAdminHousehold(household, "detailed").users).toEqual([{ id: "u1" }]);
  });
});

describe("projectAdminGroup", () => {
  it("concise trims nested lists; detailed keeps them", () => {
    const group = {
      id: "g1",
      name: "Home",
      slug: "home",
      households: [{ id: "h1" }],
      users: [],
    } as unknown as AdminGroup;

    expect("households" in projectAdminGroup(group, "concise")).toBe(false);
    expect(projectAdminGroup(group, "detailed").households).toEqual([{ id: "h1" }]);
  });
});

describe("projectAdminProvider", () => {
  it("drops an adversarially injected apiKey in BOTH formats", () => {
    const provider = {
      id: "p1",
      name: "OpenAI",
      model: "gpt-4",
      baseUrl: null,
      apiKey: "sk-leak",
    } as unknown as AdminAiProvider;

    expect("apiKey" in projectAdminProvider(provider, "concise")).toBe(false);
    expect("apiKey" in projectAdminProvider(provider, "detailed")).toBe(false);
    expect(projectAdminProvider(provider, "detailed").name).toBe("OpenAI");
  });
});

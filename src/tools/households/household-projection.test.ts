import { describe, expect, it } from "vitest";
import { type Household, projectHousehold } from "./household-projection.js";

const FULL: Household = {
  groupId: "g1",
  name: "Home",
  id: "hh1",
  slug: "home",
  group: "Group",
  webhooks: [],
  preferences: null,
};

describe("projectHousehold", () => {
  it("returns the whole household when detailed", () => {
    expect(projectHousehold(FULL, "detailed")).toEqual(FULL);
  });

  it("trims to id/name/slug/groupId when concise", () => {
    const concise = projectHousehold(FULL, "concise");

    expect(concise).toEqual({ id: "hh1", name: "Home", slug: "home", groupId: "g1" });
    expect(concise).not.toHaveProperty("webhooks");
  });
});

import { describe, expect, it } from "vitest";
import { projectCookbook } from "./cookbook-projection.js";

describe("projectCookbook", () => {
  it("keeps concise fields and drops heavy ones", () => {
    const full = {
      id: "u1",
      slug: "weeknight",
      name: "Weeknight",
      description: "d",
      public: true,
      position: 2,
      queryFilterString: "tags.name = x",
      groupId: "g",
      householdId: "h",
      queryFilter: { huge: true },
    };

    const concise = projectCookbook(full as never, "concise");

    expect(concise).toEqual({
      id: "u1",
      slug: "weeknight",
      name: "Weeknight",
      description: "d",
      public: true,
      position: 2,
      queryFilterString: "tags.name = x",
    });
    expect(concise).not.toHaveProperty("queryFilter");
  });

  it("returns the whole object when detailed", () => {
    const full = { id: "u1", name: "X", queryFilter: { huge: true } };

    expect(projectCookbook(full as never, "detailed")).toBe(full);
  });
});

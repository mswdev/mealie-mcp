import { describe, expect, it } from "vitest";
import { organizerBasePath, projectOrganizer } from "./organizer-projection.js";

describe("organizer-projection", () => {
  it("maps each type to its irregular plural path", () => {
    expect(organizerBasePath("category")).toBe("/api/organizers/categories");
    expect(organizerBasePath("tag")).toBe("/api/organizers/tags");
    expect(organizerBasePath("tool")).toBe("/api/organizers/tools");
  });

  it("concise keeps id/slug/name only", () => {
    const full = { id: "u1", slug: "quick", name: "Quick", groupId: "g1", recipes: [{}] };

    expect(projectOrganizer(full, "concise")).toEqual({ id: "u1", slug: "quick", name: "Quick" });
  });

  it("detailed returns the whole object", () => {
    const full = { id: "u1", slug: "quick", name: "Quick", recipes: [{}] };

    expect(projectOrganizer(full, "detailed")).toBe(full);
  });
});

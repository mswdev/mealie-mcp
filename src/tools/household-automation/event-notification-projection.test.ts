import { describe, expect, it } from "vitest";
import { type EventNotifier, projectEventNotifier } from "./event-notification-projection.js";

const OPTIONS = {
  testMessage: false,
  recipeCreated: true,
  id: "o1",
} as unknown as EventNotifier["options"];

const FULL: EventNotifier = {
  id: "n1",
  name: "Apprise",
  enabled: true,
  groupId: "g1",
  householdId: "h1",
  options: OPTIONS,
};

describe("projectEventNotifier", () => {
  it("returns the whole notifier when detailed", () => {
    expect(projectEventNotifier(FULL, "detailed")).toEqual(FULL);
  });

  it("trims to id/name/enabled and drops options when concise", () => {
    const concise = projectEventNotifier(FULL, "concise");

    expect(concise).toEqual({ id: "n1", name: "Apprise", enabled: true });
    expect(concise).not.toHaveProperty("options");
  });
});

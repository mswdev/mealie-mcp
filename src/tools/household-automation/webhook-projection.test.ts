import { describe, expect, it } from "vitest";
import { type Webhook, projectWebhook } from "./webhook-projection.js";

const FULL: Webhook = {
  enabled: true,
  name: "Nightly",
  url: "https://example.test/hook",
  webhookType: "mealplan",
  scheduledTime: "06:00",
  groupId: "g1",
  householdId: "h1",
  id: "w1",
};

describe("projectWebhook", () => {
  it("returns the whole webhook when detailed", () => {
    expect(projectWebhook(FULL, "detailed")).toEqual(FULL);
  });

  it("trims to the concise fields (drops groupId/householdId)", () => {
    const concise = projectWebhook(FULL, "concise");

    expect(concise).toEqual({
      id: "w1",
      name: "Nightly",
      url: "https://example.test/hook",
      enabled: true,
      webhookType: "mealplan",
      scheduledTime: "06:00",
    });
  });
});

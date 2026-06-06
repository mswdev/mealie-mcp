import { describe, expect, it } from "vitest";
import { adminHouseholdWriteHandler } from "./admin-household-write.js";

type Call = { method: string; path: string; body?: unknown };

function fakeClient(responses: Record<string, unknown> = {}) {
  const calls: Call[] = [];
  return {
    calls,
    async get<T>(path: string): Promise<T> {
      calls.push({ method: "GET", path });
      return responses.get as T;
    },
    async post<T>(path: string, body: unknown): Promise<T> {
      calls.push({ method: "POST", path, body });
      return responses.post as T;
    },
    async put<T>(path: string, body: unknown): Promise<T> {
      calls.push({ method: "PUT", path, body });
      return responses.put as T;
    },
    async delete<T>(path: string): Promise<T> {
      calls.push({ method: "DELETE", path });
      return responses.delete as T;
    },
  };
}

function bodyOf(result: { content: unknown[] }): Record<string, unknown> {
  return JSON.parse((result.content[0] as { text: string }).text);
}

/** The fetched HouseholdInDB — read-side fields the PUT schema does NOT accept. */
const CURRENT_HOUSEHOLD = {
  id: "h1",
  name: "Family",
  slug: "family",
  groupId: "g1",
  group: "Home",
  users: [{ id: "u1" }],
  webhooks: [],
  preferences: {
    id: "p1",
    privateHousehold: true,
    showAnnouncements: true,
    lockRecipeEditsFromOtherHouseholds: true,
    firstDayOfWeek: 0,
    recipePublic: true,
    recipeShowNutrition: false,
    recipeShowAssets: false,
    recipeLandscapeView: false,
    recipeDisableComments: false,
  },
};

describe("adminHouseholdWriteHandler", () => {
  it("creates with name only — no groupId key when unset", async () => {
    const client = fakeClient({ post: CURRENT_HOUSEHOLD });

    const result = await adminHouseholdWriteHandler(client, {
      action: "create",
      name: "Beach House",
    });

    expect(client.calls[0]).toEqual({
      method: "POST",
      path: "/api/admin/households",
      body: { name: "Beach House" },
    });
    expect(bodyOf(result)).toMatchObject({ id: "h1", name: "Family" });
  });

  it("passes group_id through as groupId on create", async () => {
    const client = fakeClient({ post: CURRENT_HOUSEHOLD });

    await adminHouseholdWriteHandler(client, {
      action: "create",
      name: "Beach House",
      group_id: "g2",
    });

    expect(client.calls[0]?.body).toEqual({ name: "Beach House", groupId: "g2" });
  });

  it("updates via UpdateHouseholdAdmin whitelist — id duplicated, read-side fields dropped, prefs omitted when untouched", async () => {
    const client = fakeClient({ get: CURRENT_HOUSEHOLD, put: CURRENT_HOUSEHOLD });

    const result = await adminHouseholdWriteHandler(client, {
      action: "update",
      item_id: "h1",
      changes: { name: "Renamed" },
    });

    expect(client.calls[0]).toEqual({ method: "GET", path: "/api/admin/households/h1" });
    expect(client.calls[1]).toMatchObject({ method: "PUT", path: "/api/admin/households/h1" });
    expect(client.calls[1]?.body).toEqual({ id: "h1", groupId: "g1", name: "Renamed" });
    expect(bodyOf(result)).toMatchObject({ updated: "h1" });
  });

  it("merges and projects nested preferences onto the Update field set when changed", async () => {
    const client = fakeClient({ get: CURRENT_HOUSEHOLD, put: CURRENT_HOUSEHOLD });

    await adminHouseholdWriteHandler(client, {
      action: "update",
      item_id: "h1",
      changes: { preferences: { privateHousehold: false } },
    });

    const sent = client.calls[1]?.body as Record<string, unknown>;
    expect(sent.preferences).toEqual({
      privateHousehold: false,
      showAnnouncements: true,
      lockRecipeEditsFromOtherHouseholds: true,
      firstDayOfWeek: 0,
      recipePublic: true,
      recipeShowNutrition: false,
      recipeShowAssets: false,
      recipeLandscapeView: false,
      recipeDisableComments: false,
    });
  });

  it("refuses update without item_id or changes — no client call", async () => {
    const client = fakeClient();

    const noId = await adminHouseholdWriteHandler(client, { action: "update", changes: {} });
    const noChanges = await adminHouseholdWriteHandler(client, { action: "update", item_id: "h1" });

    expect(noId.isError).toBe(true);
    expect(noChanges.isError).toBe(true);
    expect(client.calls).toHaveLength(0);
  });

  it("refuses delete without confirmation — zero client calls", async () => {
    const client = fakeClient();

    const result = await adminHouseholdWriteHandler(client, { action: "delete", item_id: "h1" });

    expect(result.isError).toBe(true);
    expect(client.calls).toHaveLength(0);
  });

  it("deletes when confirmed", async () => {
    const client = fakeClient({ delete: CURRENT_HOUSEHOLD });

    const result = await adminHouseholdWriteHandler(client, {
      action: "delete",
      item_id: "h1",
      confirm: true,
    });

    expect(client.calls[0]).toEqual({ method: "DELETE", path: "/api/admin/households/h1" });
    expect(bodyOf(result)).toEqual({ deleted: "h1" });
  });

  it("returns an error result when the client throws", async () => {
    const client = {
      ...fakeClient(),
      async post<T>(): Promise<T> {
        throw new Error("boom");
      },
    };

    const result = await adminHouseholdWriteHandler(client, { action: "create", name: "X" });

    expect(result.isError).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import { adminGroupWriteHandler } from "./admin-group-write.js";

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

/** The fetched GroupInDB — read-side fields the PUT schema does NOT accept. */
const CURRENT_GROUP = {
  id: "g1",
  name: "Home",
  slug: "home",
  categories: [],
  webhooks: [],
  households: [{ id: "h1" }],
  users: [{ id: "u1" }],
  preferences: { id: "p1", groupId: "g1", privateGroup: true, showAnnouncements: true },
  aiProviderSettings: {
    defaultProviderId: "p-default",
    audioProviderId: null,
    imageProviderId: "p-img",
    providers: [{ id: "p-default" }],
    chatEnabled: true,
  },
};

describe("adminGroupWriteHandler", () => {
  it("creates with GroupBase — name only", async () => {
    const client = fakeClient({ post: CURRENT_GROUP });

    const result = await adminGroupWriteHandler(client, { action: "create", name: "New Group" });

    expect(client.calls[0]).toEqual({
      method: "POST",
      path: "/api/admin/groups",
      body: { name: "New Group" },
    });
    expect(bodyOf(result)).toMatchObject({ id: "g1", name: "Home" });
  });

  it("updates via GroupAdminUpdate whitelist — read-side lists dropped, optional nests omitted when untouched", async () => {
    const client = fakeClient({ get: CURRENT_GROUP, put: CURRENT_GROUP });

    const result = await adminGroupWriteHandler(client, {
      action: "update",
      item_id: "g1",
      changes: { name: "Renamed" },
    });

    expect(client.calls[0]).toEqual({ method: "GET", path: "/api/admin/groups/g1" });
    expect(client.calls[1]?.body).toEqual({ id: "g1", name: "Renamed" });
    expect(bodyOf(result)).toMatchObject({ updated: "g1" });
  });

  it("merges preferences onto the Update field set — read-side prefs keys stripped", async () => {
    const client = fakeClient({ get: CURRENT_GROUP, put: CURRENT_GROUP });

    await adminGroupWriteHandler(client, {
      action: "update",
      item_id: "g1",
      changes: { preferences: { privateGroup: false } },
    });

    const sent = client.calls[1]?.body as Record<string, unknown>;
    expect(sent.preferences).toEqual({ privateGroup: false, showAnnouncements: true });
  });

  it("merges aiProviderSettings pointers — Out-only fields never sent, explicit null clears", async () => {
    const client = fakeClient({ get: CURRENT_GROUP, put: CURRENT_GROUP });

    await adminGroupWriteHandler(client, {
      action: "update",
      item_id: "g1",
      changes: { aiProviderSettings: { defaultProviderId: null } },
    });

    const sent = client.calls[1]?.body as Record<string, unknown>;
    expect(sent.aiProviderSettings).toEqual({
      defaultProviderId: null,
      audioProviderId: null,
      imageProviderId: "p-img",
    });
  });

  it("fills all three pointers even when the fetched base is null and the overlay partial", async () => {
    const client = fakeClient({
      get: { ...CURRENT_GROUP, aiProviderSettings: null },
      put: CURRENT_GROUP,
    });

    await adminGroupWriteHandler(client, {
      action: "update",
      item_id: "g1",
      changes: { aiProviderSettings: { defaultProviderId: "p-new" } },
    });

    const sent = client.calls[1]?.body as Record<string, unknown>;
    expect(sent.aiProviderSettings).toEqual({
      defaultProviderId: "p-new",
      audioProviderId: null,
      imageProviderId: null,
    });
  });

  it("refuses update without item_id or changes — no client call", async () => {
    const client = fakeClient();

    const noId = await adminGroupWriteHandler(client, { action: "update", changes: {} });
    const noChanges = await adminGroupWriteHandler(client, { action: "update", item_id: "g1" });

    expect(noId.isError).toBe(true);
    expect(noChanges.isError).toBe(true);
    expect(client.calls).toHaveLength(0);
  });

  it("refuses delete without confirmation — zero client calls", async () => {
    const client = fakeClient();

    const result = await adminGroupWriteHandler(client, { action: "delete", item_id: "g1" });

    expect(result.isError).toBe(true);
    expect(client.calls).toHaveLength(0);
  });

  it("deletes when confirmed", async () => {
    const client = fakeClient({ delete: CURRENT_GROUP });

    const result = await adminGroupWriteHandler(client, {
      action: "delete",
      item_id: "g1",
      confirm: true,
    });

    expect(client.calls[0]).toEqual({ method: "DELETE", path: "/api/admin/groups/g1" });
    expect(bodyOf(result)).toEqual({ deleted: "g1" });
  });

  it("returns an error result when the client throws", async () => {
    const client = {
      ...fakeClient(),
      async post<T>(): Promise<T> {
        throw new Error("boom");
      },
    };

    const result = await adminGroupWriteHandler(client, { action: "create", name: "X" });

    expect(result.isError).toBe(true);
  });
});

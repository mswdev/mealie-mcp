import { describe, expect, it } from "vitest";
import { MealieApiError } from "../../../client/MealieApiError.js";
import { adminUserWriteHandler } from "./admin-user-write.js";

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

function textOf(result: { content: unknown[] }): string {
  return (result.content[0] as { text: string }).text;
}

/** The fetched UserOut for update merges — server-derived fields must round-trip. */
const CURRENT_USER = {
  id: "u1",
  username: "sam",
  fullName: "Sam",
  email: "s@x.io",
  admin: false,
  authMethod: "Mealie",
  group: "Home",
  household: "Family",
  groupId: "g1",
  groupSlug: "home",
  householdId: "h1",
  householdSlug: "family",
  tokens: [{ id: 3, name: "bridge" }],
  cacheKey: "ck-round-trip",
  canInvite: false,
};

const CREATE_ARGS = {
  action: "create" as const,
  username: "sam",
  fullName: "Sam",
  email: "s@x.io",
  password: "pw-secret",
};

describe("adminUserWriteHandler", () => {
  it("creates with the typed UserIn defaults and never echoes the password", async () => {
    const client = fakeClient({ post: { ...CURRENT_USER, id: "u9" } });

    const result = await adminUserWriteHandler(client, CREATE_ARGS);

    expect(client.calls[0]).toMatchObject({ method: "POST", path: "/api/admin/users" });
    const sent = client.calls[0]?.body as Record<string, unknown>;
    expect(sent).toMatchObject({
      username: "sam",
      fullName: "Sam",
      email: "s@x.io",
      password: "pw-secret",
      authMethod: "Mealie",
      admin: false,
      advanced: false,
      showAnnouncements: true,
      canInvite: false,
      canManage: false,
      canManageHousehold: false,
      canOrganize: false,
    });
    expect("group" in sent).toBe(false);
    expect("household" in sent).toBe(false);
    expect(textOf(result)).not.toContain("pw-secret");
    expect(bodyOf(result)).toMatchObject({ id: "u9", username: "sam" });
  });

  it("passes admin flag and group/household names through on create", async () => {
    const client = fakeClient({ post: CURRENT_USER });

    await adminUserWriteHandler(client, { ...CREATE_ARGS, admin: true, group: "Home" });

    const sent = client.calls[0]?.body as Record<string, unknown>;
    expect(sent).toMatchObject({ admin: true, group: "Home" });
    expect("household" in sent).toBe(false);
  });

  it("refuses create with a missing required field — no client call", async () => {
    const client = fakeClient();

    const result = await adminUserWriteHandler(client, { ...CREATE_ARGS, password: undefined });

    expect(result.isError).toBe(true);
    expect(client.calls).toHaveLength(0);
  });

  it("updates via a straight UserOut round-trip — server-derived fields survive", async () => {
    const client = fakeClient({ get: CURRENT_USER, put: CURRENT_USER });

    const result = await adminUserWriteHandler(client, {
      action: "update",
      item_id: "u1",
      changes: { fullName: "New Name", admin: true },
    });

    expect(client.calls[0]).toEqual({ method: "GET", path: "/api/admin/users/u1" });
    expect(client.calls[1]).toMatchObject({ method: "PUT", path: "/api/admin/users/u1" });
    const sent = client.calls[1]?.body as Record<string, unknown>;
    expect(sent).toMatchObject({
      fullName: "New Name",
      admin: true,
      cacheKey: "ck-round-trip",
      groupId: "g1",
      groupSlug: "home",
    });
    expect(sent.tokens).toEqual([{ id: 3, name: "bridge" }]);
    const echoed = bodyOf(result).user as Record<string, unknown>;
    expect(echoed.cacheKey).toBeUndefined();
    expect(echoed.fullName).toBe("New Name");
  });

  it("refuses update without item_id or changes — no client call", async () => {
    const client = fakeClient();

    const noId = await adminUserWriteHandler(client, { action: "update", changes: { a: 1 } });
    const noChanges = await adminUserWriteHandler(client, { action: "update", item_id: "u1" });

    expect(noId.isError).toBe(true);
    expect(noChanges.isError).toBe(true);
    expect(client.calls).toHaveLength(0);
  });

  it("refuses delete without confirmation — zero client calls", async () => {
    const client = fakeClient();

    const result = await adminUserWriteHandler(client, { action: "delete", item_id: "u1" });

    expect(result.isError).toBe(true);
    expect(client.calls).toHaveLength(0);
  });

  it("deletes when confirmed", async () => {
    const client = fakeClient({ delete: CURRENT_USER });

    const result = await adminUserWriteHandler(client, {
      action: "delete",
      item_id: "u1",
      confirm: true,
    });

    expect(client.calls[0]).toEqual({ method: "DELETE", path: "/api/admin/users/u1" });
    expect(bodyOf(result)).toEqual({ deleted: "u1" });
  });

  it("sanitizes error paths — a 422 echoing the password never reaches the result", async () => {
    const client = {
      ...fakeClient(),
      async post<T>(): Promise<T> {
        throw new MealieApiError(422, "Unprocessable Entity", "/api/admin/users", '{"input": "pw-secret"}');
      },
    };

    const result = await adminUserWriteHandler(client, CREATE_ARGS);

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("HTTP 422");
    expect(textOf(result)).not.toContain("pw-secret");
  });
});

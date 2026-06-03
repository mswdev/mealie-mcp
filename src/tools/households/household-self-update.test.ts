import { describe, expect, it } from "vitest";
import { householdSelfUpdateHandler } from "./household-self-update.js";

type Call = { method: string; path: string; body?: unknown; query?: unknown };

/** A member with management rights already granted — the no-downgrade subject. */
const MEMBER = {
  id: "u1",
  email: "u1@test",
  canManageHousehold: false,
  canManage: true,
  canInvite: false,
  canOrganize: true,
};

function fakeClient(opts: { preferences?: unknown; members?: unknown[] }) {
  const calls: Call[] = [];
  return {
    calls,
    async get<T>(path: string): Promise<T> {
      calls.push({ method: "GET", path });
      return (opts.preferences ?? {}) as T;
    },
    async getPaginated<T>(path: string, query: unknown): Promise<T> {
      calls.push({ method: "GETP", path, query });
      return {
        items: opts.members ?? [],
        total: (opts.members ?? []).length,
        page: 1,
        perPage: 100,
        totalPages: 1,
      } as T;
    },
    async put<T>(path: string, body: unknown): Promise<T> {
      calls.push({ method: "PUT", path, body });
      return { ...(MEMBER as object), ...(body as object) } as T;
    },
  };
}

function bodyOf(result: { content: unknown[] }): Record<string, unknown> {
  return JSON.parse((result.content[0] as { text: string }).text);
}

describe("householdSelfUpdateHandler — preferences", () => {
  it("fetch-merges preferences, preserving untouched fields (no silent reset)", async () => {
    const client = fakeClient({
      preferences: {
        privateHousehold: true,
        recipePublic: true,
        firstDayOfWeek: 1,
        recipeShowNutrition: true,
      },
    });

    await householdSelfUpdateHandler(client, {
      target: "preferences",
      changes: { recipePublic: false },
    });

    expect(client.calls[0]).toMatchObject({ method: "GET", path: "/api/households/preferences" });
    const putCall = client.calls.find((call) => call.method === "PUT");
    expect(putCall?.path).toBe("/api/households/preferences");
    const put = putCall?.body as Record<string, unknown>;
    expect(put.recipePublic).toBe(false);
    expect(put.privateHousehold).toBe(true);
    expect(put.firstDayOfWeek).toBe(1);
    expect(put.recipeShowNutrition).toBe(true);
  });

  it("requires changes for target=preferences", async () => {
    const result = await householdSelfUpdateHandler(fakeClient({}), { target: "preferences" });

    expect(result.isError).toBe(true);
  });

  it("returns an error result when the client throws (preferences path)", async () => {
    const client = {
      async get<T>(): Promise<T> {
        throw new Error("boom");
      },
      async getPaginated<T>(): Promise<T> {
        throw new Error("boom");
      },
      async put<T>(): Promise<T> {
        throw new Error("boom");
      },
    };

    const result = await householdSelfUpdateHandler(client, {
      target: "preferences",
      changes: { recipePublic: false },
    });

    expect(result.isError).toBe(true);
  });
});

describe("householdSelfUpdateHandler — permissions", () => {
  it("refuses without confirm (privilege-elevating)", async () => {
    const client = fakeClient({ members: [MEMBER] });

    const result = await householdSelfUpdateHandler(client, {
      target: "permissions",
      userId: "u1",
      canInvite: true,
    });

    expect(result.isError).toBe(true);
    expect(client.calls).toHaveLength(0);
  });

  it("requires userId for target=permissions", async () => {
    const result = await householdSelfUpdateHandler(fakeClient({ members: [MEMBER] }), {
      target: "permissions",
      confirm: true,
    });

    expect(result.isError).toBe(true);
  });

  it("merges onto current flags so an omitted flag is NOT silently downgraded", async () => {
    const client = fakeClient({ members: [MEMBER] });

    const result = await householdSelfUpdateHandler(client, {
      target: "permissions",
      userId: "u1",
      canInvite: true,
      confirm: true,
    });

    const put = client.calls.find((call) => call.method === "PUT");
    expect(put?.path).toBe("/api/households/permissions");
    const sent = put?.body as Record<string, unknown>;
    expect(sent.canInvite).toBe(true); // the change
    expect(sent.canManage).toBe(true); // preserved, NOT reset to false
    expect(sent.canOrganize).toBe(true); // preserved
    expect(sent.canManageHousehold).toBe(false);
    expect(sent.userId).toBe("u1");
    expect((bodyOf(result).permissions as Record<string, unknown>).canManage).toBe(true);
  });

  it("errors (does not guess all-false) when the member is not in the household", async () => {
    const client = fakeClient({ members: [{ id: "other" }] });

    const result = await householdSelfUpdateHandler(client, {
      target: "permissions",
      userId: "u1",
      canInvite: true,
      confirm: true,
    });

    expect(result.isError).toBe(true);
    expect(client.calls.some((call) => call.method === "PUT")).toBe(false);
  });

  it("returns an error result when the client throws", async () => {
    const client = {
      async get<T>(): Promise<T> {
        throw new Error("boom");
      },
      async getPaginated<T>(): Promise<T> {
        throw new Error("boom");
      },
      async put<T>(): Promise<T> {
        throw new Error("boom");
      },
    };

    const result = await householdSelfUpdateHandler(client, {
      target: "permissions",
      userId: "u1",
      confirm: true,
    });

    expect(result.isError).toBe(true);
  });
});

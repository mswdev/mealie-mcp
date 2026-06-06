import { describe, expect, it } from "vitest";
import { userSelfUpdateHandler } from "./user-self-update.js";

type Call = { method: string; path: string; body?: unknown };

/** A full UserOut as GET /api/users/self returns it — incl. the UserOut-only keys. */
const CURRENT_SELF = {
  id: "u1",
  username: "matt",
  fullName: "Matt",
  email: "m@x.io",
  authMethod: "Mealie",
  admin: false,
  group: "Home",
  household: "Family",
  advanced: false,
  showAnnouncements: true,
  canInvite: false,
  canManage: false,
  canManageHousehold: false,
  canOrganize: false,
  groupId: "g1",
  groupSlug: "home",
  householdId: "h1",
  householdSlug: "family",
  tokens: [],
  cacheKey: "abc",
};

function fakeClient() {
  const calls: Call[] = [];
  return {
    calls,
    async get<T>(path: string): Promise<T> {
      calls.push({ method: "GET", path });
      return CURRENT_SELF as T;
    },
    async put<T>(path: string, body?: unknown): Promise<T> {
      calls.push({ method: "PUT", path, body });
      return undefined as T;
    },
  };
}

describe("userSelfUpdateHandler", () => {
  it("fetch-merges onto the UserBase whitelist and PUTs to the own id", async () => {
    const client = fakeClient();

    await userSelfUpdateHandler(client, { changes: { fullName: "New Name" } });

    expect(client.calls[0]).toEqual({ method: "GET", path: "/api/users/self" });
    expect(client.calls[1]).toMatchObject({ method: "PUT", path: "/api/users/u1" });
    const body = client.calls[1]?.body as Record<string, unknown>;
    expect(body.fullName).toBe("New Name");
    // Silent-reset guard: untouched UserBase fields preserved.
    expect(body.email).toBe("m@x.io");
    expect(body.showAnnouncements).toBe(true);
    expect(body.canInvite).toBe(false);
  });

  it("never sends UserOut-only keys (whitelist regression)", async () => {
    const client = fakeClient();

    await userSelfUpdateHandler(client, { changes: { fullName: "x" } });

    const body = client.calls[1]?.body as Record<string, unknown>;
    for (const key of [
      "groupId",
      "groupSlug",
      "householdId",
      "householdSlug",
      "tokens",
      "cacheKey",
    ]) {
      expect(body).not.toHaveProperty(key);
    }
  });

  it("drops changes keys outside the UserBase whitelist", async () => {
    const client = fakeClient();

    await userSelfUpdateHandler(client, { changes: { fullName: "x", cacheKey: "evil" } });

    const body = client.calls[1]?.body as Record<string, unknown>;
    expect(body).not.toHaveProperty("cacheKey");
    expect(body.fullName).toBe("x");
  });

  it("echoes the updated id and merged user", async () => {
    const client = fakeClient();

    const result = await userSelfUpdateHandler(client, { changes: { username: "matt2" } });

    const body = JSON.parse((result.content[0] as { text: string }).text);
    expect(body.updated).toBe("u1");
    expect(body.user.username).toBe("matt2");
  });

  it("rejects a missing changes record without calling the client", async () => {
    const client = fakeClient();

    const result = await userSelfUpdateHandler(client, {});

    expect(result.isError).toBe(true);
    expect(client.calls).toHaveLength(0);
  });

  it("returns an error result when the client throws", async () => {
    const client = {
      async get<T>(): Promise<T> {
        throw new Error("boom");
      },
      async put<T>(): Promise<T> {
        return undefined as T;
      },
    };

    const result = await userSelfUpdateHandler(client, { changes: { fullName: "x" } });

    expect(result.isError).toBe(true);
  });
});

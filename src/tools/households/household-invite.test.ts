import { describe, expect, it } from "vitest";
import { householdInviteHandler } from "./household-invite.js";

type Call = { path: string; body: unknown };

function fakeClient(calls: Call[], response: unknown) {
  return {
    async post<T>(path: string, body: unknown): Promise<T> {
      calls.push({ path, body });
      return response as T;
    },
  };
}

function bodyOf(result: { content: unknown[] }): Record<string, unknown> {
  return JSON.parse((result.content[0] as { text: string }).text);
}

describe("householdInviteHandler", () => {
  it("creates a token with uses and omits unset group/household keys", async () => {
    const calls: Call[] = [];
    const token = { token: "t1", usesLeft: 3, groupId: "g1", householdId: "h1" };

    const result = await householdInviteHandler(fakeClient(calls, token), {
      action: "create",
      uses: 3,
    });

    expect(calls[0]?.path).toBe("/api/households/invitations");
    expect(calls[0]?.body).toEqual({ uses: 3 });
    expect(bodyOf(result)).toEqual(token);
  });

  it("includes group/household ids in the create body when supplied", async () => {
    const calls: Call[] = [];

    await householdInviteHandler(fakeClient(calls, {}), {
      action: "create",
      uses: 1,
      groupId: "g1",
      householdId: "h1",
    });

    expect(calls[0]?.body).toEqual({ uses: 1, groupId: "g1", householdId: "h1" });
  });

  it("rejects create without uses", async () => {
    const result = await householdInviteHandler(fakeClient([], {}), { action: "create" });

    expect(result.isError).toBe(true);
  });

  it("emails an invitation and returns the typed success response", async () => {
    const calls: Call[] = [];
    const response = { success: true, error: null };

    const result = await householdInviteHandler(fakeClient(calls, response), {
      action: "send_email",
      email: "x@test",
      token: "t1",
    });

    expect(calls[0]?.path).toBe("/api/households/invitations/email");
    expect(calls[0]?.body).toEqual({ email: "x@test", token: "t1" });
    expect(bodyOf(result)).toEqual({ success: true, error: null });
  });

  it("rejects send_email without email and token", async () => {
    const result = await householdInviteHandler(fakeClient([], {}), {
      action: "send_email",
      email: "x@test",
    });

    expect(result.isError).toBe(true);
  });

  it("returns an error result when the client throws", async () => {
    const client = {
      async post<T>(): Promise<T> {
        throw new Error("500");
      },
    };

    const result = await householdInviteHandler(client, { action: "create", uses: 1 });

    expect(result.isError).toBe(true);
  });
});

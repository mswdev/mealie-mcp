import { describe, expect, it } from "vitest";
import { householdInvitationsListHandler } from "./household-invitations-list.js";

function bodyOf(result: { content: unknown[] }): Record<string, unknown> {
  return JSON.parse((result.content[0] as { text: string }).text);
}

describe("householdInvitationsListHandler", () => {
  it("wraps the bare ReadInviteToken[] array as { items, count }", async () => {
    let calledPath = "";
    const tokens = [
      { token: "t1", usesLeft: 2, groupId: "g1", householdId: "h1" },
      { token: "t2", usesLeft: 1, groupId: "g1", householdId: "h1" },
    ];
    const client = {
      async get<T>(path: string): Promise<T> {
        calledPath = path;
        return tokens as T;
      },
    };

    const result = await householdInvitationsListHandler(client);

    expect(calledPath).toBe("/api/households/invitations");
    expect(bodyOf(result)).toEqual({ items: tokens, count: 2 });
  });

  it("returns an error result when the client throws", async () => {
    const client = {
      async get<T>(): Promise<T> {
        throw new Error("401");
      },
    };

    const result = await householdInvitationsListHandler(client);

    expect(result.isError).toBe(true);
  });
});

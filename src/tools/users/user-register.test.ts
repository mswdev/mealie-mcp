import { describe, expect, it } from "vitest";
import { MealieApiError } from "../../client/MealieApiError.js";
import { userRegisterHandler } from "./user-register.js";

type Call = { method: string; path: string; body?: unknown };

function fakeClient() {
  const calls: Call[] = [];
  return {
    calls,
    async post<T>(path: string, body: unknown): Promise<T> {
      calls.push({ method: "POST", path, body });
      return {
        id: "u9",
        username: "newbie",
        fullName: "New User",
        email: "n@x.io",
        groupId: "g1",
        householdId: "h1",
        tokens: [],
        cacheKey: "k",
      } as T;
    },
  };
}

const REQUIRED_ARGS = {
  email: "n@x.io",
  username: "newbie",
  fullName: "New User",
  password: "pw-secret",
  passwordConfirm: "pw-secret",
};

function textOf(result: { content: unknown[] }): string {
  return (result.content[0] as { text: string }).text;
}

describe("userRegisterHandler", () => {
  it("registers with the required-with-default fields supplied and no optional keys", async () => {
    const client = fakeClient();

    await userRegisterHandler(client, REQUIRED_ARGS);

    expect(client.calls[0]?.path).toBe("/api/users/register");
    const body = client.calls[0]?.body as Record<string, unknown>;
    expect(body).toMatchObject({
      email: "n@x.io",
      username: "newbie",
      fullName: "New User",
      advanced: false,
      private: false,
      seedData: false,
      locale: "en-US",
    });
    expect(body).not.toHaveProperty("group");
    expect(body).not.toHaveProperty("household");
    expect(body).not.toHaveProperty("groupToken");
  });

  it("passes optional group/household/groupToken through when present", async () => {
    const client = fakeClient();

    await userRegisterHandler(client, {
      ...REQUIRED_ARGS,
      group: "Home",
      household: "Family",
      groupToken: "invite-secret",
    });

    const body = client.calls[0]?.body as Record<string, unknown>;
    expect(body.group).toBe("Home");
    expect(body.household).toBe("Family");
    expect(body.groupToken).toBe("invite-secret");
  });

  it("echoes the concise created user — never the password or invite token", async () => {
    const client = fakeClient();

    const result = await userRegisterHandler(client, {
      ...REQUIRED_ARGS,
      groupToken: "invite-secret",
    });

    const text = textOf(result);
    const body = JSON.parse(text);
    expect(body.registered).toBe(true);
    expect(body.user).toMatchObject({ id: "u9", username: "newbie", email: "n@x.io" });
    expect(text).not.toContain("pw-secret");
    expect(text).not.toContain("invite-secret");
  });

  it("rejects a missing required field (no client calls)", async () => {
    const client = fakeClient();

    const result = await userRegisterHandler(client, { ...REQUIRED_ARGS, passwordConfirm: "" });

    expect(result.isError).toBe(true);
    expect(client.calls).toHaveLength(0);
  });

  it("returns an error result when the client throws (e.g. signup disabled)", async () => {
    const client = {
      async post<T>(): Promise<T> {
        throw new Error("403");
      },
    };

    const result = await userRegisterHandler(client, REQUIRED_ARGS);

    expect(result.isError).toBe(true);
  });

  it("never leaks a secret echoed in Mealie's 422 body into the error result", async () => {
    const client = {
      async post<T>(): Promise<T> {
        // Pydantic v2 validation errors echo the rejected value (ValidationError.input).
        throw new MealieApiError(
          422,
          "Unprocessable Entity",
          "/api/users/register",
          '{"detail":[{"msg":"password too short","input":"pw-secret"}]}',
        );
      },
    };

    const result = await userRegisterHandler(client, REQUIRED_ARGS);

    expect(result.isError).toBe(true);
    const text = (result.content[0] as { text: string }).text;
    expect(text).not.toContain("pw-secret");
    expect(text).toContain("422");
  });
});

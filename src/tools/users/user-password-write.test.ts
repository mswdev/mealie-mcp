import { describe, expect, it } from "vitest";
import { MealieApiError } from "../../client/MealieApiError.js";
import { userPasswordWriteHandler } from "./user-password-write.js";

type Call = { method: string; path: string; body?: unknown };

function fakeClient() {
  const calls: Call[] = [];
  return {
    calls,
    async put<T>(path: string, body: unknown): Promise<T> {
      calls.push({ method: "PUT", path, body });
      return undefined as T;
    },
    async post<T>(path: string, body: unknown): Promise<T> {
      calls.push({ method: "POST", path, body });
      return undefined as T;
    },
  };
}

function textOf(result: { content: unknown[] }): string {
  return (result.content[0] as { text: string }).text;
}

describe("userPasswordWriteHandler", () => {
  it("changes the password — PUTs both fields, never echoes either secret", async () => {
    const client = fakeClient();

    const result = await userPasswordWriteHandler(client, {
      action: "change",
      currentPassword: "old-secret",
      newPassword: "new-secret",
    });

    expect(client.calls[0]).toEqual({
      method: "PUT",
      path: "/api/users/password",
      body: { currentPassword: "old-secret", newPassword: "new-secret" },
    });
    const text = textOf(result);
    expect(JSON.parse(text)).toMatchObject({ action: "change", success: true });
    expect(text).not.toContain("old-secret");
    expect(text).not.toContain("new-secret");
  });

  it("rejects change without both password fields (no client calls)", async () => {
    const client = fakeClient();

    const result = await userPasswordWriteHandler(client, {
      action: "change",
      currentPassword: "old-secret",
    });

    expect(result.isError).toBe(true);
    expect(client.calls).toHaveLength(0);
  });

  it("requests a reset email for forgot", async () => {
    const client = fakeClient();

    const result = await userPasswordWriteHandler(client, {
      action: "forgot",
      email: "m@x.io",
    });

    expect(client.calls[0]).toEqual({
      method: "POST",
      path: "/api/users/forgot-password",
      body: { email: "m@x.io" },
    });
    expect(JSON.parse(textOf(result))).toMatchObject({ action: "forgot", success: true });
  });

  it("rejects forgot without an email (no client calls)", async () => {
    const client = fakeClient();

    const result = await userPasswordWriteHandler(client, { action: "forgot" });

    expect(result.isError).toBe(true);
    expect(client.calls).toHaveLength(0);
  });

  it("completes a reset — POSTs all four fields, never echoes the secrets", async () => {
    const client = fakeClient();

    const result = await userPasswordWriteHandler(client, {
      action: "reset",
      token: "tok-secret",
      email: "m@x.io",
      password: "pw-secret",
      passwordConfirm: "pw-secret",
    });

    expect(client.calls[0]).toEqual({
      method: "POST",
      path: "/api/users/reset-password",
      body: {
        token: "tok-secret",
        email: "m@x.io",
        password: "pw-secret",
        passwordConfirm: "pw-secret",
      },
    });
    const text = textOf(result);
    expect(JSON.parse(text)).toMatchObject({ action: "reset", success: true });
    expect(text).not.toContain("tok-secret");
    expect(text).not.toContain("pw-secret");
  });

  it("rejects reset with missing fields (no client calls)", async () => {
    const client = fakeClient();

    const result = await userPasswordWriteHandler(client, {
      action: "reset",
      email: "m@x.io",
      password: "pw-secret",
    });

    expect(result.isError).toBe(true);
    expect(client.calls).toHaveLength(0);
  });

  it("returns an error result when the client throws", async () => {
    const client = {
      async put<T>(): Promise<T> {
        throw new Error("401");
      },
      async post<T>(): Promise<T> {
        return undefined as T;
      },
    };

    const result = await userPasswordWriteHandler(client, {
      action: "change",
      currentPassword: "a",
      newPassword: "b",
    });

    expect(result.isError).toBe(true);
  });

  it("never leaks a secret echoed in Mealie's 422 body into the error result", async () => {
    const client = {
      async put<T>(): Promise<T> {
        // Pydantic v2 validation errors echo the rejected value (ValidationError.input).
        throw new MealieApiError(
          422,
          "Unprocessable Entity",
          "/api/users/password",
          '{"detail":[{"msg":"too short","input":"new-secret"}]}',
        );
      },
      async post<T>(): Promise<T> {
        return undefined as T;
      },
    };

    const result = await userPasswordWriteHandler(client, {
      action: "change",
      currentPassword: "old-secret",
      newPassword: "new-secret",
    });

    expect(result.isError).toBe(true);
    const text = (result.content[0] as { text: string }).text;
    expect(text).not.toContain("new-secret");
    expect(text).not.toContain("old-secret");
    expect(text).toContain("422");
  });
});

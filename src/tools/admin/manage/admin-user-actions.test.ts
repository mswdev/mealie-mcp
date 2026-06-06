import { describe, expect, it } from "vitest";
import { MealieApiError } from "../../../client/MealieApiError.js";
import { adminUserActionsHandler } from "./admin-user-actions.js";

type Call = { method: string; path: string; body?: unknown; query?: unknown };

function fakeClient(response?: unknown) {
  const calls: Call[] = [];
  return {
    calls,
    async post<T>(path: string, body: unknown, query?: unknown): Promise<T> {
      calls.push({ method: "POST", path, body, ...(query !== undefined && { query }) });
      return response as T;
    },
  };
}

function bodyOf(result: { content: unknown[] }): Record<string, unknown> {
  return JSON.parse((result.content[0] as { text: string }).text);
}

function textOf(result: { content: unknown[] }): string {
  return (result.content[0] as { text: string }).text;
}

describe("adminUserActionsHandler", () => {
  it("unlocks locked accounts — no force query when unset", async () => {
    const client = fakeClient({ unlocked: 2 });

    const result = await adminUserActionsHandler(client, { action: "unlock" });

    expect(client.calls[0]).toEqual({
      method: "POST",
      path: "/api/admin/users/unlock",
      body: {},
    });
    expect(bodyOf(result)).toEqual({ action: "unlock", unlocked: 2 });
  });

  it("passes the force flag through as a query param", async () => {
    const client = fakeClient({ unlocked: 5 });

    await adminUserActionsHandler(client, { action: "unlock", force: true });

    expect(client.calls[0]).toMatchObject({ query: { force: true } });
  });

  it("generates a password-reset token and surfaces it once with the note", async () => {
    const client = fakeClient({ token: "reset-secret" });

    const result = await adminUserActionsHandler(client, {
      action: "password_reset_token",
      email: "s@x.io",
    });

    expect(client.calls[0]).toEqual({
      method: "POST",
      path: "/api/admin/users/password-reset-token",
      body: { email: "s@x.io" },
    });
    const body = bodyOf(result);
    expect(body.token).toBe("reset-secret");
    expect(body.note).toMatch(/once/);
  });

  it("refuses password_reset_token without email — no client call", async () => {
    const client = fakeClient();

    const result = await adminUserActionsHandler(client, { action: "password_reset_token" });

    expect(result.isError).toBe(true);
    expect(client.calls).toHaveLength(0);
  });

  it("sanitizes error paths — upstream detail never reaches the result", async () => {
    const client = {
      async post<T>(): Promise<T> {
        throw new MealieApiError(
          400,
          "Bad Request",
          "/api/admin/users/password-reset-token",
          '{"token": "reset-secret"}',
        );
      },
    };

    const result = await adminUserActionsHandler(client, {
      action: "password_reset_token",
      email: "s@x.io",
    });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("HTTP 400");
    expect(textOf(result)).not.toContain("reset-secret");
  });
});

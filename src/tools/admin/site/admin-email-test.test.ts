import { describe, expect, it } from "vitest";
import { adminEmailTestHandler } from "./admin-email-test.js";

function fakeClient(response?: unknown) {
  const calls: { method: string; path: string; body?: unknown }[] = [];
  return {
    calls,
    async post<T>(path: string, body: unknown): Promise<T> {
      calls.push({ method: "POST", path, body });
      return response as T;
    },
  };
}

function bodyOf(result: { content: unknown[] }): Record<string, unknown> {
  return JSON.parse((result.content[0] as { text: string }).text);
}

describe("adminEmailTestHandler", () => {
  it("sends a test email and reports success", async () => {
    const client = fakeClient({ success: true, error: null });

    const result = await adminEmailTestHandler(client, { email: "s@x.io" });

    expect(client.calls[0]).toEqual({
      method: "POST",
      path: "/api/admin/email",
      body: { email: "s@x.io" },
    });
    expect(bodyOf(result)).toEqual({ sent: true, email: "s@x.io" });
  });

  it("treats success:false on a 200 as a failure, surfacing the error message", async () => {
    const client = fakeClient({ success: false, error: "SMTP refused connection" });

    const result = await adminEmailTestHandler(client, { email: "s@x.io" });

    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain("SMTP refused connection");
  });

  it("returns an error result when the client throws", async () => {
    const client = {
      async post<T>(): Promise<T> {
        throw new Error("boom");
      },
    };

    const result = await adminEmailTestHandler(client, { email: "s@x.io" });

    expect(result.isError).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import { MealieApiError } from "../../../client/MealieApiError.js";
import { adminAboutHandler } from "./admin-about.js";

type Call = { method: string; path: string };

/** Per-path responses so the aggregated read can be exercised in one fake. */
function fakeClient(responses: Record<string, unknown>) {
  const calls: Call[] = [];
  return {
    calls,
    async get<T>(path: string): Promise<T> {
      calls.push({ method: "GET", path });
      return responses[path] as T;
    },
  };
}

function bodyOf(result: { content: unknown[] }): Record<string, unknown> {
  return JSON.parse((result.content[0] as { text: string }).text);
}

function textOf(result: { content: unknown[] }): string {
  return (result.content[0] as { text: string }).text;
}

/** AdminAboutInfo-shaped fake — dbUrl must never reach any output. */
const ABOUT = {
  version: "v2.8.0",
  production: true,
  allowSignup: false,
  dbType: "postgres",
  dbUrl: "postgres://user:hunter2@db:5432/mealie",
  defaultGroupSlug: "home",
};

describe("adminAboutHandler", () => {
  it("reads about only by default — and redacts dbUrl", async () => {
    const client = fakeClient({ "/api/admin/about": ABOUT });

    const result = await adminAboutHandler(client, {});

    expect(client.calls).toEqual([{ method: "GET", path: "/api/admin/about" }]);
    const body = bodyOf(result);
    expect(body.about).toMatchObject({ version: "v2.8.0", dbType: "postgres" });
    expect(textOf(result)).not.toContain("postgres://");
    expect((body.about as Record<string, unknown>).dbUrl).toBeUndefined();
  });

  it("bundles statistics, check, and email_ready when included", async () => {
    const client = fakeClient({
      "/api/admin/about": ABOUT,
      "/api/admin/about/statistics": { totalRecipes: 12, totalUsers: 3 },
      "/api/admin/about/check": { emailReady: false, baseUrlSet: true },
      "/api/admin/email": { ready: false },
    });

    const result = await adminAboutHandler(client, {
      include: ["statistics", "check", "email_ready"],
    });

    expect(client.calls.map((call) => call.path)).toEqual([
      "/api/admin/about",
      "/api/admin/about/statistics",
      "/api/admin/about/check",
      "/api/admin/email",
    ]);
    const body = bodyOf(result);
    expect(body.statistics).toEqual({ totalRecipes: 12, totalUsers: 3 });
    expect(body.check).toEqual({ emailReady: false, baseUrlSet: true });
    expect(body.email_ready).toEqual({ ready: false });
  });

  it("sanitizes error paths — upstream detail never reaches the result", async () => {
    const client = {
      async get<T>(): Promise<T> {
        throw new MealieApiError(
          500,
          "Internal Server Error",
          "/api/admin/about",
          "postgres://user:hunter2@db/leak",
        );
      },
    };

    const result = await adminAboutHandler(client, {});

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("HTTP 500");
    expect(textOf(result)).not.toContain("postgres://");
  });
});

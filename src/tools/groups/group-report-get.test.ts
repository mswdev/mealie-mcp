import { describe, expect, it } from "vitest";
import { groupReportGetHandler } from "./group-report-get.js";

type Call = { method: string; path: string; query?: unknown };

function fakeClient(value: unknown) {
  const calls: Call[] = [];
  return {
    calls,
    async get<T>(path: string, query?: unknown): Promise<T> {
      calls.push({ method: "GET", path, query });
      return value as T;
    },
  };
}

function bodyOf(result: { content: unknown[] }): Record<string, unknown> {
  return JSON.parse((result.content[0] as { text: string }).text);
}

describe("groupReportGetHandler", () => {
  it("lists reports as a bare array → {items, count}, with the report_type filter", async () => {
    const client = fakeClient([
      { id: "r1", name: "Backup", category: "backup", status: "success" },
    ]);

    const result = await groupReportGetHandler(client, { report_type: "backup" });

    expect(client.calls[0]).toEqual({
      method: "GET",
      path: "/api/groups/reports",
      query: { report_type: "backup" },
    });
    const body = bodyOf(result);
    expect(body.count).toBe(1);
    expect(body.items).toHaveLength(1);
  });

  it("lists with no query when no report_type is given", async () => {
    const client = fakeClient([]);

    await groupReportGetHandler(client, {});

    expect(client.calls[0]).toEqual({
      method: "GET",
      path: "/api/groups/reports",
      query: undefined,
    });
  });

  it("gets one report by id (detailed)", async () => {
    const client = fakeClient({ id: "r1", name: "Backup", entries: [{ message: "ok" }] });

    const result = await groupReportGetHandler(client, {
      item_id: "r1",
      response_format: "detailed",
    });

    expect(client.calls[0]).toMatchObject({ method: "GET", path: "/api/groups/reports/r1" });
    expect(bodyOf(result)).toMatchObject({ entries: [{ message: "ok" }] });
  });

  it("defaults a single report (by id) to detailed so entries are surfaced", async () => {
    const client = fakeClient({ id: "r1", name: "Backup", entries: [{ message: "ok" }] });

    const result = await groupReportGetHandler(client, { item_id: "r1" });

    expect(bodyOf(result)).toMatchObject({ entries: [{ message: "ok" }] });
  });

  it("returns an error result when the client throws", async () => {
    const client = {
      async get<T>(): Promise<T> {
        throw new Error("boom");
      },
    };

    const result = await groupReportGetHandler(client, {});

    expect(result.isError).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import { groupReportDeleteHandler } from "./group-report-delete.js";

type Call = { method: string; path: string };

function fakeClient() {
  const calls: Call[] = [];
  return {
    calls,
    async delete<T>(path: string): Promise<T> {
      calls.push({ method: "DELETE", path });
      return undefined as T; // Mealie returns 200 + an untyped body; we ignore it.
    },
  };
}

function bodyOf(result: { content: unknown[] }): Record<string, unknown> {
  return JSON.parse((result.content[0] as { text: string }).text);
}

describe("groupReportDeleteHandler", () => {
  it("refuses to delete without confirm", async () => {
    const client = fakeClient();

    const result = await groupReportDeleteHandler(client, { item_id: "r1" });

    expect(result.isError).toBe(true);
    expect(client.calls).toHaveLength(0);
  });

  it("deletes with confirm and synthesizes {deleted}, ignoring the untyped body", async () => {
    const client = fakeClient();

    const result = await groupReportDeleteHandler(client, { item_id: "r1", confirm: true });

    expect(client.calls[0]).toEqual({ method: "DELETE", path: "/api/groups/reports/r1" });
    expect(bodyOf(result)).toEqual({ deleted: "r1" });
  });

  it("returns an error result when the client throws", async () => {
    const client = {
      async delete<T>(): Promise<T> {
        throw new Error("boom");
      },
    };

    const result = await groupReportDeleteHandler(client, { item_id: "r1", confirm: true });

    expect(result.isError).toBe(true);
  });
});

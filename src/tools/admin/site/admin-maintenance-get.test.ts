import { describe, expect, it } from "vitest";
import { adminMaintenanceGetHandler } from "./admin-maintenance-get.js";

function fakeClient(single?: unknown) {
  const calls: { method: string; path: string }[] = [];
  return {
    calls,
    async get<T>(path: string): Promise<T> {
      calls.push({ method: "GET", path });
      return single as T;
    },
  };
}

function bodyOf(result: { content: unknown[] }): Record<string, unknown> {
  return JSON.parse((result.content[0] as { text: string }).text);
}

describe("adminMaintenanceGetHandler", () => {
  it("reads the summary by default — sizes stay display strings", async () => {
    const client = fakeClient({ dataDirSize: "1.4 GB", cleanableImages: 12, cleanableDirs: 3 });

    const result = await adminMaintenanceGetHandler(client, {});

    expect(client.calls[0]).toEqual({ method: "GET", path: "/api/admin/maintenance" });
    expect(bodyOf(result)).toEqual({
      dataDirSize: "1.4 GB",
      cleanableImages: 12,
      cleanableDirs: 3,
    });
  });

  it("reads storage details when view=storage", async () => {
    const client = fakeClient({ tempDirSize: "10 MB", backupsDirSize: "2 GB" });

    const result = await adminMaintenanceGetHandler(client, { view: "storage" });

    expect(client.calls[0]).toEqual({ method: "GET", path: "/api/admin/maintenance/storage" });
    expect(bodyOf(result)).toMatchObject({ backupsDirSize: "2 GB" });
  });

  it("returns an error result when the client throws", async () => {
    const client = {
      async get<T>(): Promise<T> {
        throw new Error("boom");
      },
    };

    const result = await adminMaintenanceGetHandler(client, {});

    expect(result.isError).toBe(true);
  });
});

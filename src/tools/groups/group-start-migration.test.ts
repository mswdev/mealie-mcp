import { describe, expect, it } from "vitest";
import { groupStartMigrationHandler } from "./group-start-migration.js";

type Call = { path: string; form: FormData };

function fakeClient(response: unknown) {
  const calls: Call[] = [];
  return {
    calls,
    async postMultipart<T>(path: string, form: FormData): Promise<T> {
      calls.push({ path, form });
      return response as T;
    },
  };
}

function bodyOf(result: { content: unknown[] }): Record<string, unknown> {
  return JSON.parse((result.content[0] as { text: string }).text);
}

describe("groupStartMigrationHandler", () => {
  it("refuses to start without confirm (no upload)", async () => {
    const client = fakeClient({});

    const result = await groupStartMigrationHandler(
      client,
      { migration_type: "nextcloud", filePath: "/tmp/a.zip" },
      undefined,
    );

    expect(result.isError).toBe(true);
    expect(client.calls).toHaveLength(0);
  });

  it("uploads a multipart form with archive + migration_type + stringified add_migration_tag", async () => {
    const client = fakeClient({ id: "r1", status: "in-progress" });

    const result = await groupStartMigrationHandler(
      client,
      {
        migration_type: "nextcloud",
        filePath: "/tmp/a.zip",
        add_migration_tag: false,
        confirm: true,
      },
      new Blob([new Uint8Array([1, 2, 3])]),
    );

    const call = client.calls[0];
    expect(call?.path).toBe("/api/groups/migrations");
    expect(call?.form.get("migration_type")).toBe("nextcloud");
    expect(call?.form.get("add_migration_tag")).toBe("false");
    expect(call?.form.get("archive")).toBeTruthy();
    expect(bodyOf(result)).toEqual({ started: true, reportId: "r1", status: "in-progress" });
  });

  it("defaults add_migration_tag to false when omitted", async () => {
    const client = fakeClient({ id: "r1", status: "in-progress" });

    await groupStartMigrationHandler(
      client,
      { migration_type: "paprika", filePath: "/tmp/a.zip", confirm: true },
      new Blob([new Uint8Array([1])]),
    );

    expect(client.calls[0]?.form.get("add_migration_tag")).toBe("false");
  });

  it("errors when confirmed but no file was provided", async () => {
    const client = fakeClient({});

    const result = await groupStartMigrationHandler(
      client,
      { migration_type: "nextcloud", filePath: "/tmp/a.zip", confirm: true },
      undefined,
    );

    expect(result.isError).toBe(true);
    expect(client.calls).toHaveLength(0);
  });

  it("returns an error result when the client throws", async () => {
    const client = {
      async postMultipart<T>(): Promise<T> {
        throw new Error("boom");
      },
    };

    const result = await groupStartMigrationHandler(
      client,
      { migration_type: "nextcloud", filePath: "/tmp/a.zip", confirm: true },
      new Blob([new Uint8Array([1])]),
    );

    expect(result.isError).toBe(true);
  });
});

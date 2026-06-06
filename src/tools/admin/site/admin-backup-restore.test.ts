import { describe, expect, it } from "vitest";
import { adminBackupRestoreHandler } from "./admin-backup-restore.js";

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

function textOf(result: { content: unknown[] }): string {
  return (result.content[0] as { text: string }).text;
}

describe("adminBackupRestoreHandler", () => {
  it("refuses without confirm — zero client calls", async () => {
    const client = fakeClient();

    const result = await adminBackupRestoreHandler(client, { file_name: "b.zip" });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("confirm");
    expect(client.calls).toHaveLength(0);
  });

  it("refuses when confirm_file_name is missing — zero client calls", async () => {
    const client = fakeClient();

    const result = await adminBackupRestoreHandler(client, {
      file_name: "b.zip",
      confirm: true,
    });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("confirm_file_name");
    expect(client.calls).toHaveLength(0);
  });

  it("refuses on a filename mismatch, naming both values — zero client calls", async () => {
    const client = fakeClient();

    const result = await adminBackupRestoreHandler(client, {
      file_name: "b.zip",
      confirm: true,
      confirm_file_name: "other.zip",
    });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("b.zip");
    expect(textOf(result)).toContain("other.zip");
    expect(client.calls).toHaveLength(0);
  });

  it("restores when both gates pass — no request body", async () => {
    const client = fakeClient({ message: "restored", error: false });

    const result = await adminBackupRestoreHandler(client, {
      file_name: "b.zip",
      confirm: true,
      confirm_file_name: "b.zip",
    });

    expect(client.calls[0]).toEqual({
      method: "POST",
      path: "/api/admin/backups/b.zip/restore",
      body: {},
    });
    expect(bodyOf(result)).toEqual({ restored: "b.zip", message: "restored" });
  });

  it("treats error:true on a 200 as a failure", async () => {
    const client = fakeClient({ message: "bad archive", error: true });

    const result = await adminBackupRestoreHandler(client, {
      file_name: "b.zip",
      confirm: true,
      confirm_file_name: "b.zip",
    });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("bad archive");
  });

  it("returns an error result when the client throws", async () => {
    const client = {
      async post<T>(): Promise<T> {
        throw new Error("boom");
      },
    };

    const result = await adminBackupRestoreHandler(client, {
      file_name: "b.zip",
      confirm: true,
      confirm_file_name: "b.zip",
    });

    expect(result.isError).toBe(true);
  });
});

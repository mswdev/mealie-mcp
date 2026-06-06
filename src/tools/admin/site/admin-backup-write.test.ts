import { describe, expect, it } from "vitest";
import { adminBackupWriteHandler } from "./admin-backup-write.js";

type Call = { method: string; path: string; body?: unknown; form?: FormData };

function fakeClient(response?: unknown) {
  const calls: Call[] = [];
  return {
    calls,
    async post<T>(path: string, body: unknown): Promise<T> {
      calls.push({ method: "POST", path, body });
      return response as T;
    },
    async postMultipart<T>(path: string, form: FormData): Promise<T> {
      calls.push({ method: "POST_MULTIPART", path, form });
      return response as T;
    },
    async delete<T>(path: string): Promise<T> {
      calls.push({ method: "DELETE", path });
      return response as T;
    },
  };
}

function bodyOf(result: { content: unknown[] }): Record<string, unknown> {
  return JSON.parse((result.content[0] as { text: string }).text);
}

const OK = { message: "ok", error: false };

describe("adminBackupWriteHandler", () => {
  it("creates a backup with no request body", async () => {
    const client = fakeClient(OK);

    const result = await adminBackupWriteHandler(client, { action: "create" });

    expect(client.calls[0]).toEqual({ method: "POST", path: "/api/admin/backups", body: {} });
    expect(bodyOf(result)).toEqual({ action: "create", message: "ok" });
  });

  it("treats error:true on a 200 as a failure", async () => {
    const client = fakeClient({ message: "disk full", error: true });

    const result = await adminBackupWriteHandler(client, { action: "create" });

    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain("disk full");
  });

  it("uploads via multipart with the verbatim 'archive' field", async () => {
    const client = fakeClient(OK);
    const blob = new Blob(["zip-bytes"]);

    const result = await adminBackupWriteHandler(
      client,
      { action: "upload", filePath: "/tmp/b.zip" },
      blob,
    );

    expect(client.calls[0]).toMatchObject({
      method: "POST_MULTIPART",
      path: "/api/admin/backups/upload",
    });
    const form = client.calls[0]?.form as FormData;
    expect(form.get("archive")).toBeInstanceOf(Blob);
    expect(form.get("file")).toBeNull();
    expect(bodyOf(result)).toEqual({ uploaded: true, message: "ok" });
  });

  it("refuses upload without a readable file — no client call", async () => {
    const client = fakeClient();

    const result = await adminBackupWriteHandler(client, { action: "upload" });

    expect(result.isError).toBe(true);
    expect(client.calls).toHaveLength(0);
  });

  it("refuses delete without confirmation or file_name — zero client calls", async () => {
    const client = fakeClient();

    const noConfirm = await adminBackupWriteHandler(client, {
      action: "delete",
      file_name: "b.zip",
    });
    const noName = await adminBackupWriteHandler(client, { action: "delete", confirm: true });

    expect(noConfirm.isError).toBe(true);
    expect(noName.isError).toBe(true);
    expect(client.calls).toHaveLength(0);
  });

  it("deletes when confirmed", async () => {
    const client = fakeClient(OK);

    const result = await adminBackupWriteHandler(client, {
      action: "delete",
      file_name: "b.zip",
      confirm: true,
    });

    expect(client.calls[0]).toEqual({ method: "DELETE", path: "/api/admin/backups/b.zip" });
    expect(bodyOf(result)).toEqual({ deleted: "b.zip" });
  });

  it("returns an error result when the client throws", async () => {
    const client = {
      ...fakeClient(),
      async post<T>(): Promise<T> {
        throw new Error("boom");
      },
    };

    const result = await adminBackupWriteHandler(client, { action: "create" });

    expect(result.isError).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import { adminBackupGetHandler } from "./admin-backup-get.js";

function fakeClient(single?: unknown) {
  const calls: { method: string; path: string }[] = [];
  return {
    calls,
    baseUrl: "https://mealie.example.com",
    async get<T>(path: string): Promise<T> {
      calls.push({ method: "GET", path });
      return single as T;
    },
  };
}

function bodyOf(result: { content: unknown[] }): Record<string, unknown> {
  return JSON.parse((result.content[0] as { text: string }).text);
}

function textOf(result: { content: unknown[] }): string {
  return (result.content[0] as { text: string }).text;
}

describe("adminBackupGetHandler", () => {
  it("lists backups — the AllBackups wrapper passes through as imports + templates", async () => {
    const client = fakeClient({
      imports: [{ name: "b.zip", date: "2026-06-01T00:00:00", size: "1.2 MB" }],
      templates: ["recipes.json"],
    });

    const result = await adminBackupGetHandler(client, {});

    expect(client.calls[0]).toEqual({ method: "GET", path: "/api/admin/backups" });
    expect(bodyOf(result)).toEqual({
      imports: [{ name: "b.zip", date: "2026-06-01T00:00:00", size: "1.2 MB" }],
      templates: ["recipes.json"],
    });
  });

  it("composes a download URL from the file token for one backup", async () => {
    const client = fakeClient({ fileToken: "tok/with+chars" });

    const result = await adminBackupGetHandler(client, { file_name: "b.zip" });

    expect(client.calls[0]).toEqual({ method: "GET", path: "/api/admin/backups/b.zip" });
    expect(bodyOf(result)).toEqual({
      fileName: "b.zip",
      downloadUrl: "https://mealie.example.com/api/utils/download?token=tok%2Fwith%2Bchars",
    });
  });

  it("sanitizes error paths — a thrown error embedding the token never reaches the result", async () => {
    const client = {
      baseUrl: "https://mealie.example.com",
      async get<T>(): Promise<T> {
        throw new SyntaxError('Unexpected token in JSON: {"fileToken": "tok-secret"}');
      },
    };

    const result = await adminBackupGetHandler(client, { file_name: "b.zip" });

    expect(result.isError).toBe(true);
    expect(textOf(result)).not.toContain("tok-secret");
  });
});

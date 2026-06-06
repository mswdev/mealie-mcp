import { describe, expect, it } from "vitest";
import { adminMaintenanceCleanHandler } from "./admin-maintenance-clean.js";

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

describe("adminMaintenanceCleanHandler", () => {
  it("refuses without confirmation — zero client calls", async () => {
    const client = fakeClient();

    const result = await adminMaintenanceCleanHandler(client, { target: "images" });

    expect(result.isError).toBe(true);
    expect(client.calls).toHaveLength(0);
  });

  it("cleans images when confirmed", async () => {
    const client = fakeClient({ message: "cleaned 12 images", error: false });

    const result = await adminMaintenanceCleanHandler(client, {
      target: "images",
      confirm: true,
    });

    expect(client.calls[0]).toEqual({
      method: "POST",
      path: "/api/admin/maintenance/clean/images",
      body: {},
    });
    expect(bodyOf(result)).toEqual({ cleaned: "images", message: "cleaned 12 images" });
  });

  it("maps the recipe_folders token to the hyphenated path", async () => {
    const client = fakeClient({ message: "ok", error: false });

    await adminMaintenanceCleanHandler(client, { target: "recipe_folders", confirm: true });

    expect(client.calls[0]?.path).toBe("/api/admin/maintenance/clean/recipe-folders");
  });

  it("cleans temp when confirmed", async () => {
    const client = fakeClient({ message: "ok", error: false });

    await adminMaintenanceCleanHandler(client, { target: "temp", confirm: true });

    expect(client.calls[0]?.path).toBe("/api/admin/maintenance/clean/temp");
  });

  it("treats error:true on a 200 as a failure", async () => {
    const client = fakeClient({ message: "fs error", error: true });

    const result = await adminMaintenanceCleanHandler(client, {
      target: "temp",
      confirm: true,
    });

    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain("fs error");
  });

  it("returns an error result when the client throws", async () => {
    const client = {
      async post<T>(): Promise<T> {
        throw new Error("boom");
      },
    };

    const result = await adminMaintenanceCleanHandler(client, {
      target: "images",
      confirm: true,
    });

    expect(result.isError).toBe(true);
  });
});

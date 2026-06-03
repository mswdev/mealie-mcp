import { describe, expect, it } from "vitest";
import { groupAiProviderSettingsUpdateHandler } from "./group-ai-provider-settings-update.js";

type Call = { method: string; path: string; body?: unknown };

function fakeClient(current?: unknown) {
  const calls: Call[] = [];
  return {
    calls,
    async get<T>(path: string): Promise<T> {
      calls.push({ method: "GET", path });
      return current as T;
    },
    async put<T>(path: string, body: unknown): Promise<T> {
      calls.push({ method: "PUT", path, body });
      return body as T;
    },
  };
}

describe("groupAiProviderSettingsUpdateHandler", () => {
  it("fetch-merges the three pointers, changing only the target and dropping Out-only fields", async () => {
    const client = fakeClient({
      defaultProviderId: "a",
      audioProviderId: "b",
      imageProviderId: "c",
      providers: [{ id: "a", name: "OpenAI" }],
      aiEnabled: true,
      audioProviderEnabled: false,
      imageProviderEnabled: true,
    });

    await groupAiProviderSettingsUpdateHandler(client, { changes: { imageProviderId: "z" } });

    expect(client.calls[0]).toEqual({
      method: "GET",
      path: "/api/groups/ai-providers/settings",
    });
    const put = client.calls.find((call) => call.method === "PUT");
    expect(put?.path).toBe("/api/groups/ai-providers/settings");
    // Exactly the three pointers; target changed; Out-only fields (providers/*Enabled) absent.
    expect(put?.body).toEqual({
      defaultProviderId: "a",
      audioProviderId: "b",
      imageProviderId: "z",
    });
  });

  it("nulls a pointer when explicitly set to null", async () => {
    const client = fakeClient({
      defaultProviderId: "a",
      audioProviderId: "b",
      imageProviderId: "c",
    });

    await groupAiProviderSettingsUpdateHandler(client, { changes: { defaultProviderId: null } });

    const put = client.calls.find((call) => call.method === "PUT");
    expect(put?.body).toEqual({
      defaultProviderId: null,
      audioProviderId: "b",
      imageProviderId: "c",
    });
  });

  it("rejects when changes is missing", async () => {
    const result = await groupAiProviderSettingsUpdateHandler(fakeClient(), {});

    expect(result.isError).toBe(true);
  });

  it("returns an error result when the client throws", async () => {
    const client = {
      async get<T>(): Promise<T> {
        throw new Error("boom");
      },
      async put<T>(): Promise<T> {
        throw new Error("boom");
      },
    };

    const result = await groupAiProviderSettingsUpdateHandler(client, {
      changes: { defaultProviderId: "x" },
    });

    expect(result.isError).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import { adminAiProviderGetHandler } from "./admin-ai-provider-get.js";

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

describe("adminAiProviderGetHandler", () => {
  it("reads one provider under the admin group-scoped path", async () => {
    const client = fakeClient({ id: "p1", name: "OpenAI", model: "gpt-4", baseUrl: null });

    const result = await adminAiProviderGetHandler(client, { group_id: "g1", provider_id: "p1" });

    expect(client.calls[0]).toEqual({
      method: "GET",
      path: "/api/admin/groups/g1/ai-providers/providers/p1",
    });
    expect(bodyOf(result)).toEqual({ id: "p1", name: "OpenAI", model: "gpt-4", baseUrl: null });
  });

  it("drops a stray apiKey even in detailed output (adversarial)", async () => {
    const client = fakeClient({ id: "p1", name: "OpenAI", apiKey: "sk-leak" });

    const result = await adminAiProviderGetHandler(client, {
      group_id: "g1",
      provider_id: "p1",
      response_format: "detailed",
    });

    expect((result.content[0] as { text: string }).text).not.toContain("sk-leak");
  });

  it("returns an error result when the client throws", async () => {
    const client = {
      async get<T>(): Promise<T> {
        throw new Error("boom");
      },
    };

    const result = await adminAiProviderGetHandler(client, { group_id: "g1", provider_id: "p1" });

    expect(result.isError).toBe(true);
  });
});

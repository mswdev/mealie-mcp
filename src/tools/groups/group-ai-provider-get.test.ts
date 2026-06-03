import { describe, expect, it } from "vitest";
import { groupAiProviderGetHandler } from "./group-ai-provider-get.js";

type Call = { method: string; path: string };

function fakeClient(value: unknown) {
  const calls: Call[] = [];
  return {
    calls,
    async get<T>(path: string): Promise<T> {
      calls.push({ method: "GET", path });
      return value as T;
    },
  };
}

function bodyOf(result: { content: unknown[] }): Record<string, unknown> {
  return JSON.parse((result.content[0] as { text: string }).text);
}

describe("groupAiProviderGetHandler", () => {
  it("gets one provider by id (concise), never echoing apiKey", async () => {
    const client = fakeClient({
      id: "p1",
      name: "OpenAI",
      model: "gpt-4",
      baseUrl: "https://api.openai.com",
      apiKey: "sk-SECRET", // must never appear in output
    });

    const result = await groupAiProviderGetHandler(client, { provider_id: "p1" });

    expect(client.calls[0]).toEqual({
      method: "GET",
      path: "/api/groups/ai-providers/providers/p1",
    });
    const body = bodyOf(result);
    expect(body).toEqual({
      id: "p1",
      name: "OpenAI",
      model: "gpt-4",
      baseUrl: "https://api.openai.com",
    });
    expect(body).not.toHaveProperty("apiKey");
  });

  it("never echoes apiKey even when detailed", async () => {
    const client = fakeClient({ id: "p1", name: "OpenAI", apiKey: "sk-SECRET" });

    const result = await groupAiProviderGetHandler(client, {
      provider_id: "p1",
      response_format: "detailed",
    });

    expect(bodyOf(result)).not.toHaveProperty("apiKey");
  });

  it("returns AI provider settings (incl. provider list) when no provider_id", async () => {
    const client = fakeClient({
      defaultProviderId: "p1",
      audioProviderId: null,
      imageProviderId: null,
      providers: [{ id: "p1", name: "OpenAI" }],
    });

    const result = await groupAiProviderGetHandler(client, {});

    expect(client.calls[0]).toEqual({ method: "GET", path: "/api/groups/ai-providers/settings" });
    expect(bodyOf(result)).toMatchObject({ defaultProviderId: "p1", providers: [{ id: "p1" }] });
  });

  it("returns an error result when the client throws", async () => {
    const client = {
      async get<T>(): Promise<T> {
        throw new Error("boom");
      },
    };

    const result = await groupAiProviderGetHandler(client, {});

    expect(result.isError).toBe(true);
  });
});

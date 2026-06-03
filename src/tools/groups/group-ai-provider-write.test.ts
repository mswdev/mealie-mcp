import { describe, expect, it } from "vitest";
import { groupAiProviderWriteHandler } from "./group-ai-provider-write.js";

type Call = { method: string; path: string; body?: unknown };

function fakeClient() {
  const calls: Call[] = [];
  return {
    calls,
    async post<T>(path: string, body: unknown): Promise<T> {
      calls.push({ method: "POST", path, body });
      // Mimic Mealie: AIProviderOut echoes back WITHOUT apiKey, but be adversarial
      // and include it to prove the handler's projection strips it.
      return { id: "p-new", ...(body as object) } as T;
    },
    async put<T>(path: string, body: unknown): Promise<T> {
      calls.push({ method: "PUT", path, body });
      return { id: "p1", ...(body as object) } as T;
    },
    async delete<T>(path: string): Promise<T> {
      calls.push({ method: "DELETE", path });
      return { id: "p1", name: "OpenAI" } as T;
    },
  };
}

function bodyOf(result: { content: unknown[] }): Record<string, unknown> {
  return JSON.parse((result.content[0] as { text: string }).text);
}

describe("groupAiProviderWriteHandler", () => {
  it("creates with defaults filled and never echoes apiKey", async () => {
    const client = fakeClient();

    const result = await groupAiProviderWriteHandler(client, {
      action: "create",
      name: "OpenAI",
      model: "gpt-4",
      apiKey: "sk-SECRET",
      baseUrl: "https://api.openai.com",
    });

    const post = client.calls[0];
    expect(post).toMatchObject({ method: "POST", path: "/api/groups/ai-providers/providers" });
    expect(post?.body).toEqual({
      name: "OpenAI",
      model: "gpt-4",
      apiKey: "sk-SECRET",
      timeout: 300,
      requestHeaders: {},
      requestParams: {},
      baseUrl: "https://api.openai.com",
    });
    expect(bodyOf(result)).not.toHaveProperty("apiKey");
  });

  it("rejects create when name/model/apiKey are missing", async () => {
    const r1 = await groupAiProviderWriteHandler(fakeClient(), { action: "create", name: "X" });
    const r2 = await groupAiProviderWriteHandler(fakeClient(), {
      action: "create",
      name: "X",
      model: "m",
    });

    expect(r1.isError).toBe(true);
    expect(r2.isError).toBe(true); // missing apiKey
  });

  it("updates with the full body (apiKey re-supplied), never echoing it", async () => {
    const client = fakeClient();

    const result = await groupAiProviderWriteHandler(client, {
      action: "update",
      provider_id: "p1",
      name: "OpenAI",
      model: "gpt-4o",
      apiKey: "sk-NEW",
    });

    expect(client.calls[0]).toMatchObject({
      method: "PUT",
      path: "/api/groups/ai-providers/providers/p1",
    });
    expect((client.calls[0]?.body as Record<string, unknown>).apiKey).toBe("sk-NEW");
    expect(bodyOf(result)).not.toHaveProperty("apiKey");
  });

  it("rejects update when apiKey is missing (cannot be recovered from a read)", async () => {
    const result = await groupAiProviderWriteHandler(fakeClient(), {
      action: "update",
      provider_id: "p1",
      name: "OpenAI",
      model: "gpt-4o",
    });

    expect(result.isError).toBe(true);
  });

  it("refuses to delete without confirm", async () => {
    const client = fakeClient();

    const result = await groupAiProviderWriteHandler(client, {
      action: "delete",
      provider_id: "p1",
    });

    expect(result.isError).toBe(true);
    expect(client.calls).toHaveLength(0);
  });

  it("deletes with confirm and synthesizes {deleted}", async () => {
    const client = fakeClient();

    const result = await groupAiProviderWriteHandler(client, {
      action: "delete",
      provider_id: "p1",
      confirm: true,
    });

    expect(client.calls[0]).toEqual({
      method: "DELETE",
      path: "/api/groups/ai-providers/providers/p1",
    });
    expect(bodyOf(result)).toEqual({ deleted: "p1" });
  });

  it("returns an error result when the client throws", async () => {
    const client = {
      async post<T>(): Promise<T> {
        throw new Error("boom");
      },
      async put<T>(): Promise<T> {
        throw new Error("boom");
      },
      async delete<T>(): Promise<T> {
        throw new Error("boom");
      },
    };

    const result = await groupAiProviderWriteHandler(client, {
      action: "create",
      name: "X",
      model: "m",
      apiKey: "k",
    });

    expect(result.isError).toBe(true);
  });
});

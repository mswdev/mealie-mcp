import { describe, expect, it } from "vitest";
import { MealieApiError } from "../../../client/MealieApiError.js";
import { adminAiProviderWriteHandler } from "./admin-ai-provider-write.js";

type Call = { method: string; path: string; body?: unknown };

function fakeClient(response?: unknown) {
  const calls: Call[] = [];
  return {
    calls,
    async post<T>(path: string, body: unknown): Promise<T> {
      calls.push({ method: "POST", path, body });
      return response as T;
    },
    async put<T>(path: string, body: unknown): Promise<T> {
      calls.push({ method: "PUT", path, body });
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

function textOf(result: { content: unknown[] }): string {
  return (result.content[0] as { text: string }).text;
}

const PROVIDER_OUT = { id: "p1", name: "OpenAI", model: "gpt-4", baseUrl: null };

const CREATE_ARGS = {
  action: "create" as const,
  group_id: "g1",
  name: "OpenAI",
  model: "gpt-4",
  apiKey: "sk-secret",
};

describe("adminAiProviderWriteHandler", () => {
  it("creates under the admin group path with required-with-default fields — apiKey never echoed", async () => {
    const client = fakeClient(PROVIDER_OUT);

    const result = await adminAiProviderWriteHandler(client, CREATE_ARGS);

    expect(client.calls[0]).toMatchObject({
      method: "POST",
      path: "/api/admin/groups/g1/ai-providers/providers",
    });
    expect(client.calls[0]?.body).toEqual({
      name: "OpenAI",
      model: "gpt-4",
      apiKey: "sk-secret",
      timeout: 300,
      requestHeaders: {},
      requestParams: {},
    });
    expect(textOf(result)).not.toContain("sk-secret");
    expect(bodyOf(result)).toEqual(PROVIDER_OUT);
  });

  it("refuses create without name/model/apiKey — no client call", async () => {
    const client = fakeClient();

    const result = await adminAiProviderWriteHandler(client, {
      ...CREATE_ARGS,
      apiKey: undefined,
    });

    expect(result.isError).toBe(true);
    expect(client.calls).toHaveLength(0);
  });

  it("updates with a full body — the apiKey must be re-supplied", async () => {
    const client = fakeClient(PROVIDER_OUT);

    await adminAiProviderWriteHandler(client, {
      ...CREATE_ARGS,
      action: "update",
      provider_id: "p1",
    });

    expect(client.calls[0]).toMatchObject({
      method: "PUT",
      path: "/api/admin/groups/g1/ai-providers/providers/p1",
    });
    expect(client.calls[0]?.body).toMatchObject({ apiKey: "sk-secret" });
  });

  it("refuses update without apiKey (the secret cannot be read back)", async () => {
    const client = fakeClient();

    const result = await adminAiProviderWriteHandler(client, {
      action: "update",
      group_id: "g1",
      provider_id: "p1",
      name: "OpenAI",
      model: "gpt-4",
    });

    expect(result.isError).toBe(true);
    expect(client.calls).toHaveLength(0);
  });

  it("refuses delete without confirmation — zero client calls", async () => {
    const client = fakeClient();

    const result = await adminAiProviderWriteHandler(client, {
      action: "delete",
      group_id: "g1",
      provider_id: "p1",
    });

    expect(result.isError).toBe(true);
    expect(client.calls).toHaveLength(0);
  });

  it("deletes when confirmed", async () => {
    const client = fakeClient(PROVIDER_OUT);

    const result = await adminAiProviderWriteHandler(client, {
      action: "delete",
      group_id: "g1",
      provider_id: "p1",
      confirm: true,
    });

    expect(client.calls[0]).toEqual({
      method: "DELETE",
      path: "/api/admin/groups/g1/ai-providers/providers/p1",
    });
    expect(bodyOf(result)).toEqual({ deleted: "p1" });
  });

  it("sanitizes error paths — a 422 echoing the apiKey never reaches the result", async () => {
    const client = {
      ...fakeClient(),
      async post<T>(): Promise<T> {
        throw new MealieApiError(
          422,
          "Unprocessable Entity",
          "/api/admin/groups/g1/ai-providers/providers",
          '{"input": "sk-secret"}',
        );
      },
    };

    const result = await adminAiProviderWriteHandler(client, CREATE_ARGS);

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("HTTP 422");
    expect(textOf(result)).not.toContain("sk-secret");
  });
});

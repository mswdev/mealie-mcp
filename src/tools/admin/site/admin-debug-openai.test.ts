import { describe, expect, it } from "vitest";
import { adminDebugOpenaiHandler } from "./admin-debug-openai.js";

function fakeClient(response?: unknown) {
  const calls: { method: string; path: string; form?: FormData }[] = [];
  return {
    calls,
    async postMultipart<T>(path: string, form: FormData): Promise<T> {
      calls.push({ method: "POST_MULTIPART", path, form });
      return response as T;
    },
  };
}

function bodyOf(result: { content: unknown[] }): Record<string, unknown> {
  return JSON.parse((result.content[0] as { text: string }).text);
}

describe("adminDebugOpenaiHandler", () => {
  it("probes the provider with an empty multipart form when no image is given", async () => {
    const client = fakeClient({ success: true, response: "pong" });

    const result = await adminDebugOpenaiHandler(client, { provider_id: "p1" });

    expect(client.calls[0]).toMatchObject({
      method: "POST_MULTIPART",
      path: "/api/admin/debug/openai/p1",
    });
    const form = client.calls[0]?.form as FormData;
    expect(form.get("image")).toBeNull();
    expect(bodyOf(result)).toEqual({ success: true, response: "pong" });
  });

  it("attaches the image under the verbatim 'image' field when provided", async () => {
    const client = fakeClient({ success: true, response: "saw the image" });
    const blob = new Blob(["png-bytes"]);

    await adminDebugOpenaiHandler(client, { provider_id: "p1", image_path: "/tmp/i.png" }, blob);

    const form = client.calls[0]?.form as FormData;
    expect(form.get("image")).toBeInstanceOf(Blob);
  });

  it("returns an error result when the client throws", async () => {
    const client = {
      async postMultipart<T>(): Promise<T> {
        throw new Error("boom");
      },
    };

    const result = await adminDebugOpenaiHandler(client, { provider_id: "p1" });

    expect(result.isError).toBe(true);
  });
});

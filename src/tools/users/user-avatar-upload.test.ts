import { describe, expect, it } from "vitest";
import { userAvatarUploadHandler } from "./user-avatar-upload.js";

type Call = { method: string; path: string; form?: FormData };

function fakeClient() {
  const calls: Call[] = [];
  return {
    calls,
    async get<T>(path: string): Promise<T> {
      calls.push({ method: "GET", path });
      return { id: "u1", username: "matt" } as T;
    },
    async postMultipart<T>(path: string, form: FormData): Promise<T> {
      calls.push({ method: "POST_MULTIPART", path, form });
      return undefined as T;
    },
  };
}

describe("userAvatarUploadHandler", () => {
  it("uploads the avatar under the verbatim 'profile' field to the own id", async () => {
    const client = fakeClient();
    const file = new Blob(["png-bytes"]);

    const result = await userAvatarUploadHandler(client, { filePath: "/tmp/me.png" }, file);

    expect(client.calls[0]).toEqual({ method: "GET", path: "/api/users/self" });
    expect(client.calls[1]).toMatchObject({
      method: "POST_MULTIPART",
      path: "/api/users/u1/image",
    });
    const form = client.calls[1]?.form as FormData;
    expect(form.get("profile")).toBeInstanceOf(Blob);
    expect(form.get("file")).toBeNull();
    const body = JSON.parse((result.content[0] as { text: string }).text);
    expect(body).toEqual({ uploaded: true, userId: "u1" });
  });

  it("rejects a missing file without calling the client", async () => {
    const client = fakeClient();

    const result = await userAvatarUploadHandler(client, { filePath: "/tmp/me.png" });

    expect(result.isError).toBe(true);
    expect(client.calls).toHaveLength(0);
  });

  it("returns an error result when the client throws", async () => {
    const client = {
      async get<T>(): Promise<T> {
        throw new Error("boom");
      },
      async postMultipart<T>(): Promise<T> {
        return undefined as T;
      },
    };

    const result = await userAvatarUploadHandler(
      client,
      { filePath: "/tmp/me.png" },
      new Blob(["x"]),
    );

    expect(result.isError).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import { organizerDeleteHandler } from "./organizer-delete.js";

describe("organizerDeleteHandler", () => {
  it("refuses without confirm and makes no client call", async () => {
    let called = false;
    const client = {
      async delete<T>(): Promise<T> {
        called = true;
        return undefined as T;
      },
    };

    const result = await organizerDeleteHandler(client, { type: "category", id: "u1" });

    expect(result.isError).toBe(true);
    expect(called).toBe(false);
  });

  it("deletes the typed item path when confirmed", async () => {
    const paths: string[] = [];
    const client = {
      async delete<T>(path: string): Promise<T> {
        paths.push(path);
        return undefined as T;
      },
    };

    const result = await organizerDeleteHandler(client, {
      type: "tool",
      id: "u1",
      confirm: true,
    });

    expect(paths).toEqual(["/api/organizers/tools/u1"]);
    const body = JSON.parse((result.content[0] as { text: string }).text);
    expect(body).toEqual({ deleted: "u1" });
  });

  it("returns an error result when the client throws", async () => {
    const client = {
      async delete<T>(): Promise<T> {
        throw new Error("409");
      },
    };

    const result = await organizerDeleteHandler(client, { type: "tag", id: "x", confirm: true });

    expect(result.isError).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import { cookbookUpdateHandler } from "./cookbook-update.js";

type Call = { method: string; path: string; body: unknown };

function fakeClient(current: unknown) {
  const calls: Call[] = [];
  return {
    calls,
    async get<T>(path: string): Promise<T> {
      calls.push({ method: "GET", path, body: undefined });
      return current as T;
    },
    async put<T>(path: string, body: unknown): Promise<T> {
      calls.push({ method: "PUT", path, body });
      return (Array.isArray(body) ? body : { ...(current as object), ...(body as object) }) as T;
    },
  };
}

describe("cookbookUpdateHandler", () => {
  it("single: fetch-merges changes and PUTs to the item path", async () => {
    const client = fakeClient({
      id: "u1",
      slug: "s",
      name: "Old",
      description: "d",
      public: false,
      position: 1,
      queryFilterString: "",
    });

    const result = await cookbookUpdateHandler(client, { id: "u1", changes: { name: "New" } });

    expect(client.calls[0]).toMatchObject({ method: "GET", path: "/api/households/cookbooks/u1" });
    expect(client.calls[1]).toMatchObject({ method: "PUT", path: "/api/households/cookbooks/u1" });
    expect((client.calls[1]?.body as { name: string }).name).toBe("New");
    expect(result.isError).toBeUndefined();
  });

  it("bulk: PUTs the items array to the collection path", async () => {
    const client = fakeClient(undefined);
    const items = [
      { id: "u1", name: "A" },
      { id: "u2", name: "B" },
    ];

    const result = await cookbookUpdateHandler(client, { items });

    expect(client.calls[0]).toMatchObject({ method: "PUT", path: "/api/households/cookbooks" });
    expect(client.calls[0]?.body).toEqual(items);
    // echoes the updated cookbooks concise (the bulk PUT returns ReadCookBook[])
    const body = JSON.parse((result.content[0] as { text: string }).text);
    expect(body.updated).toHaveLength(2);
    expect(body.updated.map((c: { id: string }) => c.id)).toEqual(["u1", "u2"]);
    expect(body.updated[0]).toMatchObject({ id: "u1", name: "A" });
  });

  it("errors when neither id nor items is provided", async () => {
    const result = await cookbookUpdateHandler(fakeClient(undefined), {});

    expect(result.isError).toBe(true);
  });
});

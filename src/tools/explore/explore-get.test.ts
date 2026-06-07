import { describe, expect, it } from "vitest";
import { exploreGetHandler } from "./explore-get.js";

function fakeGetClient(calls: string[], response: unknown) {
  return {
    async get<T>(path: string): Promise<T> {
      calls.push(path);
      return response as T;
    },
  };
}

describe("exploreGetHandler", () => {
  it("fetches a catalog item by id with a concise projection", async () => {
    const calls: string[] = [];
    const client = fakeGetClient(calls, {
      id: "c1",
      slug: "dinner",
      name: "Dinner",
      groupId: "g1",
    });

    const result = await exploreGetHandler(client, {
      type: "category",
      group_slug: "home",
      id: "c1",
    });

    expect(calls).toEqual(["/api/explore/groups/home/organizers/categories/c1"]);
    const body = JSON.parse((result.content[0] as { text: string }).text);
    expect(body).toEqual({ id: "c1", slug: "dinner", name: "Dinner" });
  });

  it("treats id as the household slug for type=household", async () => {
    const calls: string[] = [];
    const client = fakeGetClient(calls, { id: "h1", slug: "main-house", name: "Main" });

    await exploreGetHandler(client, { type: "household", group_slug: "home", id: "main-house" });

    expect(calls).toEqual(["/api/explore/groups/home/households/main-house"]);
  });

  it("URI-encodes the id segment", async () => {
    const calls: string[] = [];
    const client = fakeGetClient(calls, { id: "x" });

    await exploreGetHandler(client, { type: "food", group_slug: "home", id: "a/b" });

    expect(calls).toEqual(["/api/explore/groups/home/foods/a%2Fb"]);
  });

  it("returns the full object when detailed", async () => {
    const full = { id: "k1", slug: "b", name: "B", position: 9, queryFilterString: "tags.id=1" };
    const client = fakeGetClient([], full);

    const result = await exploreGetHandler(client, {
      type: "cookbook",
      group_slug: "home",
      id: "k1",
      response_format: "detailed",
    });

    const body = JSON.parse((result.content[0] as { text: string }).text);
    expect(body).toEqual(full);
  });

  it("returns an error result when the client throws", async () => {
    const client = {
      async get<T>(): Promise<T> {
        throw new Error("404 group not found");
      },
    };

    const result = await exploreGetHandler(client, { type: "tool", group_slug: "x", id: "t1" });

    expect(result.isError).toBe(true);
  });
});

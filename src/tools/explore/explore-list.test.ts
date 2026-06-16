import { describe, expect, it } from "vitest";
import { exploreListHandler } from "./explore-list.js";

type Captured = { path: string; query: unknown };

function fakePaginatedClient(captured: Captured[]) {
  return {
    async getPaginated<T>(path: string, query: unknown): Promise<T> {
      captured.push({ path, query });
      return {
        items: [{ id: "u1", slug: "dinner", name: "Dinner", position: 2, public: true }],
        total: 1,
        page: 1,
        perPage: 20,
        totalPages: 1,
      } as T;
    },
  };
}

describe("exploreListHandler", () => {
  it("lists the typed public collection paginated with concise items", async () => {
    const captured: Captured[] = [];

    const result = await exploreListHandler(fakePaginatedClient(captured), {
      type: "cookbook",
      group_slug: "home",
    });

    expect(captured[0]?.path).toBe("/api/explore/groups/home/cookbooks");
    expect(captured[0]?.query).toMatchObject({ perPage: 20 });
    const body = JSON.parse((result.content[0] as { text: string }).text);
    expect(body.items).toEqual([{ id: "u1", slug: "dinner", name: "Dinner" }]);
    expect(body).toMatchObject({ total: 1, page: 1, perPage: 20, totalPages: 1 });
  });

  it("routes organizer types under organizers/ and passes filters through", async () => {
    const captured: Captured[] = [];

    await exploreListHandler(fakePaginatedClient(captured), {
      type: "tag",
      group_slug: "home",
      search: "quick",
      page: 2,
      perPage: 50,
      orderBy: "name",
      orderDirection: "asc",
    });

    expect(captured[0]?.path).toBe("/api/explore/groups/home/organizers/tags");
    expect(captured[0]?.query).toMatchObject({
      search: "quick",
      page: 2,
      perPage: 50,
      orderBy: "name",
      orderDirection: "asc",
    });
  });

  it("projects foods to id/name/labelId", async () => {
    const client = {
      async getPaginated<T>(): Promise<T> {
        return {
          items: [{ id: "f1", name: "Flour", labelId: "l1", aliases: [{}] }],
          total: 1,
          page: 1,
          perPage: 20,
          totalPages: 1,
        } as T;
      },
    };

    const result = await exploreListHandler(client, { type: "food", group_slug: "home" });

    const body = JSON.parse((result.content[0] as { text: string }).text);
    expect(body.items).toEqual([{ id: "f1", name: "Flour", labelId: "l1" }]);
  });

  it("rejects search for households (no upstream search param)", async () => {
    const client = {
      async getPaginated<T>(): Promise<T> {
        throw new Error("must not call");
      },
    };

    const result = await exploreListHandler(client, {
      type: "household",
      group_slug: "home",
      search: "x",
    });

    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain("not supported");
  });

  it("returns an error result when the client throws (e.g. 404 private group)", async () => {
    const client = {
      async getPaginated<T>(): Promise<T> {
        throw new Error("404 group not found");
      },
    };

    const result = await exploreListHandler(client, { type: "category", group_slug: "nope" });

    expect(result.isError).toBe(true);
  });
});

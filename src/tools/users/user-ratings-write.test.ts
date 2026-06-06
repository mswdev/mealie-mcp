import { describe, expect, it } from "vitest";
import { userRatingsWriteHandler } from "./user-ratings-write.js";

type Call = { method: string; path: string; body?: unknown };

function fakeClient() {
  const calls: Call[] = [];
  return {
    calls,
    async get<T>(path: string): Promise<T> {
      calls.push({ method: "GET", path });
      return { id: "u1", username: "matt" } as T;
    },
    async post<T>(path: string, body: unknown): Promise<T> {
      calls.push({ method: "POST", path, body });
      return undefined as T;
    },
    async delete<T>(path: string): Promise<T> {
      calls.push({ method: "DELETE", path });
      return undefined as T;
    },
  };
}

function bodyOf(result: { content: unknown[] }): Record<string, unknown> {
  return JSON.parse((result.content[0] as { text: string }).text);
}

describe("userRatingsWriteHandler", () => {
  it("rates a recipe — resolves the own id, POSTs the rating body", async () => {
    const client = fakeClient();

    const result = await userRatingsWriteHandler(client, {
      action: "rate",
      recipe_slug: "pasta",
      rating: 4.5,
    });

    expect(client.calls[0]).toEqual({ method: "GET", path: "/api/users/self" });
    expect(client.calls[1]).toEqual({
      method: "POST",
      path: "/api/users/u1/ratings/pasta",
      body: { rating: 4.5 },
    });
    expect(bodyOf(result)).toEqual({ action: "rate", recipeSlug: "pasta", rating: 4.5 });
  });

  it("rejects rate without a rating value (no client calls)", async () => {
    const client = fakeClient();

    const result = await userRatingsWriteHandler(client, { action: "rate", recipe_slug: "pasta" });

    expect(result.isError).toBe(true);
    expect(client.calls).toHaveLength(0);
  });

  it("favorites a recipe", async () => {
    const client = fakeClient();

    const result = await userRatingsWriteHandler(client, {
      action: "favorite",
      recipe_slug: "pasta",
    });

    expect(client.calls[1]).toMatchObject({
      method: "POST",
      path: "/api/users/u1/favorites/pasta",
    });
    expect(bodyOf(result)).toEqual({ action: "favorite", recipeSlug: "pasta" });
  });

  it("refuses unfavorite without confirm — zero client calls, not even the self GET", async () => {
    const client = fakeClient();

    const result = await userRatingsWriteHandler(client, {
      action: "unfavorite",
      recipe_slug: "pasta",
    });

    expect(result.isError).toBe(true);
    expect(client.calls).toHaveLength(0);
  });

  it("unfavorites with confirm:true", async () => {
    const client = fakeClient();

    const result = await userRatingsWriteHandler(client, {
      action: "unfavorite",
      recipe_slug: "pasta",
      confirm: true,
    });

    expect(client.calls[0]).toEqual({ method: "GET", path: "/api/users/self" });
    expect(client.calls[1]).toEqual({ method: "DELETE", path: "/api/users/u1/favorites/pasta" });
    expect(bodyOf(result)).toEqual({ action: "unfavorite", recipeSlug: "pasta" });
  });

  it("returns an error result when the client throws", async () => {
    const client = {
      async get<T>(): Promise<T> {
        throw new Error("boom");
      },
      async post<T>(): Promise<T> {
        return undefined as T;
      },
      async delete<T>(): Promise<T> {
        return undefined as T;
      },
    };

    const result = await userRatingsWriteHandler(client, {
      action: "favorite",
      recipe_slug: "pasta",
    });

    expect(result.isError).toBe(true);
  });
});

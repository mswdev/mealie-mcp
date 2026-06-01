import { afterEach, describe, expect, it, vi } from "vitest";
import { MealieApiError } from "./MealieApiError.js";
import { MealieClient } from "./MealieClient.js";

type FetchArgs = { url: string; init: RequestInit };

/** Stubs global fetch, capturing the call and returning a 200 JSON body. */
function stubFetchOk(body: unknown, captured: FetchArgs[]): void {
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    captured.push({ url, init });
    return new Response(JSON.stringify(body), { status: 200 });
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("MealieClient write verbs", () => {
  it("post sends a JSON body and Bearer auth, returns parsed JSON", async () => {
    const captured: FetchArgs[] = [];
    stubFetchOk({ ok: true }, captured);
    const client = new MealieClient("https://m.test/", "tok");

    const result = await client.post<{ ok: boolean }>("/api/recipes", { name: "Soup" });

    const call = captured[0];
    expect(call?.url).toBe("https://m.test/api/recipes");
    expect(call?.init.method).toBe("POST");
    expect(call?.init.body).toBe(JSON.stringify({ name: "Soup" }));
    expect((call?.init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
    expect((call?.init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
    expect(result).toEqual({ ok: true });
  });

  it("put and patch use the right method", async () => {
    const captured: FetchArgs[] = [];
    stubFetchOk({}, captured);
    const client = new MealieClient("https://m.test", "tok");

    await client.put("/api/recipes/soup", { a: 1 });
    await client.patch("/api/recipes/soup", { a: 2 });

    expect(captured[0]?.init.method).toBe("PUT");
    expect(captured[1]?.init.method).toBe("PATCH");
  });

  it("appends query params to write requests", async () => {
    const captured: FetchArgs[] = [];
    stubFetchOk({}, captured);
    const client = new MealieClient("https://m.test", "tok");

    await client.post("/api/x", {}, { translateLanguage: "en" });

    expect(captured[0]?.url).toBe("https://m.test/api/x?translateLanguage=en");
  });

  it("delete issues a DELETE with no body", async () => {
    const captured: FetchArgs[] = [];
    stubFetchOk({}, captured);
    const client = new MealieClient("https://m.test", "tok");

    await client.delete("/api/recipes/soup");

    expect(captured[0]?.init.method).toBe("DELETE");
    expect(captured[0]?.init.body).toBeUndefined();
  });

  it("throws MealieApiError on a non-2xx response", async () => {
    vi.stubGlobal(
      "fetch",
      async () => new Response("nope", { status: 409, statusText: "Conflict" }),
    );
    const client = new MealieClient("https://m.test", "tok");

    await expect(client.put("/api/recipes/soup", {})).rejects.toBeInstanceOf(MealieApiError);
  });

  it("tolerates an empty 200 body (returns undefined, does not throw)", async () => {
    vi.stubGlobal("fetch", async () => new Response("", { status: 200 }));
    const client = new MealieClient("https://m.test", "tok");

    await expect(client.delete("/api/recipes/soup")).resolves.toBeUndefined();
  });
});

describe("MealieClient.postMultipart", () => {
  it("sends FormData with auth but NO manual Content-Type (fetch sets the boundary)", async () => {
    const captured: FetchArgs[] = [];
    stubFetchOk({ image: "abc.webp" }, captured);
    const client = new MealieClient("https://m.test", "tok");
    const form = new FormData();
    form.append("image", new Blob([new Uint8Array([1, 2, 3])]), "x.jpg");
    form.append("extension", "jpg");

    const result = await client.postMultipart<{ image: string }>("/api/recipes/soup/image", form);

    const headers = captured[0]?.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer tok");
    expect(headers["Content-Type"]).toBeUndefined();
    expect(captured[0]?.init.body).toBe(form);
    expect(result).toEqual({ image: "abc.webp" });
  });

  it("supports a method override for multipart PUT", async () => {
    const captured: FetchArgs[] = [];
    stubFetchOk({}, captured);
    const client = new MealieClient("https://m.test", "tok");

    await client.postMultipart("/api/recipes/soup/image", new FormData(), undefined, "PUT");

    expect(captured[0]?.init.method).toBe("PUT");
  });
});

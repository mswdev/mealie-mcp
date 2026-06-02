import { describe, expect, it } from "vitest";
import { appGetInfoHandler } from "./app-get-info.js";

function fakeClient(paths: string[]) {
  return {
    async get<T>(path: string): Promise<T> {
      paths.push(path);
      if (path.endsWith("/startup-info")) return { isFirstLogin: false } as T;
      if (path.endsWith("/theme")) return { lightPrimary: "#fff" } as T;
      return { production: true, version: "v1.12.0" } as T;
    },
  };
}

describe("appGetInfoHandler", () => {
  it("returns about only when no include is given", async () => {
    const paths: string[] = [];

    const result = await appGetInfoHandler(fakeClient(paths), {});

    expect(paths).toEqual(["/api/app/about"]);
    const body = JSON.parse((result.content[0] as { text: string }).text);
    expect(body.about).toMatchObject({ version: "v1.12.0", production: true });
    expect(body.startup_info).toBeUndefined();
    expect(body.theme).toBeUndefined();
  });

  it("bundles startup_info and theme when included", async () => {
    const paths: string[] = [];

    const result = await appGetInfoHandler(fakeClient(paths), {
      include: ["startup_info", "theme"],
    });

    expect(paths).toEqual([
      "/api/app/about",
      "/api/app/about/startup-info",
      "/api/app/about/theme",
    ]);
    const body = JSON.parse((result.content[0] as { text: string }).text);
    expect(body.startup_info).toEqual({ isFirstLogin: false });
    expect(body.theme).toEqual({ lightPrimary: "#fff" });
  });

  it("fetches only the requested section", async () => {
    const paths: string[] = [];

    await appGetInfoHandler(fakeClient(paths), { include: ["theme"] });

    expect(paths).toEqual(["/api/app/about", "/api/app/about/theme"]);
  });

  it("returns an error result when the client throws", async () => {
    const client = {
      async get<T>(): Promise<T> {
        throw new Error("connection refused");
      },
    };

    const result = await appGetInfoHandler(client, {});

    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain("connection refused");
  });
});

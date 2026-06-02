import { describe, expect, it } from "vitest";
import { appDownloadFileHandler } from "./app-download-file.js";

describe("appDownloadFileHandler", () => {
  it("builds the download URL from baseUrl + token", () => {
    const result = appDownloadFileHandler({ baseUrl: "https://m.test" }, { token: "abc123" });

    const body = JSON.parse((result.content[0] as { text: string }).text);
    expect(body).toEqual({ url: "https://m.test/api/utils/download?token=abc123" });
  });

  it("url-encodes the token", () => {
    const result = appDownloadFileHandler({ baseUrl: "https://m.test" }, { token: "a/b+c=" });

    const body = JSON.parse((result.content[0] as { text: string }).text);
    expect(body.url).toBe("https://m.test/api/utils/download?token=a%2Fb%2Bc%3D");
  });
});

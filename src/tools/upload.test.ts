import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readUploadFile } from "./upload.js";

let dir: string;
let filePath: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "upload-test-"));
  filePath = join(dir, "x.bin");
  await writeFile(filePath, new Uint8Array([1, 2, 3, 4, 5]));
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("readUploadFile", () => {
  it("reads a server-local file into a Blob of the right size", async () => {
    const blob = await readUploadFile(filePath);

    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBe(5);
  });

  it("rejects when the file does not exist", async () => {
    await expect(readUploadFile(join(dir, "missing.bin"))).rejects.toBeDefined();
  });
});

import { readFile } from "node:fs/promises";

/**
 * Reads a server-local file into a Blob for multipart upload. Only usable when the
 * MCP server shares a filesystem with the caller (stdio/local transport); under
 * remote/http transport the path will not resolve to the caller's file.
 *
 * @param path - Absolute or cwd-relative path to the file on the server
 * @returns A Blob of the file's bytes
 * @throws when the file cannot be read
 */
export async function readUploadFile(path: string): Promise<Blob> {
  const bytes = await readFile(path);
  return new Blob([bytes]);
}

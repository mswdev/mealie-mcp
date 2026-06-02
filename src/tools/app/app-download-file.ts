import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod";
import type { MealieClient } from "../../client/MealieClient.js";
import { jsonResult } from "../result.js";

/** Minimal client surface the handler needs (eases test fakes). */
type DownloadClient = Pick<MealieClient, "baseUrl">;

const inputSchema = {
  token: z.string().min(1).describe("Signed download token (e.g. from a backup/export tool)"),
};

type DownloadArgs = { token: string };

/**
 * Handles app_download_file: resolves a signed token to the Mealie file-download
 * URL. Returns a reference URL, never the bytes (per the media-as-URLs convention),
 * so it works identically over stdio and http transports.
 *
 * @param client - A MealieClient (or compatible fake exposing baseUrl)
 * @param args - Validated arguments (token)
 * @returns An MCP result with the resolved download URL
 */
export function appDownloadFileHandler(client: DownloadClient, args: DownloadArgs): CallToolResult {
  const url = `${client.baseUrl}/api/utils/download?token=${encodeURIComponent(args.token)}`;
  return jsonResult({ url });
}

/**
 * Registers the app_download_file tool on the server.
 *
 * @param server - The McpServer to register on
 * @param client - The MealieClient used by the handler
 */
export function registerAppDownloadFile(server: McpServer, client: MealieClient): void {
  server.registerTool(
    "app_download_file",
    {
      title: "Resolve Download URL",
      description:
        "Resolves a signed download token to the Mealie file-download URL (e.g. for backups/exports). Returns a URL reference, not the file bytes.",
      inputSchema,
      // openWorldHint stays true for app_* convention uniformity even though this
      // handler only builds a string — the URL it returns targets the external Mealie API.
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    (args) => appDownloadFileHandler(client, args),
  );
}

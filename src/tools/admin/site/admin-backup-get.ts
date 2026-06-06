import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod";
import type { MealieClient } from "../../../client/MealieClient.js";
import type { components } from "../../../types/mealie.js";
import { jsonResult, secretSafeErrorResult } from "../../result.js";

const BACKUPS_PATH = "/api/admin/backups";
/** The shared one-time download endpoint (same flow as app_download_file). */
const DOWNLOAD_PATH = "/api/utils/download";

/** The list wrapper {imports, templates} — not a pagination envelope, not a bare array. */
type BackupsList = components["schemas"]["AllBackups"];
/** The by-file response — a one-time download token, not the file bytes. */
type FileToken = components["schemas"]["FileTokenResponse"];

/** Minimal client surface the handler needs (eases test fakes). */
type GetClient = Pick<MealieClient, "get" | "baseUrl">;

const inputSchema = {
  file_name: z
    .string()
    .optional()
    .describe("Get a download URL for one backup archive by file name (from the list)"),
};

type BackupGetArgs = { file_name?: string | undefined };

/**
 * Handles admin_backup_get: lists backup archives (imports + templates) or
 * composes a one-time download URL for one backup from its file token.
 *
 * @param client - A MealieClient (or compatible fake exposing baseUrl)
 * @param args - Validated arguments (file_name branches to the token read)
 * @returns An MCP result with the list or {fileName, downloadUrl}, or a sanitized error result
 */
export async function adminBackupGetHandler(
  client: GetClient,
  args: BackupGetArgs,
): Promise<CallToolResult> {
  try {
    if (args.file_name) return await downloadUrl(client, args.file_name);
    return await list(client);
  } catch (error) {
    // secretSafe: the by-file response carries a download token (parse errors embed bodies).
    return secretSafeErrorResult(error, "admin_backup_get", "Failed to read backups");
  }
}

/** Lists the AllBackups wrapper — passed through as {imports, templates}. */
async function list(client: GetClient): Promise<CallToolResult> {
  const backups = await client.get<BackupsList>(BACKUPS_PATH);
  return jsonResult({ imports: backups.imports, templates: backups.templates });
}

/** Exchanges the file name for a token and composes the download URL. */
async function downloadUrl(client: GetClient, fileName: string): Promise<CallToolResult> {
  const token = await client.get<FileToken>(`${BACKUPS_PATH}/${fileName}`);
  const url = `${client.baseUrl}${DOWNLOAD_PATH}?token=${encodeURIComponent(token.fileToken)}`;
  return jsonResult({ fileName, downloadUrl: url });
}

/**
 * Registers the admin_backup_get tool on the server.
 *
 * @param server - The McpServer to register on
 * @param client - The MealieClient used by the handler
 */
export function registerAdminBackupGet(server: McpServer, client: MealieClient): void {
  server.registerTool(
    "admin_backup_get",
    {
      title: "Admin: Get Backups",
      description:
        "List backup archives (imports + templates; sizes are display strings) or get a one-time download URL for one backup by file_name.",
      inputSchema,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    (args) => adminBackupGetHandler(client, args),
  );
}

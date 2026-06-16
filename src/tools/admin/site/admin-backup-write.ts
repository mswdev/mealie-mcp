import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod";
import type { MealieClient } from "../../../client/MealieClient.js";
import { requireConfirmation } from "../../confirm.js";
import { errorResult, jsonResult } from "../../result.js";
import { readUploadFile } from "../../upload.js";
import type { SuccessResponse } from "../admin-projection.js";

const BACKUPS_PATH = "/api/admin/backups";
const UPLOAD_PATH = "/api/admin/backups/upload";
/** Verbatim multipart field name from Body_upload_one_api_admin_backups_upload_post. */
const ARCHIVE_FIELD = "archive";
/** Fallback filename for the uploaded archive part. */
const DEFAULT_FILENAME = "backup.zip";

/** Minimal client surface the handler needs (eases test fakes). */
type WriteClient = Pick<MealieClient, "post" | "postMultipart" | "delete">;

const inputSchema = {
  action: z.enum(["create", "upload", "delete"]).describe("What to do"),
  filePath: z
    .string()
    .optional()
    .describe("Server-local path to a backup archive to upload (stdio/local only; action=upload)"),
  file_name: z.string().optional().describe("The backup archive's file name (action=delete)"),
  confirm: z.boolean().optional().describe("Must be true to delete"),
};

type BackupWriteArgs = {
  action: "create" | "upload" | "delete";
  filePath?: string | undefined;
  file_name?: string | undefined;
  confirm?: boolean | undefined;
};

/**
 * Handles admin_backup_write: creates a new backup, uploads an archive
 * (multipart), or deletes one (confirm-gated). The archive file is read in the
 * registration layer so this handler stays filesystem-free and testable.
 *
 * @param client - A MealieClient (or compatible fake)
 * @param args - Validated arguments (action + action fields)
 * @param file - The pre-read archive Blob (action=upload)
 * @returns An MCP result for the action, or an error result
 */
export async function adminBackupWriteHandler(
  client: WriteClient,
  args: BackupWriteArgs,
  file?: Blob,
): Promise<CallToolResult> {
  const refusal = validate(args, file);
  if (refusal) return refusal;
  try {
    if (args.action === "create") return await create(client);
    if (args.action === "upload") return await upload(client, args, file as Blob);
    return await remove(client, args);
  } catch (error) {
    return errorResult(error, "admin_backup_write", "Failed to write backup");
  }
}

/** Validates per-action required args; returns an isError result or null. */
function validate(args: BackupWriteArgs, file: Blob | undefined): CallToolResult | null {
  if (args.action === "upload") {
    return file ? null : missing("requires a readable filePath");
  }
  if (args.action === "delete") {
    if (!args.file_name) return missing("file_name is required for delete");
    return requireConfirmation(args.confirm, `delete backup ${args.file_name}`);
  }
  return null;
}

/** Creates a backup — the endpoint takes no body. */
async function create(client: WriteClient): Promise<CallToolResult> {
  const response = await client.post<SuccessResponse>(BACKUPS_PATH, {});
  if (response.error) {
    return errorResult(new Error(response.message), "admin_backup_write", "Backup failed");
  }
  return jsonResult({ action: "create", message: response.message });
}

/** Uploads an archive — a single multipart field named exactly "archive". */
async function upload(
  client: WriteClient,
  args: BackupWriteArgs,
  file: Blob,
): Promise<CallToolResult> {
  const form = new FormData();
  form.append(ARCHIVE_FIELD, file, args.filePath?.split("/").pop() ?? DEFAULT_FILENAME);
  const response = await client.postMultipart<SuccessResponse>(UPLOAD_PATH, form);
  if (response.error) {
    return errorResult(new Error(response.message), "admin_backup_write", "Upload failed");
  }
  return jsonResult({ uploaded: true, message: response.message });
}

/** Deletes a backup archive by file name. */
async function remove(client: WriteClient, args: BackupWriteArgs): Promise<CallToolResult> {
  const response = await client.delete<SuccessResponse>(`${BACKUPS_PATH}/${args.file_name}`);
  if (response.error) {
    return errorResult(new Error(response.message), "admin_backup_write", "Delete failed");
  }
  return jsonResult({ deleted: args.file_name });
}

/** Returns an isError result describing the missing requirement. */
function missing(requirement: string): CallToolResult {
  return {
    content: [{ type: "text", text: `admin_backup_write: ${requirement}` }],
    isError: true,
  };
}

/** Reads the archive file for uploads; returns undefined or the read error. */
async function loadBackupArchive(args: BackupWriteArgs): Promise<Blob | undefined | Error> {
  if (args.action !== "upload" || !args.filePath) return undefined;
  try {
    return await readUploadFile(args.filePath);
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
}

/**
 * Registers the admin_backup_write tool. The registration layer reads the
 * archive file so the handler stays filesystem-free and testable.
 *
 * @param server - The McpServer to register on
 * @param client - The MealieClient used by the handler
 */
export function registerAdminBackupWrite(server: McpServer, client: MealieClient): void {
  server.registerTool(
    "admin_backup_write",
    {
      title: "Admin: Write Backups",
      description:
        "Create a new instance backup, upload a backup archive (reads a file on the MCP server — stdio/local only), or delete one (confirm required). Restoring is a separate, double-gated tool: admin_backup_restore.",
      inputSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    },
    async (args) => {
      const file = await loadBackupArchive(args);
      if (file instanceof Error) {
        return errorResult(file, "admin_backup_write", "Failed to read file");
      }
      return adminBackupWriteHandler(client, args, file);
    },
  );
}

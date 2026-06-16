import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod";
import type { MealieClient } from "../../../client/MealieClient.js";
import { requireConfirmation } from "../../confirm.js";
import { errorResult, jsonResult } from "../../result.js";
import type { SuccessResponse } from "../admin-projection.js";

const BACKUPS_PATH = "/api/admin/backups";

/** Minimal client surface the handler needs (eases test fakes). */
type RestoreClient = Pick<MealieClient, "post">;

const inputSchema = {
  file_name: z.string().describe("The backup archive to restore (see admin_backup_get)"),
  confirm: z.boolean().optional().describe("Must be true — this OVERWRITES the entire instance"),
  confirm_file_name: z
    .string()
    .optional()
    .describe(
      "Re-type file_name exactly — the second gate for the most destructive operation in the API",
    ),
};

type RestoreArgs = {
  file_name: string;
  confirm?: boolean | undefined;
  confirm_file_name?: string | undefined;
};

/**
 * Handles admin_backup_restore: restores a backup archive, OVERWRITING the
 * entire Mealie instance. Double-gated — requires confirm:true AND
 * confirm_file_name re-typed to exactly match file_name, both checked before
 * any client call.
 *
 * @param client - A MealieClient (or compatible fake)
 * @param args - Validated arguments (file_name + both gates)
 * @returns An MCP result reporting the restore outcome, or an error result
 */
export async function adminBackupRestoreHandler(
  client: RestoreClient,
  args: RestoreArgs,
): Promise<CallToolResult> {
  const refusal = gates(args);
  if (refusal) return refusal;
  try {
    const path = `${BACKUPS_PATH}/${args.file_name}/restore`;
    const response = await client.post<SuccessResponse>(path, {});
    if (response.error) {
      return errorResult(new Error(response.message), "admin_backup_restore", "Restore failed");
    }
    return jsonResult({ restored: args.file_name, message: response.message });
  } catch (error) {
    return errorResult(error, "admin_backup_restore", "Failed to restore backup");
  }
}

/** The double gate: confirm flag first, then the exact-match filename re-type. */
function gates(args: RestoreArgs): CallToolResult | null {
  const unconfirmed = requireConfirmation(
    args.confirm,
    `restore backup ${args.file_name} (OVERWRITES the entire instance)`,
  );
  if (unconfirmed) return unconfirmed;
  if (args.confirm_file_name !== args.file_name) {
    return {
      content: [
        {
          type: "text",
          text: `admin_backup_restore: confirm_file_name ("${args.confirm_file_name ?? ""}") must exactly match file_name ("${args.file_name}") — re-type it to proceed.`,
        },
      ],
      isError: true,
    };
  }
  return null;
}

/**
 * Registers the admin_backup_restore tool on the server.
 *
 * @param server - The McpServer to register on
 * @param client - The MealieClient used by the handler
 */
export function registerAdminBackupRestore(server: McpServer, client: MealieClient): void {
  server.registerTool(
    "admin_backup_restore",
    {
      title: "Admin: RESTORE Backup (Destructive)",
      description:
        "RESTORE a backup — OVERWRITES the entire Mealie instance (all recipes, users, settings) with the archive's contents and may restart the server or invalidate sessions. Requires confirm:true AND confirm_file_name re-typed to exactly match file_name.",
      inputSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    },
    (args) => adminBackupRestoreHandler(client, args),
  );
}

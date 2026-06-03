import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod";
import type { MealieClient } from "../../client/MealieClient.js";
import type { components } from "../../types/mealie.js";
import { requireConfirmation } from "../confirm.js";
import { errorResult, jsonResult } from "../result.js";
import { readUploadFile } from "../upload.js";

/** Path for the group data-migration resource. */
const PATH = "/api/groups/migrations";
/** Upload filename for the migration archive part. */
const ARCHIVE_FILENAME = "migration.zip";
/** Supported migration source formats (SupportedMigrations enum). */
const MIGRATION_TYPES = [
  "nextcloud",
  "chowdown",
  "copymethat",
  "paprika",
  "mealie_alpha",
  "tandoor",
  "plantoeat",
  "myrecipebox",
  "recipekeeper",
  "cookn",
] as const;

/** A report summary describing the started migration job. */
type ReportSummary = components["schemas"]["ReportSummary"];

/** Minimal client surface the handler needs (eases test fakes). */
type MigrationClient = Pick<MealieClient, "postMultipart">;

const inputSchema = {
  migration_type: z.enum(MIGRATION_TYPES).describe("Source format of the archive being imported"),
  filePath: z.string().describe("Server-local path to the migration archive (stdio/local only)"),
  add_migration_tag: z
    .boolean()
    .optional()
    .describe("Tag imported recipes with the migration source (default false)"),
  confirm: z.boolean().optional().describe("Must be true — importing a dataset is destructive"),
};

type MigrationArgs = {
  migration_type: (typeof MIGRATION_TYPES)[number];
  filePath?: string | undefined;
  add_migration_tag?: boolean | undefined;
  confirm?: boolean | undefined;
};

/**
 * Handles group_start_migration: uploads a migration archive (multipart) to import
 * recipes from another app into the group. Confirm-gated (imports a whole dataset).
 * The archive file is read in the registration layer so this handler stays
 * filesystem-free and testable.
 *
 * @param client - A MealieClient (or compatible fake)
 * @param args - Validated arguments (migration_type, filePath, add_migration_tag, confirm)
 * @param file - The pre-read archive Blob (read in the registration layer)
 * @returns An MCP result with the started report's id/status, or an error result
 */
export async function groupStartMigrationHandler(
  client: MigrationClient,
  args: MigrationArgs,
  file?: Blob,
): Promise<CallToolResult> {
  const unconfirmed = requireConfirmation(args.confirm, `start a ${args.migration_type} migration`);
  if (unconfirmed) return unconfirmed;
  if (!file) return missing("requires a readable filePath");
  try {
    const report = await client.postMultipart<ReportSummary>(PATH, buildForm(args, file));
    const summary = report as unknown as Record<string, unknown>;
    return jsonResult({ started: true, reportId: summary.id, status: summary.status });
  } catch (error) {
    return errorResult(error, "group_start_migration", "Failed to start migration");
  }
}

/** Assembles the multipart form: the archive file plus the scalar fields (as strings). */
function buildForm(args: MigrationArgs, file: Blob): FormData {
  const form = new FormData();
  form.append("archive", file, ARCHIVE_FILENAME);
  form.append("migration_type", args.migration_type);
  form.append("add_migration_tag", String(args.add_migration_tag ?? false));
  return form;
}

/** Returns an isError result describing the missing requirement. */
function missing(requirement: string): CallToolResult {
  return {
    content: [{ type: "text", text: `group_start_migration: ${requirement}` }],
    isError: true,
  };
}

/** Reads the archive file when the action is confirmed; returns undefined or the read error. */
async function loadArchive(args: MigrationArgs): Promise<Blob | undefined | Error> {
  if (args.confirm !== true || !args.filePath) return undefined;
  try {
    return await readUploadFile(args.filePath);
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
}

/**
 * Registers the group_start_migration tool. The registration layer reads the
 * archive file so the handler stays filesystem-free and testable.
 *
 * @param server - The McpServer to register on
 * @param client - The MealieClient used by the handler
 */
export function registerGroupStartMigration(server: McpServer, client: MealieClient): void {
  server.registerTool(
    "group_start_migration",
    {
      title: "Start Data Migration",
      description:
        "Import recipes from another app (Nextcloud, Paprika, Tandoor, …) by uploading an archive. Destructive — imports a whole dataset into your group (confirm:true). Reads a file on the MCP server (stdio/local only).",
      inputSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    },
    async (args) => {
      const file = await loadArchive(args);
      if (file instanceof Error) {
        return errorResult(file, "group_start_migration", "Failed to read file");
      }
      return groupStartMigrationHandler(client, args, file);
    },
  );
}

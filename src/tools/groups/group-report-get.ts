import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod";
import type { MealieClient } from "../../client/MealieClient.js";
import { errorResult, jsonResult } from "../result.js";
import { type ReportSummary, projectReport } from "./group-projection.js";

/** Base path for the group reports resource. */
const BASE_PATH = "/api/groups/reports";
/** Report categories Mealie can filter the list by (ReportCategory enum). */
const REPORT_CATEGORIES = ["backup", "restore", "migration", "bulk_import"] as const;

/** Minimal client surface the handler needs (eases test fakes). */
type GetClient = Pick<MealieClient, "get">;

const inputSchema = {
  item_id: z.string().optional().describe("Report id; omit to list all reports"),
  report_type: z
    .enum(REPORT_CATEGORIES)
    .optional()
    .describe("Filter the list by category (list mode)"),
  response_format: z
    .enum(["concise", "detailed"])
    .optional()
    .describe("concise (default) trims report fields; detailed returns everything (incl. entries)"),
};

type GetArgs = {
  item_id?: string | undefined;
  report_type?: (typeof REPORT_CATEGORIES)[number] | undefined;
  response_format?: "concise" | "detailed" | undefined;
};

/**
 * Handles group_report_get: a single report by id (detailed, with entries), or
 * the report list. The list endpoint returns a BARE array (no pagination
 * envelope), so we wrap it as { items, count }.
 *
 * @param client - A MealieClient (or compatible fake)
 * @param args - Validated arguments (item_id selects single vs list)
 * @returns An MCP result with the report(s), or an error result
 */
export async function groupReportGetHandler(
  client: GetClient,
  args: GetArgs,
): Promise<CallToolResult> {
  try {
    return args.item_id ? await getOne(client, args) : await list(client, args);
  } catch (error) {
    return errorResult(error, "group_report_get", "Failed to read reports");
  }
}

/** Fetches and projects a single report (ReportOut, with entries) by id. */
async function getOne(client: GetClient, args: GetArgs): Promise<CallToolResult> {
  const report = await client.get<Record<string, unknown>>(`${BASE_PATH}/${args.item_id}`);
  return jsonResult(projectReport(report, args.response_format ?? "concise"));
}

/** Fetches the bare-array report list and projects concise items. */
async function list(client: GetClient, args: GetArgs): Promise<CallToolResult> {
  const query = args.report_type ? { report_type: args.report_type } : undefined;
  const reports = await client.get<ReportSummary[]>(BASE_PATH, query);
  const format = args.response_format ?? "concise";
  const items = reports.map((report) =>
    projectReport(report as unknown as Record<string, unknown>, format),
  );
  return jsonResult({ items, count: reports.length });
}

/**
 * Registers the group_report_get tool on the server.
 *
 * @param server - The McpServer to register on
 * @param client - The MealieClient used by the handler
 */
export function registerGroupReportGet(server: McpServer, client: MealieClient): void {
  server.registerTool(
    "group_report_get",
    {
      title: "Get Reports",
      description:
        "Read group reports (backup/restore/migration/bulk_import jobs): omit item_id to list (optionally filtered by report_type), or pass item_id for one report with its entries.",
      inputSchema,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    (args) => groupReportGetHandler(client, args),
  );
}

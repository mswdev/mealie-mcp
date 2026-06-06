import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod";
import type { MealieClient } from "../../../client/MealieClient.js";
import type { components } from "../../../types/mealie.js";
import { errorResult, jsonResult } from "../../result.js";

const SUMMARY_PATH = "/api/admin/maintenance";
const STORAGE_PATH = "/api/admin/maintenance/storage";

type MaintenanceSummary = components["schemas"]["MaintenanceSummary"];
type MaintenanceStorageDetails = components["schemas"]["MaintenanceStorageDetails"];

/** Minimal client surface the handler needs (eases test fakes). */
type GetClient = Pick<MealieClient, "get">;

const inputSchema = {
  view: z
    .enum(["summary", "storage"])
    .optional()
    .describe("summary (default): data-dir size + cleanable counts; storage: per-dir sizes"),
};

type MaintenanceGetArgs = { view?: "summary" | "storage" | undefined };

/**
 * Handles admin_maintenance_get: reads the maintenance summary (default) or
 * per-directory storage details. All size fields are human-readable strings.
 *
 * @param client - A MealieClient (or compatible fake)
 * @param args - Validated arguments (view selects the read)
 * @returns An MCP result with the requested view, or an error result
 */
export async function adminMaintenanceGetHandler(
  client: GetClient,
  args: MaintenanceGetArgs,
): Promise<CallToolResult> {
  try {
    if (args.view === "storage") {
      return jsonResult(await client.get<MaintenanceStorageDetails>(STORAGE_PATH));
    }
    return jsonResult(await client.get<MaintenanceSummary>(SUMMARY_PATH));
  } catch (error) {
    return errorResult(error, "admin_maintenance_get", "Failed to read maintenance info");
  }
}

/**
 * Registers the admin_maintenance_get tool on the server.
 *
 * @param server - The McpServer to register on
 * @param client - The MealieClient used by the handler
 */
export function registerAdminMaintenanceGet(server: McpServer, client: MealieClient): void {
  server.registerTool(
    "admin_maintenance_get",
    {
      title: "Admin: Get Maintenance Info",
      description:
        "Read maintenance info: summary (data-dir size plus cleanableImages/cleanableDirs — what admin_maintenance_clean would remove) or storage (per-directory sizes). Sizes are display strings.",
      inputSchema,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    (args) => adminMaintenanceGetHandler(client, args),
  );
}

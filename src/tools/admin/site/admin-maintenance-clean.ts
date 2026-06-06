import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod";
import type { MealieClient } from "../../../client/MealieClient.js";
import { requireConfirmation } from "../../confirm.js";
import { errorResult, jsonResult } from "../../result.js";
import type { SuccessResponse } from "../admin-projection.js";

/** Clean target token → upstream path (note recipe_folders → recipe-folders). */
const CLEAN_PATHS = {
  images: "/api/admin/maintenance/clean/images",
  temp: "/api/admin/maintenance/clean/temp",
  recipe_folders: "/api/admin/maintenance/clean/recipe-folders",
} as const;

/** The clean targets exposed by the dispatcher. */
const TARGETS = ["images", "temp", "recipe_folders"] as const;

/** Minimal client surface the handler needs (eases test fakes). */
type CleanClient = Pick<MealieClient, "post">;

const inputSchema = {
  target: z
    .enum(TARGETS)
    .describe(
      "What to clean: images (purges non-webp originals), temp (empties the temp dir), recipe_folders (deletes folders with non-UUID names)",
    ),
  confirm: z.boolean().optional().describe("Must be true — cleans delete files irreversibly"),
};

type CleanArgs = {
  target: (typeof TARGETS)[number];
  confirm?: boolean | undefined;
};

/**
 * Handles admin_maintenance_clean: runs one of Mealie's destructive cleanup
 * jobs. Upstream has NO confirmation flag of its own, so the confirm gate here
 * is the only check before files are deleted.
 *
 * @param client - A MealieClient (or compatible fake)
 * @param args - Validated arguments (target + confirm)
 * @returns An MCP result reporting the clean outcome, or an error result
 */
export async function adminMaintenanceCleanHandler(
  client: CleanClient,
  args: CleanArgs,
): Promise<CallToolResult> {
  const unconfirmed = requireConfirmation(
    args.confirm,
    `clean ${args.target} (irreversibly deletes files)`,
  );
  if (unconfirmed) return unconfirmed;
  try {
    const response = await client.post<SuccessResponse>(CLEAN_PATHS[args.target], {});
    if (response.error) {
      return errorResult(new Error(response.message), "admin_maintenance_clean", "Clean failed");
    }
    return jsonResult({ cleaned: args.target, message: response.message });
  } catch (error) {
    return errorResult(error, "admin_maintenance_clean", "Failed to clean");
  }
}

/**
 * Registers the admin_maintenance_clean tool on the server.
 *
 * @param server - The McpServer to register on
 * @param client - The MealieClient used by the handler
 */
export function registerAdminMaintenanceClean(server: McpServer, client: MealieClient): void {
  server.registerTool(
    "admin_maintenance_clean",
    {
      title: "Admin: Run Maintenance Clean (Destructive)",
      description:
        "Run a destructive maintenance clean (confirm required): images purges non-webp originals, temp empties the temp directory, recipe_folders deletes recipe folders with non-UUID names. Preview impact via admin_maintenance_get first.",
      inputSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    },
    (args) => adminMaintenanceCleanHandler(client, args),
  );
}

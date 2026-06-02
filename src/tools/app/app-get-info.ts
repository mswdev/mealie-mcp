import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod";
import type { AppAbout, MealieClient } from "../../client/MealieClient.js";
import type { components } from "../../types/mealie.js";
import { errorResult, jsonResult } from "../result.js";

type AppStartupInfo = components["schemas"]["AppStartupInfo"];
type AppTheme = components["schemas"]["AppTheme"];

/** Minimal client surface the handler needs (eases test fakes). */
type GetClient = Pick<MealieClient, "get">;

/** Optional secondary sections bundled alongside about. */
const SECTIONS = ["startup_info", "theme"] as const;

const inputSchema = {
  include: z
    .array(z.enum(SECTIONS))
    .optional()
    .describe("Extra sections to bundle alongside about: startup_info, theme"),
};

type GetArgs = { include?: ("startup_info" | "theme")[] | undefined };

/**
 * Handles app_get_info: returns the connected Mealie instance's about info,
 * optionally bundling startup-info and/or theme (aggregated-read).
 *
 * @param client - A MealieClient (or compatible fake)
 * @param args - Validated arguments (optional include sections)
 * @returns An MCP result with { about, startup_info?, theme? }, or an error result
 */
export async function appGetInfoHandler(client: GetClient, args: GetArgs): Promise<CallToolResult> {
  try {
    const include = new Set(args.include ?? []);
    const result: Record<string, unknown> = {
      about: await client.get<AppAbout>("/api/app/about"),
    };
    if (include.has("startup_info")) {
      result.startup_info = await client.get<AppStartupInfo>("/api/app/about/startup-info");
    }
    if (include.has("theme")) {
      result.theme = await client.get<AppTheme>("/api/app/about/theme");
    }
    return jsonResult(result);
  } catch (error) {
    return errorResult(error, "app_get_info", "Failed to get Mealie info");
  }
}

/**
 * Registers the app_get_info tool on the server.
 *
 * @param server - The McpServer to register on
 * @param client - The MealieClient used by the handler
 */
export function registerAppGetInfo(server: McpServer, client: MealieClient): void {
  server.registerTool(
    "app_get_info",
    {
      title: "Get Mealie Info",
      description:
        "Returns the connected Mealie instance's info: version, configuration, and feature flags. Pass include: [startup_info, theme] to also bundle startup diagnostics and the UI theme.",
      inputSchema,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    (args) => appGetInfoHandler(client, args),
  );
}

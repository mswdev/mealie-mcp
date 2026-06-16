import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod";
import type { MealieClient } from "../../../client/MealieClient.js";
import type { components } from "../../../types/mealie.js";
import { jsonResult, secretSafeErrorResult } from "../../result.js";
import { type AdminAbout, projectAdminAbout } from "../admin-projection.js";

const ABOUT_PATH = "/api/admin/about";
const STATISTICS_PATH = "/api/admin/about/statistics";
const CHECK_PATH = "/api/admin/about/check";
const EMAIL_READY_PATH = "/api/admin/email";

/** Optional secondary sections bundled alongside about. */
const INCLUDE_SECTIONS = ["statistics", "check", "email_ready"] as const;

type AppStatistics = components["schemas"]["AppStatistics"];
type CheckAppConfig = components["schemas"]["CheckAppConfig"];
type EmailReady = components["schemas"]["EmailReady"];

/** Minimal client surface the handler needs (eases test fakes). */
type GetClient = Pick<MealieClient, "get">;

const inputSchema = {
  include: z
    .array(z.enum(INCLUDE_SECTIONS))
    .optional()
    .describe("Extra sections to bundle alongside about: statistics, check, email_ready"),
};

type AboutArgs = { include?: ("statistics" | "check" | "email_ready")[] | undefined };

/**
 * Handles admin_about: an aggregated read of the instance's admin diagnostics —
 * about (always; dbUrl redacted), plus optional statistics, config check, and
 * email readiness.
 *
 * @param client - A MealieClient (or compatible fake)
 * @param args - Validated arguments (optional include sections)
 * @returns An MCP result with { about, statistics?, check?, email_ready? }, or a sanitized error result
 */
export async function adminAboutHandler(
  client: GetClient,
  args: AboutArgs,
): Promise<CallToolResult> {
  try {
    const include = new Set(args.include ?? []);
    const result: Record<string, unknown> = {
      about: projectAdminAbout(await client.get<AdminAbout>(ABOUT_PATH)),
    };
    if (include.has("statistics")) {
      result.statistics = await client.get<AppStatistics>(STATISTICS_PATH);
    }
    if (include.has("check")) {
      result.check = await client.get<CheckAppConfig>(CHECK_PATH);
    }
    if (include.has("email_ready")) {
      result.email_ready = await client.get<EmailReady>(EMAIL_READY_PATH);
    }
    return jsonResult(result);
  } catch (error) {
    // secretSafe: the about payload carries dbUrl — error bodies/parse failures could embed it.
    return secretSafeErrorResult(error, "admin_about", "Failed to read admin info");
  }
}

/**
 * Registers the admin_about tool on the server.
 *
 * @param server - The McpServer to register on
 * @param client - The MealieClient used by the handler
 */
export function registerAdminAbout(server: McpServer, client: MealieClient): void {
  server.registerTool(
    "admin_about",
    {
      title: "Admin: Get Instance Info",
      description:
        "Read instance diagnostics as the site admin: version + configuration (DB connection string redacted). Pass include: [statistics, check, email_ready] to bundle usage counts, the config readiness check, and SMTP readiness (check.emailReady and email_ready report the same thing — the API exposes both).",
      inputSchema,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    (args) => adminAboutHandler(client, args),
  );
}

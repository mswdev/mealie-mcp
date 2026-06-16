import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod";
import type { MealieClient } from "../../../client/MealieClient.js";
import { errorResult, jsonResult } from "../../result.js";
import { type AdminAiProvider, projectAdminProvider } from "../admin-projection.js";

/** Minimal client surface the handler needs (eases test fakes). */
type GetClient = Pick<MealieClient, "get">;

const inputSchema = {
  group_id: z.string().describe("The group the provider belongs to (see admin_group_get)"),
  provider_id: z.string().describe("The provider id"),
  response_format: z
    .enum(["concise", "detailed"])
    .optional()
    .describe("concise (default) trims to id/name/model/baseUrl; detailed returns everything"),
};

type ProviderGetArgs = {
  group_id: string;
  provider_id: string;
  response_format?: "concise" | "detailed" | undefined;
};

/** Builds the admin providers collection path for a group. */
function providersPath(groupId: string): string {
  return `/api/admin/groups/${groupId}/ai-providers/providers`;
}

/**
 * Handles admin_ai_provider_get: reads one AI provider in any group. There is
 * NO admin list endpoint — enumeration lives in the groups toolset.
 *
 * @param client - A MealieClient (or compatible fake)
 * @param args - Validated arguments (group_id + provider_id required)
 * @returns An MCP result with the projected provider (never apiKey), or an error result
 */
export async function adminAiProviderGetHandler(
  client: GetClient,
  args: ProviderGetArgs,
): Promise<CallToolResult> {
  try {
    const path = `${providersPath(args.group_id)}/${args.provider_id}`;
    const provider = await client.get<AdminAiProvider>(path);
    return jsonResult(projectAdminProvider(provider, args.response_format ?? "concise"));
  } catch (error) {
    return errorResult(error, "admin_ai_provider_get", "Failed to read AI provider");
  }
}

/**
 * Registers the admin_ai_provider_get tool on the server.
 *
 * @param server - The McpServer to register on
 * @param client - The MealieClient used by the handler
 */
export function registerAdminAiProviderGet(server: McpServer, client: MealieClient): void {
  server.registerTool(
    "admin_ai_provider_get",
    {
      title: "Admin: Get AI Provider",
      description:
        "Read one AI provider in any group (admin). There is NO admin list endpoint — enumerate providers via the groups toolset's group_ai_provider_get, or know the provider id. The apiKey is never returned.",
      inputSchema,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    (args) => adminAiProviderGetHandler(client, args),
  );
}

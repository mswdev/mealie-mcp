import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod";
import type { MealieClient } from "../../client/MealieClient.js";
import { errorResult, jsonResult } from "../result.js";
import { type AIProvider, projectProvider } from "./group-projection.js";

const PROVIDERS_PATH = "/api/groups/ai-providers/providers";
const SETTINGS_PATH = "/api/groups/ai-providers/settings";

/** Minimal client surface the handler needs (eases test fakes). */
type GetClient = Pick<MealieClient, "get">;

const inputSchema = {
  provider_id: z
    .string()
    .optional()
    .describe("AI provider id; omit to read the AI settings (incl. the provider summary list)"),
  response_format: z
    .enum(["concise", "detailed"])
    .optional()
    .describe("concise (default) trims provider fields; detailed returns the rest (never apiKey)"),
};

type GetArgs = {
  provider_id?: string | undefined;
  response_format?: "concise" | "detailed" | undefined;
};

/**
 * Handles group_ai_provider_get: one provider by id, or — when no id is given —
 * the AI settings (the only place the provider list is exposed; there is no
 * native provider-list endpoint). The apiKey secret is never returned.
 *
 * @param client - A MealieClient (or compatible fake)
 * @param args - Validated arguments (provider_id selects provider vs settings)
 * @returns An MCP result with the provider or settings, or an error result
 */
export async function groupAiProviderGetHandler(
  client: GetClient,
  args: GetArgs,
): Promise<CallToolResult> {
  try {
    if (!args.provider_id) return jsonResult(await client.get(SETTINGS_PATH));
    const provider = await client.get<AIProvider>(`${PROVIDERS_PATH}/${args.provider_id}`);
    return jsonResult(projectProvider(provider, args.response_format ?? "concise"));
  } catch (error) {
    return errorResult(error, "group_ai_provider_get", "Failed to read AI providers");
  }
}

/**
 * Registers the group_ai_provider_get tool on the server.
 *
 * @param server - The McpServer to register on
 * @param client - The MealieClient used by the handler
 */
export function registerGroupAiProviderGet(server: McpServer, client: MealieClient): void {
  server.registerTool(
    "group_ai_provider_get",
    {
      title: "Get AI Provider(s)",
      description:
        "Read AI providers. Pass provider_id for one provider. With no provider_id, returns the AI settings including the provider summary list (there is no separate provider-list endpoint). The apiKey secret is never returned.",
      inputSchema,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    (args) => groupAiProviderGetHandler(client, args),
  );
}

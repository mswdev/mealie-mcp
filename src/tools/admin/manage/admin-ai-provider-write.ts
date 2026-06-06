import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod";
import type { MealieClient } from "../../../client/MealieClient.js";
import type { components } from "../../../types/mealie.js";
import { requireConfirmation } from "../../confirm.js";
import { jsonResult, secretSafeErrorResult } from "../../result.js";
import { type AdminAiProvider, projectAdminProvider } from "../admin-projection.js";

/** Default request timeout in seconds (matches AIProviderCreate's @default). */
const DEFAULT_TIMEOUT = 300;

/** Minimal client surface the handler needs (eases test fakes). */
type WriteClient = Pick<MealieClient, "post" | "put" | "delete">;

const inputSchema = {
  action: z.enum(["create", "update", "delete"]).describe("AI provider write operation"),
  group_id: z.string().describe("The group the provider belongs to (see admin_group_get)"),
  provider_id: z.string().optional().describe("Provider id (action=update/delete)"),
  name: z.string().optional().describe("Provider name (action=create/update)"),
  model: z.string().optional().describe("Model name, e.g. gpt-4 (action=create/update)"),
  apiKey: z
    .string()
    .optional()
    .describe(
      "Provider API key — a write-only secret. Required on create AND update (it cannot be read back, so re-supply it on every update).",
    ),
  baseUrl: z.string().optional().describe("Override base URL (action=create/update)"),
  timeout: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(`Request timeout, seconds (default ${DEFAULT_TIMEOUT})`),
  requestHeaders: z.record(z.string(), z.string()).optional().describe("Extra request headers"),
  requestParams: z.record(z.string(), z.string()).optional().describe("Extra request params"),
  confirm: z.boolean().optional().describe("Must be true to delete (action=delete)"),
};

type ProviderWriteArgs = {
  action: "create" | "update" | "delete";
  group_id: string;
  provider_id?: string | undefined;
  name?: string | undefined;
  model?: string | undefined;
  apiKey?: string | undefined;
  baseUrl?: string | undefined;
  timeout?: number | undefined;
  requestHeaders?: Record<string, string> | undefined;
  requestParams?: Record<string, string> | undefined;
  confirm?: boolean | undefined;
};

/** Builds the admin providers collection path for a group. */
function providersPath(groupId: string): string {
  return `/api/admin/groups/${groupId}/ai-providers/providers`;
}

/**
 * Handles admin_ai_provider_write: create, update, or delete (confirm-gated)
 * an AI provider in any group. Same schemas as the groups toolset plus the
 * admin-only group_id path param; apiKey is a write-only secret — required on
 * create and update, never echoed back.
 *
 * @param client - A MealieClient (or compatible fake)
 * @param args - Validated arguments (action + action-specific fields)
 * @returns An MCP result with the affected provider (no apiKey), or a sanitized error result
 */
export async function adminAiProviderWriteHandler(
  client: WriteClient,
  args: ProviderWriteArgs,
): Promise<CallToolResult> {
  const refusal = validate(args);
  if (refusal) return refusal;
  try {
    if (args.action === "create") return await create(client, args);
    if (args.action === "update") return await update(client, args);
    return await remove(client, args);
  } catch (error) {
    // secretSafe: create/update bodies carry the apiKey (422s echo input).
    return secretSafeErrorResult(error, "admin_ai_provider_write", "Failed to write AI provider");
  }
}

/** Validates per-action required args; returns an isError result or null. */
function validate(args: ProviderWriteArgs): CallToolResult | null {
  if (args.action !== "create" && !args.provider_id) {
    return missing(`provider_id is required for ${args.action}`);
  }
  if (args.action === "delete") {
    return requireConfirmation(args.confirm, `delete AI provider "${args.provider_id}"`);
  }
  if (!args.name || !args.model || !args.apiKey) {
    return missing(
      `${args.action} requires name, model, and apiKey (the secret cannot be read back)`,
    );
  }
  return null;
}

/** Builds the full provider body, supplying required-with-default fields. */
function buildBody(args: ProviderWriteArgs): components["schemas"]["AIProviderCreate"] {
  return {
    name: args.name as string,
    model: args.model as string,
    apiKey: args.apiKey as string,
    timeout: args.timeout ?? DEFAULT_TIMEOUT,
    requestHeaders: args.requestHeaders ?? {},
    requestParams: args.requestParams ?? {},
    ...(args.baseUrl ? { baseUrl: args.baseUrl } : {}),
  };
}

/** POSTs a new provider (admin path; upstream returns 200, not 201). */
async function create(client: WriteClient, args: ProviderWriteArgs): Promise<CallToolResult> {
  const created = await client.post<AdminAiProvider>(providersPath(args.group_id), buildBody(args));
  return jsonResult(projectAdminProvider(created, "concise"));
}

/** PUTs the full edited provider — fetch-merge cannot recover the write-only apiKey. */
async function update(client: WriteClient, args: ProviderWriteArgs): Promise<CallToolResult> {
  const path = `${providersPath(args.group_id)}/${args.provider_id}`;
  const updated = await client.put<AdminAiProvider>(path, buildBody(args));
  return jsonResult(projectAdminProvider(updated, "concise"));
}

/** DELETEs a provider; the echoed entity is discarded for a uniform {deleted}. */
async function remove(client: WriteClient, args: ProviderWriteArgs): Promise<CallToolResult> {
  await client.delete(`${providersPath(args.group_id)}/${args.provider_id}`);
  return jsonResult({ deleted: args.provider_id });
}

/** Returns an isError result describing the missing requirement. */
function missing(requirement: string): CallToolResult {
  return {
    content: [{ type: "text", text: `admin_ai_provider_write: ${requirement}` }],
    isError: true,
  };
}

/**
 * Registers the admin_ai_provider_write tool on the server.
 *
 * @param server - The McpServer to register on
 * @param client - The MealieClient used by the handler
 */
export function registerAdminAiProviderWrite(server: McpServer, client: MealieClient): void {
  server.registerTool(
    "admin_ai_provider_write",
    {
      title: "Admin: Write AI Providers",
      description:
        "Create, edit, or delete (confirm required) an AI provider in any group as the site admin. create/update need name, model, and apiKey (write-only — re-supply it on every update or it resets). Settings pointers live in admin_group_write(changes.aiProviderSettings).",
      inputSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    },
    (args) => adminAiProviderWriteHandler(client, args),
  );
}

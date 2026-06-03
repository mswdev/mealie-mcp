import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod";
import type { MealieClient } from "../../client/MealieClient.js";
import type { components } from "../../types/mealie.js";
import { requireConfirmation } from "../confirm.js";
import { errorResult, jsonResult } from "../result.js";
import { type AIProvider, projectProvider } from "./group-projection.js";

/** Base path for the group AI providers resource. */
const BASE_PATH = "/api/groups/ai-providers/providers";
/** Default request timeout in seconds (matches AIProviderCreate's @default). */
const DEFAULT_TIMEOUT = 300;

/** Minimal client surface the handler needs (eases test fakes). */
type WriteClient = Pick<MealieClient, "post" | "put" | "delete">;

const inputSchema = {
  action: z.enum(["create", "update", "delete"]).describe("AI provider write operation"),
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
    .describe("Request timeout, seconds (default 300)"),
  requestHeaders: z.record(z.string()).optional().describe("Extra request headers"),
  requestParams: z.record(z.string()).optional().describe("Extra request params"),
  confirm: z.boolean().optional().describe("Must be true to delete (action=delete)"),
};

type WriteArgs = {
  action: "create" | "update" | "delete";
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

/**
 * Handles group_ai_provider_write: create, update, or delete (confirm-gated) an
 * AI provider. apiKey is a write-only secret — required on create and update,
 * never echoed back (responses project AIProviderOut, which omits it).
 *
 * @param client - A MealieClient (or compatible fake)
 * @param args - Validated arguments (action + action-specific fields)
 * @returns An MCP result with the affected provider (no apiKey), or an error result
 */
export async function groupAiProviderWriteHandler(
  client: WriteClient,
  args: WriteArgs,
): Promise<CallToolResult> {
  if (args.action === "delete") return remove(client, args);
  try {
    return args.action === "create" ? await create(client, args) : await update(client, args);
  } catch (error) {
    return errorResult(error, "group_ai_provider_write", "Failed to write AI provider");
  }
}

/** Builds the full provider body, supplying required-with-default fields. */
function buildBody(args: WriteArgs): components["schemas"]["AIProviderCreate"] {
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

/** POSTs a new provider; the secret apiKey is sent but never echoed back. */
async function create(client: WriteClient, args: WriteArgs): Promise<CallToolResult> {
  if (!args.name || !args.model || !args.apiKey) {
    return missing("create requires name, model, and apiKey");
  }
  return jsonResult(
    projectProvider(await client.post<AIProvider>(BASE_PATH, buildBody(args)), "concise"),
  );
}

/**
 * PUTs an edited provider. AIProviderUpdate requires apiKey, but the read shape
 * never returns it — so fetch-merge cannot recover the secret. The caller must
 * re-supply apiKey (and the full provider) on every update.
 */
async function update(client: WriteClient, args: WriteArgs): Promise<CallToolResult> {
  if (!args.provider_id) return missing("update requires provider_id");
  if (!args.name || !args.model || !args.apiKey) {
    return missing("update requires name, model, and apiKey (the secret cannot be read back)");
  }
  const path = `${BASE_PATH}/${args.provider_id}`;
  return jsonResult(
    projectProvider(await client.put<AIProvider>(path, buildBody(args)), "concise"),
  );
}

/** DELETEs a provider (confirm-gated). Mealie echoes the entity; we synthesize {deleted}. */
async function remove(client: WriteClient, args: WriteArgs): Promise<CallToolResult> {
  if (!args.provider_id) return missing("delete requires provider_id");
  const unconfirmed = requireConfirmation(args.confirm, `delete AI provider "${args.provider_id}"`);
  if (unconfirmed) return unconfirmed;
  try {
    await client.delete(`${BASE_PATH}/${args.provider_id}`);
    return jsonResult({ deleted: args.provider_id });
  } catch (error) {
    return errorResult(error, "group_ai_provider_write", "Failed to delete AI provider");
  }
}

/** Returns an isError result describing the missing requirement for the action. */
function missing(requirement: string): CallToolResult {
  return {
    content: [{ type: "text", text: `group_ai_provider_write: ${requirement}` }],
    isError: true,
  };
}

/**
 * Registers the group_ai_provider_write tool on the server.
 *
 * @param server - The McpServer to register on
 * @param client - The MealieClient used by the handler
 */
export function registerGroupAiProviderWrite(server: McpServer, client: MealieClient): void {
  server.registerTool(
    "group_ai_provider_write",
    {
      title: "Write AI Provider",
      description:
        "Create, edit, or delete an AI provider. create/update need name, model, and apiKey (the apiKey is write-only — it cannot be read back, so re-supply it on every update). Delete is destructive (confirm:true).",
      inputSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    },
    (args) => groupAiProviderWriteHandler(client, args),
  );
}

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod";
import type { MealieClient } from "../../client/MealieClient.js";
import type { components } from "../../types/mealie.js";
import { errorResult, jsonResult } from "../result.js";

const SETTINGS_PATH = "/api/groups/ai-providers/settings";
/** The only three fields AIProviderSettingsUpdate accepts (all required, all nullable). */
const POINTER_KEYS = ["defaultProviderId", "audioProviderId", "imageProviderId"] as const;

/** Minimal client surface the handler needs (eases test fakes). */
type UpdateClient = Pick<MealieClient, "get" | "put">;

const inputSchema = {
  changes: z
    .record(z.unknown())
    .describe(
      "Provider-id pointers to change: defaultProviderId, audioProviderId, imageProviderId (use null to clear one).",
    ),
};

type UpdateArgs = {
  changes?: Record<string, unknown> | undefined;
};

/**
 * Handles group_ai_provider_settings_update: updates the AI settings pointers.
 * AIProviderSettingsUpdate is a full replace of three required nullable pointers,
 * so we fetch the current settings, carry all three over, change only the
 * supplied ones, and never send the read-only Out fields (providers, *Enabled).
 *
 * @param client - A MealieClient (or compatible fake)
 * @param args - Validated arguments (the pointer changes to merge)
 * @returns An MCP result with the updated settings, or an error result
 */
export async function groupAiProviderSettingsUpdateHandler(
  client: UpdateClient,
  args: UpdateArgs,
): Promise<CallToolResult> {
  if (!args.changes) return missing("requires changes");
  try {
    const current = await client.get<Record<string, unknown>>(SETTINGS_PATH);
    const body = buildBody(current, args.changes);
    return jsonResult(await client.put(SETTINGS_PATH, body));
  } catch (error) {
    return errorResult(error, "group_ai_provider_settings_update", "Failed to update AI settings");
  }
}

/** Builds the three-pointer update body, overlaying only supplied pointer changes. */
function buildBody(
  current: Record<string, unknown>,
  changes: Record<string, unknown>,
): components["schemas"]["AIProviderSettingsUpdate"] {
  const body: Record<string, string | null> = {};
  for (const key of POINTER_KEYS) {
    body[key] = key in changes ? asPointer(changes[key]) : asPointer(current[key]);
  }
  return body as components["schemas"]["AIProviderSettingsUpdate"];
}

/** Coerces a pointer value to string|null (the schema's field type). */
function asPointer(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/** Returns an isError result describing the missing requirement. */
function missing(requirement: string): CallToolResult {
  return {
    content: [{ type: "text", text: `group_ai_provider_settings_update: ${requirement}` }],
    isError: true,
  };
}

/**
 * Registers the group_ai_provider_settings_update tool on the server.
 *
 * @param server - The McpServer to register on
 * @param client - The MealieClient used by the handler
 */
export function registerGroupAiProviderSettingsUpdate(
  server: McpServer,
  client: MealieClient,
): void {
  server.registerTool(
    "group_ai_provider_settings_update",
    {
      title: "Update AI Provider Settings",
      description:
        "Set the group's AI provider pointers (defaultProviderId, audioProviderId, imageProviderId). Merges onto the current settings (full replace); pass null to clear a pointer.",
      inputSchema,
      annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: true },
    },
    (args) => groupAiProviderSettingsUpdateHandler(client, args),
  );
}

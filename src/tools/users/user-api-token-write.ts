import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod";
import type { MealieClient } from "../../client/MealieClient.js";
import type { components } from "../../types/mealie.js";
import { requireConfirmation } from "../confirm.js";
import { errorResult, jsonResult } from "../result.js";

const TOKENS_PATH = "/api/users/api-tokens";
/** Mealie's default integration tag for new tokens. */
const DEFAULT_INTEGRATION_ID = "generic";
/** Create responses carry the raw token exactly once (upstream: "the token field is sensitive"). */
const SHOWN_ONCE_NOTE =
  "Save this token now — it is shown only once and can never be retrieved again.";

/** The create response — the only place the raw token value ever appears. */
type TokenCreated = components["schemas"]["LongLiveTokenCreateResponse"];
/** The create request body. */
type TokenIn = components["schemas"]["LongLiveTokenIn"];

/** Minimal client surface the handler needs (eases test fakes). */
type WriteClient = Pick<MealieClient, "post" | "delete">;

const inputSchema = {
  action: z.enum(["create", "delete"]).describe("What to do"),
  name: z.string().optional().describe("A label for the new token (action=create)"),
  integrationId: z
    .string()
    .optional()
    .describe(`Integration tag (action=create, default "${DEFAULT_INTEGRATION_ID}")`),
  token_id: z
    .number()
    .int()
    .optional()
    .describe("The token's integer id — list them via user_me profile (action=delete)"),
  confirm: z.boolean().optional().describe("Must be true to delete"),
};

type TokenWriteArgs = {
  action: "create" | "delete";
  name?: string | undefined;
  integrationId?: string | undefined;
  token_id?: number | undefined;
  confirm?: boolean | undefined;
};

/**
 * Handles user_api_token_write: creates or deletes the current user's API tokens.
 * The create response deliberately includes the raw token value — Mealie returns
 * it exactly once at creation and it is never retrievable again.
 *
 * @param client - A MealieClient (or compatible fake)
 * @param args - Validated arguments (action + action fields)
 * @returns An MCP result for the action, or an error result
 */
export async function userApiTokenWriteHandler(
  client: WriteClient,
  args: TokenWriteArgs,
): Promise<CallToolResult> {
  if (args.action === "create" && !args.name) return missing("name is required for create");
  if (args.action === "delete") {
    if (args.token_id === undefined) return missing("token_id is required for delete");
    const refusal = requireConfirmation(args.confirm, `delete API token ${args.token_id}`);
    if (refusal) return refusal;
  }
  try {
    return args.action === "create" ? await create(client, args) : await remove(client, args);
  } catch (error) {
    return errorResult(error, "user_api_token_write", "Failed to write API token");
  }
}

/** Creates the token and surfaces the write-once secret with the shown-once note. */
async function create(client: WriteClient, args: TokenWriteArgs): Promise<CallToolResult> {
  const body: TokenIn = {
    name: args.name ?? "",
    integrationId: args.integrationId ?? DEFAULT_INTEGRATION_ID,
  };
  const created = await client.post<TokenCreated>(TOKENS_PATH, body);
  return jsonResult({
    id: created.id,
    name: created.name,
    createdAt: created.createdAt,
    token: created.token,
    note: SHOWN_ONCE_NOTE,
  });
}

/** Deletes by integer id; the response wrapper is discarded for a uniform {deleted}. */
async function remove(client: WriteClient, args: TokenWriteArgs): Promise<CallToolResult> {
  await client.delete(`${TOKENS_PATH}/${args.token_id}`);
  return jsonResult({ deleted: args.token_id });
}

/** Returns an isError result describing the missing requirement. */
function missing(requirement: string): CallToolResult {
  return {
    content: [{ type: "text", text: `user_api_token_write: ${requirement}` }],
    isError: true,
  };
}

/**
 * Registers the user_api_token_write tool on the server.
 *
 * @param server - The McpServer to register on
 * @param client - The MealieClient used by the handler
 */
export function registerUserApiTokenWrite(server: McpServer, client: MealieClient): void {
  server.registerTool(
    "user_api_token_write",
    {
      title: "Create/Delete My API Tokens",
      description:
        "Create or delete (confirm required) the current user's API tokens. Create returns the token value exactly once — it can never be retrieved again. List existing tokens via user_me (ids/names only).",
      inputSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    },
    (args) => userApiTokenWriteHandler(client, args),
  );
}

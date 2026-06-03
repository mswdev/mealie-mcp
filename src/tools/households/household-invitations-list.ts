import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { MealieClient } from "../../client/MealieClient.js";
import type { components } from "../../types/mealie.js";
import { errorResult, jsonResult } from "../result.js";

/** Path for the household invitations resource. */
const PATH = "/api/households/invitations";

/** An invite token as returned by Mealie. */
type InviteToken = components["schemas"]["ReadInviteToken"];

/** Minimal client surface the handler needs (eases test fakes). */
type ListClient = Pick<MealieClient, "get">;

/**
 * Handles household_invitations_list: lists the household's invite tokens. The
 * endpoint returns a BARE array (no pagination envelope), so we use the generic
 * get<T[]> and wrap it as { items, count }.
 *
 * @param client - A MealieClient (or compatible fake)
 * @returns An MCP result with the invite tokens, or an error result
 */
export async function householdInvitationsListHandler(client: ListClient): Promise<CallToolResult> {
  try {
    const tokens = await client.get<InviteToken[]>(PATH);
    return jsonResult({ items: tokens, count: tokens.length });
  } catch (error) {
    return errorResult(error, "household_invitations_list", "Failed to list invitations");
  }
}

/**
 * Registers the household_invitations_list tool on the server.
 *
 * @param server - The McpServer to register on
 * @param client - The MealieClient used by the handler
 */
export function registerHouseholdInvitationsList(server: McpServer, client: MealieClient): void {
  server.registerTool(
    "household_invitations_list",
    {
      title: "List Household Invitations",
      description:
        "List the household's invite tokens (token, usesLeft, groupId, householdId). Use household_invite to create a token or email one.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    () => householdInvitationsListHandler(client),
  );
}

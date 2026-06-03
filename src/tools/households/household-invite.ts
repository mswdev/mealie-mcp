import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod";
import type { MealieClient } from "../../client/MealieClient.js";
import type { components } from "../../types/mealie.js";
import { errorResult, jsonResult } from "../result.js";

const INVITATIONS_PATH = "/api/households/invitations";
const EMAIL_PATH = "/api/households/invitations/email";

/** Minimal client surface the handler needs (eases test fakes). */
type InviteClient = Pick<MealieClient, "post">;

const inputSchema = {
  action: z
    .enum(["create", "send_email"])
    .describe("create (mint an invite token) or send_email (email an existing token)"),
  uses: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("How many times the token may be used (action=create)"),
  groupId: z
    .string()
    .optional()
    .describe("Group id to scope the token to (action=create, optional)"),
  householdId: z
    .string()
    .optional()
    .describe("Household id to scope the token to (action=create, optional)"),
  email: z.string().optional().describe("Recipient email address (action=send_email)"),
  token: z.string().optional().describe("The invite token to email (action=send_email)"),
};

type InviteArgs = {
  action: "create" | "send_email";
  uses?: number | undefined;
  groupId?: string | undefined;
  householdId?: string | undefined;
  email?: string | undefined;
  token?: string | undefined;
};

/**
 * Handles household_invite: mint an invite token, or email an existing token.
 * Both are non-destructive; send_email fires an email (network side-effect).
 *
 * @param client - A MealieClient (or compatible fake)
 * @param args - Validated arguments (action + action-specific fields)
 * @returns An MCP result with the created token or the email response, or an error result
 */
export async function householdInviteHandler(
  client: InviteClient,
  args: InviteArgs,
): Promise<CallToolResult> {
  try {
    return args.action === "create" ? await create(client, args) : await sendEmail(client, args);
  } catch (error) {
    return errorResult(error, "household_invite", "Failed to process invitation");
  }
}

/** POSTs a new invite token (uses required; group/household optional). */
async function create(client: InviteClient, args: InviteArgs): Promise<CallToolResult> {
  if (args.uses === undefined) return missing("create requires uses");
  const body: components["schemas"]["CreateInviteToken"] = {
    uses: args.uses,
    ...(args.groupId !== undefined ? { groupId: args.groupId } : {}),
    ...(args.householdId !== undefined ? { householdId: args.householdId } : {}),
  };
  const token = await client.post<components["schemas"]["ReadInviteToken"]>(INVITATIONS_PATH, body);
  return jsonResult(token);
}

/** POSTs an email-invitation request (fires an email; returns success/error). */
async function sendEmail(client: InviteClient, args: InviteArgs): Promise<CallToolResult> {
  if (!args.email || !args.token) return missing("send_email requires email and token");
  const body: components["schemas"]["EmailInvitation"] = { email: args.email, token: args.token };
  const response = await client.post<components["schemas"]["EmailInitationResponse"]>(
    EMAIL_PATH,
    body,
  );
  return jsonResult(response);
}

/** Returns an isError result describing the missing requirement for the action. */
function missing(requirement: string): CallToolResult {
  return { content: [{ type: "text", text: `household_invite: ${requirement}` }], isError: true };
}

/**
 * Registers the household_invite tool on the server.
 *
 * @param server - The McpServer to register on
 * @param client - The MealieClient used by the handler
 */
export function registerHouseholdInvite(server: McpServer, client: MealieClient): void {
  server.registerTool(
    "household_invite",
    {
      title: "Invite to Household",
      description:
        "Mint or email a household invite. action=create returns a new invite token (needs uses); action=send_email emails an existing token to an address (needs email + token) and fires an email.",
      inputSchema,
      annotations: { readOnlyHint: false, openWorldHint: true },
    },
    (args) => householdInviteHandler(client, args),
  );
}

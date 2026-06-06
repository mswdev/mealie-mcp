import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod";
import type { MealieClient } from "../../../client/MealieClient.js";
import type { components } from "../../../types/mealie.js";
import { jsonResult, secretSafeErrorResult } from "../../result.js";

const UNLOCK_PATH = "/api/admin/users/unlock";
const RESET_TOKEN_PATH = "/api/admin/users/password-reset-token";
/** The reset token appears only in this response — deliver it out-of-band, once. */
const SHOWN_ONCE_NOTE =
  "Deliver this reset token to the user out-of-band — it is shown only once and never retrievable again.";

type UnlockResults = components["schemas"]["UnlockResults"];
/** The reset-token response — the only place the reset secret ever appears. */
type ResetTokenResponse = components["schemas"]["PasswordResetToken"];
type ForgotBody = components["schemas"]["ForgotPassword"];

/** Minimal client surface the handler needs (eases test fakes). */
type ActionsClient = Pick<MealieClient, "post">;

const inputSchema = {
  action: z.enum(["unlock", "password_reset_token"]).describe("What to do"),
  force: z
    .boolean()
    .optional()
    .describe("Unlock all locked accounts even if their lockout has not expired (action=unlock)"),
  email: z.string().optional().describe("The user's email (action=password_reset_token)"),
};

type ActionsArgs = {
  action: "unlock" | "password_reset_token";
  force?: boolean | undefined;
  email?: string | undefined;
};

/**
 * Handles admin_user_actions: account-recovery operations — unlock locked-out
 * accounts, or generate a password-reset token for a user by email. The reset
 * token is a write-once secret surfaced deliberately, exactly once.
 *
 * @param client - A MealieClient (or compatible fake)
 * @param args - Validated arguments (action + action fields)
 * @returns An MCP result for the action, or a sanitized error result
 */
export async function adminUserActionsHandler(
  client: ActionsClient,
  args: ActionsArgs,
): Promise<CallToolResult> {
  if (args.action === "password_reset_token" && !args.email) {
    return missing("email is required for password_reset_token");
  }
  try {
    if (args.action === "unlock") return await unlock(client, args);
    return await resetToken(client, args);
  } catch (error) {
    // secretSafe: the reset-token response carries the secret (parse errors embed bodies).
    return secretSafeErrorResult(error, "admin_user_actions", "Failed to run user action");
  }
}

/** Unlocks locked accounts; force rides as a query param only when set. */
async function unlock(client: ActionsClient, args: ActionsArgs): Promise<CallToolResult> {
  const query = args.force !== undefined ? { force: args.force } : undefined;
  const results = query
    ? await client.post<UnlockResults>(UNLOCK_PATH, {}, query)
    : await client.post<UnlockResults>(UNLOCK_PATH, {});
  return jsonResult({ action: "unlock", unlocked: results.unlocked });
}

/** Generates the reset token — the deliberate write-once surfacing. */
async function resetToken(client: ActionsClient, args: ActionsArgs): Promise<CallToolResult> {
  const body: ForgotBody = { email: args.email ?? "" };
  const response = await client.post<ResetTokenResponse>(RESET_TOKEN_PATH, body);
  return jsonResult({
    action: "password_reset_token",
    email: args.email,
    token: response.token,
    note: SHOWN_ONCE_NOTE,
  });
}

/** Returns an isError result describing the missing requirement. */
function missing(requirement: string): CallToolResult {
  return {
    content: [{ type: "text", text: `admin_user_actions: ${requirement}` }],
    isError: true,
  };
}

/**
 * Registers the admin_user_actions tool on the server.
 *
 * @param server - The McpServer to register on
 * @param client - The MealieClient used by the handler
 */
export function registerAdminUserActions(server: McpServer, client: MealieClient): void {
  server.registerTool(
    "admin_user_actions",
    {
      title: "Admin: User Account Recovery",
      description:
        "Unlock locked-out user accounts (optionally force), or generate a password-reset token for a user by email. The token is shown exactly once — deliver it to the user out-of-band.",
      inputSchema,
      annotations: { readOnlyHint: false, openWorldHint: true },
    },
    (args) => adminUserActionsHandler(client, args),
  );
}

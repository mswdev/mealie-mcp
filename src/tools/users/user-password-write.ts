import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod";
import type { MealieClient } from "../../client/MealieClient.js";
import type { components } from "../../types/mealie.js";
import { errorResult, jsonResult } from "../result.js";

const CHANGE_PATH = "/api/users/password";
const FORGOT_PATH = "/api/users/forgot-password";
const RESET_PATH = "/api/users/reset-password";

type ChangeBody = components["schemas"]["ChangePassword"];
type ForgotBody = components["schemas"]["ForgotPassword"];
type ResetBody = components["schemas"]["ResetPassword"];

/** Minimal client surface the handler needs (eases test fakes). */
type WriteClient = Pick<MealieClient, "put" | "post">;

const inputSchema = {
  action: z
    .enum(["change", "forgot", "reset"])
    .describe("change = rotate your password; forgot = send a reset email; reset = redeem a token"),
  currentPassword: z.string().optional().describe("Your current password (action=change)"),
  newPassword: z.string().optional().describe("The new password (action=change)"),
  email: z.string().optional().describe("Account email (action=forgot or reset)"),
  token: z.string().optional().describe("The emailed reset token (action=reset)"),
  password: z.string().optional().describe("The new password (action=reset)"),
  passwordConfirm: z.string().optional().describe("Repeat the new password (action=reset)"),
};

type PasswordWriteArgs = {
  action: "change" | "forgot" | "reset";
  currentPassword?: string | undefined;
  newPassword?: string | undefined;
  email?: string | undefined;
  token?: string | undefined;
  password?: string | undefined;
  passwordConfirm?: string | undefined;
};

/**
 * Handles user_password_write: change the current user's password, request a
 * reset email, or complete a token reset. Password and token values are never
 * echoed in any result (Mealie's responses are untyped — successes synthesize
 * a plain { action, success } echo with no inputs).
 *
 * @param client - A MealieClient (or compatible fake)
 * @param args - Validated arguments (action + action fields; secrets stay out of results)
 * @returns An MCP result for the action, or an error result
 */
export async function userPasswordWriteHandler(
  client: WriteClient,
  args: PasswordWriteArgs,
): Promise<CallToolResult> {
  const requirement = missingField(args);
  if (requirement) return missing(requirement);
  try {
    return await dispatch(client, args);
  } catch (error) {
    return errorResult(error, "user_password_write", "Password operation failed");
  }
}

/** Names the first missing required field for the action, or null when complete. */
function missingField(args: PasswordWriteArgs): string | null {
  if (args.action === "change") {
    if (!args.currentPassword || !args.newPassword)
      return "currentPassword and newPassword are required for change";
    return null;
  }
  if (args.action === "forgot") return args.email ? null : "email is required for forgot";
  if (!args.token || !args.email || !args.password || !args.passwordConfirm)
    return "token, email, password, and passwordConfirm are required for reset";
  return null;
}

/** Routes the validated action; every response body is untyped and discarded. */
async function dispatch(client: WriteClient, args: PasswordWriteArgs): Promise<CallToolResult> {
  if (args.action === "change") {
    const body: ChangeBody = {
      currentPassword: args.currentPassword ?? "",
      newPassword: args.newPassword ?? "",
    };
    await client.put(CHANGE_PATH, body);
    return jsonResult({ action: "change", success: true });
  }
  if (args.action === "forgot") {
    const body: ForgotBody = { email: args.email ?? "" };
    await client.post(FORGOT_PATH, body);
    return jsonResult({
      action: "forgot",
      success: true,
      message: "If the address exists, a reset email was sent (requires instance SMTP).",
    });
  }
  const body: ResetBody = {
    token: args.token ?? "",
    email: args.email ?? "",
    password: args.password ?? "",
    passwordConfirm: args.passwordConfirm ?? "",
  };
  await client.post(RESET_PATH, body);
  return jsonResult({ action: "reset", success: true });
}

/** Returns an isError result describing the missing requirement (never echoes values). */
function missing(requirement: string): CallToolResult {
  return {
    content: [{ type: "text", text: `user_password_write: ${requirement}` }],
    isError: true,
  };
}

/**
 * Registers the user_password_write tool on the server.
 *
 * @param server - The McpServer to register on
 * @param client - The MealieClient used by the handler
 */
export function registerUserPasswordWrite(server: McpServer, client: MealieClient): void {
  server.registerTool(
    "user_password_write",
    {
      title: "Change/Reset My Password",
      description:
        "Change your password (currentPassword + newPassword), request a reset email (forgot + email; needs instance SMTP), or complete a reset (reset + token/email/password/passwordConfirm). Password values are never echoed.",
      inputSchema,
      annotations: { readOnlyHint: false, openWorldHint: true },
    },
    (args) => userPasswordWriteHandler(client, args),
  );
}

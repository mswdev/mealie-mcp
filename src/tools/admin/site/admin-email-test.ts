import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod";
import type { MealieClient } from "../../../client/MealieClient.js";
import type { components } from "../../../types/mealie.js";
import { errorResult, jsonResult } from "../../result.js";

const EMAIL_PATH = "/api/admin/email";

type EmailTest = components["schemas"]["EmailTest"];
/**
 * EmailSuccess uses POSITIVE-success semantics: a failed test returns HTTP 200
 * with success:false and error set to the failure MESSAGE STRING — unlike
 * SuccessResponse's boolean error flag. The body must be inspected.
 */
type EmailSuccess = components["schemas"]["EmailSuccess"];

/** Minimal client surface the handler needs (eases test fakes). */
type EmailClient = Pick<MealieClient, "post">;

const inputSchema = {
  email: z.string().describe("Recipient address for the test email"),
};

type EmailTestArgs = { email: string };

/**
 * Handles admin_email_test: sends a REAL test email through the instance's
 * SMTP configuration and reports whether delivery was accepted.
 *
 * @param client - A MealieClient (or compatible fake)
 * @param args - Validated arguments (recipient email)
 * @returns An MCP result reporting the send outcome, or an error result
 */
export async function adminEmailTestHandler(
  client: EmailClient,
  args: EmailTestArgs,
): Promise<CallToolResult> {
  try {
    const body: EmailTest = { email: args.email };
    const response = await client.post<EmailSuccess>(EMAIL_PATH, body);
    if (!response.success) {
      const reason = response.error ?? "email test failed";
      return errorResult(new Error(reason), "admin_email_test", "Email test failed");
    }
    return jsonResult({ sent: true, email: args.email });
  } catch (error) {
    return errorResult(error, "admin_email_test", "Failed to send test email");
  }
}

/**
 * Registers the admin_email_test tool on the server.
 *
 * @param server - The McpServer to register on
 * @param client - The MealieClient used by the handler
 */
export function registerAdminEmailTest(server: McpServer, client: MealieClient): void {
  server.registerTool(
    "admin_email_test",
    {
      title: "Admin: Send Test Email",
      description:
        "Send a REAL test email to an address through the instance's SMTP configuration (side-effecting). Check readiness first via admin_about include: [email_ready].",
      inputSchema,
      annotations: { readOnlyHint: false, openWorldHint: true },
    },
    (args) => adminEmailTestHandler(client, args),
  );
}

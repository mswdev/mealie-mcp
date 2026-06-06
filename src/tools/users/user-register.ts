import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod";
import type { MealieClient } from "../../client/MealieClient.js";
import type { components } from "../../types/mealie.js";
import { jsonResult, secretSafeErrorResult } from "../result.js";
import { type User, projectUser } from "./user-projection.js";

const REGISTER_PATH = "/api/users/register";
/** Mealie's registration default locale. */
const DEFAULT_LOCALE = "en-US";

/** The registration request body (required-with-default fields supplied explicitly). */
type RegistrationBody = components["schemas"]["CreateUserRegistration"];

/** Minimal client surface the handler needs (eases test fakes). */
type RegisterClient = Pick<MealieClient, "post">;

const inputSchema = {
  email: z.string().describe("The new account's email"),
  username: z.string().describe("The new account's username"),
  fullName: z.string().describe("The new account's display name"),
  password: z.string().describe("The new account's password"),
  passwordConfirm: z.string().describe("Repeat the password"),
  group: z.string().optional().describe("Group NAME to join (not an id)"),
  household: z.string().optional().describe("Household NAME to join (not an id)"),
  groupToken: z.string().optional().describe("Invite token to join an existing group"),
  advanced: z.boolean().optional().describe("Enable advanced features (default false)"),
  private: z.boolean().optional().describe("Make the account private (default false)"),
  seedData: z.boolean().optional().describe("Seed starter data (default false)"),
  locale: z.string().optional().describe(`Seed-data locale (default ${DEFAULT_LOCALE})`),
};

type RegisterArgs = {
  email: string;
  username: string;
  fullName: string;
  password: string;
  passwordConfirm: string;
  group?: string | undefined;
  household?: string | undefined;
  groupToken?: string | undefined;
  advanced?: boolean | undefined;
  private?: boolean | undefined;
  seedData?: boolean | undefined;
  locale?: string | undefined;
};

/**
 * Handles user_register: creates a NEW user account via Mealie's public
 * registration endpoint. The echoed result is the concise created user —
 * password, passwordConfirm, and groupToken are never echoed.
 *
 * @param client - A MealieClient (or compatible fake)
 * @param args - Validated arguments (account fields; secrets stay out of results)
 * @returns An MCP result with { registered, user }, or an error result
 */
export async function userRegisterHandler(
  client: RegisterClient,
  args: RegisterArgs,
): Promise<CallToolResult> {
  if (!hasRequiredFields(args)) return missingFields();
  try {
    const user = await client.post<User>(REGISTER_PATH, buildBody(args));
    return jsonResult({ registered: true, user: projectUser(user, "concise") });
  } catch (error) {
    // Sanitized: Mealie's 422 bodies can echo the rejected password/groupToken value.
    return secretSafeErrorResult(
      error,
      "user_register",
      "Registration failed (signup may be disabled)",
    );
  }
}

/** All five identity fields must be non-empty strings. */
function hasRequiredFields(args: RegisterArgs): boolean {
  return Boolean(
    args.email && args.username && args.fullName && args.password && args.passwordConfirm,
  );
}

/** Builds the typed body, supplying Mealie's required-with-default fields explicitly. */
function buildBody(args: RegisterArgs): RegistrationBody {
  return {
    email: args.email,
    username: args.username,
    fullName: args.fullName,
    password: args.password,
    passwordConfirm: args.passwordConfirm,
    advanced: args.advanced ?? false,
    private: args.private ?? false,
    seedData: args.seedData ?? false,
    locale: args.locale ?? DEFAULT_LOCALE,
    ...(args.group !== undefined ? { group: args.group } : {}),
    ...(args.household !== undefined ? { household: args.household } : {}),
    ...(args.groupToken !== undefined ? { groupToken: args.groupToken } : {}),
  };
}

/** Returns an isError result for missing identity fields (never echoes values). */
function missingFields(): CallToolResult {
  return {
    content: [
      {
        type: "text",
        text: "user_register: email, username, fullName, password, and passwordConfirm are required",
      },
    ],
    isError: true,
  };
}

/**
 * Registers the user_register tool on the server.
 *
 * @param server - The McpServer to register on
 * @param client - The MealieClient used by the handler
 */
export function registerUserRegister(server: McpServer, client: MealieClient): void {
  server.registerTool(
    "user_register",
    {
      title: "Register a New User",
      description:
        "Create a NEW user account (public endpoint — not scoped to the current user; instances may have signup disabled). Optional groupToken joins via invite; group/household are NAMES. Passwords are never echoed.",
      inputSchema,
      annotations: { readOnlyHint: false, openWorldHint: true },
    },
    (args) => userRegisterHandler(client, args),
  );
}

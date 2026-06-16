import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod";
import type { MealieClient } from "../../client/MealieClient.js";
import type { components } from "../../types/mealie.js";
import { errorResult, jsonResult } from "../result.js";
import {
  ORGANIZER_TYPES,
  type OrganizerType,
  organizerBasePath,
  projectOrganizer,
} from "./organizer-projection.js";

/** Minimal client surface the handler needs (eases test fakes). */
type CreateClient = Pick<MealieClient, "post">;

const inputSchema = {
  type: z.enum(ORGANIZER_TYPES).describe("Which organizer resource to create"),
  name: z.string().min(1).describe("Name of the new organizer"),
  householdsWithTool: z
    .array(z.string())
    .optional()
    .describe("Household ids the tool applies to (tool type only; default empty)"),
};

type CreateArgs = {
  type: OrganizerType;
  name: string;
  householdsWithTool?: string[] | undefined;
};

/**
 * Handles organizer_create: creates a category/tag/tool. category and tag take a
 * bare { name }; tool additionally takes householdsWithTool (default empty).
 *
 * @param client - A MealieClient (or compatible fake)
 * @param args - Validated arguments (type, name, optional householdsWithTool)
 * @returns An MCP result with the concise created organizer, or an error result
 */
export async function organizerCreateHandler(
  client: CreateClient,
  args: CreateArgs,
): Promise<CallToolResult> {
  try {
    const created = await client.post<unknown>(organizerBasePath(args.type), buildBody(args));
    return jsonResult(projectOrganizer(created, "concise"));
  } catch (error) {
    return errorResult(error, "organizer_create", "Failed to create organizer");
  }
}

/**
 * Builds the per-type create body. tool diverges with householdsWithTool;
 * category and tag share the byte-identical `{ name }` schema (CategoryIn ≡ TagIn),
 * so CategoryIn is used intentionally for both rather than branching twice.
 */
function buildBody(args: CreateArgs): unknown {
  if (args.type === "tool") {
    const body: components["schemas"]["RecipeToolCreate"] = {
      name: args.name,
      householdsWithTool: args.householdsWithTool ?? [],
    };
    return body;
  }
  const body: components["schemas"]["CategoryIn"] = { name: args.name };
  return body;
}

/**
 * Registers the organizer_create tool on the server.
 *
 * @param server - The McpServer to register on
 * @param client - The MealieClient used by the handler
 */
export function registerOrganizerCreate(server: McpServer, client: MealieClient): void {
  server.registerTool(
    "organizer_create",
    {
      title: "Create Organizer",
      description:
        "Create a recipe category, tag, or tool (set type). name is required; tools may set householdsWithTool.",
      inputSchema,
      annotations: { readOnlyHint: false, openWorldHint: true },
    },
    (args) => organizerCreateHandler(client, args),
  );
}

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod";
import type { MealieClient } from "../../client/MealieClient.js";
import type { components } from "../../types/mealie.js";
import { errorResult, jsonResult } from "../result.js";
import { type CookbookDetail, projectCookbook } from "./cookbook-projection.js";

/** Minimal client surface the handler needs (eases test fakes). */
type CreateClient = Pick<MealieClient, "post">;

/** Default ordering position Mealie assigns a new cookbook. */
const DEFAULT_COOKBOOK_POSITION = 1;

const inputSchema = {
  name: z.string().min(1).describe("Name of the new cookbook"),
  description: z.string().optional().describe("Optional description"),
  public: z
    .boolean()
    .optional()
    .describe("Whether the cookbook is publicly visible (default false)"),
  position: z.number().int().optional().describe("Ordering position (default 1)"),
  queryFilterString: z
    .string()
    .optional()
    .describe('Optional Mealie filter expression selecting recipes (e.g. \'tags.name CONTAINS ALL ["quick"]\')'),
};

type CreateArgs = {
  name: string;
  description?: string | undefined;
  public?: boolean | undefined;
  position?: number | undefined;
  queryFilterString?: string | undefined;
};

/**
 * Handles cookbook_create: creates a cookbook. Mealie's CreateCookBook marks
 * description/public/position/queryFilterString required (they sit in the schema's
 * `required` array despite having defaults), so the handler supplies safe defaults
 * for any the caller omits.
 *
 * @param client - A MealieClient (or compatible fake)
 * @param args - Validated arguments (name + optional fields)
 * @returns An MCP result with the concise created cookbook, or an error result
 */
export async function cookbookCreateHandler(
  client: CreateClient,
  args: CreateArgs,
): Promise<CallToolResult> {
  try {
    const body: components["schemas"]["CreateCookBook"] = {
      name: args.name,
      description: args.description ?? "",
      public: args.public ?? false,
      position: args.position ?? DEFAULT_COOKBOOK_POSITION,
      queryFilterString: args.queryFilterString ?? "",
    };
    const created = await client.post<CookbookDetail>("/api/households/cookbooks", body);
    return jsonResult(projectCookbook(created, "concise"));
  } catch (error) {
    return errorResult(error, "cookbook_create", "Failed to create cookbook");
  }
}

/**
 * Registers the cookbook_create tool on the server.
 *
 * @param server - The McpServer to register on
 * @param client - The MealieClient used by the handler
 */
export function registerCookbookCreate(server: McpServer, client: MealieClient): void {
  server.registerTool(
    "cookbook_create",
    {
      title: "Create Cookbook",
      description:
        "Create a new cookbook. A cookbook is a saved filter over recipes (queryFilterString); name is required, other fields default.",
      inputSchema,
      annotations: { readOnlyHint: false, openWorldHint: true },
    },
    (args) => cookbookCreateHandler(client, args),
  );
}

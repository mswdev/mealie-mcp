import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod";
import type { MealieClient } from "../../client/MealieClient.js";
import { errorResult, jsonResult } from "../result.js";
import { type CookbookDetail, projectCookbook } from "./cookbook-projection.js";

/** Minimal client surface the handler needs (eases test fakes). */
type GetClient = Pick<MealieClient, "get">;

const inputSchema = {
  id: z.string().describe("Cookbook id or slug (from cookbook_search)"),
  response_format: z
    .enum(["concise", "detailed"])
    .optional()
    .describe("concise (default) trims heavy fields; detailed returns the full cookbook"),
};

type GetArgs = {
  id: string;
  response_format?: "concise" | "detailed" | undefined;
};

/**
 * Handles cookbook_get: fetches a single cookbook and projects it.
 *
 * @param client - A MealieClient (or compatible fake)
 * @param args - Validated arguments (id, response_format)
 * @returns An MCP result with the projected cookbook, or an error result
 */
export async function cookbookGetHandler(
  client: GetClient,
  args: GetArgs,
): Promise<CallToolResult> {
  try {
    const cookbook = await client.get<CookbookDetail>(`/api/households/cookbooks/${args.id}`);
    return jsonResult(projectCookbook(cookbook, args.response_format ?? "concise"));
  } catch (error) {
    return errorResult(error, "cookbook_get", "Failed to get cookbook");
  }
}

/**
 * Registers the cookbook_get tool on the server.
 *
 * @param server - The McpServer to register on
 * @param client - The MealieClient used by the handler
 */
export function registerCookbookGet(server: McpServer, client: MealieClient): void {
  server.registerTool(
    "cookbook_get",
    {
      title: "Get Cookbook",
      description:
        "Get a single cookbook by id or slug. Returns concise by default; pass response_format: detailed for every field.",
      inputSchema,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    (args) => cookbookGetHandler(client, args),
  );
}

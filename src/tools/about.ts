import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { AppAbout, MealieClient } from "../client/MealieClient.js";
import { errorResult, jsonResult } from "./result.js";

/**
 * Handles the get_about tool call — returns Mealie instance info.
 *
 * @param client - A MealieClient (or compatible fake for testing)
 * @returns MCP tool result with JSON-formatted about info, or an error result on failure
 */
export async function getAboutHandler(
  client: Pick<MealieClient, "getAbout">,
): Promise<CallToolResult> {
  try {
    const about: AppAbout = await client.getAbout();
    return jsonResult(about);
  } catch (error) {
    return errorResult(error, "get_about", "Failed to get Mealie info");
  }
}

/**
 * Registers all "about" tools on the MCP server.
 *
 * @param server - The McpServer instance to register tools on
 * @param client - The MealieClient to use for API calls
 */
export function registerAboutTools(server: McpServer, client: MealieClient): void {
  server.registerTool(
    "get_about",
    {
      title: "Get Mealie Info",
      description:
        "Returns information about the connected Mealie instance: version, configuration, and feature flags.",
      annotations: { readOnlyHint: true },
    },
    () => getAboutHandler(client),
  );
}

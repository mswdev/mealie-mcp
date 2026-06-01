import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { MealieClient } from "./client/MealieClient.js";
import { registerAboutTools } from "./tools/about.js";

const SERVER_NAME = "mealie-mcp";
const SERVER_VERSION = "0.1.0";

/**
 * Creates and configures the MCP server with all registered tools.
 * Called once per process for stdio, or once per HTTP request for stateless HTTP mode.
 *
 * @param client - The MealieClient instance to pass to all tool handlers
 * @returns A fully configured McpServer ready to connect to a transport
 */
export function createServer(client: MealieClient): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });

  registerAboutTools(server, client);

  return server;
}

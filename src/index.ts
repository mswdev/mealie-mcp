import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { MealieClient } from "./client/MealieClient.js";
import { loadConfig } from "./config.js";
import { buildHttpApp } from "./http/app.js";
import { logger } from "./logger.js";
import { createServer } from "./server.js";

/** Bind addresses that expose the server on all interfaces. */
const ALL_INTERFACES_HOSTS = new Set(["0.0.0.0", "::"]);

const config = loadConfig();
const client = new MealieClient(config.MEALIE_URL, config.MEALIE_API_TOKEN);

if (config.TRANSPORT === "stdio") {
  await startStdio();
} else {
  startHttp();
}

/**
 * Starts the MCP server over stdio — the default transport for desktop and CLI clients.
 *
 * @returns A promise that resolves once the server is connected to stdio
 */
async function startStdio(): Promise<void> {
  const server = createServer(client, {
    readOnly: config.MEALIE_READ_ONLY,
    toolsets: config.MEALIE_TOOLSETS,
  });
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info("mealie-mcp running on stdio");
}

/**
 * Starts the MCP server over HTTP using a stateless StreamableHTTP transport, bound to the
 * configured host. Bearer auth is enforced by buildHttpApp; warns if binding to all
 * interfaces without a Host allow-list (DNS-rebinding protection then relies on auth alone).
 */
function startHttp(): void {
  const app = buildHttpApp(config, client);
  app.listen(config.PORT, config.HOST, () => {
    logger.info({ port: config.PORT, host: config.HOST }, "mealie-mcp running on HTTP");
  });
  if (ALL_INTERFACES_HOSTS.has(config.HOST) && config.MEALIE_HTTP_ALLOWED_HOSTS === undefined) {
    logger.warn(
      { host: config.HOST },
      "Binding to all interfaces without MEALIE_HTTP_ALLOWED_HOSTS; Host-header DNS-rebinding protection is disabled (bearer auth still enforced)",
    );
  }
}

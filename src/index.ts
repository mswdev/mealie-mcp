import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { Request, Response } from "express";
import { MealieClient } from "./client/MealieClient.js";
import { loadConfig } from "./config.js";
import { logger } from "./logger.js";
import { createServer } from "./server.js";

/**
 * HTTP transport listen address. Passed both to `app.listen` (the actual bind) and to
 * `createMcpExpressApp`, where it selects DNS-rebinding protection: "0.0.0.0" binds all
 * interfaces and, per the SDK, disables the localhost-only DNS-rebinding guard.
 */
const HTTP_HOST = "0.0.0.0";
/** HTTP status for an unsupported HTTP method on the /mcp endpoint. */
const HTTP_METHOD_NOT_ALLOWED = 405;
/** JSON-RPC error code used by the MCP transport layer for server-side errors. */
const JSON_RPC_SERVER_ERROR = -32000;

const config = loadConfig();
const client = new MealieClient(config.MEALIE_URL, config.MEALIE_API_TOKEN);

if (config.TRANSPORT === "stdio") {
  await startStdio();
} else {
  await startHttp();
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
 * Starts the MCP server over HTTP using a stateless StreamableHTTP transport.
 * Each POST /mcp request gets a fresh server + transport pair.
 *
 * @returns A promise that resolves once the HTTP listener is bound
 */
async function startHttp(): Promise<void> {
  const app = createMcpExpressApp({ host: HTTP_HOST });

  app.post("/mcp", handleMcpPost);
  app.get("/mcp", respondMethodNotAllowed);
  app.delete("/mcp", respondMethodNotAllowed);

  app.listen(config.PORT, HTTP_HOST, () => {
    logger.info({ port: config.PORT, host: HTTP_HOST }, "mealie-mcp running on HTTP");
  });
}

/**
 * Handles a POST /mcp request by creating a per-request server + transport and
 * delegating the JSON-RPC message to the StreamableHTTP transport. Every request
 * (initialize, tools/list, tools/call, ...) is served by a fresh stateless pair.
 *
 * @param req - The incoming Express request carrying a JSON-RPC message body
 * @param res - The Express response to stream the MCP reply through
 * @returns A promise that resolves once the request has been handled
 */
async function handleMcpPost(req: Request, res: Response): Promise<void> {
  const server = createServer(client, {
    readOnly: config.MEALIE_READ_ONLY,
    toolsets: config.MEALIE_TOOLSETS,
  });
  // Stateless mode: omit sessionIdGenerator so the transport does not track sessions.
  const transport = new StreamableHTTPServerTransport({});
  // SDK v1.29.0: StreamableHTTPServerTransport implements Transport, but its optional
  // onclose field widens to (() => void) | undefined under exactOptionalPropertyTypes and
  // is not directly assignable. Cast at the connect boundary; the variable stays concrete
  // so transport.handleRequest()/close() remain typed below.
  await server.connect(transport as Transport);

  // server.close() cascades to transport.close() (Protocol.close awaits the transport),
  // so closing the server is sufficient. Catch the async rejection to avoid an
  // unhandled rejection crashing the process if teardown fails mid-request.
  res.on("close", () => {
    server.close().catch((err) => logger.error({ err }, "error closing MCP server"));
  });

  await transport.handleRequest(req, res, req.body);
}

/**
 * Rejects unsupported HTTP methods on the /mcp endpoint with a 405 JSON-RPC error.
 *
 * @param _req - The incoming Express request (unused)
 * @param res - The Express response used to send the 405 error
 */
function respondMethodNotAllowed(_req: Request, res: Response): void {
  res.status(HTTP_METHOD_NOT_ALLOWED).json(jsonRpcError("Method not allowed"));
}

/**
 * Builds a JSON-RPC 2.0 error envelope with a null id.
 *
 * @param message - The human-readable error message to embed
 * @returns A JSON-RPC error object suitable for sending as the response body
 */
function jsonRpcError(message: string): {
  jsonrpc: "2.0";
  error: { code: number; message: string };
  id: null;
} {
  return {
    jsonrpc: "2.0",
    error: { code: JSON_RPC_SERVER_ERROR, message },
    id: null,
  };
}

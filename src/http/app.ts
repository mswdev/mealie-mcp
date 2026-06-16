import type { CreateMcpExpressAppOptions } from "@modelcontextprotocol/sdk/server/express.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { Express, Request, Response } from "express";
import type { MealieClient } from "../client/MealieClient.js";
import type { Config } from "../config.js";
import { logger } from "../logger.js";
import { createServer } from "../server.js";
import { createBearerAuthMiddleware } from "./auth.js";
import { jsonRpcError } from "./json-rpc.js";

/** HTTP status for an unsupported HTTP method on the /mcp endpoint. */
const HTTP_METHOD_NOT_ALLOWED = 405;
/** HTTP status for an unexpected server-side failure handling a /mcp request. */
const HTTP_INTERNAL_ERROR = 500;

/** Bind hosts that are loopback-only, where the SDK auto-applies Host-header validation. */
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

/**
 * Decides whether to warn that Host-header DNS-rebinding protection is off. It is off whenever
 * the server binds a non-loopback host (0.0.0.0, ::, or a routable IP/hostname) without an
 * explicit allow-list — the SDK only auto-protects loopback binds. Bearer auth still applies.
 *
 * @param host - The configured bind host
 * @param allowedHosts - The configured Host-header allow-list, or undefined when unset
 * @returns true when the operator should be warned that DNS-rebinding protection is disabled
 */
export function shouldWarnUnprotectedBind(
  host: string,
  allowedHosts: string[] | undefined,
): boolean {
  return !LOOPBACK_HOSTS.has(host) && allowedHosts === undefined;
}

/** The per-request context needed to build a fresh MCP server + transport. */
type HttpContext = { config: Config; client: MealieClient };

/**
 * Builds the createMcpExpressApp options from config, including allowedHosts only when
 * an allow-list is configured (exactOptionalPropertyTypes: never assign `allowedHosts: undefined`).
 *
 * @param config - The validated server configuration
 * @returns Options for createMcpExpressApp (host always; allowedHosts when present)
 */
function buildExpressOptions(config: Config): CreateMcpExpressAppOptions {
  if (config.MEALIE_HTTP_ALLOWED_HOSTS === undefined) return { host: config.HOST };
  return { host: config.HOST, allowedHosts: config.MEALIE_HTTP_ALLOWED_HOSTS };
}

/**
 * Narrows the auth token to a non-empty string. loadConfig guarantees this in HTTP mode;
 * the guard keeps the type honest and fails loudly if reached without a token.
 *
 * @param config - The validated server configuration
 * @returns The required HTTP auth token
 * @throws {Error} when the auth token is missing (should be unreachable after loadConfig)
 */
function requireAuthToken(config: Config): string {
  const token = config.MEALIE_HTTP_AUTH_TOKEN;
  if (token === undefined || token.trim() === "") {
    throw new Error("MEALIE_HTTP_AUTH_TOKEN is required in HTTP mode");
  }
  return token;
}

/**
 * Handles a POST /mcp request with a fresh stateless server + transport pair.
 *
 * @param req - The incoming Express request carrying a JSON-RPC message body
 * @param res - The Express response to stream the MCP reply through
 * @param context - The config + client used to build the per-request server
 * @returns A promise that resolves once the request has been handled
 */
async function handleMcpPost(req: Request, res: Response, context: HttpContext): Promise<void> {
  const server = createServer(context.client, {
    readOnly: context.config.MEALIE_READ_ONLY,
    toolsets: context.config.MEALIE_TOOLSETS,
  });
  // Stateless mode: omit sessionIdGenerator so the transport does not track sessions.
  const transport = new StreamableHTTPServerTransport({});
  // SDK v1.29.0: StreamableHTTPServerTransport implements Transport, but its optional
  // onclose field widens under exactOptionalPropertyTypes and is not directly assignable.
  // Cast at the connect boundary; the variable stays concrete so handleRequest() is typed.
  await server.connect(transport as Transport);

  // server.close() cascades to transport.close(); catch the async rejection so a teardown
  // failure mid-request does not crash the process with an unhandled rejection.
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
 * Handles an unexpected rejection from the POST /mcp handler: logs it and returns a JSON-RPC
 * 500, unless the transport has already started streaming the response. The error detail is
 * logged but never sent to the client (it may carry upstream specifics).
 *
 * @param res - The Express response for the failed request
 * @param err - The error thrown while handling the request
 */
export function respondInternalError(res: Response, err: unknown): void {
  logger.error({ err }, "error handling MCP request");
  if (res.headersSent) return;
  res.status(HTTP_INTERNAL_ERROR).json(jsonRpcError("Internal server error"));
}

/**
 * Builds the Express app for HTTP transport: DNS-rebinding host validation (via the SDK
 * helper), bearer auth, and the /mcp routes. Does not bind a port — the caller listens.
 *
 * @param config - The validated server configuration
 * @param client - The MealieClient shared across per-request servers
 * @returns A configured Express application ready to listen
 */
export function buildHttpApp(config: Config, client: MealieClient): Express {
  const app = createMcpExpressApp(buildExpressOptions(config));
  // createMcpExpressApp already registered express.json() (100kb default) and Host-header
  // validation, so an unauthenticated body is parsed (bounded) before this 401 gate. Bearer
  // auth is the primary control; this ordering is intentional and acceptable.
  app.use(createBearerAuthMiddleware(requireAuthToken(config)));

  const context: HttpContext = { config, client };
  // Express does not await a handler's returned promise, so catch rejections explicitly:
  // surface a JSON-RPC 500 (not Express's default HTML error) and log the failure.
  app.post("/mcp", (req, res) => {
    handleMcpPost(req, res, context).catch((err) => respondInternalError(res, err));
  });
  app.get("/mcp", respondMethodNotAllowed);
  app.delete("/mcp", respondMethodNotAllowed);
  return app;
}

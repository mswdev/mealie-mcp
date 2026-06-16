import pino from "pino";

/** File descriptor for stderr. stdout (fd 1) is reserved for MCP JSON-RPC. */
const STDERR_FD = 2;

const isDev = process.env.NODE_ENV !== "production";

/**
 * Pino logger configured to write to stderr only.
 * stdout is reserved for MCP JSON-RPC in stdio transport mode.
 */
export const logger = pino(
  {
    level: process.env.LOG_LEVEL ?? (isDev ? "debug" : "info"),
  },
  pino.destination({ dest: STDERR_FD, sync: false }),
);

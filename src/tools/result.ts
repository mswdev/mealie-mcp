import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { logger } from "../logger.js";
import { JSON_INDENT } from "./format.js";

/**
 * Wraps data as a successful MCP tool result with pretty-printed JSON text.
 *
 * @param data - The value to serialize into the tool result
 * @returns An MCP CallToolResult with a single JSON text block
 */
export function jsonResult(data: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, JSON_INDENT) }] };
}

/**
 * Logs an error and returns a uniform MCP error result. Tools never throw — they
 * return an isError result so the calling agent sees a readable failure.
 *
 * @param error - The caught error (any thrown value)
 * @param logLabel - Stable label for the structured log line (e.g. the tool name)
 * @param messagePrefix - Human-readable prefix shown before the error message
 * @returns An MCP CallToolResult with isError set
 */
export function errorResult(
  error: unknown,
  logLabel: string,
  messagePrefix: string,
): CallToolResult {
  logger.error({ err: error }, `${logLabel} failed`);
  const message = error instanceof Error ? error.message : String(error);
  return {
    content: [{ type: "text", text: `${messagePrefix}: ${message}` }],
    isError: true,
  };
}

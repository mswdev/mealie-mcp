import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { MealieApiError } from "../client/MealieApiError.js";
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

/**
 * Logs and returns a sanitized MCP error result for tools whose request bodies
 * carry secrets (passwords, reset tokens). Mealie's 422 validation errors echo
 * the rejected input value (Pydantic v2 ValidationError.input), and even
 * JSON-parse errors can embed response-body snippets — so neither the upstream
 * body nor any error message may reach logs or the result text. Only the HTTP
 * status (or the error's class name) survives.
 *
 * @param error - The caught error (any thrown value); its message is never surfaced
 * @param logLabel - Stable label for the structured log line (e.g. the tool name)
 * @param messagePrefix - Human-readable prefix for the sanitized result text
 * @returns An MCP CallToolResult with isError set and no upstream content
 */
export function secretSafeErrorResult(
  error: unknown,
  logLabel: string,
  messagePrefix: string,
): CallToolResult {
  const reason = describeWithoutBody(error);
  logger.error({ reason }, `${logLabel} failed (detail withheld: request carries secrets)`);
  return {
    content: [{ type: "text", text: `${messagePrefix} (${reason})` }],
    isError: true,
  };
}

/** Names the failure without touching any message/body that could carry a secret. */
function describeWithoutBody(error: unknown): string {
  if (error instanceof MealieApiError) {
    return `HTTP ${error.statusCode} ${error.statusText}`;
  }
  if (error instanceof Error) return error.name;
  return "unknown error";
}

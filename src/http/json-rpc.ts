/** JSON-RPC error code used by the MCP transport layer for server-side errors. */
export const JSON_RPC_SERVER_ERROR = -32000;

/** A JSON-RPC 2.0 error envelope with a null id. */
export type JsonRpcErrorBody = {
  jsonrpc: "2.0";
  error: { code: number; message: string };
  id: null;
};

/**
 * Builds a JSON-RPC 2.0 error envelope with a null id.
 *
 * @param message - The human-readable error message to embed
 * @returns A JSON-RPC error object suitable for sending as the response body
 */
export function jsonRpcError(message: string): JsonRpcErrorBody {
  return {
    jsonrpc: "2.0",
    error: { code: JSON_RPC_SERVER_ERROR, message },
    id: null,
  };
}

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

/**
 * Guards a destructive action behind an explicit confirm flag. This is real
 * server-side enforcement (defense-in-depth atop the read-only switch), not a
 * trusted annotation.
 *
 * @param confirm - The tool's confirm argument
 * @param action - Human-readable description of what would happen (e.g. 'delete recipe "soup"')
 * @returns An isError result to return immediately, or null when confirmed
 */
export function requireConfirmation(
  confirm: boolean | undefined,
  action: string,
): CallToolResult | null {
  if (confirm === true) return null;
  return {
    content: [
      {
        type: "text",
        text: `Refusing to ${action} without confirmation. Pass confirm: true to proceed.`,
      },
    ],
    isError: true,
  };
}

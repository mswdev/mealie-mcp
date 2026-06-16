import type { McpHandle } from "../mcp.js";

/** Shared state threaded through the check modules. */
export type CheckContext = {
  /** Connected MCP client (dist/, all toolsets, writes enabled). */
  mcp: McpHandle;
  /** A short-lived bearer for the few REST-only setup steps (prefs, slug). */
  bearer: string;
  /** The caller's group slug — the explore group_slug. */
  groupSlug: string;
  /** Absolute path to scripts/verify-live/fixtures (multipart inputs). */
  fixturesDir: string;
  /** Names/ids of throwaway entities created during the run, shared across modules. */
  scratch: Record<string, string>;
};

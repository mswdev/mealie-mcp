/**
 * Live-verification harness constants. The target is HARDCODED — never read from
 * the ambient environment — so the harness can only ever hit its own throwaway
 * container, never a real Mealie instance. This is the safety boundary.
 */

/** Host port the throwaway container is published on (non-standard, localhost-only). */
export const HOST_PORT = 9925;
/** The hardcoded target URL (matches docker-compose.yml). */
export const MEALIE_URL = `http://127.0.0.1:${HOST_PORT}`;
/** Pinned image tag, recorded in the report (verified at runtime against /api/app/about). */
export const PINNED_IMAGE_TAG = "v3.19.2";
/** Default first-run admin credentials (seeded only on a zero-user DB). */
export const DEFAULT_ADMIN = { username: "changeme@example.com", password: "MyPassword" } as const;
/** Name given to the long-lived API token the MCP server runs with. */
export const TOKEN_NAME = "verify-live";
/** Built entrypoint the MCP stdio subprocess runs (we test dist/, not source). */
export const SERVER_ENTRY = "dist/index.js";
/** Where the run report is written. */
export const REPORT_PATH = "docs/plans/2026-06-15-live-verification-report.md";
/** When set ("1"), skip teardown so the container survives for fast iteration. */
export const KEEP = process.env.VERIFY_LIVE_KEEP === "1";

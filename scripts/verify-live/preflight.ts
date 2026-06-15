import { MEALIE_URL } from "./config.js";

/** Committed types provenance (src/types/mealie.ts): 259 operations. */
const COMMITTED_OP_COUNT = 259;
/** HTTP methods that count as an operation in an OpenAPI path item. */
const OPERATION_METHODS = new Set(["get", "post", "put", "patch", "delete"]);

/** Fetches the container's OpenAPI and counts operations across all paths. */
async function liveOpCount(): Promise<number> {
  const res = await fetch(`${MEALIE_URL}/openapi.json`);
  const spec = (await res.json()) as { paths: Record<string, Record<string, unknown>> };
  let count = 0;
  for (const item of Object.values(spec.paths)) {
    for (const method of Object.keys(item)) if (OPERATION_METHODS.has(method)) count += 1;
  }
  return count;
}

/** Returns a one-line parity verdict for the report header. */
export async function specParity(): Promise<string> {
  const live = await liveOpCount();
  const delta = live - COMMITTED_OP_COUNT;
  if (delta === 0) return `MATCH (live ${live} ops = committed ${COMMITTED_OP_COUNT})`;
  return `SKEW (live ${live} vs committed ${COMMITTED_OP_COUNT}, Δ${delta > 0 ? "+" : ""}${delta}) — interpret check failures with this in mind`;
}

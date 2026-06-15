import { execFileSync } from "node:child_process";
import { KEEP, MEALIE_URL, PINNED_IMAGE_TAG } from "./config.js";

/** Runs `docker compose <args>` synchronously, inheriting stdio for visibility. */
function compose(args: string[]): void {
  execFileSync("docker", ["compose", ...args], { stdio: "inherit" });
}

/** Brings up the throwaway Mealie and blocks until the container is healthy (idempotent). */
export function up(): void {
  compose(["up", "-d", "--wait"]);
}

/** Tears down the container AND its anonymous volume — unless KEEP is set (iteration). */
export function down(): void {
  if (KEEP) {
    process.stdout.write(
      "VERIFY_LIVE_KEEP=1 — leaving the container up (run `docker compose down -v` to wipe).\n",
    );
    return;
  }
  compose(["down", "-v"]);
}

/** Reads the actual running version from /api/app/about (image tags can mismatch internal version). */
async function runningVersion(): Promise<string> {
  const res = await fetch(`${MEALIE_URL}/api/app/about`);
  const body = (await res.json()) as { version?: string };
  return body.version ?? "unknown";
}

/** Returns pinned tag + actual running version for the report header. */
export async function reportVersion(): Promise<{ pinnedTag: string; runningVersion: string }> {
  return { pinnedTag: PINNED_IMAGE_TAG, runningVersion: await runningVersion() };
}

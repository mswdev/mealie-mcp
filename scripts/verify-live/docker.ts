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

/** Polls /api/app/about until it returns 200 (the instance is ready again). Used after a
 *  backup restore, which can momentarily restart Mealie. Resolves false on timeout. */
export async function waitHealthy(attempts = 30): Promise<boolean> {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const res = await fetch(`${MEALIE_URL}/api/app/about`);
      if (res.ok) return true;
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return false;
}

/** Reads the actual running version from /api/app/about (image tags can mismatch internal version). */
async function runningVersion(): Promise<string> {
  const res = await fetch(`${MEALIE_URL}/api/app/about`);
  const body = (await res.json()) as { version?: string };
  return body.version ?? "unknown";
}

/** Reads the immutable image digest (the tag is re-pushable; the digest is the reproducibility anchor). */
function imageDigest(): string {
  try {
    const out = execFileSync(
      "docker",
      [
        "image",
        "inspect",
        `ghcr.io/mealie-recipes/mealie:${PINNED_IMAGE_TAG}`,
        "--format",
        "{{index .RepoDigests 0}}",
      ],
      { encoding: "utf8" },
    );
    return out.trim() || "unknown";
  } catch {
    return "unknown";
  }
}

/** Returns pinned tag + actual running version + immutable digest for the report header. */
export async function reportVersion(): Promise<{
  pinnedTag: string;
  runningVersion: string;
  digest: string;
}> {
  return {
    pinnedTag: PINNED_IMAGE_TAG,
    runningVersion: await runningVersion(),
    digest: imageDigest(),
  };
}

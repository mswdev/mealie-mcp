import * as z from "zod";
import { logger } from "./logger.js";

/** Lowest valid TCP port number. */
const MIN_PORT = 1;
/** Highest valid TCP port number. */
const MAX_PORT = 65535;
/** Default HTTP port used when PORT is unset and TRANSPORT is "http". */
const DEFAULT_PORT = 3000;
/** Default HTTP bind host — loopback only, so HTTP mode is not exposed by default. */
const DEFAULT_HOST = "127.0.0.1";

/** Environment-string values that enable a boolean flag (everything else is false). */
const TRUTHY_ENV_VALUES = ["true", "1", "yes", "on"] as const;

/**
 * Parses an environment-variable string into a boolean. Unlike z.coerce.boolean(),
 * the string "false" maps to false — coerce treats any non-empty string as true.
 *
 * @param value - Raw env value (or undefined when unset)
 * @returns true only when the value is a recognized truthy token (case-insensitive)
 */
export function parseReadOnly(value: string | undefined): boolean {
  if (value === undefined) return false;
  const normalized = value.trim().toLowerCase();
  return TRUTHY_ENV_VALUES.includes(normalized as (typeof TRUTHY_ENV_VALUES)[number]);
}

/** Loopback hostnames always permitted so local health checks survive an allow-list. */
const LOCALHOST_HOSTNAMES = ["localhost", "127.0.0.1", "[::1]"] as const;

/**
 * Normalizes one allow-list token to the bare, lower-cased hostname the SDK derives from a
 * Host header (`new URL("http://" + host).hostname`), which strips any port. Matching the
 * SDK's own parsing keeps the stored value comparable: a port-bearing entry like
 * "example.com:3000" would otherwise never match the port-less hostname and silently 403.
 *
 * @param token - A single trimmed allow-list entry
 * @returns The bare hostname, or null when the entry is empty or not a valid host
 */
function normalizeHostname(token: string): string | null {
  if (token === "") return null;
  try {
    return new URL(`http://${token}`).hostname;
  } catch {
    logger.warn({ token }, "Ignoring invalid MEALIE_HTTP_ALLOWED_HOSTS entry");
    return null;
  }
}

/**
 * Parses MEALIE_HTTP_ALLOWED_HOSTS into the Host-header allow-list for DNS-rebinding
 * protection. The value is a comma-separated list; entries are normalized to bare lower-cased
 * hostnames (ports stripped, like the SDK), de-duplicated, then merged with the loopback trio
 * so localhost access always works.
 *
 * Returns `undefined` (never `[]`) when no hosts are configured: createMcpExpressApp treats
 * any array as "validate against this list", so an empty array would reject every request.
 *
 * @param value - Raw env value (or undefined when unset)
 * @returns The merged allow-list, or undefined when nothing is configured
 */
export function parseAllowedHosts(value: string | undefined): string[] | undefined {
  if (value === undefined) return undefined;
  const hosts = new Set<string>();
  for (const raw of value.split(",")) {
    const hostname = normalizeHostname(raw.trim());
    if (hostname !== null) hosts.add(hostname);
  }
  if (hosts.size === 0) return undefined;
  for (const localhost of LOCALHOST_HOSTNAMES) hosts.add(localhost);
  return [...hosts];
}

/** Opt-in toolset tokens recognized in MEALIE_TOOLSETS. Extend per opt-in PR (#8-#11). */
export const KNOWN_TOOLSETS = [
  "households",
  "automation",
  "groups",
  "users",
  "admin",
  "explore",
] as const;

/** A recognized opt-in toolset name. */
export type ToolsetName = (typeof KNOWN_TOOLSETS)[number];

/** Type guard: is the token one of the recognized opt-in toolsets? */
function isKnownToolset(token: string): token is ToolsetName {
  return (KNOWN_TOOLSETS as readonly string[]).includes(token);
}

/**
 * Parses MEALIE_TOOLSETS into the set of enabled opt-in toolsets. The value is a
 * comma-separated list; tokens are trimmed, lower-cased, and de-duplicated.
 * Unknown tokens are logged to stderr and ignored so a single typo never blocks
 * startup — valid tokens still take effect.
 *
 * @param value - Raw env value (or undefined when unset)
 * @returns The set of recognized toolset names to enable (empty when unset)
 */
export function parseToolsets(value: string | undefined): Set<ToolsetName> {
  const enabled = new Set<ToolsetName>();
  if (value === undefined) return enabled;
  for (const raw of value.split(",")) {
    const token = raw.trim().toLowerCase();
    if (token === "") continue;
    if (isKnownToolset(token)) enabled.add(token);
    else logger.warn({ token }, "Ignoring unknown MEALIE_TOOLSETS token");
  }
  return enabled;
}

const baseConfigSchema = z.object({
  MEALIE_URL: z.string().url("MEALIE_URL must be a valid URL (e.g. https://mealie.example.com)"),
  MEALIE_API_TOKEN: z.string().min(1, "MEALIE_API_TOKEN is required"),
  TRANSPORT: z.enum(["stdio", "http"]).default("stdio"),
  PORT: z.coerce.number().int().min(MIN_PORT).max(MAX_PORT).default(DEFAULT_PORT),
  HOST: z.string().min(1).default(DEFAULT_HOST),
  MEALIE_READ_ONLY: z
    .preprocess(
      (value) => parseReadOnly(typeof value === "string" ? value : undefined),
      z.boolean(),
    )
    .default(false),
  MEALIE_TOOLSETS: z
    .string()
    .optional()
    .transform((value) => parseToolsets(value)),
  MEALIE_HTTP_AUTH_TOKEN: z.string().optional(),
  MEALIE_HTTP_ALLOWED_HOSTS: z
    .string()
    .optional()
    .transform((value) => parseAllowedHosts(value)),
});

/**
 * HTTP transport is unauthenticated unless a bearer token is set, so it is hard-required:
 * the server refuses to start in http mode without MEALIE_HTTP_AUTH_TOKEN.
 */
const configSchema = baseConfigSchema.superRefine((config, ctx) => {
  if (config.TRANSPORT !== "http") return;
  if (config.MEALIE_HTTP_AUTH_TOKEN !== undefined && config.MEALIE_HTTP_AUTH_TOKEN.trim() !== "") {
    return;
  }
  ctx.addIssue({
    code: z.ZodIssueCode.custom,
    path: ["MEALIE_HTTP_AUTH_TOKEN"],
    message: "MEALIE_HTTP_AUTH_TOKEN is required when TRANSPORT=http",
  });
});

/** Validated server configuration derived from environment variables. */
export type Config = z.infer<typeof configSchema>;

/**
 * Validates environment variables against the config schema without exiting the process.
 * Use this for testing; loadConfig wraps it with process-exit-on-failure.
 *
 * @param env - The environment record to validate (typically process.env)
 * @returns A zod SafeParseReturnType with the validated Config on success
 */
export function parseConfig(env: NodeJS.ProcessEnv): ReturnType<typeof configSchema.safeParse> {
  return configSchema.safeParse(env);
}

/**
 * Validates and returns the server configuration from environment variables.
 * Exits the process with a descriptive error if required variables are missing.
 *
 * @returns The validated Config object; the process exits before returning if validation fails
 */
export function loadConfig(): Config {
  const result = parseConfig(process.env);

  if (!result.success) {
    const errors = result.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    process.stderr.write(`Configuration error:\n${errors}\n`);
    process.exit(1);
  }

  return result.data;
}

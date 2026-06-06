import * as z from "zod";
import { logger } from "./logger.js";

/** Lowest valid TCP port number. */
const MIN_PORT = 1;
/** Highest valid TCP port number. */
const MAX_PORT = 65535;
/** Default HTTP port used when PORT is unset and TRANSPORT is "http". */
const DEFAULT_PORT = 3000;

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

/** Opt-in toolset tokens recognized in MEALIE_TOOLSETS. Extend per opt-in PR (#8-#11). */
export const KNOWN_TOOLSETS = ["households", "automation", "groups", "users"] as const;

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

const configSchema = z.object({
  MEALIE_URL: z.string().url("MEALIE_URL must be a valid URL (e.g. https://mealie.example.com)"),
  MEALIE_API_TOKEN: z.string().min(1, "MEALIE_API_TOKEN is required"),
  TRANSPORT: z.enum(["stdio", "http"]).default("stdio"),
  PORT: z.coerce.number().int().min(MIN_PORT).max(MAX_PORT).default(DEFAULT_PORT),
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
});

/** Validated server configuration derived from environment variables. */
export type Config = z.infer<typeof configSchema>;

/**
 * Validates and returns the server configuration from environment variables.
 * Exits the process with a descriptive error if required variables are missing.
 *
 * @returns The validated Config object; the process exits before returning if validation fails
 */
export function loadConfig(): Config {
  const result = configSchema.safeParse(process.env);

  if (!result.success) {
    const errors = result.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    process.stderr.write(`Configuration error:\n${errors}\n`);
    process.exit(1);
  }

  return result.data;
}

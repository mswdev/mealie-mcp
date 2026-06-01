import * as z from "zod";

/** Lowest valid TCP port number. */
const MIN_PORT = 1;
/** Highest valid TCP port number. */
const MAX_PORT = 65535;
/** Default HTTP port used when PORT is unset and TRANSPORT is "http". */
const DEFAULT_PORT = 3000;

const configSchema = z.object({
  MEALIE_URL: z.string().url("MEALIE_URL must be a valid URL (e.g. https://mealie.example.com)"),
  MEALIE_API_TOKEN: z.string().min(1, "MEALIE_API_TOKEN is required"),
  TRANSPORT: z.enum(["stdio", "http"]).default("stdio"),
  PORT: z.coerce.number().int().min(MIN_PORT).max(MAX_PORT).default(DEFAULT_PORT),
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

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import openapiTS, { astToString } from "openapi-typescript";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_FILE = path.join(__dirname, "../src/types/mealie.ts");

/** Header prepended to the generated types so the file is obviously machine-generated. */
const GENERATED_BANNER = `/**
 * AUTO-GENERATED from Mealie's OpenAPI spec by \`npm run generate\`.
 * Do not edit by hand — changes will be overwritten on the next generation.
 * @see scripts/generate-types.ts
 */`;

/** Public Mealie demo instance used when no spec URL is configured. */
const DEFAULT_SPEC_URL = "https://demo.mealie.io/openapi.json";
/** Only these URL schemes are allowed for fetching the spec. */
const ALLOWED_PROTOCOLS = ["http:", "https:"];

// Use `||` (not `??`) so an empty-string env var (common in CI) is treated as unset.
const specBase = process.env.MEALIE_SPEC_URL || process.env.MEALIE_URL;
const specUrl = specBase ? `${specBase}/openapi.json` : DEFAULT_SPEC_URL;

async function main(): Promise<void> {
  process.stdout.write(`Generating types from: ${specUrl}\n`);

  const url = new URL(specUrl);
  if (!ALLOWED_PROTOCOLS.includes(url.protocol)) {
    throw new Error(`Refusing to fetch spec from a non-http(s) URL: ${specUrl}`);
  }

  const ast = await openapiTS(url);
  const contents = astToString(ast);

  await fs.mkdir(path.dirname(OUT_FILE), { recursive: true });
  await fs.writeFile(OUT_FILE, `${GENERATED_BANNER}\n\n${contents}`, "utf8");

  process.stdout.write(`Types written to: ${OUT_FILE}\n`);
}

main().catch((err: unknown) => {
  process.stderr.write(`Type generation failed: ${String(err)}\n`);
  process.exit(1);
});

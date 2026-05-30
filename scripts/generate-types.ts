import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import openapiTS, { astToString } from "openapi-typescript";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_FILE = path.join(__dirname, "../src/types/mealie.ts");

const specUrl =
  (process.env.MEALIE_SPEC_URL ?? process.env.MEALIE_URL)
    ? `${process.env.MEALIE_SPEC_URL ?? process.env.MEALIE_URL}/openapi.json`
    : "https://demo.mealie.io/openapi.json";

async function main(): Promise<void> {
  process.stdout.write(`Generating types from: ${specUrl}\n`);

  const ast = await openapiTS(new URL(specUrl));
  const contents = astToString(ast);

  await fs.mkdir(path.dirname(OUT_FILE), { recursive: true });
  await fs.writeFile(OUT_FILE, contents, "utf8");

  process.stdout.write(`Types written to: ${OUT_FILE}\n`);
}

main().catch((err: unknown) => {
  process.stderr.write(`Type generation failed: ${String(err)}\n`);
  process.exit(1);
});

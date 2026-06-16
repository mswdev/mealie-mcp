import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod";
import type { MealieClient } from "../../../client/MealieClient.js";
import type { components } from "../../../types/mealie.js";
import { errorResult, jsonResult } from "../../result.js";
import { readUploadFile } from "../../upload.js";
import { type RecipeDetail, projectRecipe } from "../recipe-projection.js";

/** Minimal client surface the handler needs (eases test fakes). */
type ImportClient = Pick<MealieClient, "post" | "get" | "postMultipart">;

/** Default file extensions for the multipart import sources. */
const DEFAULT_ZIP_EXTENSION = "zip";
const DEFAULT_IMAGE_EXTENSION = "jpg";

const inputSchema = {
  source: z
    .enum(["url", "bulk_url", "html_or_json", "zip", "image", "preview"])
    .describe(
      "Where the recipe comes from. url/bulk_url/preview cause YOUR Mealie server to fetch the URL (open-world); zip/image read a file on the MCP server's filesystem (stdio/local only).",
    ),
  url: z.string().url().optional().describe("Recipe URL (source=url or preview)"),
  urls: z.array(z.string().url()).optional().describe("Recipe URLs (source=bulk_url)"),
  data: z.string().optional().describe("Raw HTML or schema.org JSON string (source=html_or_json)"),
  filePath: z
    .string()
    .optional()
    .describe("Server-local file path to upload (source=zip or image; stdio/local only)"),
  extension: z.string().optional().describe("File extension for the upload (zip/image)"),
  translateLanguage: z
    .string()
    .optional()
    .describe("Language to translate the parsed recipe into (source=image)"),
  includeTags: z.boolean().optional().describe("Import the source's tags"),
  includeCategories: z.boolean().optional().describe("Import the source's categories"),
};

type ImportArgs = {
  source: "url" | "bulk_url" | "html_or_json" | "zip" | "image" | "preview";
  url?: string | undefined;
  urls?: string[] | undefined;
  data?: string | undefined;
  filePath?: string | undefined;
  extension?: string | undefined;
  translateLanguage?: string | undefined;
  includeTags?: boolean | undefined;
  includeCategories?: boolean | undefined;
};

/** Returns an isError result naming the field the chosen source requires. */
function missingField(field: string): CallToolResult {
  return {
    content: [{ type: "text", text: `recipe_import: source requires "${field}"` }],
    isError: true,
  };
}

/**
 * Handles recipe_import: a dispatcher over Mealie's import endpoints. URLs are
 * validated lexically only and forwarded to Mealie, which performs the actual
 * fetch — the MCP process never resolves or fetches the URL itself (SSRF stays
 * Mealie's surface, mitigated by its AsyncSafeTransport on Mealie >= 1.4.0).
 *
 * @param client - A MealieClient (or compatible fake)
 * @param args - Validated arguments (source + source-specific fields)
 * @param file - Pre-read file Blob for the zip/image sources (read in the registration layer)
 * @returns An MCP result echoing the imported recipe or a job acknowledgement
 */
export async function recipeImportHandler(
  client: ImportClient,
  args: ImportArgs,
  file?: Blob,
): Promise<CallToolResult> {
  try {
    return await dispatch(client, args, file);
  } catch (error) {
    return errorResult(error, "recipe_import", "Failed to import recipe");
  }
}

/** Routes to the right Mealie import endpoint for the chosen source. */
async function dispatch(
  client: ImportClient,
  args: ImportArgs,
  file: Blob | undefined,
): Promise<CallToolResult> {
  switch (args.source) {
    case "url":
      return importUrl(client, args);
    case "bulk_url":
      return importBulkUrl(client, args);
    case "html_or_json":
      return importHtmlOrJson(client, args);
    case "preview":
      return previewUrl(client, args);
    case "zip":
      return importZip(client, args, file);
    case "image":
      return importImage(client, args, file);
  }
}

/** Re-fetches a recipe by slug and returns its concise projection. */
async function refetchConcise(client: ImportClient, slug: string): Promise<CallToolResult> {
  const recipe = await client.get<RecipeDetail>(`/api/recipes/${slug}`);
  return jsonResult(projectRecipe(recipe, "concise", []));
}

/** POST /api/recipes/create/url — scrape a single URL into a new recipe. */
async function importUrl(client: ImportClient, args: ImportArgs): Promise<CallToolResult> {
  if (!args.url) return missingField("url");
  const body: components["schemas"]["ScrapeRecipe"] = {
    url: args.url,
    includeTags: args.includeTags ?? false,
    includeCategories: args.includeCategories ?? false,
  };
  const slug = await client.post<string>("/api/recipes/create/url", body);
  return refetchConcise(client, slug);
}

/** POST /api/recipes/create/url/bulk — async batch scrape (returns a job ack). */
async function importBulkUrl(client: ImportClient, args: ImportArgs): Promise<CallToolResult> {
  if (!args.urls?.length) return missingField("urls");
  const body: components["schemas"]["CreateRecipeByUrlBulk"] = {
    imports: args.urls.map((url) => ({ url })),
  };
  await client.post("/api/recipes/create/url/bulk", body);
  return jsonResult({ accepted: args.urls.length });
}

/** POST /api/recipes/create/html-or-json — parse caller-supplied HTML/JSON. */
async function importHtmlOrJson(client: ImportClient, args: ImportArgs): Promise<CallToolResult> {
  if (!args.data) return missingField("data");
  const body: components["schemas"]["ScrapeRecipeData"] = {
    data: args.data,
    includeTags: args.includeTags ?? false,
    includeCategories: args.includeCategories ?? false,
    ...(args.url ? { url: args.url } : {}),
  };
  const slug = await client.post<string>("/api/recipes/create/html-or-json", body);
  return refetchConcise(client, slug);
}

/** POST /api/recipes/test-scrape-url — preview a scrape without persisting. */
async function previewUrl(client: ImportClient, args: ImportArgs): Promise<CallToolResult> {
  if (!args.url) return missingField("url");
  const body: components["schemas"]["ScrapeRecipeTest"] = {
    url: args.url,
    useOpenAI: false,
  };
  const result = await client.post("/api/recipes/test-scrape-url", body);
  return jsonResult(result);
}

/** POST /api/recipes/create/zip — upload a Mealie recipe archive. */
async function importZip(
  client: ImportClient,
  args: ImportArgs,
  file: Blob | undefined,
): Promise<CallToolResult> {
  if (!file) return missingField("filePath");
  const form = new FormData();
  form.append("archive", file, `import.${args.extension ?? DEFAULT_ZIP_EXTENSION}`);
  const result = await client.postMultipart<unknown>("/api/recipes/create/zip", form);
  return typeof result === "string" ? refetchConcise(client, result) : jsonResult(result);
}

/** POST /api/recipes/create/image — OCR/AI parse an uploaded image. */
async function importImage(
  client: ImportClient,
  args: ImportArgs,
  file: Blob | undefined,
): Promise<CallToolResult> {
  if (!file) return missingField("filePath");
  const form = new FormData();
  form.append("images", file, `import.${args.extension ?? DEFAULT_IMAGE_EXTENSION}`);
  const query = args.translateLanguage ? { translateLanguage: args.translateLanguage } : undefined;
  const result = await client.postMultipart<unknown>("/api/recipes/create/image", form, query);
  return jsonResult(result);
}

/**
 * Registers the recipe_import tool. The registration layer reads the upload file
 * (for zip/image sources) so the handler stays filesystem-free and testable.
 *
 * @param server - The McpServer to register on
 * @param client - The MealieClient used by the handler
 */
export function registerRecipeImport(server: McpServer, client: MealieClient): void {
  server.registerTool(
    "recipe_import",
    {
      title: "Import Recipe",
      description:
        "Import a recipe from a URL, raw HTML/JSON, a Mealie zip, or an image. URL imports cause your Mealie server to fetch the URL; zip/image read a file on the MCP server (stdio/local only).",
      inputSchema,
      annotations: { readOnlyHint: false, openWorldHint: true },
    },
    async (args) => {
      const file = await loadImportFile(args);
      if (file instanceof Error) return errorResult(file, "recipe_import", "Failed to read file");
      return recipeImportHandler(client, args, file);
    },
  );
}

/** Reads the upload file for file-based sources; returns undefined or the read error. */
async function loadImportFile(args: ImportArgs): Promise<Blob | undefined | Error> {
  const needsFile = args.source === "zip" || args.source === "image";
  if (!needsFile || !args.filePath) return undefined;
  try {
    return await readUploadFile(args.filePath);
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
}

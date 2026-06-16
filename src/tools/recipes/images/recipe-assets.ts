import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod";
import type { MealieClient } from "../../../client/MealieClient.js";
import { errorResult, jsonResult } from "../../result.js";
import { readUploadFile } from "../../upload.js";

/** Minimal client surface the handler needs (eases test fakes). */
type AssetsClient = Pick<MealieClient, "postMultipart">;

/** Default Material Design icon for an uploaded asset. */
const DEFAULT_ASSET_ICON = "mdi-file";

const inputSchema = {
  slug: z.string().describe("The recipe slug to attach the asset to"),
  filePath: z.string().optional().describe("Server-local file path to upload (stdio/local only)"),
  name: z.string().describe("Display name for the asset"),
  extension: z.string().describe("File extension, e.g. pdf/png"),
  icon: z.string().optional().describe(`Material Design icon name (default ${DEFAULT_ASSET_ICON})`),
};

type AssetsArgs = {
  slug: string;
  filePath?: string | undefined;
  name: string;
  extension: string;
  icon?: string | undefined;
};

/**
 * Handles recipe_assets: uploads a file asset attached to a recipe.
 *
 * @param client - A MealieClient (or compatible fake)
 * @param args - Validated arguments (slug, name, extension, icon)
 * @param file - Pre-read asset Blob (read in the registration layer)
 * @returns An MCP result with the created asset, or an error result
 */
export async function recipeAssetsHandler(
  client: AssetsClient,
  args: AssetsArgs,
  file?: Blob,
): Promise<CallToolResult> {
  if (!file) {
    return {
      content: [{ type: "text", text: "recipe_assets: filePath is required to upload an asset" }],
      isError: true,
    };
  }
  try {
    const form = new FormData();
    form.append("file", file, `${args.name}.${args.extension}`);
    form.append("name", args.name);
    form.append("icon", args.icon ?? DEFAULT_ASSET_ICON);
    form.append("extension", args.extension);
    const asset = await client.postMultipart(`/api/recipes/${args.slug}/assets`, form);
    return jsonResult(asset);
  } catch (error) {
    return errorResult(error, "recipe_assets", "Failed to upload recipe asset");
  }
}

/**
 * Registers the recipe_assets tool. The registration layer reads the upload file
 * so the handler stays filesystem-free and testable.
 *
 * @param server - The McpServer to register on
 * @param client - The MealieClient used by the handler
 */
export function registerRecipeAssets(server: McpServer, client: MealieClient): void {
  server.registerTool(
    "recipe_assets",
    {
      title: "Upload Recipe Asset",
      description:
        "Attach a file asset (e.g. a PDF) to a recipe. Reads a file on the MCP server's filesystem (stdio/local only). Read assets back with recipe_media.",
      inputSchema,
      annotations: { readOnlyHint: false, openWorldHint: true },
    },
    async (args) => {
      if (!args.filePath) return recipeAssetsHandler(client, args);
      try {
        const file = await readUploadFile(args.filePath);
        return recipeAssetsHandler(client, args, file);
      } catch (error) {
        return errorResult(error, "recipe_assets", "Failed to read asset file");
      }
    },
  );
}

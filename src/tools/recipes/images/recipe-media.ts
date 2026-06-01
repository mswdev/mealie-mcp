import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod";
import type { MealieClient } from "../../../client/MealieClient.js";
import { jsonResult } from "../../result.js";

/** Minimal client surface the handler needs (eases test fakes). */
type MediaClient = Pick<MealieClient, "baseUrl">;

/** Default image variant returned when no fileName is given (an ImageType value). */
const DEFAULT_IMAGE_FILE = "original.webp";

const inputSchema = {
  recipeId: z.string().describe("The recipe's stable UUID (not its slug)"),
  kind: z.enum(["image", "asset"]).optional().describe("image (default) or asset"),
  fileName: z
    .string()
    .optional()
    .describe(
      `For images, an ImageType variant like original.webp/min-original.webp/tiny-original.webp (default ${DEFAULT_IMAGE_FILE}). For assets, the asset's file name (required).`,
    ),
};

type MediaArgs = {
  recipeId: string;
  kind?: "image" | "asset" | undefined;
  fileName?: string | undefined;
};

/**
 * Handles recipe_media: returns a reference URL to a recipe's image or asset file.
 * Returns a URL only — never the bytes (design §1.3). Performs no network call.
 *
 * @param client - A MealieClient (or compatible fake) exposing baseUrl
 * @param args - Validated arguments (recipeId, kind, fileName)
 * @returns An MCP result with the media URL, or an error result
 */
export async function recipeMediaHandler(
  client: MediaClient,
  args: MediaArgs,
): Promise<CallToolResult> {
  const base = `${client.baseUrl}/api/media/recipes/${args.recipeId}`;
  if ((args.kind ?? "image") === "asset") {
    if (!args.fileName) {
      return {
        content: [{ type: "text", text: "recipe_media: fileName is required for assets" }],
        isError: true,
      };
    }
    return jsonResult({ url: `${base}/assets/${args.fileName}` });
  }
  return jsonResult({ url: `${base}/images/${args.fileName ?? DEFAULT_IMAGE_FILE}` });
}

/**
 * Registers the recipe_media tool on the server.
 *
 * @param server - The McpServer to register on
 * @param client - The MealieClient used by the handler
 */
export function registerRecipeMedia(server: McpServer, client: MealieClient): void {
  server.registerTool(
    "recipe_media",
    {
      title: "Get Recipe Media URL",
      description:
        "Build a reference URL for a recipe's image or asset file (use the recipe UUID). Returns a URL, never the file bytes.",
      inputSchema,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    (args) => recipeMediaHandler(client, args),
  );
}

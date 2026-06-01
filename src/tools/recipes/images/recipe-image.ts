import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod";
import type { MealieClient } from "../../../client/MealieClient.js";
import type { components } from "../../../types/mealie.js";
import { requireConfirmation } from "../../confirm.js";
import { errorResult, jsonResult } from "../../result.js";
import { readUploadFile } from "../../upload.js";

/** Minimal client surface the handler needs (eases test fakes). */
type ImageClient = Pick<MealieClient, "post" | "delete" | "postMultipart">;

const inputSchema = {
  slug: z.string().describe("The recipe slug whose image to manage"),
  action: z
    .enum(["upload", "set_url", "delete"])
    .describe("upload a local file, set the image from a URL (Mealie fetches it), or delete it"),
  filePath: z
    .string()
    .optional()
    .describe("Server-local image path (action=upload; stdio/local only)"),
  extension: z.string().optional().describe("Image file extension, e.g. jpg/png (action=upload)"),
  url: z.string().url().optional().describe("Image URL for Mealie to fetch (action=set_url)"),
  confirm: z.boolean().optional().describe("Must be true to delete the image (action=delete)"),
};

type ImageArgs = {
  slug: string;
  action: "upload" | "set_url" | "delete";
  filePath?: string | undefined;
  extension?: string | undefined;
  url?: string | undefined;
  confirm?: boolean | undefined;
};

/**
 * Handles recipe_image: a write dispatcher for a recipe's image — upload a file,
 * set it from a URL (Mealie fetches), or delete it.
 *
 * @param client - A MealieClient (or compatible fake)
 * @param args - Validated arguments (slug, action + action-specific fields)
 * @param file - Pre-read image Blob for the upload action (read in the registration layer)
 * @returns An MCP result describing the change, or an error result
 */
export async function recipeImageHandler(
  client: ImageClient,
  args: ImageArgs,
  file?: Blob,
): Promise<CallToolResult> {
  if (args.action === "delete") return deleteImage(client, args);
  try {
    return args.action === "upload"
      ? await uploadImage(client, args, file)
      : await setImageUrl(client, args);
  } catch (error) {
    return errorResult(error, "recipe_image", "Failed to update recipe image");
  }
}

/** PUT multipart upload of an image file. */
async function uploadImage(
  client: ImageClient,
  args: ImageArgs,
  file: Blob | undefined,
): Promise<CallToolResult> {
  if (!file) return missing("filePath");
  if (!args.extension) return missing("extension");
  const form = new FormData();
  form.append("image", file, `image.${args.extension}`);
  form.append("extension", args.extension);
  const result = await client.postMultipart(
    `/api/recipes/${args.slug}/image`,
    form,
    undefined,
    "PUT",
  );
  return jsonResult(result);
}

/** POST JSON telling Mealie to fetch the image from a URL. */
async function setImageUrl(client: ImageClient, args: ImageArgs): Promise<CallToolResult> {
  if (!args.url) return missing("url");
  const body: components["schemas"]["ScrapeRecipe"] = {
    url: args.url,
    includeTags: false,
    includeCategories: false,
  };
  await client.post(`/api/recipes/${args.slug}/image`, body);
  return jsonResult({ slug: args.slug, imageSource: args.url });
}

/** DELETE the recipe image (confirm-gated). */
async function deleteImage(client: ImageClient, args: ImageArgs): Promise<CallToolResult> {
  const unconfirmed = requireConfirmation(args.confirm, `delete the image for "${args.slug}"`);
  if (unconfirmed) return unconfirmed;
  try {
    await client.delete(`/api/recipes/${args.slug}/image`);
    return jsonResult({ slug: args.slug, imageDeleted: true });
  } catch (error) {
    return errorResult(error, "recipe_image", "Failed to delete recipe image");
  }
}

/** Returns an isError result naming the field the chosen action requires. */
function missing(field: string): CallToolResult {
  return {
    content: [{ type: "text", text: `recipe_image: action requires "${field}"` }],
    isError: true,
  };
}

/**
 * Registers the recipe_image tool. The registration layer reads the upload file
 * so the handler stays filesystem-free and testable.
 *
 * @param server - The McpServer to register on
 * @param client - The MealieClient used by the handler
 */
export function registerRecipeImage(server: McpServer, client: MealieClient): void {
  server.registerTool(
    "recipe_image",
    {
      title: "Manage Recipe Image",
      description:
        "Upload a recipe image file, set it from a URL (Mealie fetches it), or delete it. Destructive on delete (confirm:true). File upload is stdio/local only.",
      inputSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    },
    async (args) => {
      if (args.action !== "upload" || !args.filePath) return recipeImageHandler(client, args);
      try {
        const file = await readUploadFile(args.filePath);
        return recipeImageHandler(client, args, file);
      } catch (error) {
        return errorResult(error, "recipe_image", "Failed to read image file");
      }
    },
  );
}

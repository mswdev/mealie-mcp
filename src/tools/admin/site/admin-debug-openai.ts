import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod";
import type { MealieClient } from "../../../client/MealieClient.js";
import type { components } from "../../../types/mealie.js";
import { errorResult, jsonResult } from "../../result.js";
import { readUploadFile } from "../../upload.js";

const DEBUG_PATH = "/api/admin/debug/openai";
/** Verbatim multipart field name from Body_debug_openai_…_post (optional + nullable). */
const IMAGE_FIELD = "image";
/** Fallback filename for the uploaded image part. */
const DEFAULT_FILENAME = "image";

/** The probe outcome — response is a free-form opaque string, never parsed. */
type DebugResponse = components["schemas"]["DebugResponse"];

/** Minimal client surface the handler needs (eases test fakes). */
type DebugClient = Pick<MealieClient, "postMultipart">;

const inputSchema = {
  provider_id: z.string().describe("The AI provider to probe (see admin_ai_provider_get)"),
  image_path: z
    .string()
    .optional()
    .describe("Server-local path to a test image (stdio/local only; exercises vision support)"),
};

type DebugArgs = {
  provider_id: string;
  image_path?: string | undefined;
};

/**
 * Handles admin_debug_openai: fires a REAL connectivity probe against the
 * configured AI provider (possibly billable). The upstream body is optional
 * multipart — an empty form is the deterministic no-image encoding. The image
 * file is read in the registration layer so this handler stays filesystem-free.
 *
 * @param client - A MealieClient (or compatible fake)
 * @param args - Validated arguments (provider_id + optional image_path)
 * @param file - The pre-read image Blob (when image_path is given)
 * @returns An MCP result with {success, response}, or an error result
 */
export async function adminDebugOpenaiHandler(
  client: DebugClient,
  args: DebugArgs,
  file?: Blob,
): Promise<CallToolResult> {
  try {
    const form = new FormData();
    if (file) {
      form.append(IMAGE_FIELD, file, args.image_path?.split("/").pop() ?? DEFAULT_FILENAME);
    }
    const path = `${DEBUG_PATH}/${args.provider_id}`;
    const response = await client.postMultipart<DebugResponse>(path, form);
    return jsonResult({ success: response.success, response: response.response });
  } catch (error) {
    return errorResult(error, "admin_debug_openai", "Failed to probe AI provider");
  }
}

/** Reads the test image when given; returns undefined or the read error. */
async function loadDebugImage(args: DebugArgs): Promise<Blob | undefined | Error> {
  if (!args.image_path) return undefined;
  try {
    return await readUploadFile(args.image_path);
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
}

/**
 * Registers the admin_debug_openai tool. The registration layer reads the
 * image file so the handler stays filesystem-free and testable.
 *
 * @param server - The McpServer to register on
 * @param client - The MealieClient used by the handler
 */
export function registerAdminDebugOpenai(server: McpServer, client: MealieClient): void {
  server.registerTool(
    "admin_debug_openai",
    {
      title: "Admin: Debug AI Provider",
      description:
        "Probe an AI provider's connectivity as the site admin — fires a REAL request against the configured provider (possibly billable). Optionally attach a test image (reads a file on the MCP server — stdio/local only) to exercise vision support.",
      inputSchema,
      annotations: { readOnlyHint: false, openWorldHint: true },
    },
    async (args) => {
      const file = await loadDebugImage(args);
      if (file instanceof Error) {
        return errorResult(file, "admin_debug_openai", "Failed to read file");
      }
      return adminDebugOpenaiHandler(client, args, file);
    },
  );
}

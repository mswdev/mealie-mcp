import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod";
import type { MealieClient } from "../../client/MealieClient.js";
import { errorResult, jsonResult } from "../result.js";
import { readUploadFile } from "../upload.js";
import type { User } from "./user-projection.js";

const SELF_PATH = "/api/users/self";
/** Verbatim multipart field name from Body_update_user_image_api_users__id__image_post. */
const AVATAR_FIELD = "profile";
/** Fallback upload filename when the path has no basename. */
const DEFAULT_FILENAME = "avatar";

/** Minimal client surface the handler needs (eases test fakes). */
type UploadClient = Pick<MealieClient, "get" | "postMultipart">;

const inputSchema = {
  filePath: z.string().describe("Server-local path to the image file (stdio/local only)"),
};

type AvatarArgs = {
  filePath?: string | undefined;
};

/**
 * Handles user_avatar_upload: replaces the current user's avatar via multipart
 * upload. The image file is read in the registration layer so this handler
 * stays filesystem-free and testable; the own user id is resolved via GET /self.
 *
 * @param client - A MealieClient (or compatible fake)
 * @param args - Validated arguments ({ filePath })
 * @param file - The pre-read image Blob (read in the registration layer)
 * @returns An MCP result with { uploaded, userId }, or an error result
 */
export async function userAvatarUploadHandler(
  client: UploadClient,
  args: AvatarArgs,
  file?: Blob,
): Promise<CallToolResult> {
  if (!file) return missingFile();
  try {
    const self = await client.get<User>(SELF_PATH);
    await client.postMultipart<unknown>(`/api/users/${self.id}/image`, buildForm(args, file));
    return jsonResult({ uploaded: true, userId: self.id });
  } catch (error) {
    return errorResult(error, "user_avatar_upload", "Failed to upload avatar");
  }
}

/** Assembles the single-field multipart form (the field name is verbatim "profile"). */
function buildForm(args: AvatarArgs, file: Blob): FormData {
  const form = new FormData();
  const filename = args.filePath?.split("/").pop() || DEFAULT_FILENAME;
  form.append(AVATAR_FIELD, file, filename);
  return form;
}

/** Returns an isError result for a missing/unreadable file. */
function missingFile(): CallToolResult {
  return {
    content: [{ type: "text", text: "user_avatar_upload: requires a readable filePath" }],
    isError: true,
  };
}

/** Reads the image file when a path is given; returns undefined or the read error. */
async function loadAvatar(args: AvatarArgs): Promise<Blob | undefined | Error> {
  if (!args.filePath) return undefined;
  try {
    return await readUploadFile(args.filePath);
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
}

/**
 * Registers the user_avatar_upload tool. The registration layer reads the image
 * file so the handler stays filesystem-free and testable.
 *
 * @param server - The McpServer to register on
 * @param client - The MealieClient used by the handler
 */
export function registerUserAvatarUpload(server: McpServer, client: MealieClient): void {
  server.registerTool(
    "user_avatar_upload",
    {
      title: "Upload My Avatar",
      description:
        "Replace the current user's avatar image. Reads a file on the MCP server (stdio/local only).",
      inputSchema,
      annotations: { readOnlyHint: false, openWorldHint: true },
    },
    async (args) => {
      const file = await loadAvatar(args);
      if (file instanceof Error) {
        return errorResult(file, "user_avatar_upload", "Failed to read file");
      }
      return userAvatarUploadHandler(client, args, file);
    },
  );
}

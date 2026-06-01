import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod";
import type { MealieClient } from "../../../client/MealieClient.js";
import type { components } from "../../../types/mealie.js";
import { requireConfirmation } from "../../confirm.js";
import { errorResult, jsonResult } from "../../result.js";
import { readUploadFile } from "../../upload.js";

/** Minimal client surface the handler needs (eases test fakes). */
type TimelineWriteClient = Pick<MealieClient, "post" | "put" | "delete" | "postMultipart">;

const inputSchema = {
  action: z
    .enum(["create", "update", "delete", "set_image"])
    .describe("Timeline event write operation"),
  recipeId: z.string().optional().describe("Recipe UUID (action=create)"),
  subject: z.string().optional().describe("Event subject/title (action=create/update)"),
  eventType: z
    .enum(["system", "info", "comment"])
    .optional()
    .describe("Event type (action=create)"),
  eventMessage: z.string().optional().describe("Longer event message (action=create/update)"),
  timestamp: z.string().optional().describe("ISO 8601 event time (action=create)"),
  eventId: z.string().optional().describe("Event id (action=update/delete/set_image)"),
  filePath: z
    .string()
    .optional()
    .describe("Server-local image path (action=set_image; stdio-only)"),
  extension: z.string().optional().describe("Image extension (action=set_image)"),
  confirm: z.boolean().optional().describe("Must be true to delete (action=delete)"),
};

type TimelineWriteArgs = {
  action: "create" | "update" | "delete" | "set_image";
  recipeId?: string | undefined;
  subject?: string | undefined;
  eventType?: "system" | "info" | "comment" | undefined;
  eventMessage?: string | undefined;
  timestamp?: string | undefined;
  eventId?: string | undefined;
  filePath?: string | undefined;
  extension?: string | undefined;
  confirm?: boolean | undefined;
};

/**
 * Handles recipe_timeline_write: create/update/delete a timeline event, or set an
 * event's image. Delete is confirm-gated.
 *
 * @param client - A MealieClient (or compatible fake)
 * @param args - Validated arguments (action + action-specific fields)
 * @param file - Pre-read image Blob for set_image (read in the registration layer)
 * @returns An MCP result with the affected event, or an error result
 */
export async function recipeTimelineWriteHandler(
  client: TimelineWriteClient,
  args: TimelineWriteArgs,
  file?: Blob,
): Promise<CallToolResult> {
  if (args.action === "delete") return remove(client, args);
  try {
    return await dispatch(client, args, file);
  } catch (error) {
    return errorResult(error, "recipe_timeline_write", "Failed to write timeline event");
  }
}

/** Routes the non-delete timeline writes. */
async function dispatch(
  client: TimelineWriteClient,
  args: TimelineWriteArgs,
  file: Blob | undefined,
): Promise<CallToolResult> {
  if (args.action === "create") return create(client, args);
  if (args.action === "update") return update(client, args);
  return setImage(client, args, file);
}

/** POST a new timeline event. */
async function create(
  client: TimelineWriteClient,
  args: TimelineWriteArgs,
): Promise<CallToolResult> {
  if (!args.recipeId) return missing("recipeId");
  if (!args.subject) return missing("subject");
  if (!args.eventType) return missing("eventType");
  // image/timestamp are contract-required (RecipeTimelineEventIn); default them so
  // Mealie does not reject the event — null image = "no image", timestamp = now.
  const body: components["schemas"]["RecipeTimelineEventIn"] = {
    recipeId: args.recipeId,
    subject: args.subject,
    eventType: args.eventType,
    image: null,
    timestamp: args.timestamp ?? new Date().toISOString(),
    ...(args.eventMessage ? { eventMessage: args.eventMessage } : {}),
  };
  return jsonResult(await client.post("/api/recipes/timeline/events", body));
}

/** PUT an edited timeline event. */
async function update(
  client: TimelineWriteClient,
  args: TimelineWriteArgs,
): Promise<CallToolResult> {
  if (!args.eventId) return missing("eventId");
  if (!args.subject) return missing("subject");
  const body: components["schemas"]["RecipeTimelineEventUpdate"] = {
    subject: args.subject,
    ...(args.eventMessage ? { eventMessage: args.eventMessage } : {}),
  };
  return jsonResult(await client.put(`/api/recipes/timeline/events/${args.eventId}`, body));
}

/** PUT multipart upload of a timeline event image. */
async function setImage(
  client: TimelineWriteClient,
  args: TimelineWriteArgs,
  file: Blob | undefined,
): Promise<CallToolResult> {
  if (!args.eventId) return missing("eventId");
  if (!file) return missing("filePath");
  if (!args.extension) return missing("extension");
  const form = new FormData();
  form.append("image", file, `image.${args.extension}`);
  form.append("extension", args.extension);
  const result = await client.postMultipart(
    `/api/recipes/timeline/events/${args.eventId}/image`,
    form,
    undefined,
    "PUT",
  );
  return jsonResult(result);
}

/** DELETE a timeline event (confirm-gated). */
async function remove(
  client: TimelineWriteClient,
  args: TimelineWriteArgs,
): Promise<CallToolResult> {
  if (!args.eventId) return missing("eventId");
  const unconfirmed = requireConfirmation(args.confirm, `delete timeline event ${args.eventId}`);
  if (unconfirmed) return unconfirmed;
  try {
    await client.delete(`/api/recipes/timeline/events/${args.eventId}`);
    return jsonResult({ deleted: args.eventId });
  } catch (error) {
    return errorResult(error, "recipe_timeline_write", "Failed to delete timeline event");
  }
}

/** Returns an isError result naming the field the chosen action requires. */
function missing(field: string): CallToolResult {
  return {
    content: [{ type: "text", text: `recipe_timeline_write: action requires "${field}"` }],
    isError: true,
  };
}

/**
 * Registers the recipe_timeline_write tool. The registration layer reads the
 * upload file so the handler stays filesystem-free and testable.
 *
 * @param server - The McpServer to register on
 * @param client - The MealieClient used by the handler
 */
export function registerRecipeTimelineWrite(server: McpServer, client: MealieClient): void {
  server.registerTool(
    "recipe_timeline_write",
    {
      title: "Write Recipe Timeline",
      description:
        "Create, edit, or delete a recipe timeline event, or set an event's image. Delete is destructive (confirm:true). Image upload is stdio/local only.",
      inputSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    },
    async (args) => {
      if (args.action !== "set_image" || !args.filePath) {
        return recipeTimelineWriteHandler(client, args);
      }
      try {
        const file = await readUploadFile(args.filePath);
        return recipeTimelineWriteHandler(client, args, file);
      } catch (error) {
        return errorResult(error, "recipe_timeline_write", "Failed to read image file");
      }
    },
  );
}

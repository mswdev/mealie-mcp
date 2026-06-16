import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { MealieClient } from "../../../client/MealieClient.js";
import { registerRecipeCommentWrite } from "./recipe-comment-write.js";
import { registerRecipeComments } from "./recipe-comments.js";
import { registerRecipeShareWrite } from "./recipe-share-write.js";
import { registerRecipeShare } from "./recipe-share.js";
import { registerRecipeTimelineWrite } from "./recipe-timeline-write.js";
import { registerRecipeTimeline } from "./recipe-timeline.js";

/**
 * Registers always-on social reads (comments, timeline, share).
 *
 * @param server - The McpServer to register on
 * @param client - The MealieClient passed to each handler
 */
export function registerSocialReadTools(server: McpServer, client: MealieClient): void {
  registerRecipeComments(server, client);
  registerRecipeTimeline(server, client);
  registerRecipeShare(server, client);
}

/**
 * Registers social writes (stripped under read-only mode).
 *
 * @param server - The McpServer to register on
 * @param client - The MealieClient passed to each handler
 */
export function registerSocialWriteTools(server: McpServer, client: MealieClient): void {
  registerRecipeCommentWrite(server, client);
  registerRecipeTimelineWrite(server, client);
  registerRecipeShareWrite(server, client);
}

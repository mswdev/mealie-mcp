import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { MealieClient } from "../../../client/MealieClient.js";
import { registerRecipeAssets } from "./recipe-assets.js";
import { registerRecipeImage } from "./recipe-image.js";
import { registerRecipeMedia } from "./recipe-media.js";

/**
 * Registers always-on image/asset reads (reference-URL builder).
 *
 * @param server - The McpServer to register on
 * @param client - The MealieClient passed to each handler
 */
export function registerImagesReadTools(server: McpServer, client: MealieClient): void {
  registerRecipeMedia(server, client);
}

/**
 * Registers image/asset writes (stripped under read-only mode).
 *
 * @param server - The McpServer to register on
 * @param client - The MealieClient passed to each handler
 */
export function registerImagesWriteTools(server: McpServer, client: MealieClient): void {
  registerRecipeImage(server, client);
  registerRecipeAssets(server, client);
}

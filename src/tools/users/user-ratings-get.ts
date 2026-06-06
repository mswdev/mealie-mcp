import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod";
import type { MealieClient } from "../../client/MealieClient.js";
import type { components } from "../../types/mealie.js";
import { errorResult, jsonResult } from "../result.js";

/** The {ratings: []} wrapper Mealie returns for by-id ratings/favorites (items carry userId/id). */
type RatingsOutWrapper = components["schemas"]["UserRatings_UserRatingOut_"];

/** Minimal client surface the handler needs (eases test fakes). */
type GetClient = Pick<MealieClient, "get">;

const inputSchema = {
  user_id: z.string().describe("The user's id (from the groups toolset's group_self_get members)"),
  view: z
    .enum(["ratings", "favorites"])
    .optional()
    .describe("Which list to read (default ratings)"),
};

type RatingsGetArgs = {
  user_id: string;
  view?: "ratings" | "favorites" | undefined;
};

/**
 * Handles user_ratings_get: reads another user's recipe ratings or favorites
 * by user id, unwrapping Mealie's {ratings: []} wrapper into items + count.
 *
 * @param client - A MealieClient (or compatible fake)
 * @param args - Validated arguments (user_id + optional view)
 * @returns An MCP result with { items, count }, or an error result
 */
export async function userRatingsGetHandler(
  client: GetClient,
  args: RatingsGetArgs,
): Promise<CallToolResult> {
  try {
    const view = args.view ?? "ratings";
    const wrapper = await client.get<RatingsOutWrapper>(`/api/users/${args.user_id}/${view}`);
    return jsonResult({ items: wrapper.ratings, count: wrapper.ratings.length });
  } catch (error) {
    return errorResult(error, "user_ratings_get", "Failed to read user ratings");
  }
}

/**
 * Registers the user_ratings_get tool on the server.
 *
 * @param server - The McpServer to register on
 * @param client - The MealieClient used by the handler
 */
export function registerUserRatingsGet(server: McpServer, client: MealieClient): void {
  server.registerTool(
    "user_ratings_get",
    {
      title: "Get a User's Ratings",
      description:
        "Read another user's recipe ratings or favorites by user id. User ids come from the groups toolset's group_self_get(view: members); for the current user prefer user_me.",
      inputSchema,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    (args) => userRatingsGetHandler(client, args),
  );
}

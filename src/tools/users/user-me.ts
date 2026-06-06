import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod";
import type { MealieClient } from "../../client/MealieClient.js";
import type { components } from "../../types/mealie.js";
import { errorResult, jsonResult } from "../result.js";
import { type User, projectUser } from "./user-projection.js";

const SELF_PATH = "/api/users/self";
const RATINGS_PATH = "/api/users/self/ratings";
const FAVORITES_PATH = "/api/users/self/favorites";

/** The {ratings: []} wrapper Mealie returns for self ratings/favorites lists. */
type RatingsWrapper = components["schemas"]["UserRatings_UserRatingSummary_"];

/** Minimal client surface the handler needs (eases test fakes). */
type GetClient = Pick<MealieClient, "get">;

const inputSchema = {
  view: z
    .enum(["profile", "ratings", "favorites"])
    .optional()
    .describe("Which self view (default profile)"),
  recipe_id: z.string().optional().describe("One recipe's rating by recipe id (view=ratings only)"),
  response_format: z
    .enum(["concise", "detailed"])
    .optional()
    .describe("concise (default) trims the profile; detailed returns everything (view=profile)"),
};

type MeArgs = {
  view?: "profile" | "ratings" | "favorites" | undefined;
  recipe_id?: string | undefined;
  response_format?: "concise" | "detailed" | undefined;
};

/**
 * Handles user_me: a read dispatcher over the current authenticated user
 * (profile | ratings | favorites).
 *
 * @param client - A MealieClient (or compatible fake)
 * @param args - Validated arguments (view + view-specific fields)
 * @returns An MCP result for the requested view, or an error result
 */
export async function userMeHandler(client: GetClient, args: MeArgs): Promise<CallToolResult> {
  try {
    return await read(client, args);
  } catch (error) {
    return errorResult(error, "user_me", "Failed to read current user");
  }
}

/** Routes to the requested view. */
async function read(client: GetClient, args: MeArgs): Promise<CallToolResult> {
  if (args.view === "ratings" && args.recipe_id) {
    return jsonResult(await client.get(`${RATINGS_PATH}/${args.recipe_id}`));
  }
  if (args.view === "ratings") return ratingsList(client, RATINGS_PATH);
  if (args.view === "favorites") return ratingsList(client, FAVORITES_PATH);
  const user = await client.get<User>(SELF_PATH);
  return jsonResult(projectUser(user, args.response_format ?? "concise"));
}

/** Unwraps the {ratings: []} wrapper (not a pagination envelope) into items + count. */
async function ratingsList(client: GetClient, path: string): Promise<CallToolResult> {
  const wrapper = await client.get<RatingsWrapper>(path);
  return jsonResult({ items: wrapper.ratings, count: wrapper.ratings.length });
}

/**
 * Registers the user_me tool on the server.
 *
 * @param server - The McpServer to register on
 * @param client - The MealieClient used by the handler
 */
export function registerUserMe(server: McpServer, client: MealieClient): void {
  server.registerTool(
    "user_me",
    {
      title: "Get My User (Self)",
      description:
        "Read the current authenticated user by view: profile (default; includes the API-token list — ids/names only, never token values), ratings, or favorites. Pass recipe_id with view=ratings for one recipe's rating.",
      inputSchema,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    (args) => userMeHandler(client, args),
  );
}

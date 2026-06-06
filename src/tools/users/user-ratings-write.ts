import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod";
import type { MealieClient } from "../../client/MealieClient.js";
import type { components } from "../../types/mealie.js";
import { requireConfirmation } from "../confirm.js";
import { errorResult, jsonResult } from "../result.js";
import type { User } from "./user-projection.js";

const SELF_PATH = "/api/users/self";

/** The rating body for POST /api/users/{id}/ratings/{slug}. */
type RatingUpdate = components["schemas"]["UserRatingUpdate"];

/** Minimal client surface the handler needs (eases test fakes). */
type WriteClient = Pick<MealieClient, "get" | "post" | "delete">;

const inputSchema = {
  action: z.enum(["rate", "favorite", "unfavorite"]).describe("What to do with the recipe"),
  recipe_slug: z.string().describe("The recipe's slug"),
  rating: z.number().optional().describe("The rating value, typically 0-5 (action=rate)"),
  confirm: z.boolean().optional().describe("Must be true to unfavorite"),
};

type RatingsWriteArgs = {
  action: "rate" | "favorite" | "unfavorite";
  recipe_slug: string;
  rating?: number | undefined;
  confirm?: boolean | undefined;
};

/**
 * Handles user_ratings_write: rate, favorite, or unfavorite a recipe as the
 * current user. Mealie has no self-scoped rating write endpoints — only by-id
 * paths — so every action resolves the caller's id via GET /api/users/self first.
 *
 * @param client - A MealieClient (or compatible fake)
 * @param args - Validated arguments (action + recipe_slug + action fields)
 * @returns An MCP result echoing the action, or an error result
 */
export async function userRatingsWriteHandler(
  client: WriteClient,
  args: RatingsWriteArgs,
): Promise<CallToolResult> {
  if (args.action === "rate" && args.rating === undefined) return missingRating();
  if (args.action === "unfavorite") {
    const refusal = requireConfirmation(args.confirm, `unfavorite recipe "${args.recipe_slug}"`);
    if (refusal) return refusal;
  }
  try {
    return await dispatch(client, args);
  } catch (error) {
    return errorResult(error, "user_ratings_write", "Failed to write rating");
  }
}

/** Routes the confirmed/validated action to the by-id endpoint. */
async function dispatch(client: WriteClient, args: RatingsWriteArgs): Promise<CallToolResult> {
  const self = await client.get<User>(SELF_PATH);
  const base = `/api/users/${self.id}`;
  if (args.action === "rate") {
    // rating is guarded non-undefined before dispatch; ?? null satisfies the nullable schema type.
    const body: RatingUpdate = { rating: args.rating ?? null };
    await client.post(`${base}/ratings/${args.recipe_slug}`, body);
    return jsonResult({ action: "rate", recipeSlug: args.recipe_slug, rating: args.rating });
  }
  if (args.action === "favorite") {
    await client.post(`${base}/favorites/${args.recipe_slug}`, {});
    return jsonResult({ action: "favorite", recipeSlug: args.recipe_slug });
  }
  await client.delete(`${base}/favorites/${args.recipe_slug}`);
  return jsonResult({ action: "unfavorite", recipeSlug: args.recipe_slug });
}

/** Returns an isError result for a rate call without a rating value. */
function missingRating(): CallToolResult {
  return {
    content: [{ type: "text", text: "user_ratings_write: rating is required for action=rate" }],
    isError: true,
  };
}

/**
 * Registers the user_ratings_write tool on the server.
 *
 * @param server - The McpServer to register on
 * @param client - The MealieClient used by the handler
 */
export function registerUserRatingsWrite(server: McpServer, client: MealieClient): void {
  server.registerTool(
    "user_ratings_write",
    {
      title: "Rate/Favorite a Recipe",
      description:
        "Rate, favorite, or unfavorite a recipe as the current user (your id is resolved automatically). Unfavorite requires confirm: true.",
      inputSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    },
    (args) => userRatingsWriteHandler(client, args),
  );
}

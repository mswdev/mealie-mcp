import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod";
import type { MealieClient } from "../../../client/MealieClient.js";
import { errorResult, jsonResult } from "../../result.js";

/** Minimal client surface the handler needs (eases test fakes). */
type ExportClient = Pick<MealieClient, "get" | "baseUrl">;

const inputSchema = {
  action: z
    .enum(["formats", "render_one", "list_jobs", "download_token"])
    .describe("Which export read to perform"),
  slug: z.string().optional().describe("Recipe slug (action=render_one)"),
  templateName: z.string().optional().describe("Export template name (action=render_one)"),
  exportId: z.string().optional().describe("Export job id (action=download_token)"),
};

type ExportArgs = {
  action: "formats" | "render_one" | "list_jobs" | "download_token";
  slug?: string | undefined;
  templateName?: string | undefined;
  exportId?: string | undefined;
};

/**
 * Handles recipe_export (reads): list formats, render one recipe to a template
 * (returned as a reference URL, never bytes), list export jobs, or fetch an
 * export download token.
 *
 * @param client - A MealieClient (or compatible fake)
 * @param args - Validated arguments (action + action-specific fields)
 * @returns An MCP result with the requested export data, or an error result
 */
export async function recipeExportHandler(
  client: ExportClient,
  args: ExportArgs,
): Promise<CallToolResult> {
  if (args.action === "render_one") return renderOne(client, args);
  try {
    return await read(client, args);
  } catch (error) {
    return errorResult(error, "recipe_export", "Failed to read export data");
  }
}

/** Routes the network-backed export reads. */
async function read(client: ExportClient, args: ExportArgs): Promise<CallToolResult> {
  if (args.action === "formats") {
    return jsonResult(await client.get("/api/recipes/exports"));
  }
  if (args.action === "list_jobs") {
    return jsonResult(await client.get("/api/recipes/bulk-actions/export"));
  }
  if (!args.exportId) return missing("exportId");
  return jsonResult(await client.get(`/api/recipes/bulk-actions/export/${args.exportId}/download`));
}

/** Builds a reference URL for rendering one recipe to a template (a file download). */
function renderOne(client: ExportClient, args: ExportArgs): CallToolResult {
  if (!args.slug) return missing("slug");
  if (!args.templateName) return missing("templateName");
  const query = `template_name=${encodeURIComponent(args.templateName)}`;
  return jsonResult({
    url: `${client.baseUrl}/api/recipes/${args.slug}/exports?${query}`,
  });
}

/** Returns an isError result naming the field the chosen action requires. */
function missing(field: string): CallToolResult {
  return {
    content: [{ type: "text", text: `recipe_export: action requires "${field}"` }],
    isError: true,
  };
}

/**
 * Registers the recipe_export tool on the server.
 *
 * @param server - The McpServer to register on
 * @param client - The MealieClient used by the handler
 */
export function registerRecipeExport(server: McpServer, client: MealieClient): void {
  server.registerTool(
    "recipe_export",
    {
      title: "Recipe Exports",
      description:
        "Read recipe export data: list formats, render one recipe to a template (reference URL), list export jobs, or get a download token.",
      inputSchema,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    (args) => recipeExportHandler(client, args),
  );
}

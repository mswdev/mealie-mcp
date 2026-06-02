import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod";
import type { MealieClient } from "../../client/MealieClient.js";
import type { components } from "../../types/mealie.js";
import { errorResult, jsonResult } from "../result.js";
import { type UnitDetail, projectUnit } from "./unit-projection.js";

/** Minimal client surface the handler needs (eases test fakes). */
type CreateClient = Pick<MealieClient, "post">;

const inputSchema = {
  name: z.string().min(1).describe("Unit name (e.g. tablespoon)"),
  pluralName: z.string().optional().describe("Plural form (e.g. tablespoons)"),
  abbreviation: z.string().optional().describe("Short form (e.g. tbsp)"),
  useAbbreviation: z.boolean().optional().describe("Display the abbreviation (default false)"),
  fraction: z.boolean().optional().describe("Allow fractional display (default true)"),
  description: z.string().optional().describe("Optional description"),
};

type CreateArgs = {
  name: string;
  pluralName?: string | undefined;
  abbreviation?: string | undefined;
  useAbbreviation?: boolean | undefined;
  fraction?: boolean | undefined;
  description?: string | undefined;
};

/**
 * Handles unit_create: creates an ingredient unit. Mealie's CreateIngredientUnit
 * marks description/extras/fraction/abbreviation/pluralAbbreviation/useAbbreviation/
 * aliases required (they sit in the schema's `required` array despite having
 * defaults), so the handler supplies safe defaults for any the caller omits.
 *
 * @param client - A MealieClient (or compatible fake)
 * @param args - Validated arguments (name + optional fields)
 * @returns An MCP result with the concise created unit, or an error result
 */
export async function unitCreateHandler(
  client: CreateClient,
  args: CreateArgs,
): Promise<CallToolResult> {
  try {
    const body: components["schemas"]["CreateIngredientUnit"] = {
      name: args.name,
      description: args.description ?? "",
      extras: {},
      fraction: args.fraction ?? true,
      abbreviation: args.abbreviation ?? "",
      pluralAbbreviation: "",
      useAbbreviation: args.useAbbreviation ?? false,
      aliases: [],
      ...(args.pluralName ? { pluralName: args.pluralName } : {}),
    };
    const created = await client.post<UnitDetail>("/api/units", body);
    return jsonResult(projectUnit(created, "concise"));
  } catch (error) {
    return errorResult(error, "unit_create", "Failed to create unit");
  }
}

/**
 * Registers the unit_create tool on the server.
 *
 * @param server - The McpServer to register on
 * @param client - The MealieClient used by the handler
 */
export function registerUnitCreate(server: McpServer, client: MealieClient): void {
  server.registerTool(
    "unit_create",
    {
      title: "Create Unit",
      description:
        "Create an ingredient unit. name is required; pluralName/abbreviation/useAbbreviation/fraction/description are optional.",
      inputSchema,
      annotations: { readOnlyHint: false, openWorldHint: true },
    },
    (args) => unitCreateHandler(client, args),
  );
}

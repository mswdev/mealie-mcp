import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { getDefaultEnvironment, StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { MEALIE_URL, SERVER_ENTRY } from "./config.js";

/** All opt-in toolsets, so one client can reach every tool under test. */
const ALL_TOOLSETS = "households,automation,groups,users,admin,explore";

/** A normalized tool-call outcome the checks assert against. */
export type ToolOutcome = { isError: boolean; text: string; json: unknown };

/** A connected MCP client over a real stdio subprocess pointed at the throwaway. */
export type McpHandle = {
  call(name: string, args: Record<string, unknown>): Promise<ToolOutcome>;
  listToolNames(): Promise<string[]>;
  close(): Promise<void>;
};

/** Spawns dist/index.js as a stdio MCP server and returns a connected client. */
export async function connect(
  token: string,
  extraEnv: Record<string, string> = {},
): Promise<McpHandle> {
  const transport = new StdioClientTransport({
    command: "node",
    args: [SERVER_ENTRY],
    env: {
      ...getDefaultEnvironment(),
      MEALIE_URL,
      MEALIE_API_TOKEN: token,
      MEALIE_TOOLSETS: ALL_TOOLSETS,
      ...extraEnv,
    },
  });
  const client = new Client({ name: "verify-live", version: "0" });
  await client.connect(transport);
  return {
    async call(name, args) {
      const result = (await client.callTool({ name, arguments: args })) as {
        isError?: boolean;
        content?: Array<{ type: string; text?: string }>;
      };
      const text = result.content?.find((c) => c.type === "text")?.text ?? "";
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        json = undefined; // error results carry plain prose, not JSON
      }
      return { isError: result.isError === true, text, json };
    },
    async listToolNames() {
      const { tools } = await client.listTools();
      return tools.map((t) => t.name);
    },
    async close() {
      await client.close();
    },
  };
}

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Yaak } from "../yaak.js";
import { json } from "./result.js";

export function registerWorkspaceTools(server: McpServer, yaak: Yaak) {
  server.registerTool(
    "list_workspaces",
    {
      title: "List Workspaces",
      description: "List all Yaak workspaces",
      annotations: { readOnlyHint: true },
    },
    async () => json(await yaak.listWorkspaces()),
  );
}

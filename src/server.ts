import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { YaakCli } from "./cli.js";
import { registerEnvironmentTools } from "./tools/environment.js";
import { registerFolderTools } from "./tools/folder.js";
import { registerHttpRequestTools } from "./tools/httpRequest.js";
import { registerWorkspaceTools } from "./tools/workspace.js";
import { Yaak } from "./yaak.js";

export interface ServerOptions {
  sendTimeoutMs?: number;
}

export function createServer(cli: YaakCli, options: ServerOptions = {}): McpServer {
  const server = new McpServer({ name: "yaak-mcp", version: "0.1.0" });
  const yaak = new Yaak(cli);

  registerWorkspaceTools(server, yaak);
  registerHttpRequestTools(server, yaak, { timeoutMs: options.sendTimeoutMs ?? 120_000 });
  registerFolderTools(server, yaak);
  registerEnvironmentTools(server, yaak);

  return server;
}

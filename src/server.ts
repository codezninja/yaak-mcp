import { createRequire } from "node:module";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { YaakCli } from "./cli.js";
import { registerEnvironmentTools } from "./tools/environment.js";
import { registerFolderTools } from "./tools/folder.js";
import { registerHttpRequestTools } from "./tools/httpRequest.js";
import { registerWorkspaceTools } from "./tools/workspace.js";
import { Yaak } from "./yaak.js";

// package.json sits one level above both src/ and dist/.
const { version } = createRequire(import.meta.url)("../package.json") as { version: string };

export interface ServerOptions {
  sendTimeoutMs?: number;
}

export function createServer(cli: YaakCli, options: ServerOptions = {}): McpServer {
  const server = new McpServer({ name: "yaak-mcp", version });
  const yaak = new Yaak(cli);

  registerWorkspaceTools(server, yaak);
  registerHttpRequestTools(server, yaak, { timeoutMs: options.sendTimeoutMs ?? 120_000 });
  registerFolderTools(server, yaak);
  registerEnvironmentTools(server, yaak);

  return server;
}

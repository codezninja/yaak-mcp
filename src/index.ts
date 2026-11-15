#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createYaakCli } from "./cli.js";
import { createServer } from "./server.js";

function intFromEnv(name: string): number | undefined {
  const raw = process.env[name];
  if (!raw) return undefined;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
}

const cli = createYaakCli({
  bin: process.env.YAAK_BIN,
  dataDir: process.env.YAAK_DATA_DIR,
  timeoutMs: intFromEnv("YAAK_CLI_TIMEOUT_MS"),
});

const server = createServer(cli, { sendTimeoutMs: intFromEnv("YAAK_SEND_TIMEOUT_MS") });
await server.connect(new StdioServerTransport());
// stdout carries the MCP protocol, so diagnostics go to stderr.
console.error("yaak-mcp running on stdio");

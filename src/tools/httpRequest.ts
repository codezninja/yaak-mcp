import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod";
import type { Yaak } from "../yaak.js";
import { defined, json, text } from "./result.js";
import {
  authenticationSchema,
  authenticationTypeSchema,
  bodySchema,
  bodyTypeSchema,
  headersSchema,
  urlParametersSchema,
  workspaceIdSchema,
} from "./schemas.js";

/** Response bodies beyond this are cut off so they don't flood the agent's context. */
export const MAX_BODY_CHARS = 100_000;

const requestFields = {
  method: z.string().optional().describe("HTTP method (defaults to GET)"),
  folderId: z.string().optional().describe("Parent folder ID"),
  description: z.string().optional().describe("Request description"),
  headers: headersSchema.describe("Request headers"),
  urlParameters: urlParametersSchema,
  bodyType: bodyTypeSchema,
  body: bodySchema,
  authenticationType: authenticationTypeSchema,
  authentication: authenticationSchema,
};

export interface SendOptions {
  timeoutMs: number;
}

export function registerHttpRequestTools(server: McpServer, yaak: Yaak, send: SendOptions) {
  server.registerTool(
    "list_http_requests",
    {
      title: "List HTTP Requests",
      description: "List all HTTP requests in a workspace",
      inputSchema: { workspaceId: workspaceIdSchema },
      annotations: { readOnlyHint: true },
    },
    async ({ workspaceId }) => {
      const id = await yaak.resolveWorkspaceId(workspaceId);
      return json(await yaak.showAll("request", id));
    },
  );

  server.registerTool(
    "get_http_request",
    {
      title: "Get HTTP Request",
      description: "Get details of a specific HTTP request by ID",
      inputSchema: { id: z.string().describe("The HTTP request ID") },
      annotations: { readOnlyHint: true },
    },
    async ({ id }) => json(await yaak.show("request", id)),
  );

  server.registerTool(
    "send_http_request",
    {
      title: "Send HTTP Request",
      description:
        "Send a saved HTTP request and return the response status, headers and body. " +
        "Pass environmentId to resolve variables from that environment; without it only " +
        "base (global) and folder variables apply, since the CLI cannot see which " +
        "environment is selected in the Yaak app.",
      inputSchema: {
        id: z.string().describe("The HTTP request ID to send"),
        environmentId: z
          .string()
          .optional()
          .describe("Environment ID to use for variable substitution on this send"),
      },
    },
    async ({ id, environmentId }) => {
      const args = ["request", "send", id];
      if (environmentId) args.push("--environment", environmentId);
      const body = await yaak.cli.run(args, { timeoutMs: send.timeoutMs });

      // The CLI streams only the body. Its stored response carries status and headers.
      let response: Record<string, unknown> | null = null;
      try {
        response = await yaak.cli
          .run(["response", "show", id])
          .then((out) => JSON.parse(out) as Record<string, unknown>);
      } catch {
        // Older CLIs may not store CLI sends. The body alone is still useful.
      }
      if (response) delete response.bodyPath;

      const truncated = body.length > MAX_BODY_CHARS;
      return json({
        response,
        body: truncated ? body.slice(0, MAX_BODY_CHARS) : body,
        ...(truncated ? { bodyTruncated: true, bodyLength: body.length } : {}),
      });
    },
  );

  server.registerTool(
    "create_http_request",
    {
      title: "Create HTTP Request",
      description: "Create a new HTTP request",
      inputSchema: {
        workspaceId: workspaceIdSchema,
        name: z
          .string()
          .optional()
          .describe("Request name (empty string to auto-generate from URL)"),
        url: z.string().describe("Request URL"),
        ...requestFields,
      },
    },
    async ({ workspaceId, ...fields }) => {
      const resolved = await yaak.resolveWorkspaceId(workspaceId);
      return json(await yaak.create("request", { workspaceId: resolved, ...defined(fields) }));
    },
  );

  server.registerTool(
    "update_http_request",
    {
      title: "Update HTTP Request",
      description: "Update an existing HTTP request. Only the fields you pass change.",
      inputSchema: {
        id: z.string().describe("HTTP request ID to update"),
        name: z.string().optional().describe("Request name"),
        url: z.string().optional().describe("Request URL"),
        ...requestFields,
      },
    },
    async ({ id, ...updates }) => json(await yaak.update("request", id, defined(updates))),
  );

  server.registerTool(
    "delete_http_request",
    {
      title: "Delete HTTP Request",
      description: "Delete an HTTP request by ID",
      inputSchema: { id: z.string().describe("HTTP request ID to delete") },
      annotations: { destructiveHint: true },
    },
    async ({ id }) => {
      const request = await yaak.delete<{ id: string; name: string }>("request", id);
      return text(`Deleted: ${request.name} (${request.id})`);
    },
  );
}

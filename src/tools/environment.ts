import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod";
import type { Environment, EnvironmentVariable, Yaak } from "../yaak.js";
import { defined, json, text } from "./result.js";
import { workspaceIdSchema } from "./schemas.js";

const variableSchema = z.object({
  name: z.string().describe("Variable name"),
  value: z.string().describe("Variable value (may contain template tags)"),
  enabled: z.boolean().default(true),
});

const variablesSchema = z
  .array(variableSchema)
  .optional()
  .describe("Variables. On update this replaces the whole list.");

const colorSchema = z
  .string()
  .nullable()
  .optional()
  .describe('Display color as a hex string like "#c084fc", or null for none');

const publicSchema = z
  .boolean()
  .optional()
  .describe(
    "Whether the environment is shared (included in sync/export). New environments " +
      "default to true, as in the app.",
  );

function isBase(env: Environment): boolean {
  return env.base === true || env.parentModel === "workspace";
}

function summarize(env: Environment) {
  return {
    id: env.id,
    name: env.name,
    kind: isBase(env) ? "base" : env.parentModel === "folder" ? "folder" : "sub",
    parentId: env.parentId,
    color: env.color,
    public: env.public,
    variableNames: env.variables.map((v) => v.name),
  };
}

function cleanVariables(variables: EnvironmentVariable[]): EnvironmentVariable[] {
  return variables.map(({ name, value, enabled }) => ({ name, value, enabled: enabled ?? true }));
}

export function registerEnvironmentTools(server: McpServer, yaak: Yaak) {
  server.registerTool(
    "list_environments",
    {
      title: "List Environments",
      description:
        "List environments in a workspace with their variable names (not values). " +
        "kind is base (global variables), sub (selectable environments like staging) or " +
        "folder (scoped to a folder). Use get_environment for values.",
      inputSchema: { workspaceId: workspaceIdSchema },
      annotations: { readOnlyHint: true },
    },
    async ({ workspaceId }) => {
      const id = await yaak.resolveWorkspaceId(workspaceId);
      const environments = await yaak.showAll<Environment>("environment", id);
      return json(environments.map(summarize));
    },
  );

  server.registerTool(
    "get_environment",
    {
      title: "Get Environment",
      description: "Get an environment by ID, including all variables and values",
      inputSchema: { id: z.string().describe("Environment ID") },
      annotations: { readOnlyHint: true },
    },
    async ({ id }) => json(await yaak.show<Environment>("environment", id)),
  );

  server.registerTool(
    "create_environment",
    {
      title: "Create Environment",
      description:
        "Create a sub-environment (e.g. staging, production) in a workspace, or a folder " +
        "environment when folderId is given. Every workspace already has one base " +
        "environment for global variables; edit that one instead of creating another.",
      inputSchema: {
        workspaceId: workspaceIdSchema,
        name: z.string().min(1).describe("Environment name"),
        variables: variablesSchema,
        color: colorSchema,
        public: publicSchema,
        folderId: z
          .string()
          .optional()
          .describe("Create a folder environment scoped to this folder instead"),
      },
    },
    async ({ workspaceId, folderId, ...fields }) => {
      const resolved = await yaak.resolveWorkspaceId(workspaceId);
      const payload = {
        workspaceId: resolved,
        parentModel: folderId ? "folder" : "environment",
        parentId: folderId ?? null,
        // The CLI defaults to private; the app creates shared environments.
        public: true,
        ...defined(fields),
      };
      return json(await yaak.create<Environment>("environment", payload));
    },
  );

  server.registerTool(
    "update_environment",
    {
      title: "Update Environment",
      description:
        "Update an environment's name, color, visibility or variables. Only the fields you " +
        "pass change, but variables replaces the whole list; use set_environment_variable " +
        "or remove_environment_variable to change one variable.",
      inputSchema: {
        id: z.string().describe("Environment ID to update"),
        name: z.string().min(1).optional().describe("Environment name"),
        variables: variablesSchema,
        color: colorSchema,
        public: publicSchema,
      },
    },
    async ({ id, ...updates }) =>
      json(await yaak.update<Environment>("environment", id, defined(updates))),
  );

  server.registerTool(
    "delete_environment",
    {
      title: "Delete Environment",
      description: "Delete a sub or folder environment by ID. The base environment can't be deleted.",
      inputSchema: { id: z.string().describe("Environment ID to delete") },
      annotations: { destructiveHint: true },
    },
    async ({ id }) => {
      const existing = await yaak.show<Environment>("environment", id);
      if (isBase(existing)) {
        throw new Error(
          `${existing.name} (${id}) is the workspace's base environment and can't be deleted. ` +
            "Remove its variables instead.",
        );
      }
      await yaak.delete("environment", id);
      return text(`Deleted: ${existing.name} (${id})`);
    },
  );

  server.registerTool(
    "set_environment_variable",
    {
      title: "Set Environment Variable",
      description:
        "Add a variable to an environment, or change it if one with that name exists. " +
        "Other variables are left alone.",
      inputSchema: {
        environmentId: z.string().describe("Environment ID"),
        name: z.string().min(1).describe("Variable name"),
        value: z.string().describe("Variable value (may contain template tags)"),
        enabled: z.boolean().optional().describe("Whether the variable is active (default true)"),
      },
    },
    async ({ environmentId, name, value, enabled }) => {
      const env = await yaak.show<Environment>("environment", environmentId);
      const variables = cleanVariables(env.variables);
      const existing = variables.find((v) => v.name === name);
      if (existing) {
        existing.value = value;
        if (enabled !== undefined) existing.enabled = enabled;
      } else {
        variables.push({ name, value, enabled: enabled ?? true });
      }
      const saved = await yaak.update<Environment>("environment", environmentId, { variables });
      return json({ action: existing ? "updated" : "added", environment: summarize(saved) });
    },
  );

  server.registerTool(
    "remove_environment_variable",
    {
      title: "Remove Environment Variable",
      description: "Remove a variable from an environment by name",
      inputSchema: {
        environmentId: z.string().describe("Environment ID"),
        name: z.string().describe("Variable name to remove"),
      },
      annotations: { destructiveHint: true },
    },
    async ({ environmentId, name }) => {
      const env = await yaak.show<Environment>("environment", environmentId);
      const variables = cleanVariables(env.variables);
      const remaining = variables.filter((v) => v.name !== name);
      if (remaining.length === variables.length) {
        throw new Error(`Variable "${name}" not found in ${env.name} (${environmentId})`);
      }
      const saved = await yaak.update<Environment>("environment", environmentId, {
        variables: remaining,
      });
      return json({ action: "removed", environment: summarize(saved) });
    },
  );
}

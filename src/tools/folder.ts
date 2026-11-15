import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod";
import type { Yaak } from "../yaak.js";
import { defined, json, text } from "./result.js";
import {
  authenticationSchema,
  authenticationTypeSchema,
  headersSchema,
  workspaceIdSchema,
} from "./schemas.js";

const folderFields = {
  folderId: z.string().optional().describe("Parent folder ID (for nested folders)"),
  description: z.string().optional().describe("Folder description"),
  sortPriority: z.number().optional().describe("Sort priority for ordering"),
  headers: headersSchema.describe("Default headers to apply to requests in this folder"),
  authenticationType: authenticationTypeSchema,
  authentication: authenticationSchema,
};

export function registerFolderTools(server: McpServer, yaak: Yaak) {
  server.registerTool(
    "list_folders",
    {
      title: "List Folders",
      description: "List all folders in a workspace",
      inputSchema: { workspaceId: workspaceIdSchema },
      annotations: { readOnlyHint: true },
    },
    async ({ workspaceId }) => {
      const id = await yaak.resolveWorkspaceId(workspaceId);
      return json(await yaak.showAll("folder", id));
    },
  );

  server.registerTool(
    "get_folder",
    {
      title: "Get Folder",
      description: "Get details of a specific folder by ID",
      inputSchema: { id: z.string().describe("The folder ID") },
      annotations: { readOnlyHint: true },
    },
    async ({ id }) => json(await yaak.show("folder", id)),
  );

  server.registerTool(
    "create_folder",
    {
      title: "Create Folder",
      description: "Create a new folder in a workspace",
      inputSchema: {
        workspaceId: workspaceIdSchema,
        name: z.string().describe("Folder name"),
        ...folderFields,
      },
    },
    async ({ workspaceId, ...fields }) => {
      const resolved = await yaak.resolveWorkspaceId(workspaceId);
      return json(await yaak.create("folder", { workspaceId: resolved, ...defined(fields) }));
    },
  );

  server.registerTool(
    "update_folder",
    {
      title: "Update Folder",
      description: "Update an existing folder. Only the fields you pass change.",
      inputSchema: {
        id: z.string().describe("Folder ID to update"),
        name: z.string().optional().describe("Folder name"),
        ...folderFields,
      },
    },
    async ({ id, ...updates }) => json(await yaak.update("folder", id, defined(updates))),
  );

  server.registerTool(
    "delete_folder",
    {
      title: "Delete Folder",
      description: "Delete a folder by ID",
      inputSchema: { id: z.string().describe("Folder ID to delete") },
      annotations: { destructiveHint: true },
    },
    async ({ id }) => {
      const folder = await yaak.delete<{ id: string; name: string }>("folder", id);
      return text(`Deleted: ${folder.name} (${folder.id})`);
    },
  );
}

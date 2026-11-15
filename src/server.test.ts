import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, test } from "vitest";
import type { YaakCli } from "./cli.js";
import { createServer } from "./server.js";
import { parseListRows } from "./yaak.js";

type Model = Record<string, unknown> & { id: string; workspaceId?: string; name: string };

/** A stand-in for the yaak binary, backed by an in-memory model store. */
function fakeCli(workspaces: Model[], models: Model[]) {
  const store = new Map(models.map((m) => [m.id, structuredClone(m)]));
  const calls: string[][] = [];
  let counter = 0;
  const prefix = { request: "rq", folder: "fl", environment: "ev" } as const;

  const cli: YaakCli = {
    async run(args) {
      calls.push(args);
      const [kind, verb, ...rest] = args;
      if (kind === "workspace" && verb === "list") {
        return workspaces.map((w) => `${w.id} - ${w.name}`).join("\n") + "\n";
      }
      if (kind === "request" && verb === "send") return '{"ok":true}';
      if (kind === "response" && verb === "show") {
        return JSON.stringify({ id: "rs_1", requestId: rest[0], status: 200, bodyPath: "/x" });
      }
      if (verb === "list") {
        return [...store.values()]
          .filter((m) => m.model === kind && m.workspaceId === rest[0])
          .map((m) => `${m.id} - ${m.name}`)
          .join("\n");
      }
      if (verb === "show") {
        const m = store.get(rest[0] ?? "");
        if (!m) throw new Error(`not found: ${rest[0]}`);
        return JSON.stringify(m);
      }
      if (verb === "create") {
        const payload = JSON.parse(rest[1] ?? "{}") as Model;
        const id = `${prefix[kind as keyof typeof prefix]}_new${++counter}`;
        store.set(id, { model: kind, variables: [], ...payload, id });
        return `Created ${kind}: ${id}\n`;
      }
      if (verb === "update") {
        const patch = JSON.parse(rest[1] ?? "{}") as Model;
        const m = store.get(patch.id);
        if (!m) throw new Error(`not found: ${patch.id}`);
        store.set(patch.id, { ...m, ...patch });
        return `Updated ${kind}: ${patch.id}\n`;
      }
      if (verb === "delete") {
        store.delete(rest[0] ?? "");
        return `Deleted ${kind}: ${rest[0]}\n`;
      }
      throw new Error(`unexpected: ${args.join(" ")}`);
    },
  };
  return { cli, calls, store };
}

const WS = { id: "wk_one", name: "One", model: "workspace" };
const BASE = {
  model: "environment",
  id: "ev_base",
  workspaceId: "wk_one",
  name: "Global Variables",
  base: true,
  parentModel: "workspace",
  parentId: null,
  public: true,
  color: null,
  variables: [{ name: "host", value: "localhost", enabled: true, id: null }],
};
const STAGING = {
  ...BASE,
  id: "ev_staging",
  name: "Staging",
  base: false,
  parentModel: "environment",
  variables: [
    { name: "token", value: "abc", enabled: true, id: null },
    { name: "user", value: "grace", enabled: false, id: null },
  ],
};

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

async function connect(workspaces: Model[] = [WS], models: Model[] = [BASE, STAGING]) {
  const fake = fakeCli(workspaces, models);
  const server = createServer(fake.cli);
  const client = new Client({ name: "test", version: "0.0.0" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(b);
  await client.connect(a);
  cleanups.push(async () => {
    await client.close();
    await server.close();
  });
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const result = await client.callTool({ name, arguments: args });
    const content = result.content as Array<{ text: string }>;
    return { isError: result.isError === true, text: content[0]?.text ?? "" };
  };
  return { ...fake, client, call };
}

describe("parseListRows", () => {
  test("reads ids and labels and skips other lines", () => {
    expect(
      parseListRows("ev_a1 - Global (workspace)\nNo folders found\nrq_B2 - GET List users\n"),
    ).toEqual([
      { id: "ev_a1", label: "Global (workspace)" },
      { id: "rq_B2", label: "GET List users" },
    ]);
  });
});

describe("tools", () => {
  test("advertises environment tools alongside the plugin's request and folder tools", async () => {
    const { client } = await connect();
    const names = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(names).toEqual(
      [
        "create_environment",
        "create_folder",
        "create_http_request",
        "delete_environment",
        "delete_folder",
        "delete_http_request",
        "get_environment",
        "get_folder",
        "get_http_request",
        "list_environments",
        "list_folders",
        "list_http_requests",
        "list_workspaces",
        "remove_environment_variable",
        "send_http_request",
        "set_environment_variable",
        "update_environment",
        "update_folder",
        "update_http_request",
      ].sort(),
    );
  });

  test("asks for a workspace when several exist", async () => {
    const { call } = await connect([WS, { id: "wk_two", name: "Two" }]);
    const result = await call("list_environments");
    expect(result.isError).toBe(true);
    expect(result.text).toContain("Multiple workspaces");
    expect(result.text).toContain("wk_two");
  });

  test("lists environments with kinds and variable names only", async () => {
    const { call } = await connect();
    const result = await call("list_environments");
    const envs = JSON.parse(result.text);
    expect(envs).toEqual([
      expect.objectContaining({ id: "ev_base", kind: "base", variableNames: ["host"] }),
      expect.objectContaining({ id: "ev_staging", kind: "sub", variableNames: ["token", "user"] }),
    ]);
    expect(result.text).not.toContain("abc");
  });

  test("creates a sub-environment in the resolved workspace", async () => {
    const { call, calls } = await connect();
    const result = await call("create_environment", {
      name: "Prod",
      variables: [{ name: "host", value: "api.example.com" }],
    });
    expect(result.isError).toBe(false);
    const create = calls.find((c) => c[0] === "environment" && c[1] === "create");
    expect(JSON.parse(create?.[3] ?? "")).toEqual({
      workspaceId: "wk_one",
      parentModel: "environment",
      parentId: null,
      public: true,
      name: "Prod",
      variables: [{ name: "host", value: "api.example.com", enabled: true }],
    });
    expect(JSON.parse(result.text)).toMatchObject({ id: "ev_new1", name: "Prod" });
  });

  test("set_environment_variable updates in place and keeps the other variables", async () => {
    const { call, store } = await connect();
    await call("set_environment_variable", { environmentId: "ev_staging", name: "token", value: "xyz" });
    await call("set_environment_variable", { environmentId: "ev_staging", name: "region", value: "us" });
    expect(store.get("ev_staging")?.variables).toEqual([
      { name: "token", value: "xyz", enabled: true },
      { name: "user", value: "grace", enabled: false },
      { name: "region", value: "us", enabled: true },
    ]);
  });

  test("remove_environment_variable errors on an unknown name", async () => {
    const { call, store } = await connect();
    const missing = await call("remove_environment_variable", {
      environmentId: "ev_staging",
      name: "nope",
    });
    expect(missing.isError).toBe(true);
    await call("remove_environment_variable", { environmentId: "ev_staging", name: "token" });
    expect(store.get("ev_staging")?.variables).toEqual([
      { name: "user", value: "grace", enabled: false },
    ]);
  });

  test("refuses to delete the base environment", async () => {
    const { call, calls } = await connect();
    const result = await call("delete_environment", { id: "ev_base" });
    expect(result.isError).toBe(true);
    expect(calls.some((c) => c[1] === "delete")).toBe(false);
  });

  test("deletes a sub-environment without prompting", async () => {
    const { call, calls } = await connect();
    const result = await call("delete_environment", { id: "ev_staging" });
    expect(result.text).toBe("Deleted: Staging (ev_staging)");
    expect(calls).toContainEqual(["environment", "delete", "ev_staging", "--yes"]);
  });

  test("send passes the environment and returns stored response metadata", async () => {
    const { call, calls } = await connect();
    const result = await call("send_http_request", { id: "rq_1", environmentId: "ev_staging" });
    expect(calls).toContainEqual(["request", "send", "rq_1", "--environment", "ev_staging"]);
    const out = JSON.parse(result.text);
    expect(out.body).toBe('{"ok":true}');
    expect(out.response).toEqual({ id: "rs_1", requestId: "rq_1", status: 200 });
  });

  test("update sends only the fields given, as a merge patch", async () => {
    const { call, calls } = await connect();
    await call("update_environment", { id: "ev_staging", color: "#ff0000" });
    const update = calls.find((c) => c[1] === "update");
    expect(JSON.parse(update?.[3] ?? "")).toEqual({ color: "#ff0000", id: "ev_staging" });
  });
});

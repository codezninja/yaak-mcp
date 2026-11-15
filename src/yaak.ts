import type { YaakCli } from "./cli.js";

export type ModelKind = "workspace" | "request" | "folder" | "environment";

export interface WorkspaceSummary {
  id: string;
  name: string;
}

export interface EnvironmentVariable {
  name: string;
  value: string;
  enabled?: boolean;
  id?: string | null;
}

export interface Environment {
  model: "environment";
  id: string;
  workspaceId: string;
  name: string;
  public: boolean;
  base?: boolean;
  parentModel: string;
  parentId: string | null;
  variables: EnvironmentVariable[];
  color: string | null;
  sortPriority: number;
  [key: string]: unknown;
}

/** One `<id> - <rest>` row from a `yaak <kind> list` command. */
export interface ListRow {
  id: string;
  label: string;
}

/**
 * Parses the human-readable list output. Every list command prints one model
 * per line as `<id> - <label>`; anything else (e.g. "No folders found") is skipped.
 */
export function parseListRows(stdout: string): ListRow[] {
  const rows: ListRow[] = [];
  for (const line of stdout.split("\n")) {
    const match = /^([a-z]{2}_[A-Za-z0-9]+) - (.*)$/.exec(line.trim());
    if (match?.[1] && match[2] !== undefined) rows.push({ id: match[1], label: match[2] });
  }
  return rows;
}

function parseJson<T>(stdout: string, what: string): T {
  try {
    return JSON.parse(stdout) as T;
  } catch {
    throw new Error(`Could not parse ${what} JSON from the Yaak CLI: ${stdout.slice(0, 200)}`);
  }
}

/** Runs at most `limit` async jobs at once, preserving input order. */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index] as T);
    }
  });
  await Promise.all(workers);
  return results;
}

export class Yaak {
  constructor(readonly cli: YaakCli) {}

  async listWorkspaces(): Promise<WorkspaceSummary[]> {
    const rows = parseListRows(await this.cli.run(["workspace", "list"]));
    return rows.map((row) => ({ id: row.id, name: row.label }));
  }

  /**
   * Picks the workspace a tool should act on. Mirrors the old plugin: an
   * explicit ID must exist, and omitting it only works with one workspace.
   */
  async resolveWorkspaceId(workspaceId?: string): Promise<string> {
    const workspaces = await this.listWorkspaces();
    if (workspaceId) {
      if (!workspaces.some((w) => w.id === workspaceId)) {
        const list = workspaces.map((w) => `- ${w.name} (ID: ${w.id})`).join("\n");
        throw new Error(`Workspace "${workspaceId}" not found.\n\nAvailable workspaces:\n${list}`);
      }
      return workspaceId;
    }
    if (workspaces.length === 1 && workspaces[0]) return workspaces[0].id;
    if (workspaces.length === 0) throw new Error("No Yaak workspaces found.");
    const list = workspaces.map((w, i) => `${i + 1}. ${w.name} (ID: ${w.id})`).join("\n");
    throw new Error(
      "Multiple workspaces exist. Pass workspaceId to choose one.\n\n" +
        `Workspaces:\n${list}\n\n` +
        "Ask the user which workspace they mean if it isn't clear.",
    );
  }

  async listIds(kind: Exclude<ModelKind, "workspace">, workspaceId: string): Promise<string[]> {
    return parseListRows(await this.cli.run([kind, "list", workspaceId])).map((r) => r.id);
  }

  async show<T = Record<string, unknown>>(kind: ModelKind, id: string): Promise<T> {
    return parseJson<T>(await this.cli.run([kind, "show", id]), kind);
  }

  async showAll<T = Record<string, unknown>>(
    kind: Exclude<ModelKind, "workspace">,
    workspaceId: string,
  ): Promise<T[]> {
    const ids = await this.listIds(kind, workspaceId);
    return mapLimit(ids, 8, (id) => this.show<T>(kind, id));
  }

  async create<T = Record<string, unknown>>(
    kind: Exclude<ModelKind, "workspace">,
    payload: Record<string, unknown>,
  ): Promise<T> {
    const stdout = await this.cli.run([kind, "create", "--json", JSON.stringify(payload)]);
    return this.readBack<T>(kind, stdout);
  }

  /** Applies a JSON merge patch. Arrays in the patch replace the stored array. */
  async update<T = Record<string, unknown>>(
    kind: Exclude<ModelKind, "workspace">,
    id: string,
    patch: Record<string, unknown>,
  ): Promise<T> {
    const stdout = await this.cli.run([
      kind,
      "update",
      "--json",
      JSON.stringify({ ...patch, id }),
    ]);
    return this.readBack<T>(kind, stdout, id);
  }

  async delete<T = Record<string, unknown>>(
    kind: Exclude<ModelKind, "workspace">,
    id: string,
  ): Promise<T> {
    // Read first: delete only prints a confirmation line, not the model.
    const existing = await this.show<T>(kind, id);
    await this.cli.run([kind, "delete", id, "--yes"]);
    return existing;
  }

  /**
   * Create/update print either the model JSON or a line naming its ID,
   * depending on CLI version. Fetch the stored model either way.
   */
  private async readBack<T>(kind: ModelKind, stdout: string, knownId?: string): Promise<T> {
    const trimmed = stdout.trim();
    if (trimmed.startsWith("{")) {
      try {
        return JSON.parse(trimmed) as T;
      } catch {
        // fall through to the ID lookup
      }
    }
    const id = knownId ?? /\b([a-z]{2}_[A-Za-z0-9]+)\b/.exec(trimmed)?.[1];
    if (!id) throw new Error(`Could not find the new ${kind} ID in CLI output: ${trimmed}`);
    return this.show<T>(kind, id);
  }
}

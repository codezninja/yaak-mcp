import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export function json(value: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

export function text(value: string): CallToolResult {
  return { content: [{ type: "text", text: value }] };
}

/** Drops undefined keys so they don't reach a JSON merge patch. */
export function defined<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>;
}

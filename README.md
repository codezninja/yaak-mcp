# yaak-mcp

An MCP server for [Yaak](https://yaak.app) that adds environment management. It replaces the
deprecated `@yaak/mcp-server` plugin and runs over stdio by calling the `yaak` CLI, so it works
whether or not the app is open. Changes appear in a running Yaak window within about a second.

## Requirements

- Yaak CLI 2026.9.1 or later: `mise use -g npm:@yaakapp/cli@latest`
- Node 22+ (pinned in `mise.toml`)

## Install

Published to npm as [`@codezninja/yaak-mcp`](https://www.npmjs.com/package/@codezninja/yaak-mcp).

For Claude Code:

```sh
claude mcp add -s user yaak -- npx -y @codezninja/yaak-mcp
```

For Claude Desktop, add this to `~/Library/Application Support/Claude/claude_desktop_config.json`
and restart Desktop. Desktop doesn't load your shell profile, so use absolute paths if `npx` or
`yaak` aren't on its `PATH` (or set `YAAK_BIN`):

```json
{
  "mcpServers": {
    "yaak": {
      "command": "npx",
      "args": ["-y", "@codezninja/yaak-mcp"]
    }
  }
}
```

## Development

```sh
mise run deps
mise run build
mise run check   # typecheck + unit tests
```

To run a local build, point the MCP client at `node <repo>/dist/index.js`.

## Releasing

1. Bump `version` in `package.json` (`npm version patch --no-git-tag-version`), commit and push.
2. Publish a GitHub Release with tag `v<version>`, e.g. `gh release create v0.1.1 --generate-notes`.
   Mark it as a pre-release to publish under the `next` dist-tag.

The `Publish` workflow checks the tag matches `package.json`, runs the checks, and publishes with
npm trusted publishing (OIDC, with provenance). No npm token is stored in the repo.

## Tools

Same names as the old plugin, so existing prompts keep working:

- `list_workspaces`
- `list_http_requests`, `get_http_request`, `create_http_request`, `update_http_request`,
  `delete_http_request`, `send_http_request`
- `list_folders`, `get_folder`, `create_folder`, `update_folder`, `delete_folder`

New:

- `list_environments` lists environments with their kind (`base`, `sub`, `folder`) and variable
  names. Values are left out.
- `get_environment` returns one environment with all variables and values.
- `create_environment` creates a sub-environment, or a folder environment when `folderId` is given.
- `update_environment` changes name, color, `public` or the whole variable list.
- `delete_environment` deletes a sub or folder environment. It refuses the base environment.
- `set_environment_variable` adds or changes one variable, leaving the rest alone.
- `remove_environment_variable` removes one variable by name.

### Differences from the plugin

- No `show_toast`, `get_workspace_id` or `get_environment_id`. Those read the app window, which
  the CLI can't see.
- `send_http_request` can't use the environment selected in the app. Pass `environmentId`;
  without it only base and folder variables apply.
- With more than one workspace, tools that take `workspaceId` need it.
- `update_*` tools send a JSON merge patch: fields you pass change, and arrays you pass
  (headers, variables) replace the stored ones.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `YAAK_BIN` | `yaak` | Path to the Yaak CLI |
| `YAAK_DATA_DIR` | CLI default | Passed as `--data-dir` |
| `YAAK_CLI_TIMEOUT_MS` | `30000` | Timeout for each CLI call |
| `YAAK_SEND_TIMEOUT_MS` | `120000` | Timeout for `send_http_request` |

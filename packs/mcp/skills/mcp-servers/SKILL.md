---
name: mcp-servers
description: Add, remove, list and troubleshoot MCP servers (external tool servers) for the owner, and find their tools with tool_search. Read when the owner wants to connect a new service or tool server, when an mcp__ tool fails, or before editing mcp.json.
---

# MCP servers

MCP servers give you extra tools. Each server's tools are named `mcp__<server>__<tool>`. The servers you have are listed in the `mcp_servers` section of your context.

## Finding and calling tools
Servers are set up with `deferred` exposure, so their tools are not declared until you look for them:
1. Call `tool_search` with a few words for what you need (for example `create calendar event`). Matching tools become callable on your next step.
2. Call the tool by its full `mcp__<server>__<tool>` name.
Search again with other words if nothing fits. Servers left at the default `codemode` exposure are reached from a `codemode` script instead (`searchTools()`, then `tools.mcp__<server>__<tool>(args)`).

## The config file
Servers live in `$PI_CODING_AGENT_DIR/mcp.json` (Nano's `<data>/pi/mcp.json`). Changes apply to the next fresh context window, not the current one. Use the `nano-mcp` command, which edits and checks that same file:

- List and test every server: `nano-mcp list` (connects to each; exits 1 when one fails).
- Add a local command (stdio): `nano-mcp add <name> --exposure deferred --description "<what it does>" -- <command> <args...>`
  Example: `nano-mcp add fs --exposure deferred --description "Read files in the shared folder" -- npx -y @modelcontextprotocol/server-filesystem /data/workspace/shared`
- Add a remote server (streamable HTTP): `nano-mcp add <name> --exposure deferred --description "<...>" --url https://example.com/mcp --bearer-token-env-var <ENV_NAME>`
- Remove: `nano-mcp remove <name>`

Or edit the JSON yourself:

```json
{
  "mcpServers": {
    "fs": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/data/workspace/shared"],
      "env": { "SOME_SETTING": "value" },
      "exposure": "deferred",
      "description": "Read files in the shared folder"
    },
    "docs": {
      "url": "https://example.com/mcp",
      "headers": { "Authorization": "Bearer ${DOCS_TOKEN}" },
      "exposure": "deferred",
      "description": "Search the product documentation"
    }
  }
}
```

Rules:
- Server names: letters, digits, `_` and `-` only.
- `command` is one executable; arguments go in `args`. It is not a shell line.
- Always set `"exposure": "deferred"` and a one-sentence `description`. Use `"direct"` only for a tiny server the owner uses constantly. `"enabled": false` keeps an entry but switches it off.
- Only streamable HTTP is supported. If a service documents an `/sse` endpoint, try the same host with `/mcp`.
- Check every change with `nano-mcp list`, then tell the owner in one line what was added and whether it connected.

## Secrets
- Never write a token, password or API key into mcp.json, the knowledge base, or a message. Reference it as `${ENV_NAME}` in `env` or `headers`. Pi fills it in from the environment when it connects.
- The owner adds the actual value to Nano's `.env` on the host (`ENV_NAME=...`) and restarts Nano. Tell them the exact variable name to add. Do not ask them to text you the value.
- A header can also come from a file the owner created: `"Authorization": "!cat /data/secrets/<file>"`. The command must be the whole value and print the complete header value.
- If the owner pastes a secret into the chat anyway, do not repeat it. Suggest they rotate it, and still put only the `${ENV_NAME}` reference in the config.

## Before adding a server
- Only add servers the owner asked for. Running a server means running its code inside Nano's container with Nano's access.
- Prefer a server's official package or URL. `npx -y` and `uvx` fetch the latest version on every start; that is fine for well-known servers.
- Servers that use OAuth sign-in need a browser on the same machine (`pi mcp login`), which Nano does not have. Prefer a token-based setup for those, or tell the owner the server needs a sign-in from the host.

## When a tool fails
- `nano-mcp list` shows the connection error and recent stderr of a failing stdio server. Logs are in `$PI_CODING_AGENT_DIR/mcp.log`.
- 401 or 403 from an HTTP server: the token is missing, wrong or expired. Tell the owner which variable to fix.
- Tell the owner plainly what failed. Never claim a tool call succeeded when it returned an error.

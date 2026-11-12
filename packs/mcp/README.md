# mcp pack

Pi's MCP support in Nano sessions: any [MCP](https://modelcontextprotocol.io) server the owner adds becomes a set of `mcp__<server>__<tool>` tools.

- `extension.ts` loads Pi's MCP, `tool_search` and `codemode` extensions (SDK sessions do not load them by themselves). It also points `PI_CODING_AGENT_DIR` at Nano's agent dir, so the servers come from `<data>/pi/mcp.json`, OAuth state goes to `<data>/pi/mcp-auth.json` and logs to `<data>/pi/mcp.log`.
- `bin/nano-mcp` is `pi mcp` for that same file: `nano-mcp list`, `nano-mcp add ...`, `nano-mcp remove <name>`.
- `skills/mcp-servers/SKILL.md` teaches the agent to add, remove and check servers for the owner, keep secrets out of the conversation as `${ENV}` references, and find tools with `tool_search`.

Enable it with `NANO_PACKS=core,mcp`. Give servers `"exposure": "deferred"` so their tools stay out of the standing prompt until `tool_search` loads them. Servers left at Pi's default `codemode` exposure are reached from `codemode` scripts.

Changes to `mcp.json` take effect in the next fresh context window. Pi's OAuth sign-in (`pi mcp login`) needs a browser on the machine Nano runs on; prefer token-based servers.

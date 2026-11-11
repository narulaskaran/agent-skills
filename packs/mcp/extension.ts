import { join } from "node:path";
import {
	createCodemodeExtension,
	createMcpExtension,
	createToolSearchExtension,
	type ExtensionFactory,
} from "@earendil-works/pi-coding-agent";
import type { PackContext } from "../../src/packs.ts";

/**
 * Pi's MCP support for Nano sessions. SDK sessions do not load Pi's built-in extensions, so this
 * adds the same three the CLI uses: MCP itself, `tool_search` for servers with `deferred`
 * exposure, and `codemode` for servers left at the default `codemode` exposure. The MCP extension
 * activates whichever of the two its servers need.
 *
 * Pi's MCP extension finds `mcp.json`, `mcp-auth.json` and `mcp.log` through PI_CODING_AGENT_DIR,
 * not through the session's agentDir, so point it at Nano's agent dir (`<data>/pi`). The bash tool
 * inherits the variable, so `nano-mcp list` edits and checks the same file.
 */
export default function mcp(ctx: PackContext): ExtensionFactory[] {
	process.env.PI_CODING_AGENT_DIR ??= join(ctx.config.dataDir, "pi");
	return [createCodemodeExtension(), createToolSearchExtension(), createMcpExtension()];
}

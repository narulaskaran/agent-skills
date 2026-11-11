import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { fauxAssistantMessage, fauxText, fauxToolCall } from "@earendil-works/pi-ai";
import { scriptedConversation, toolResults } from "./helpers/scripted-session.ts";

const fixture = fileURLToPath(new URL("./fixtures/mcp-echo-server.mjs", import.meta.url));

test("a Nano session discovers a deferred stdio MCP tool with tool_search and calls it", async () => {
	delete process.env.PI_CODING_AGENT_DIR;
	const nano = await scriptedConversation({ packs: "mcp" });
	writeFileSync(
		join(nano.dataDir, "pi", "mcp.json"),
		JSON.stringify({
			mcpServers: {
				echo: { command: process.execPath, args: [fixture], exposure: "deferred", description: "Reverses text (test fixture)" },
			},
		}),
	);

	nano.script([
		(context) => {
			assert.match(JSON.stringify(context), /mcp_servers[\s\S]*Reverses text/, "the model is told about the configured server");
			return fauxAssistantMessage(fauxToolCall("tool_search", { query: "reverse text" }), { stopReason: "toolUse" });
		},
		(context) => {
			assert.match(toolResults(context).at(-1) ?? "", /mcp__echo__reverse_text/);
			return fauxAssistantMessage(fauxToolCall("mcp__echo__reverse_text", { text: "nano" }), { stopReason: "toolUse" });
		},
		(context) => fauxAssistantMessage(fauxText(`Tool said: ${toolResults(context).at(-1)}`)),
	]);

	nano.say("reverse the word nano with the echo server");
	try {
		assert.equal(await nano.next(), "Tool said: reversed: onan");
		assert.equal(process.env.PI_CODING_AGENT_DIR, join(nano.dataDir, "pi"));
		assert.equal(nano.pending(), 0);
	} finally {
		await nano.conversation.dispose();
	}
	for (let i = 0; i < 50 && process.getActiveResourcesInfo().includes("ProcessWrap"); i++) await new Promise((r) => setTimeout(r, 100));
	assert.ok(!process.getActiveResourcesInfo().includes("ProcessWrap"), "disposing the conversation stops the stdio server");
});

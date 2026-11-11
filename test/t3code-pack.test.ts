import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fauxAssistantMessage, fauxText, fauxToolCall } from "@earendil-works/pi-ai";
import {
	checkToken,
	credentialsPath,
	describeCredentials,
	mcpServerConfig,
	pairWithCode,
	readCredentials,
	rewriteLinks,
	t3Origin,
	writeCredentials,
} from "../packs/t3code/auth.ts";
import { findPairingCode } from "../packs/t3code/extension.ts";
import { startFakeT3Code } from "./fixtures/fake-t3code.ts";
import { scriptedConversation, toolResults } from "./helpers/scripted-session.ts";

test("pairing codes are recognised in owner messages", () => {
	assert.deepEqual(findPairingCode("[Wed]\nT3 pairing code: ab12-CD34-ef56"), { code: "ab12-CD34-ef56", access: undefined });
	assert.equal(findPairingCode("here is my T3 Code pairing code xyz987654 auto")?.access, "auto");
	assert.equal(findPairingCode("t3 pairing code=abcdefgh.")?.code, "abcdefgh");
	assert.equal(findPairingCode("have T3 fix the flaky test"), undefined);
});

test("origins, links and the server entry", () => {
	assert.equal(t3Origin(undefined), "http://127.0.0.1:4096");
	assert.equal(t3Origin("http://host.example:4096/mcp/"), "http://host.example:4096");
	assert.equal(
		rewriteLinks('{"link":"http://127.0.0.1:4096/env/t1"}', "http://127.0.0.1:4096", "https://t3.example.com/"),
		'{"link":"https://t3.example.com/env/t1"}',
	);
	assert.equal(rewriteLinks("x http://127.0.0.1:4096/env/t1", "http://127.0.0.1:4096", undefined), "x http://127.0.0.1:4096/env/t1");
	const config = mcpServerConfig({ url: "http://127.0.0.1:4096", token: "t", access: "auto", scope: "", expiresAt: 0, connectedAt: 0 });
	assert.equal(config.url, "http://127.0.0.1:4096/mcp");
	assert.equal(config.exposure, "hidden");
	assert.equal(config.toolExposure.t3_thread_launch, "deferred");
	assert.equal("t3_project_delete" in config.toolExposure, false);
});

test("a pairing code is redeemed for a stored, private token", async () => {
	const t3 = await startFakeT3Code({ pairingCode: "GOOD-CODE-123" });
	const dataDir = mkdtempSync(join(tmpdir(), "nano-t3-"));
	try {
		await assert.rejects(pairWithCode({ url: t3.url, code: "wrong-code", access: "auto" }), /unknown, expired, or already used/);
		const credentials = await pairWithCode({ url: t3.url, code: "GOOD-CODE-123", access: "auto", now: 0 });
		assert.equal(credentials.access, "auto");
		assert.equal(credentials.expiresAt, 30 * 86_400_000);
		writeCredentials(dataDir, credentials);
		assert.equal(statSync(credentialsPath(dataDir)).mode & 0o777, 0o600);
		assert.equal(readCredentials(dataDir)?.token, credentials.token);
		assert.match(describeCredentials(credentials, 86_400_000), /auto access until 1970-01-31 \(29 days left\)/);
		assert.doesNotMatch(describeCredentials(credentials), new RegExp(credentials.token));
		assert.deepEqual(await checkToken(t3.url, credentials.token), { ok: true });
		assert.equal((await checkToken(t3.url, "nope")).ok, false);
		await assert.rejects(pairWithCode({ url: t3.url, code: "GOOD-CODE-123", access: "auto" }), /already used/);
	} finally {
		await t3.close();
	}
});

test("Nano redeems a texted pairing code without the model seeing it, then starts a T3 Code thread", async () => {
	delete process.env.PI_CODING_AGENT_DIR;
	const t3 = await startFakeT3Code({ pairingCode: "SECRET-PAIR-42" });
	process.env.NANO_T3CODE_URL = t3.url;
	process.env.NANO_T3CODE_WEB_URL = "https://t3.example.com";
	const nano = await scriptedConversation({ packs: "mcp,t3code" });
	try {
		nano.script([
			(context) => {
				const seen = JSON.stringify(context);
				assert.doesNotMatch(seen, /SECRET-PAIR-42/);
				assert.match(seen, /removed by Nano before you saw it; redeemed\. Connected to T3 Code/);
				return fauxAssistantMessage(fauxText("Connected to T3 Code."));
			},
		]);
		nano.say("T3 pairing code: SECRET-PAIR-42 auto");
		assert.equal(await nano.next(), "Connected to T3 Code.");
		assert.equal(readCredentials(nano.dataDir)?.access, "auto");

		nano.script([
			() => fauxAssistantMessage(fauxToolCall("tool_search", { query: "t3 code start thread project" }), { stopReason: "toolUse" }),
			(context) => {
				const found = toolResults(context).at(-1) ?? "";
				assert.match(found, /mcp__t3code__t3_thread_launch/);
				assert.doesNotMatch(found, /t3_project_delete/);
				return fauxAssistantMessage(fauxToolCall("mcp__t3code__t3_project_list", {}), { stopReason: "toolUse" });
			},
			(context) => {
				assert.match(toolResults(context).at(-1) ?? "", /proj-1/);
				return fauxAssistantMessage(
					fauxToolCall("mcp__t3code__t3_thread_launch", { projectId: "proj-1", title: "Fix flaky test", message: "Find and fix the flaky test." }),
					{ stopReason: "toolUse" },
				);
			},
			(context) => {
				const launched = toolResults(context).at(-1) ?? "";
				assert.match(launched, /https:\/\/t3\.example\.com\/env-1\/thread-1/);
				return fauxAssistantMessage(fauxText(`Started: ${JSON.parse(launched).link}`));
			},
		]);
		nano.say("have T3 fix the flaky test in demo-repo");
		assert.equal(await nano.next(), "Started: https://t3.example.com/env-1/thread-1");
		assert.deepEqual(
			t3.calls.map((c) => c.tool),
			["t3_project_list", "t3_thread_launch"],
		);
		const sessions = readdirSync(join(nano.dataDir, "sessions"));
		for (const file of sessions) assert.doesNotMatch(readFileSync(join(nano.dataDir, "sessions", file), "utf8"), /SECRET-PAIR-42/);
	} finally {
		await nano.conversation.dispose();
		await t3.close();
		delete process.env.NANO_T3CODE_URL;
		delete process.env.NANO_T3CODE_WEB_URL;
	}
});

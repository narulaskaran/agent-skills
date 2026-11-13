import assert from "node:assert/strict";
import { test } from "node:test";
import { chmodSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import http from "node:http";
import { ip4 } from "../lib/net.mjs";
import {
	saveProvider,
	saveRoles,
	publicSettings,
	publicProvider,
	providerRequest,
	runRole,
	deleteProvider,
	testProvider,
} from "../lib/providers.mjs";
import { renderTemplate, anthropicRequest, anthropicResponse, completionResponse } from "../lib/provider-shapes.mjs";
import { emptyStore, upsertLogin, saveStore, loadStore } from "../lib/store.mjs";
import { handleProviderApi, scrubProviderText } from "../lib/provider-api.mjs";
import { roleFetch } from "../../../src/provider-client.ts";
import { streamSimple } from "@earendil-works/pi-ai/api/openai-completions";

const secret = "fixture-provider-secret-2394";
const form = (id, extra = {}) => ({
	id,
	name: id,
	baseUrl: "https://api.example.com/v1",
	format: "openai",
	cap_chat: "yes",
	key: secret,
	...extra,
});
function configured(extra = {}) {
	let data = saveProvider(emptyStore(), form("cloud", extra));
	return saveRoles(data, { main_provider: "cloud", main_model: "owner-model" });
}
const ok = (data) => ({ status: 200, contentType: "application/json", body: Buffer.from(JSON.stringify(data)) });

test("provider keys persist without appearing in public settings or metadata", () => {
	const dir = mkdtempSync(join(tmpdir(), "nano-providers-"));
	chmodSync(dir, 0o700);
	try {
		let data = configured();
		data = upsertLogin(data, { name: "fixture", site: "example.com", username: "user@example.com", password: "fixture-password" });
		saveStore(dir, data);
		const loaded = loadStore(dir);
		assert.equal(loaded.providers[0].key, secret);
		assert.equal(loaded.roles.main.model, "owner-model");
		assert.ok(!JSON.stringify(publicSettings(loaded)).includes(secret));
		assert.ok(!JSON.stringify(publicProvider(loaded.providers[0])).includes(secret));
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
test("changing destinations clears keys, and editing the same destination keeps them", () => {
	let data = configured();
	data = saveProvider(data, form("cloud", { key: "" }));
	assert.equal(data.providers[0].key, secret);
	data = saveProvider(data, form("cloud", { key: "", baseUrl: "https://other.example.com/v1" }));
	assert.equal(data.providers[0].key, "");
	assert.throws(() => saveProvider(data, form("cloud", { baseUrl: "http://example.com" })), /HTTPS/);
	assert.throws(() => saveProvider(data, form("cloud", { baseUrl: "https://user:pass@example.com" })), /credentials/);
	assert.throws(() => saveProvider(data, form("cloud", { authHeader: "Host" })), /authentication header/);
});
test("private routes, local endpoints and fallbacks are validated before saving", () => {
	let data = configured();
	assert.throws(() => saveRoles(data, { local_provider: "cloud", local_model: "x" }), /local connection/);
	assert.throws(() => saveProvider(data, form("local", { local: "yes", baseUrl: "http://localhost:8090/v1" })), /literal/);
	data = saveProvider(data, form("local", { local: "yes", baseUrl: "http://127.0.0.1:8090/v1", key: "" }));
	assert.throws(
		() => saveRoles(data, { local_provider: "local", local_model: "x", local_fallback_provider: "cloud", local_fallback_model: "x" }),
		/local connection/,
	);
	assert.throws(() => saveRoles(data, { stt_provider: "cloud", stt_model: "x" }), /supports stt/);
	assert.throws(() => deleteProvider(data, "cloud"), /assigned/);
	assert.throws(() => saveProvider(data, form("cloud", { cap_chat: undefined, cap_stt: "yes" })), /supports chat/);
});
test("caller model and destination overrides are not forwarded; background follows main", async () => {
	const data = configured();
	let seen;
	const result = await runRole(
		data,
		"background",
		{ model: "attacker-model", base_url: "https://evil.example", messages: [] },
		async (p, path, opts) => {
			seen = { p, path, body: JSON.parse(opts.body) };
			return ok({ choices: [] });
		},
	);
	assert.equal(result.status, 200);
	assert.equal(seen.path, "/chat/completions");
	assert.equal(seen.body.model, "owner-model");
	assert.equal(seen.body.base_url, undefined);
	assert.equal(seen.p.id, "cloud");
});
test("only an explicit fallback receives work, and authentication failures do not fall back", async () => {
	let data = configured();
	data = saveProvider(data, form("other"));
	data = saveRoles(data, { main_provider: "cloud", main_model: "a", main_fallback_provider: "other", main_fallback_model: "b" });
	let calls = [];
	const call = async (p) => {
		calls.push(p.id);
		return p.id === "cloud" ? { status: 503 } : ok({});
	};
	await runRole(data, "main", { messages: [] }, call);
	assert.deepEqual(calls, ["cloud", "other"]);
	calls = [];
	await assert.rejects(
		runRole(data, "main", {}, async (p) => {
			calls.push(p.id);
			return { status: 401 };
		}),
		/401/,
	);
	assert.deepEqual(calls, ["cloud"]);
	data = saveRoles(data, { main_provider: "cloud", main_model: "a" });
	calls = [];
	await assert.rejects(runRole(data, "main", {}, call), /503/);
	assert.deepEqual(calls, ["cloud"]);
});
test("Anthropic conversion preserves system prompts, tools, results, images and token usage", async () => {
	const input = {
		messages: [
			{ role: "system", content: "System" },
			{
				role: "user",
				content: [
					{ type: "text", text: "hello" },
					{ type: "image_url", image_url: { url: "data:image/png;base64,Zml4dHVyZQ==" } },
				],
			},
			{
				role: "assistant",
				content: null,
				tool_calls: [{ id: "call_1", type: "function", function: { name: "lookup", arguments: '{"q":"x"}' } }],
			},
			{ role: "tool", tool_call_id: "call_1", content: "result" },
		],
		tools: [{ type: "function", function: { name: "lookup", parameters: { type: "object" } } }],
	};
	const body = anthropicRequest(input, "claude-fixture");
	assert.equal(body.system, "System");
	assert.equal(body.tools[0].name, "lookup");
	assert.equal(body.messages[1].content[0].type, "tool_use");
	assert.equal(body.messages[2].content[0].tool_use_id, "call_1");
	assert.equal(body.messages[0].content[1].source.media_type, "image/png");
	const reply = {
		content: [
			{ type: "text", text: "done" },
			{ type: "tool_use", id: "t1", name: "lookup", input: { q: "x" } },
		],
		usage: { input_tokens: 3, output_tokens: 4 },
	};
	const result = anthropicResponse(reply, "claude-fixture");
	assert.equal(result.choices[0].message.tool_calls[0].function.arguments, '{"q":"x"}');
	assert.equal(result.usage.prompt_tokens, 3);
	let data = configured({ format: "anthropic" });
	let path;
	const response = await runRole(data, "main", { ...input, stream: true }, async (_p, p, opts) => {
		path = p;
		assert.equal(JSON.parse(opts.body).stream, false);
		return ok(reply);
	});
	assert.equal(path, "/messages");
	assert.match(response.body.toString(), /tool_calls/);
	assert.match(response.body.toString(), /\[DONE\]/);
});
test("custom templates retain JSON types and cannot execute code or reference secrets", async () => {
	assert.deepEqual(renderTemplate({ messages: "{{messages}}", prompt: "Hi {{text}}" }, { messages: [{ role: "user" }], text: "there" }), {
		messages: [{ role: "user" }],
		prompt: "Hi there",
	});
	assert.throws(() => renderTemplate("{{api_key}}", {}), /Unknown/);
	const custom = {
		healthPath: "/health",
		chat: { path: "/generate", request: { model: "{{model}}", conversation: "{{messages}}" }, response: { text: "result.answer" } },
	};
	let data = configured({ format: "custom", custom: JSON.stringify(custom) });
	const response = await runRole(
		data,
		"main",
		{ messages: [{ role: "user", content: "hello" }], stream: false },
		async (_p, path, opts) => {
			assert.equal(path, "/generate");
			assert.equal(JSON.parse(opts.body).conversation[0].content, "hello");
			return ok({ result: { answer: "custom answer" } });
		},
	);
	assert.equal(JSON.parse(response.body).choices[0].message.content, "custom answer");
	assert.throws(
		() => configured({ format: "custom", custom: '{"chat":{"path":"//evil.example","request":{},"response":{"text":"x"}}}' }),
		/path/,
	);
});
test("speech adapters send raw WAV to Bark, multipart to compatible STT and voice to compatible TTS", async () => {
	let data = saveProvider(
		emptyStore(),
		form("bark", { format: "bark", cap_chat: undefined, cap_stt: "yes", local: "yes", baseUrl: "http://127.0.0.1:8095", key: "" }),
	);
	data = saveProvider(data, form("audio", { cap_chat: undefined, cap_stt: "yes", cap_tts: "yes" }));
	data = saveRoles(data, { stt_provider: "bark", tts_provider: "audio", tts_model: "voice-model", tts_voice: "fixture-voice" });
	let seen = [];
	const call = async (p, path, o) => {
		seen.push({ p, path, o });
		return path === "/speak" ? { status: 200, body: Buffer.from("RIFF") } : ok({ text: "hello" });
	};
	await runRole(data, "stt", { audio: Buffer.from("WAV fixture").toString("base64") }, call);
	assert.equal(seen[0].path, "/transcribe");
	assert.equal(seen[0].o.body.toString(), "WAV fixture");
	data = saveRoles(data, {
		stt_provider: "audio",
		stt_model: "transcribe-model",
		tts_provider: "audio",
		tts_model: "voice-model",
		tts_voice: "fixture-voice",
	});
	await runRole(data, "stt", { audio: Buffer.from("WAV fixture").toString("base64") }, call);
	assert.match(seen[1].o.contentType, /multipart/);
	assert.match(seen[1].o.body.toString(), /transcribe-model/);
	await runRole(data, "tts", { text: "hello" }, call);
	assert.equal(JSON.parse(seen[2].o.body).voice, "fixture-voice");
});
test("provider transport attaches the saved authentication header and blocks hosted private destinations", async (t) => {
	const server = http.createServer((req, res) => {
		assert.equal(req.headers["x-fixture-key"], secret);
		res.end("ok");
	});
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	t.after(() => server.close());
	const baseUrl = `http://127.0.0.1:${server.address().port}`;
	const response = await providerRequest({ baseUrl, local: true, key: secret, authHeader: "X-Fixture-Key", authPrefix: "" }, "/health");
	assert.equal(response.body.toString(), "ok");
	await assert.rejects(providerRequest({ baseUrl: baseUrl.replace("http:", "https:"), local: false, key: secret }, "/health"), /private/);
});
test("connection tests validate model list shape", async () => {
	const p = configured().providers[0];
	const result = await testProvider(p, async () => ok({ data: [{ id: "test-model" }] }));
	assert.deepEqual(result.models, ["test-model"]);
	await assert.rejects(
		testProvider(p, async () => ok({ text: "wrong shape" })),
		/model list/,
	);
});
test("Unix socket rejects settings changes and unknown roles without exposing keys", async (t) => {
	const dir = mkdtempSync(join(tmpdir(), "nano-socket-"));
	const socket = join(dir, "test.sock");
	const data = configured();
	const server = http.createServer(
		(req, res) => void handleProviderApi(req, res, { read: () => data, scrub: (s) => s.split(secret).join("[redacted]") }),
	);
	await new Promise((resolve) => server.listen(socket, resolve));
	t.after(() => {
		server.close();
		rmSync(dir, { recursive: true, force: true });
	});
	const call = (path, method = "GET") =>
		new Promise((resolve, reject) => {
			const req = http.request(
				{ socketPath: socket, path, method, headers: method === "POST" ? { "content-type": "application/json", "content-length": 2 } : {} },
				(res) => {
					let body = "";
					res.on("data", (c) => (body += c));
					res.on("end", () => resolve({ status: res.statusCode, body }));
				},
			);
			req.on("error", reject);
			req.end(method === "POST" ? "{}" : undefined);
		});
	const config = await call("/providers/config");
	assert.equal(config.status, 200);
	assert.ok(!config.body.includes(secret));
	assert.equal((await call("/providers/config", "POST")).status, 404);
	assert.equal((await call("/providers/run/unknown", "POST")).status, 404);
});
test("Pi consumes adapted SSE and preserves custom tool calls through the Unix client", async (t) => {
	const dir = mkdtempSync(join(tmpdir(), "nano-pi-proxy-"));
	const socket = join(dir, "test.sock");
	const value = {
		id: "fixture",
		object: "chat.completion",
		created: 1,
		model: "fixture",
		choices: [
			{
				index: 0,
				message: {
					role: "assistant",
					content: "hello",
					tool_calls: [{ id: "c1", type: "function", function: { name: "lookup", arguments: '{"q":"test"}' } }],
				},
				finish_reason: "tool_calls",
			},
		],
		usage: { prompt_tokens: 1, completion_tokens: 2 },
	};
	const server = http.createServer((req, res) => {
		req.resume();
		req.on("end", () => {
			const result = completionResponse(value, true);
			res.writeHead(200, { "content-type": result.contentType });
			res.end(result.body);
		});
	});
	await new Promise((resolve) => server.listen(socket, resolve));
	t.after(() => {
		server.close();
		rmSync(dir, { recursive: true, force: true });
	});
	const model = {
		id: "fixture",
		name: "fixture",
		provider: "nano-fixture",
		api: "openai-completions",
		baseUrl: "http://nano-vault/main",
		reasoning: false,
		input: ["text"],
		contextWindow: 32768,
		maxTokens: 1024,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	};
	const result = await streamSimple(
		model,
		{
			messages: [{ role: "user", content: "hello", timestamp: Date.now() }],
			tools: [{ name: "lookup", description: "lookup", parameters: { type: "object", properties: { q: { type: "string" } } } }],
		},
		{ apiKey: "vault-proxy", fetch: roleFetch("main", socket) },
	).result();
	assert.equal(result.stopReason, "toolUse");
	assert.ok(result.content.some((b) => b.type === "toolCall" && b.name === "lookup" && b.arguments.q === "test"));
});

test("redaction preserves valid JSON and SSE when numeric statistics resemble sensitive text", () => {
	const value = { choices: [{ message: { content: secret } }], timings: { seconds: 0.123456789 }, usage: { prompt_tokens: 3 } };
	const scrub = (s) => s.replace(secret, "[redacted]").replace("123456789", "[redacted]");
	const parsed = JSON.parse(scrubProviderText(JSON.stringify(value), "application/json", scrub));
	assert.equal(parsed.choices[0].message.content, "[redacted]");
	assert.equal(parsed.usage.prompt_tokens, 3);
	assert.equal(typeof parsed.timings.seconds, "string");
	const stream = "data: " + JSON.stringify(value) + "\n\ndata: [DONE]\n\n";
	const safe = scrubProviderText(stream, "text/event-stream", scrub);
	assert.equal(JSON.parse(safe.split("\n")[0].slice(6)).choices[0].message.content, "[redacted]");
	assert.match(safe, /data: \[DONE\]/);
});

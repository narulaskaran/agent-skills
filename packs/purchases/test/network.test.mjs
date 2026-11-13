import assert from "node:assert/strict";
import { test } from "node:test";
import { formatNetwork, sanitizeBody, sanitizeNetworkUrl } from "../lib/browser.mjs";

test("query values and fragments are dropped, parameter names kept", () => {
	const out = sanitizeNetworkUrl("https://pay.example/api/v1/order?token=abc123secret&amount=10#frag");
	assert.equal(out, "pay.example/api/v1/order?token&amount=…");
	assert.ok(!out.includes("abc123secret"));
});

test("JSON bodies lose token-like keys and long opaque strings but keep the reason", () => {
	const body = JSON.stringify({ code: 40012, message: "card not supported", access_token: "short", data: { id: "a".repeat(40), reason: "risk_declined" } });
	const out = sanitizeBody(body);
	assert.match(out, /card not supported/);
	assert.match(out, /risk_declined/);
	assert.ok(!out.includes("a".repeat(40)));
	assert.match(out, /"access_token":"\[redacted\]"/);
});

test("HTML bodies are flattened and opaque strings removed", () => {
	const out = sanitizeBody(`<div>Payment failed <b>${"Z".repeat(50)}</b></div>`);
	assert.match(out, /Payment failed/);
	assert.ok(!out.includes("ZZZZZZZZZZ"));
});

test("the default view keeps errors and payment calls, and hides static noise", () => {
	const at = Date.now();
	const entries = [
		{ at, method: "GET", type: "xhr", status: 200, url: "site.example/api/profile", body: '{"ok":true}' },
		{ at, method: "POST", type: "xhr", status: 200, url: "site.example/api/pay/create", body: '{"code":1}' },
		{ at, method: "POST", type: "fetch", status: 403, url: "site.example/api/other", body: '{"message":"blocked"}' },
		{ at, method: "GET", type: "image", status: 200, url: "cdn.example/x.png" },
		{ at, method: "POST", type: "xhr", status: 200, url: "www.paypal.com/xoplatform/logger/api/logger", body: "{}" },
		{ at, kind: "console", level: "error", text: "Uncaught TypeError" },
	];
	const out = formatNetwork(entries);
	assert.ok(out.includes("api/pay/create") && out.includes("403") && out.includes("console.error"));
	assert.ok(!out.includes("api/profile") && !out.includes("x.png") && !out.includes("logger"));
	assert.ok(formatNetwork(entries, { all: true }).includes("api/profile"));
	assert.equal(formatNetwork(entries, { grep: "blocked" }).split("\n").length, 2);
});

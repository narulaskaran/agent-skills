import assert from "node:assert/strict";
import { test } from "node:test";
import { authorizedFetch, parseFetchArgs } from "../lib/fetch.mjs";
import { ip4 } from "../lib/net.mjs";

const key = "vk-test-fixture-key-0001";
const entry = { header: "Authorization", prefix: "Bearer ", key, hosts: ["api.example", "logs.example"] };

function scripted(steps) {
	const seen = [];
	return {
		seen,
		transport: async (request) => {
			seen.push({ url: request.url.href, authorization: request.headers.Authorization, method: request.method });
			const step = steps.shift();
			if (!step) throw new Error("unexpected request");
			return step;
		},
	};
}

test("parseFetchArgs reads method, repeated headers and a body", () => {
	const parsed = parseFetchArgs(["deepseek", "-X", "PUT", "-H", "Accept: text/plain", "-H", "X-Trace: 1", "-d", "{}", "https://api.example/v1"]);
	assert.equal(parsed.name, "deepseek");
	assert.equal(parsed.method, "PUT");
	assert.equal(parsed.body, "{}");
	assert.equal(parsed.headers.length, 2);
	assert.equal(parseFetchArgs(["deepseek", "-d", "{}", "https://api.example/v1"]).method, "POST");
});

test("the key is one header, and a redirect to another saved host drops it", async () => {
	const pub = ip4(93, 184, 216, 34);
	const { seen, transport } = scripted([
		{ status: 302, headers: { location: "https://logs.example/next" }, body: "" },
		{ status: 200, headers: { "content-type": "text/plain" }, body: `echo ${key}` },
	]);
	const text = await authorizedFetch({
		entry,
		url: "https://api.example/start",
		method: "GET",
		headers: [{ name: "Accept", value: "text/plain" }],
		resolve: async () => [pub],
		transport,
	});
	assert.equal(seen[0].authorization, `Bearer ${key}`);
	assert.equal(seen[1].authorization, undefined);
	assert.equal(text.includes(key), false);
	assert.match(text, /HTTP 200/);
	assert.match(text, /\[redacted\]/);
});

test("a redirect off the saved hosts is refused and the key stays off the URL", async () => {
	const pub = ip4(93, 184, 216, 34);
	const { transport } = scripted([{ status: 302, headers: { location: "https://evil.example/steal" }, body: "" }]);
	await assert.rejects(
		authorizedFetch({ entry, url: "https://api.example/start", method: "GET", headers: [], resolve: async () => [pub], transport }),
		/not allowed/,
	);
	await assert.rejects(
		authorizedFetch({
			entry,
			url: "https://api.example/start",
			method: "GET",
			headers: [{ name: "Authorization", value: "nope" }],
			resolve: async () => [pub],
			transport,
		}),
		/supplied Authorization/,
	);
	await assert.rejects(authorizedFetch({ entry, url: "http://api.example/", method: "GET", headers: [], resolve: async () => [pub], transport }), /non-https/);
});

test("a public name that resolves to a private address is refused", async () => {
	const priv = ip4(10, 9, 8, 7);
	await assert.rejects(
		authorizedFetch({ entry, url: "https://api.example/x", method: "GET", headers: [], resolve: async () => [priv], transport: async () => { throw new Error("should not connect"); } }),
		/non-public/,
	);
	const loop = ip4(127, 0, 0, 1);
	const literal = { ...entry, hosts: [loop] };
	const { seen, transport } = scripted([{ status: 200, headers: { "content-type": "text/plain" }, body: "ok" }]);
	const text = await authorizedFetch({ entry: literal, url: `https://${loop}/x`, method: "GET", headers: [], resolve: async () => [loop], transport });
	assert.match(text, /HTTP 200/);
	assert.equal(seen[0].authorization.endsWith(key), true);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { evalAllowed, hostMatchesSite, loginUrlAllowed, navigationAllowed } from "../lib/policy.mjs";
import { destinationAllowed, hostPinMatches, ip4 } from "../lib/net.mjs";

test("a saved site matches itself and its subdomains, not look-alikes", () => {
	assert.equal(hostMatchesSite("deepseek.com", "deepseek.com"), true);
	assert.equal(hostMatchesSite("platform.deepseek.com", "deepseek.com"), true);
	assert.equal(hostMatchesSite("deepseek.com.evil.example", "deepseek.com"), false);
	assert.equal(hostMatchesSite("evildeepseek.com", "deepseek.com"), false);
	assert.equal(hostMatchesSite("deepseek.com.evil.example", "evil.example"), true);
	assert.equal(loginUrlAllowed("https://platform.deepseek.com/login", "deepseek.com"), true);
	assert.equal(loginUrlAllowed("http://platform.deepseek.com/login", "deepseek.com"), false);
	assert.equal(loginUrlAllowed("https://deepseek.com.evil.example/", "deepseek.com"), false);
	assert.equal(loginUrlAllowed("http://127.0.0.1:8491/login", "127.0.0.1"), false);
	assert.equal(loginUrlAllowed("http://127.0.0.1:8491/login", "127.0.0.1", { allowHttpLoopback: true }), true);
	assert.equal(loginUrlAllowed("http://localhost:8491/login", "127.0.0.1", { allowHttpLoopback: true }), false);
});

test("eval is refused when the page or the frame matches a saved login", () => {
	const sites = ["deepseek.com"];
	assert.equal(evalAllowed("https://platform.deepseek.com/a", "https://platform.deepseek.com/a", sites), false);
	assert.equal(evalAllowed("https://platform.deepseek.com/a", "about:blank", sites), false);
	assert.equal(evalAllowed("https://evil.example/", "https://platform.deepseek.com/frame", sites), false);
	assert.equal(evalAllowed("https://evil.example/", "https://evil.example/frame", sites), true);
	assert.equal(evalAllowed("https://evildeepseek.com/", "https://evildeepseek.com/", sites), true);
});

test("open accepts http, https and about:blank, and refuses the rest", () => {
	assert.equal(navigationAllowed("https://example.com/a", { top: true }), true);
	assert.equal(navigationAllowed("http://127.0.0.1/", { top: true }), true);
	assert.equal(navigationAllowed("about:blank", { top: true }), true);
	assert.equal(navigationAllowed("about:srcdoc", { top: true }), false);
	assert.equal(navigationAllowed("about:srcdoc", { top: false }), true);
	for (const url of ["file:///vault/store.json", "javascript:alert(1)", "view-source:https://example.com", "chrome://settings", "data:text/html,hi"]) {
		assert.equal(navigationAllowed(url, { top: true }), false, url);
	}
});

test("an API key is pinned to exact hosts or to a saved wildcard", () => {
	const pins = ["api.example", "*.cdn.example"];
	assert.equal(hostPinMatches("api.example", pins), true);
	assert.equal(hostPinMatches("API.example", pins), true);
	assert.equal(hostPinMatches("files.cdn.example", pins), true);
	assert.equal(hostPinMatches("cdn.example", pins), false);
	assert.equal(hostPinMatches("api.example.evil.test", pins), false);
	assert.equal(hostPinMatches("notapi.example", pins), false);
});

test("a name that resolves to a restricted address is refused unless the pin is that address", () => {
	const loop = ip4(127, 0, 0, 1);
	const priv = ip4(10, 1, 2, 3);
	const pub = ip4(93, 184, 216, 34);
	assert.equal(destinationAllowed("api.example", [pub], ["api.example"]).ok, true);
	assert.equal(destinationAllowed("api.example", [loop], ["api.example"]).ok, false);
	assert.equal(destinationAllowed("api.example", [priv], ["*.example"]).ok, false);
	assert.equal(destinationAllowed(loop, [loop], [loop]).ok, true);
	assert.equal(destinationAllowed("localhost", [loop], [loop]).ok, false);
});

test("a login page on another port of the saved site is refused", () => {
	assert.equal(loginUrlAllowed("https://example.com/login", "example.com"), true);
	assert.equal(loginUrlAllowed("https://example.com:8443/login", "example.com"), false);
});

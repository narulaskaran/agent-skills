import assert from "node:assert/strict";
import { test } from "node:test";
import { carryOver, isIdle } from "../src/agent.ts";
import { chooseFormat } from "../src/channel.ts";
import { cronMatches, parseLocalTime } from "../src/scheduler.ts";
import { htmlToText } from "../src/tools.ts";

const NY = "America/New_York";

test("cron matches in the owner's timezone, not UTC", () => {
	// 2026-11-11 14:00 UTC is 09:00 in New York (EST).
	const at = new Date("2026-11-11T14:00:00Z");
	assert.equal(cronMatches("0 9 * * *", at, NY), true);
	assert.equal(cronMatches("0 14 * * *", at, NY), false);
	assert.equal(cronMatches("0 14 * * *", at, "UTC"), true);
});

test("cron lists, ranges, steps and weekdays", () => {
	const wed = new Date("2026-11-11T14:30:00Z"); // Wednesday 09:30 New York
	assert.equal(cronMatches("*/15 9-17 * * 1-5", wed, NY), true);
	assert.equal(cronMatches("*/20 9 * * *", wed, NY), false);
	assert.equal(cronMatches("30 9 * * 0,6", wed, NY), false);
	assert.equal(cronMatches("30 9 11 11 *", wed, NY), true);
	const sun = new Date("2026-11-15T14:30:00Z");
	assert.equal(cronMatches("30 9 * * 7", sun, NY), true);
	assert.equal(cronMatches("30 9 * * 0", sun, NY), true);
});

test("cron with both day fields set fires when either matches", () => {
	const wed = new Date("2026-11-11T14:00:00Z");
	assert.equal(cronMatches("0 9 1 * 3", wed, NY), true);
	assert.equal(cronMatches("0 9 1 * 4", wed, NY), false);
});

test("cron rejects malformed expressions", () => {
	assert.throws(() => cronMatches("0 9 * *", new Date(), NY));
	assert.throws(() => cronMatches("61 9 * * *", new Date(), NY));
	assert.throws(() => cronMatches("*/0 9 * * *", new Date(), NY));
});

test("local times resolve through the owner's timezone, across DST", () => {
	assert.equal(parseLocalTime("2026-11-12T09:00", NY), Date.parse("2026-11-12T14:00:00Z")); // EST
	assert.equal(parseLocalTime("2026-07-04 09:00", NY), Date.parse("2026-07-04T13:00:00Z")); // EDT
	assert.equal(parseLocalTime("2026-11-12T09:00:00Z", NY), Date.parse("2026-11-12T09:00:00Z"));
	assert.equal(parseLocalTime("2026-11-12T09:00-08:00", NY), Date.parse("2026-11-12T17:00:00Z"));
	assert.throws(() => parseLocalTime("tomorrow at 9", NY));
});

test("idle rollover only after the configured gap", () => {
	const now = Date.parse("2026-11-11T12:00:00Z");
	assert.equal(isIdle(0, 4, now), false);
	assert.equal(isIdle(now - 3 * 3_600_000, 4, now), false);
	assert.equal(isIdle(now - 5 * 3_600_000, 4, now), true);
});

test("carry-over keeps the most recent turns within the budget", () => {
	const recent = Array.from({ length: 10 }, (_, i) => ({ role: i % 2 ? "nano" : "owner", text: `message ${i} ${"x".repeat(100)}`, at: i }) as const);
	const carry = carryOver([...recent], 400);
	assert.ok(carry.includes("message 9"));
	assert.ok(!carry.includes("message 0"));
	assert.ok(carry.length <= 400 + 10);
	assert.ok(carry.indexOf("message 8") < carry.indexOf("message 9"));
});

test("messages with URLs go out as plain text", () => {
	assert.equal(chooseFormat("**Done.** Logged it."), "markdown");
	assert.equal(chooseFormat("**Here**: https://example.com/x"), "text");
	assert.equal(chooseFormat("just a normal text"), "text");
});

test("html is reduced to readable text", () => {
	const out = htmlToText("<html><head><title>t</title><style>a{}</style></head><body><h1>Hi</h1><p>A &amp; B</p><script>x()</script></body></html>");
	assert.equal(out, "Hi\nA & B");
});

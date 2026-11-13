import assert from "node:assert/strict";
import { test } from "node:test";
import { connectionAllowed, ip4, isRestricted, parseAllow } from "../lib/net.mjs";

const allow = parseAllow("");
const tail = ip4(100, 64, 1, 2);
const own = ip4(100, 64, 0, 8);
const outside = ip4(93, 184, 216, 34);
const loop = "127.0.0.1";

test("a tailnet address is allowed, and this machine, loopback and the public internet are not", () => {
	const ownAddresses = new Set([own, loop]);
	assert.equal(connectionAllowed({ remoteAddress: tail, allow, ownAddresses }), true);
	assert.equal(connectionAllowed({ remoteAddress: `::ffff:${tail}`, allow, ownAddresses }), true);
	assert.equal(connectionAllowed({ remoteAddress: own, allow, ownAddresses }), false);
	assert.equal(connectionAllowed({ remoteAddress: loop, allow, ownAddresses }), false);
	assert.equal(connectionAllowed({ remoteAddress: "::1", allow, ownAddresses }), false);
	assert.equal(connectionAllowed({ remoteAddress: outside, allow, ownAddresses }), false);
	assert.equal(connectionAllowed({ remoteAddress: loop, allow, ownAddresses, insecureLocal: true }), true);
	assert.equal(connectionAllowed({ remoteAddress: own, allow, ownAddresses, insecureLocal: true }), false);
});

test("loopback, link-local, private and CGNAT addresses are restricted", () => {
	assert.equal(isRestricted(loop), true);
	assert.equal(isRestricted(ip4(10, 0, 0, 1)), true);
	assert.equal(isRestricted(ip4(172, 16, 0, 1)), true);
	assert.equal(isRestricted(ip4(192, 168, 1, 1)), true);
	assert.equal(isRestricted(ip4(169, 254, 1, 1)), true);
	assert.equal(isRestricted(ip4(100, 64, 0, 1)), true);
	assert.equal(isRestricted(ip4(8, 8, 8, 8)), false);
	assert.equal(isRestricted("::1"), true);
});

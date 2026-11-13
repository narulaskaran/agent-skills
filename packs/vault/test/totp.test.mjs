import assert from "node:assert/strict";
import { test } from "node:test";
import { base32Decode, hotp, normalizeTotp, totpCode } from "../lib/totp.mjs";

const SHA1 = Buffer.from("12345678901234567890");
const SHA1_B32 = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
const SHA256 = Buffer.from("12345678901234567890123456789012");
const SHA512 = Buffer.from("1234567890123456789012345678901234567890123456789012345678901234");

// RFC 6238 appendix B. Counter is floor(time / 30); time 59 is counter 1.
const SHA1_VECTORS = [
	[59, "94287082"],
	[1111111109, "07081804"],
	[1111111111, "14050471"],
	[1234567890, "89005924"],
	[2000000000, "69279037"],
	[20000000000, "65353130"],
];

test("HOTP matches the RFC 6238 SHA1 vectors", () => {
	for (const [time, code] of SHA1_VECTORS) {
		const counter = Math.floor(time / 30);
		assert.equal(hotp(SHA1, counter, { digits: 8, algorithm: "sha1" }), code);
	}
	assert.equal(hotp(SHA256, 1, { digits: 8, algorithm: "sha256" }), "46119246");
	assert.equal(hotp(SHA512, 1, { digits: 8, algorithm: "sha512" }), "90693936");
});

test("base32 secrets and otpauth URIs produce the same code", () => {
	assert.equal(base32Decode(SHA1_B32).toString(), SHA1.toString());
	const spec = { secret: SHA1_B32, digits: 8, period: 30, algorithm: "SHA1" };
	assert.equal(totpCode(spec, 59_000), "94287082");
	const fromUri = normalizeTotp(`otpauth://totp/Example:user@example.com?secret=${SHA1_B32}&issuer=Example&digits=8&period=30&algorithm=SHA1`);
	assert.equal(totpCode(fromUri, 59_000), "94287082");
	assert.equal(fromUri.secret, SHA1_B32);
});

test("a short or non-base32 secret is rejected", () => {
	assert.throws(() => normalizeTotp("AAAA"), /too short|not base32/);
	assert.throws(() => normalizeTotp("otpauth://hotp/Example?secret=AAAA"), /otpauth:\/\/totp/);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { redact } from "../../purchases/lib/browser.mjs";
import { collectSecrets } from "../lib/secrets.mjs";
import { totpCode } from "../lib/totp.mjs";

const password = "fixture-password-9f3a";
const seed = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
const key = "vk-test-fixture-key-0001";
const now = 59_000;

test("passwords, seeds, keys and neighbouring TOTP codes are removed, longer secrets first", () => {
	const entries = [
		{ kind: "login", password, totp: { secret: seed, digits: 8, period: 30, algorithm: "SHA1" } },
		{ kind: "api-key", key },
	];
	const code = totpCode(entries[0].totp, now);
	const secrets = collectSecrets(entries, now);
	const page = `password ${password} seed ${seed} key ${key} code ${code} also 12345678 and 123456`;
	const cleaned = redact(`${page} 12345678`, [...secrets, "12345678", "123456"], { minLength: 6 });
	assert.equal(cleaned.includes(password), false);
	assert.equal(cleaned.includes(seed), false);
	assert.equal(cleaned.includes(key), false);
	assert.equal(cleaned.includes(code), false);
	assert.match(cleaned, /\[redacted\]/);
});

test("the default redaction length stays at 8 characters", () => {
	assert.equal(redact("code 123456 here", ["123456"]), "code 123456 here");
	assert.equal(redact("code 123456 here", ["123456"], { minLength: 6 }), "code [redacted] here");
});

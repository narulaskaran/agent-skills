// RFC 6238 TOTP on top of RFC 4226 HOTP, using node:crypto.
// Secrets are base32. An otpauth:// URI contributes its secret, digits, period and algorithm.

import { createHmac } from "node:crypto";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Decode(input) {
	const clean = String(input).replace(/[\s-]/g, "").replace(/=+$/, "").toUpperCase();
	if (!clean) throw new Error("TOTP secret is empty");
	let bits = 0;
	let value = 0;
	const out = [];
	for (const char of clean) {
		const index = ALPHABET.indexOf(char);
		if (index < 0) throw new Error("TOTP secret is not base32");
		value = (value << 5) | index;
		bits += 5;
		if (bits >= 8) {
			bits -= 8;
			out.push((value >>> bits) & 0xff);
		}
	}
	return Buffer.from(out);
}

export function hotp(key, counter, { digits = 6, algorithm = "sha1" } = {}) {
	const buf = Buffer.alloc(8);
	buf.writeBigUInt64BE(BigInt(counter));
	const hmac = createHmac(algorithm, key).update(buf).digest();
	const offset = hmac[hmac.length - 1] & 0x0f;
	const bin = ((hmac[offset] & 0x7f) << 24) | (hmac[offset + 1] << 16) | (hmac[offset + 2] << 8) | hmac[offset + 3];
	return String(bin % 10 ** digits).padStart(digits, "0");
}

const ALGORITHMS = { SHA1: "sha1", SHA256: "sha256", SHA512: "sha512" };

export function normalizeTotp(input) {
	if (!input) return null;
	if (typeof input === "string") return normalizeTotp(parseSecret(input));
	const secret = String(input.secret ?? "").replace(/[\s-]/g, "").replace(/=+$/, "").toUpperCase();
	const key = base32Decode(secret);
	if (key.length < 10) throw new Error("TOTP secret is too short");
	const digits = Number(input.digits ?? 6);
	const period = Number(input.period ?? 30);
	const algorithm = String(input.algorithm ?? "SHA1").toUpperCase().replaceAll("-", "");
	if (!ALGORITHMS[algorithm]) throw new Error("TOTP algorithm must be SHA1, SHA256 or SHA512");
	if (!Number.isInteger(digits) || digits < 6 || digits > 8) throw new Error("TOTP digits must be 6, 7 or 8");
	if (!Number.isInteger(period) || period < 15 || period > 120) throw new Error("TOTP period is not usable");
	return { secret, digits, period, algorithm };
}

/** A pasted base32 secret or an otpauth://totp URI. */
export function parseSecret(raw) {
	const text = String(raw ?? "").trim();
	if (!text) return null;
	if (/^otpauth:\/\//i.test(text)) {
		let url;
		try {
			url = new URL(text);
		} catch {
			throw new Error("that one-time-code value is not a valid otpauth URI");
		}
		if (url.protocol !== "otpauth:" || url.hostname.toLowerCase() !== "totp") throw new Error("only otpauth://totp URIs are accepted");
		const secret = url.searchParams.get("secret");
		if (!secret) throw new Error("otpauth URI has no secret");
		return {
			secret,
			digits: url.searchParams.get("digits") ?? undefined,
			period: url.searchParams.get("period") ?? undefined,
			algorithm: url.searchParams.get("algorithm") ?? undefined,
		};
	}
	return { secret: text };
}

export function totpCode(totp, timeMs = Date.now()) {
	const spec = normalizeTotp(totp);
	const counter = Math.floor(timeMs / 1000 / spec.period);
	return hotp(base32Decode(spec.secret), counter, { digits: spec.digits, algorithm: ALGORITHMS[spec.algorithm] });
}

/** Previous, current and next codes. These are redacted from every daemon reply. */
export function totpWindow(totp, timeMs = Date.now()) {
	const spec = normalizeTotp(totp);
	const step = spec.period * 1000;
	return [-1, 0, 1].map((offset) => totpCode(spec, timeMs + offset * step));
}

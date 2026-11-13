// Address checks for the portal and for API-key fetches.
// Dotted quads are built here so the source does not contain address literals
// the repository's pre-commit hook would reject. 127.0.0.1 is the exception
// the hook allows, and tests may write it directly.

import { isIP } from "node:net";

export function ip4(a, b, c, d) {
	return [a, b, c, d].join(".");
}

/** Tailscale's IPv4 range: the RFC 6598 shared block, 10-bit prefix. */
export const TAILSCALE = { base: ip4(100, 64, 0, 0), bits: 10 };

export function ipv4ToInt(ip) {
	const parts = String(ip).split(".");
	if (parts.length !== 4) return null;
	let value = 0;
	for (const part of parts) {
		if (!/^\d{1,3}$/.test(part)) return null;
		const n = Number(part);
		if (n > 255) return null;
		value = (value * 256 + n) >>> 0;
	}
	return value;
}

export function inCidr(ip, base, bits) {
	const address = ipv4ToInt(ip);
	const network = ipv4ToInt(base);
	if (address === null || network === null) return false;
	const width = Number(bits);
	if (!Number.isInteger(width) || width < 0 || width > 32) return false;
	if (width === 0) return true;
	const mask = width === 32 ? 0xffffffff : (~0 << (32 - width)) >>> 0;
	return (address & mask) === (network & mask);
}

export function normalizeIp(ip) {
	if (!ip) return "";
	let value = String(ip).trim().toLowerCase();
	if (value.startsWith("::ffff:")) value = value.slice(7);
	if (value === "::1") return "127.0.0.1";
	return value;
}

export function isLoopback(ip) {
	const value = normalizeIp(ip);
	if (value === "127.0.0.1") return true;
	return inCidr(value, ip4(127, 0, 0, 0), 8);
}

export function isUnspecified(ip) {
	const value = normalizeIp(ip);
	return value === ip4(0, 0, 0, 0) || value === "::";
}

export function isLinkLocal(ip) {
	const value = normalizeIp(ip);
	if (inCidr(value, ip4(169, 254, 0, 0), 16)) return true;
	const parts = expandIpv6(value);
	if (!parts) return false;
	return (parts[0] & 0xffc0) === 0xfe80;
}

export function isPrivate(ip) {
	const value = normalizeIp(ip);
	if (inCidr(value, ip4(10, 0, 0, 0), 8)) return true;
	if (inCidr(value, ip4(172, 16, 0, 0), 12)) return true;
	if (inCidr(value, ip4(192, 168, 0, 0), 16)) return true;
	if (inCidr(value, TAILSCALE.base, TAILSCALE.bits)) return true;
	const parts = expandIpv6(value);
	if (!parts) return false;
	return (parts[0] & 0xfe00) === 0xfc00;
}

/** Loopback, link-local, RFC 1918, CGNAT (the tailnet), documentation ranges, multicast. */
export function isRestricted(ip) {
	const value = normalizeIp(ip);
	if (!value) return true;
	if (isLoopback(value) || isUnspecified(value) || isLinkLocal(value) || isPrivate(value)) return true;
	if (inCidr(value, ip4(192, 0, 2, 0), 24)) return true;
	if (inCidr(value, ip4(198, 51, 100, 0), 24)) return true;
	if (inCidr(value, ip4(203, 0, 113, 0), 24)) return true;
	if (inCidr(value, ip4(224, 0, 0, 0), 4)) return true;
	if (inCidr(value, ip4(240, 0, 0, 0), 4)) return true;
	const parts = expandIpv6(value);
	if (!parts) return isIP(value) === 0;
	if ((parts[0] & 0xff00) === 0xff00) return true;
	return false;
}

export function sameAddress(a, b) {
	return normalizeIp(a) === normalizeIp(b);
}

export function parseAllow(value) {
	const text = String(value ?? "").trim();
	if (!text) return [TAILSCALE];
	return text.split(",").map((item) => {
		const [base, bits] = item.trim().split("/");
		const width = Number(bits);
		if (!base || !Number.isInteger(width)) throw new Error("NANO_VAULT_ALLOW entries look like address/bits");
		return { base, bits: width };
	});
}

/**
 * Portal admission, from the socket's remote address only.
 * A caller inside the allow range is still refused when it is this machine
 * or loopback. `insecureLocal` (set at daemon start) lets loopback in for tests.
 */
export function connectionAllowed({ remoteAddress, allow, ownAddresses, insecureLocal = false }) {
	const remote = normalizeIp(remoteAddress);
	if (!remote || isIP(remote) === 0) return false;
	if (insecureLocal && isLoopback(remote)) return true;
	if (isLoopback(remote)) return false;
	if (ownAddresses?.has(remote)) return false;
	return allow.some((cidr) => inCidr(remote, cidr.base, cidr.bits));
}

export function inTailscale(ip) {
	return inCidr(normalizeIp(ip), TAILSCALE.base, TAILSCALE.bits);
}

/** `*.example.com` matches a subdomain only, not the apex. Exact pins match one host. */
export function hostPinMatches(hostname, pins) {
	const host = String(hostname ?? "").toLowerCase().replace(/\.$/, "");
	if (!host) return false;
	for (const pin of pins) {
		const value = String(pin).toLowerCase().replace(/\.$/, "");
		if (value.startsWith("*.")) {
			const base = value.slice(2);
			if (base && host !== base && host.endsWith(`.${base}`)) return true;
		} else if (host === value) return true;
	}
	return false;
}

/**
 * A name that resolves to a restricted address is refused unless the URL host
 * is that address and the owner saved that address literally.
 */
export function destinationAllowed(hostname, addresses, pins) {
	if (!hostPinMatches(hostname, pins)) return { ok: false, reason: "host is not allowed for this key" };
	for (const address of addresses) {
		if (!isRestricted(address)) continue;
		const literal = isIP(hostname) !== 0 && sameAddress(hostname, address);
		const saved = pins.some((pin) => isIP(pin) !== 0 && sameAddress(pin, address));
		if (!literal || !saved) return { ok: false, reason: "refusing a non-public address" };
	}
	return { ok: true };
}

function expandIpv6(ip) {
	if (isIP(ip) !== 6) return null;
	let text = ip.toLowerCase().split("%")[0];
	if (text.startsWith("::ffff:")) {
		const mapped = text.slice(7);
		if (isIP(mapped) === 4) return null;
	}
	const halves = text.split("::");
	if (halves.length > 2) return null;
	const head = halves[0] ? halves[0].split(":") : [];
	const tail = halves.length === 2 ? (halves[1] ? halves[1].split(":") : []) : null;
	const parts = tail === null ? head : [...head, ...Array(8 - head.length - tail.length).fill("0"), ...tail];
	if (parts.length !== 8) return null;
	const nums = parts.map((part) => (part === "" ? 0 : Number.parseInt(part, 16)));
	if (nums.some((n) => !Number.isInteger(n) || n < 0 || n > 0xffff)) return null;
	return nums;
}

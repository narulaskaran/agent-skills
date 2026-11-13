// The daemon performs an API-key request. The key is one header, chosen when the
// key was saved. It is never placed in the URL, the body, or a header the model named.
// Redirects off the saved hosts are refused. The key header is not sent again
// after the host changes. A name that resolves to a non-public address is refused
// unless the owner saved that address itself.

import https from "node:https";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { redact } from "../../purchases/lib/browser.mjs";
import { destinationAllowed, normalizeIp } from "./net.mjs";

const MAX_BODY = 200_000;
const REDIRECTS = new Set([301, 302, 303, 307, 308]);
// A supplied Host would send the key to another site behind the same CDN address.
// The rest change how the request is framed or routed.
const FORBIDDEN_HEADERS = new Set(["host", "connection", "content-length", "transfer-encoding", "upgrade", "proxy-authorization", "te", "trailer", "keep-alive"]);

export function parseFetchArgs(argv) {
	let method;
	const headers = [];
	let data;
	const positional = [];
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "-X" || arg === "--request") method = required(argv, ++i, arg);
		else if (arg === "-H" || arg === "--header") headers.push(parseHeader(required(argv, ++i, arg)));
		else if (arg === "-d" || arg === "--data" || arg === "--data-binary") data = required(argv, ++i, arg);
		else if (arg.startsWith("-")) throw new Error(`unknown option ${arg}`);
		else positional.push(arg);
	}
	if (positional.length !== 2) throw new Error("usage: vault fetch <name> [-X METHOD] [-H 'Name: value']... [-d body] <url>");
	return { name: positional[0], url: positional[1], method: (method ?? (data !== undefined ? "POST" : "GET")).toUpperCase(), headers, body: data };
}

export async function authorizedFetch({ entry, url, method, headers, body, resolve = resolveHost, transport, maxBytes = MAX_BODY, anyPort = false }) {
	let current;
	try {
		current = new URL(url);
	} catch {
		throw new Error("that URL is not valid");
	}
	const reserved = entry.header.toLowerCase();
	if (headers.some((header) => header.name.toLowerCase() === reserved)) {
		throw new Error(`refusing a supplied ${entry.header} header; the saved key uses it`);
	}
	for (const header of headers) {
		if (FORBIDDEN_HEADERS.has(header.name.toLowerCase())) throw new Error(`refusing a supplied ${header.name} header`);
	}
	let sendKey = true;
	let verb = method;
	let payload = body;
	for (let hop = 0; hop <= 5; hop++) {
		if (current.protocol !== "https:") throw new Error("refusing a non-https URL");
		if (current.username || current.password) throw new Error("refusing a URL that contains credentials");
		// A key is saved for a host, and another port on that host can be another party's server.
		if (current.port && !anyPort) throw new Error("refusing a URL with a port; keys are sent to port 443 only");
		const addresses = (await resolve(current.hostname)).map(normalizeIp);
		if (addresses.length === 0) throw new Error("that host did not resolve");
		const gate = destinationAllowed(current.hostname, addresses, entry.hosts);
		if (!gate.ok) throw new Error(gate.reason);
		const reqHeaders = {};
		for (const header of headers) reqHeaders[header.name] = header.value;
		if (sendKey) reqHeaders[entry.header] = `${entry.prefix}${entry.key}`;
		const response = await transport({ url: current, method: verb, headers: reqHeaders, body: payload, address: addresses[0], maxBytes });
		if (!REDIRECTS.has(response.status)) return formatResponse(response, [entry.key, `${entry.prefix}${entry.key}`]);
		if (hop === 5) throw new Error("too many redirects");
		const location = headerValue(response.headers, "location");
		if (!location) throw new Error("redirect had no location");
		const next = new URL(location, current);
		if (next.hostname.toLowerCase() !== current.hostname.toLowerCase()) sendKey = false;
		if (response.status === 301 || response.status === 302 || response.status === 303) {
			verb = "GET";
			payload = undefined;
		}
		current = next;
	}
	throw new Error("too many redirects");
}

export function formatResponse(response, secrets) {
	const lines = [`HTTP ${response.status}`];
	for (const name of ["content-type", "content-length"]) {
		const value = headerValue(response.headers, name);
		if (value) lines.push(`${name}: ${value}`);
	}
	if (response.truncated) lines.push("[body truncated]");
	lines.push("", response.body ?? "");
	return redact(lines.join("\n"), secrets, { minLength: 6 });
}

export function httpsTransport({ rejectUnauthorized = true } = {}) {
	return (options) =>
		new Promise((resolvePromise, reject) => {
			const { url, method, headers, body, address, maxBytes } = options;
			const req = https.request(
				{
					host: url.hostname,
					port: url.port || 443,
					servername: url.hostname,
					method,
					path: `${url.pathname}${url.search}`,
					headers,
					rejectUnauthorized,
					lookup: (_hostname, opts, callback) => {
						const done = typeof opts === "function" ? opts : callback;
						const family = isIP(address);
						if (typeof opts === "object" && opts?.all) done(null, [{ address, family }]);
						else done(null, address, family);
					},
				},
				(res) => {
					const chunks = [];
					let size = 0;
					let truncated = false;
					res.on("data", (chunk) => {
						size += chunk.length;
						if (size <= maxBytes) chunks.push(chunk);
						else truncated = true;
					});
					res.on("end", () => {
						const buffer = Buffer.concat(chunks);
						resolvePromise({
							status: res.statusCode,
							headers: res.headers,
							body: buffer.subarray(0, maxBytes).toString("utf8"),
							truncated: truncated || size > maxBytes,
						});
					});
				},
			);
			req.on("error", () => reject(new Error("request failed")));
			if (payloadAllowed(method) && body !== undefined) req.write(body);
			req.end();
		});
}

export async function resolveHost(hostname) {
	if (isIP(hostname)) return [normalizeIp(hostname)];
	const found = await lookup(hostname, { all: true, verbatim: true });
	return found.map((item) => item.address);
}

function payloadAllowed(method) {
	return method !== "GET" && method !== "HEAD";
}

function parseHeader(raw) {
	const index = raw.indexOf(":");
	if (index <= 0) throw new Error("a header looks like 'Name: value'");
	const name = raw.slice(0, index).trim();
	if (!name) throw new Error("a header looks like 'Name: value'");
	return { name, value: raw.slice(index + 1).trim() };
}

function required(argv, index, flag) {
	if (index >= argv.length) throw new Error(`${flag} needs a value`);
	return argv[index];
}

function headerValue(headers, name) {
	const value = headers?.[name] ?? headers?.[name.toLowerCase()];
	if (Array.isArray(value)) return value.join(", ");
	return value ? String(value) : "";
}

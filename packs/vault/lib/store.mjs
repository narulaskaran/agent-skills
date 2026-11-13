// One JSON file, mode 0600, replaced atomically. No encryption: a key stored
// next to the file would not be a boundary. The directory mode is the boundary.

import { chmodSync, closeSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeSync } from "node:fs";
import { dirname, join } from "node:path";
import { checkName, normalizeHostPin, normalizeSite } from "./policy.mjs";
import { normalizeTotp, parseSecret } from "./totp.mjs";

export function assertVaultDir(dir) {
	const st = statSync(dir);
	if (!st.isDirectory()) throw new Error("vault path is not a directory");
	if (st.uid !== process.getuid()) throw new Error("vault directory is not owned by the vault user");
	if ((st.mode & 0o777) !== 0o700) throw new Error("vault directory must be mode 0700");
}

export function isMountPoint(dir) {
	try {
		const here = statSync(dir);
		const parent = statSync(dirname(dir));
		return here.dev !== parent.dev;
	} catch {
		return false;
	}
}

export function emptyStore() {
	return { version: 1, entries: [] };
}

export function loadStore(dir) {
	const path = storePath(dir);
	try {
		const st = lstatSync(path);
		if (st.isSymbolicLink() || !st.isFile()) throw new Error("vault store is not a regular file");
		if (st.uid !== process.getuid()) throw new Error("vault store is not owned by the vault user");
		if ((st.mode & 0o777) !== 0o600) throw new Error("vault store must be mode 0600");
		const parsed = JSON.parse(readFileSync(path, "utf8"));
		if (!parsed || !Array.isArray(parsed.entries)) throw new Error("vault store is unreadable");
		return parsed;
	} catch (error) {
		if (error?.code === "ENOENT") return emptyStore();
		throw error;
	}
}

export function saveStore(dir, data) {
	const path = storePath(dir);
	const tmp = `${path}.tmp-${process.pid}`;
	const payload = JSON.stringify({ ...data, version: 1, entries: data.entries }, null, 2);
	const fd = openSync(tmp, "w", 0o600);
	try {
		writeSync(fd, payload);
		fsyncSync(fd);
	} finally {
		closeSync(fd);
	}
	chmodSync(tmp, 0o600);
	renameSync(tmp, path);
	chmodSync(path, 0o600);
	const dirfd = openSync(dir, "r");
	try {
		fsyncSync(dirfd);
	} finally {
		closeSync(dirfd);
	}
	try {
		unlinkSync(tmp);
	} catch {
		// renamed away
	}
}

export function storePath(dir) {
	return join(dir, "store.json");
}

export function prepareVaultDir(dir) {
	mkdirSync(dir, { recursive: true, mode: 0o700 });
	chmodSync(dir, 0o700);
}

function stamp(entry) {
	return { ...entry, updatedAt: new Date().toISOString() };
}

export function publicEntry(entry) {
	const base = { name: entry.name, kind: entry.kind, updatedAt: entry.updatedAt };
	if (entry.kind === "login") {
		return { ...base, site: entry.site, username: entry.username, totp: Boolean(entry.totp) };
	}
	return {
		...base,
		hosts: entry.hosts,
		header: entry.header,
		prefix: entry.prefix,
		keyLast4: String(entry.key).slice(-4),
	};
}

export function upsertLogin(data, input) {
	const name = checkName(input.name);
	const site = normalizeSite(input.site);
	const username = String(input.username ?? "");
	if (!username || username.length > 200) throw new Error("username is missing");
	const existing = data.entries.find((entry) => entry.name === name);
	if (existing && existing.kind !== "login") throw new Error("that name is already used by an API key");
	let password = String(input.password ?? "");
	if (!password && existing) password = existing.password;
	if (password.length < 8) throw new Error("password must be at least 8 characters");
	let totp = existing?.totp ?? null;
	if (input.removeTotp) totp = null;
	if (input.totp) totp = normalizeTotp(parseSecret(input.totp));
	const entry = stamp({ name, kind: "login", site, username, password, totp });
	return replace(data, entry);
}

export function upsertKey(data, input) {
	const name = checkName(input.name);
	const existing = data.entries.find((entry) => entry.name === name);
	if (existing && existing.kind !== "api-key") throw new Error("that name is already used by a login");
	const hosts = String(input.hosts ?? "")
		.split(/[\s,]+/)
		.map((host) => host.trim())
		.filter(Boolean)
		.map(normalizeHostPin);
	if (hosts.length === 0) throw new Error("add at least one host");
	const header = String(input.header ?? "").trim() || "Authorization";
	if (!/^[A-Za-z0-9-]{1,64}$/.test(header)) throw new Error("header name is not usable");
	const prefix = input.prefix === undefined || input.prefix === null ? "Bearer " : String(input.prefix);
	if (prefix.length > 40) throw new Error("header prefix is too long");
	let key = String(input.key ?? "");
	if (!key && existing) key = existing.key;
	if (key.length < 8) throw new Error("API key must be at least 8 characters");
	const entry = stamp({ name, kind: "api-key", hosts: [...new Set(hosts)], header, prefix, key });
	return replace(data, entry);
}

export function deleteEntry(data, name) {
	const checked = checkName(name);
	if (!data.entries.some((entry) => entry.name === checked)) throw new Error("no entry with that name");
	return { ...data, version: 1, entries: data.entries.filter((entry) => entry.name !== checked) };
}

export function getEntry(data, name) {
	return data.entries.find((entry) => entry.name === name) ?? null;
}

function replace(data, entry) {
	const entries = data.entries.filter((item) => item.name !== entry.name);
	entries.push(entry);
	entries.sort((a, b) => a.name.localeCompare(b.name));
	return { ...data, version: 1, entries };
}

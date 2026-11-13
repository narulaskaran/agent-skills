// Write-only portal. List, add, replace, delete. A stored password or TOTP seed
// is never put back into a response. API keys show their last four characters.

import { randomBytes, timingSafeEqual } from "node:crypto";
import http from "node:http";
import { connectionAllowed, inTailscale } from "./net.mjs";
import { publicEntry } from "./store.mjs";

const MAX_BODY = 64 * 1024;

const PAGE = `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Vault</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; background: #101114; color: #eceae6; font: 17px/1.45 system-ui, sans-serif; }
  main { max-width: 28rem; margin: 0 auto; padding: 1.25rem 1rem 3rem; }
  h1 { font-size: 1.45rem; font-weight: 620; letter-spacing: -0.03em; margin: 0 0 0.25rem; }
  a { color: #b7c9ff; }
  p, li { color: #c8c4bc; }
  .muted { color: #9b978f; font-size: 0.92rem; }
  .card { background: #1b1e27; border-radius: 14px; padding: 0.95rem 1rem; margin: 0.7rem 0; }
  .card b { font-weight: 600; }
  label { display: block; margin: 0.85rem 0; }
  label span { display: block; margin-bottom: 0.3rem; color: #b8b4ac; font-size: 0.92rem; }
  input, textarea { width: 100%; box-sizing: border-box; font: inherit; color: inherit; background: #0e1014; border: 1px solid #343844; border-radius: 12px; padding: 0.75rem 0.8rem; }
  textarea { min-height: 5.5rem; resize: vertical; }
  .actions { display: flex; gap: 0.6rem; flex-wrap: wrap; margin-top: 1rem; }
  button, .btn { font: inherit; border: 0; border-radius: 999px; padding: 0.75rem 1.15rem; background: #f2f0ea; color: #16181d; text-decoration: none; display: inline-block; }
  button.quiet, a.quiet { background: transparent; color: #ffb4ab; padding-left: 0; }
  .error { background: #3a2426; color: #ffd7d4; border-radius: 12px; padding: 0.7rem 0.85rem; }
  form.check label { display: flex; gap: 0.55rem; align-items: center; }
  form.check input { width: auto; }
</style>
<main>
CONTENT
</main>
</html>`;

export function hostHeaderAllowed(header, { bind, port, names }) {
	if (!header || /[\s,]/.test(header)) return false;
	const parsed = splitHost(header);
	if (!parsed) return false;
	if (parsed.port && String(parsed.port) !== String(port)) return false;
	const name = parsed.name.toLowerCase();
	if (name === String(bind).toLowerCase()) return true;
	return names.some((item) => item.toLowerCase() === name);
}

export function originMatchesHost(origin, host) {
	if (!origin || !host || origin === "null") return false;
	try {
		return new URL(origin).host.toLowerCase() === String(host).toLowerCase();
	} catch {
		return false;
	}
}

export function chooseBind(configured, addresses) {
	const bind = String(configured ?? "").trim();
	if (bind) {
		if (bind === "0.0.0.0" || bind === "::" || bind === "*") throw new Error("NANO_VAULT_BIND must name one address");
		return bind;
	}
	return addresses.find((address) => inTailscale(address)) ?? null;
}

export function createPortal(options) {
	const names = options.hosts ?? [];
	return http.createServer((req, res) => {
		void handle(req, res, { ...options, hosts: names }).catch((error) => {
			if (!res.headersSent) res.writeHead(error?.status === 413 ? 413 : 500, { "content-type": "text/plain", "cache-control": "no-store" });
			res.end("error");
		});
	});
}

async function handle(req, res, options) {
	const remote = req.socket?.remoteAddress ?? "";
	const own = typeof options.ownAddresses === "function" ? options.ownAddresses() : options.ownAddresses;
	if (!connectionAllowed({ remoteAddress: remote, allow: options.allow, ownAddresses: own, insecureLocal: options.insecureLocal })) {
		return bare(res, 403);
	}
	const host = req.headers.host ?? "";
	if (!hostHeaderAllowed(host, { bind: options.bind, port: options.port, names: options.hosts })) return bare(res, 403);
	const url = new URL(req.url || "/", "http://vault");
	if (req.method === "GET" || req.method === "HEAD") return send(res, await pageFor(url, options, ensureCsrf(req, res)), req.method === "HEAD");
	if (req.method !== "POST") return bare(res, 405);
	if (!originMatchesHost(req.headers.origin, host)) return bare(res, 403);
	const token = csrfCookie(req);
	const form = await readForm(req);
	if (!token || !safeEqual(token, form.csrf)) return bare(res, 403);
	const outcome = await post(url.pathname, form, options);
	if (outcome.error) return send(res, layout(`<p class="error">${esc(outcome.error)}</p>${outcome.form}`), false, token);
	if (outcome.event) options.log?.(outcome.event);
	return send(res, await pageFor(new URL("/", "http://vault"), options, token), false, token);
}

function ensureCsrf(req, res) {
	const existing = csrfCookie(req);
	if (/^[a-f0-9]{64}$/.test(existing)) return existing;
	const token = randomBytes(32).toString("hex");
	res.setHeader("set-cookie", `vault_csrf=${token}; HttpOnly; SameSite=Strict; Path=/`);
	return token;
}

function csrfCookie(req) {
	const header = req.headers.cookie ?? "";
	for (const part of header.split(";")) {
		const [name, ...rest] = part.trim().split("=");
		if (name === "vault_csrf") return decodeURIComponent(rest.join("="));
	}
	return "";
}

async function pageFor(url, options, token) {
	const entries = options.read().entries.map(publicEntry);
	if (url.pathname === "/") return layout(listPage(entries));
	if (url.pathname === "/login/new") return layout(loginForm(token, { site: url.searchParams.get("site") ?? "" }));
	if (url.pathname === "/key/new") return layout(keyForm(token, {}));
	if (url.pathname === "/edit") return layout(editPage(entries, url.searchParams.get("name") ?? "", token));
	if (url.pathname === "/delete") return layout(deletePage(entries, url.searchParams.get("name") ?? "", token));
	return layout(`<p class="error">That page does not exist.</p><p><a href="/">Back</a></p>`);
}

async function post(pathname, form, options) {
	try {
		if (pathname === "/login/new" || pathname === "/edit") {
			const kind = pathname === "/edit" ? "updated" : "added";
			options.write((data) => options.saveLogin(data, form));
			return { event: `login '${form.name}' ${kind}` };
		}
		if (pathname === "/key/new" || pathname === "/key/edit") {
			const kind = pathname === "/key/edit" ? "updated" : "added";
			options.write((data) => options.saveKey(data, form));
			return { event: `api key '${form.name}' ${kind}` };
		}
		if (pathname === "/delete") {
			const entry = options.read().entries.find((item) => item.name === form.name);
			options.write((data) => options.remove(data, form.name));
			const label = entry?.kind === "api-key" ? "api key" : "login";
			return { event: `${label} '${form.name}' deleted` };
		}
		return { error: "That page does not exist.", form: "" };
	} catch (error) {
		const message = error?.message ?? "could not save";
		const token = form.csrf;
		const rebuilt = pathname.includes("key") ? keyForm(token, { ...form, key: "" }) : loginForm(token, { ...form, password: "", totp: "" });
		return { error: message, form: rebuilt };
	}
}

function listPage(entries) {
	const rows = entries.length === 0 ? `<p class="muted">Nothing saved yet.</p>` : entries.map(row).join("");
	return `<h1>Vault</h1>
<p class="muted">Write-only. A password or one-time-code seed is never shown again. An API key shows its last four characters.</p>
${rows}
<div class="actions"><a class="btn" href="/login/new">Add login</a><a class="btn" href="/key/new">Add API key</a></div>`;
}

function row(entry) {
	const where = entry.kind === "login" ? esc(entry.site) : esc((entry.hosts ?? []).join(", "));
	const extra = entry.kind === "login"
		? `${esc(entry.username)}${entry.totp ? " · 2FA saved" : ""}`
		: `key •••• ${esc(entry.keyLast4)} · ${esc(entry.header)}`;
	return `<article class="card"><b>${esc(entry.name)}</b> <span class="muted">${esc(entry.kind)}</span>
<p>${where}</p><p>${extra}</p>
<p class="muted">Updated ${esc(entry.updatedAt ?? "")}</p>
<p><a href="/edit?name=${encodeURIComponent(entry.name)}">Edit</a> · <a href="/delete?name=${encodeURIComponent(entry.name)}">Delete</a></p></article>`;
}

function editPage(entries, name, token) {
	const entry = entries.find((item) => item.name === name);
	if (!entry) return `<p class="error">No entry named ${esc(name)}.</p><p><a href="/">Back</a></p>`;
	if (entry.kind === "api-key") {
		return keyForm(token, { ...entry, hosts: (entry.hosts ?? []).join("\n"), key: "" }, { action: "/key/edit", editing: true });
	}
	return loginForm(token, { ...entry, password: "", totp: "" }, { action: "/edit", editing: true });
}

function deletePage(entries, name, token) {
	const entry = entries.find((item) => item.name === name);
	if (!entry) return `<p class="error">No entry named ${esc(name)}.</p>`;
	return `<h1>Delete ${esc(entry.name)}</h1>
<p>This removes the ${esc(entry.kind)} and cannot be undone.</p>
<form method="post" action="/delete">
<input type="hidden" name="csrf" value="${esc(token)}">
<input type="hidden" name="name" value="${esc(entry.name)}">
<div class="actions"><button type="submit">Delete</button><a class="quiet" href="/">Cancel</a></div>
</form>`;
}

function loginForm(token, values, { action = "/login/new", editing = false } = {}) {
	return `<h1>${editing ? "Edit login" : "Add login"}</h1>
<p class="muted">${editing ? "Leave a secret blank to keep the saved one." : "The password and the one-time-code seed are not shown after you save."}</p>
<form method="post" action="${action}" autocomplete="off">
<input type="hidden" name="csrf" value="${esc(token)}">
${field("Name", "name", values.name, editing ? "text" : "text", editing)}
${field("Site", "site", values.site)}
${field("Username", "username", values.username)}
${field("Password", "password", "", "password")}
${field("One-time code seed or otpauth URI", "totp", "", "password")}
${editing ? `<label class="check"><input type="checkbox" name="removeTotp" value="yes"> Remove saved 2FA</label>` : ""}
<div class="actions"><button type="submit">Save</button><a class="quiet" href="/">Cancel</a></div>
</form>`;
}

function keyForm(token, values, { action = "/key/new", editing = false } = {}) {
	const last4 = editing && values.keyLast4 ? `<p class="muted">Current key ends in ${esc(values.keyLast4)}. Leave the field blank to keep it.</p>` : "";
	return `<h1>${editing ? "Edit API key" : "Add API key"}</h1>
${last4}
<form method="post" action="${action}" autocomplete="off">
<input type="hidden" name="csrf" value="${esc(token)}">
${field("Name", "name", values.name, "text", editing)}
<label><span>Hosts, one per line. Start a line with *. to include subdomains.</span><textarea name="hosts">${esc(values.hosts ?? "")}</textarea></label>
${field("Header name", "header", values.header || "Authorization")}
${field("Header prefix", "prefix", values.prefix === undefined ? "Bearer " : values.prefix)}
${field("Key", "key", "", "password")}
<div class="actions"><button type="submit">Save</button><a class="quiet" href="/">Cancel</a></div>
</form>`;
}

function field(label, name, value, type = "text", locked = false) {
	const readonly = locked ? " readonly" : "";
	return `<label><span>${esc(label)}</span><input name="${esc(name)}" type="${type}" autocomplete="off" value="${esc(value ?? "")}"${readonly}></label>`;
}

function layout(content) {
	return PAGE.replace("CONTENT", content);
}

function send(res, html, head, token) {
	const headers = {
		"content-type": "text/html; charset=utf-8",
		"content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'",
		"cache-control": "no-store",
		"referrer-policy": "no-referrer",
		"x-content-type-options": "nosniff",
	};
	if (token && !res.getHeader("set-cookie")) headers["set-cookie"] = `vault_csrf=${token}; HttpOnly; SameSite=Strict; Path=/`;
	res.writeHead(200, headers);
	res.end(head ? "" : html);
}

function bare(res, status) {
	res.writeHead(status, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
	res.end(status === 403 ? "forbidden" : "error");
}

function readForm(req) {
	return new Promise((resolve, reject) => {
		const chunks = [];
		let size = 0;
		req.on("data", (chunk) => {
			size += chunk.length;
			if (size > MAX_BODY) {
				req.destroy();
				reject(Object.assign(new Error("body too large"), { status: 413 }));
				return;
			}
			chunks.push(chunk);
		});
		req.on("end", () => {
			const params = new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
			resolve(Object.fromEntries(params));
		});
		req.on("error", reject);
	});
}

function safeEqual(a, b) {
	const left = Buffer.from(String(a));
	const right = Buffer.from(String(b ?? ""));
	if (left.length === 0 || left.length !== right.length) return false;
	return timingSafeEqual(left, right);
}

function splitHost(host) {
	if (host.startsWith("[")) {
		const end = host.indexOf("]");
		if (end < 0) return null;
		const name = host.slice(1, end);
		const rest = host.slice(end + 1);
		if (rest && !rest.startsWith(":")) return null;
		return { name, port: rest.slice(1) };
	}
	const index = host.lastIndexOf(":");
	if (index === -1) return { name: host, port: "" };
	if (host.indexOf(":") !== index) return null;
	return { name: host.slice(0, index), port: host.slice(index + 1) };
}

function esc(value) {
	return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

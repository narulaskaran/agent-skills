// Write-only portal. List, add, replace, delete. A stored password or TOTP seed
// is never put back into a response. API keys show their last four characters.

import { randomBytes, timingSafeEqual } from "node:crypto";
import http from "node:http";
import { connectionAllowed, inTailscale } from "./net.mjs";
import { check, csrf, esc, field, hidden, notice, providerPage, providerPost, sectionFor, sectionTitle, settingsNav } from "./provider-pages.mjs";
import { publicEntry } from "./store.mjs";

const MAX_BODY = 64 * 1024;

const STYLE = `
  :root { color-scheme: dark; --bg: #0d0f13; --bar: #11141a; --panel: #161920; --line: #2a2f3b; --line-strong: #3d4454; --text: #edebe6; --text-2: #cbc7bf; --muted: #a39f97; --link: #a9c0ff; --focus: #a9c0ff; --login: #7fdcc7; --key: #f2c27a; --ok: #8fe0b0; --bad: #ffb4ab; --radius: 14px; }
  * { box-sizing: border-box; }
  html { -webkit-text-size-adjust: 100%; scroll-padding-bottom: 6rem; }
  body { margin: 0; background: var(--bg); color: var(--text); font: 16px/1.55 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  a { color: var(--link); text-underline-offset: 0.18em; }
  :focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
  .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
  .skip { position: absolute; left: 0.75rem; top: -4rem; background: var(--text); color: #15171c; padding: 0.6rem 1rem; border-radius: 10px; z-index: 5; }
  .skip:focus { top: 0.75rem; }
  .bar { background: var(--bar); border-bottom: 1px solid var(--line); }
  .bar-in { max-width: 62rem; margin: 0 auto; padding: 0.6rem 1rem; display: flex; align-items: center; flex-wrap: wrap; gap: 0.35rem 1.25rem; }
  .brand { font-weight: 650; font-size: 1.1rem; letter-spacing: -0.02em; color: var(--text); text-decoration: none; padding: 0.4rem 0; }
  nav { display: flex; flex-wrap: wrap; gap: 0.25rem; margin-left: auto; }
  nav a { display: inline-flex; align-items: center; justify-content: center; min-height: 44px; padding: 0.4rem 1rem; border-radius: 999px; color: var(--text-2); text-decoration: none; font-weight: 500; }
  nav a:hover { background: #1c202a; color: var(--text); }
  nav a[aria-current="page"] { background: #2b3141; color: var(--text); font-weight: 650; box-shadow: inset 0 -2px 0 var(--link); }
  main { max-width: 62rem; margin: 0 auto; padding: 1.75rem 1rem 4rem; }
  .narrow { max-width: 40rem; }
  h1 { font-size: 1.7rem; line-height: 1.2; font-weight: 650; letter-spacing: -0.03em; margin: 0 0 0.4rem; }
  h2 { font-size: 1.15rem; font-weight: 620; letter-spacing: -0.015em; margin: 0 0 0.6rem; }
  h3 { font-size: 1.02rem; font-weight: 620; margin: 0; overflow-wrap: anywhere; }
  p { margin: 0 0 0.8rem; color: var(--text-2); }
  .page-head { margin-bottom: 1.5rem; }
  .lede { color: var(--muted); max-width: 42rem; margin: 0; }
  main > section + section { margin-top: 2rem; }
  .section-head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 0.5rem 1rem; margin-bottom: 0.4rem; }
  .section-head h2 { margin: 0; }
  .hint { margin: 0.35rem 0 0; color: var(--muted); font-size: 0.9rem; line-height: 1.45; max-width: 44rem; }
  .section-note { margin: 0 0 0.9rem; color: var(--muted); font-size: 0.92rem; }
  .cards, .tiles, .jobs { display: grid; gap: 0.85rem; grid-template-columns: repeat(auto-fill, minmax(min(100%, 19rem), 1fr)); align-items: start; }
  .jobs { grid-template-columns: repeat(auto-fit, minmax(min(100%, 21rem), 1fr)); }
  .card { background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius); padding: 1rem 1.1rem; min-width: 0; }
  .entry.login { border-top: 3px solid var(--login); }
  .entry.key { border-top: 3px solid var(--key); }
  .card-head { display: flex; flex-wrap: wrap; align-items: flex-start; justify-content: space-between; gap: 0.35rem 0.75rem; margin-bottom: 0.5rem; }
  .card-head h2 { margin: 0; font-size: 1.05rem; }
  .card p { margin: 0 0 0.35rem; overflow-wrap: anywhere; }
  .card p.hint { margin: 0.35rem 0 0; }
  .card .where { color: var(--text); font-weight: 500; }
  .card-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 0.25rem 0.75rem; margin-top: 0.6rem; }
  .card-actions form { margin: 0; }
  .act { display: inline-flex; align-items: center; min-height: 44px; padding: 0 0.35rem; }
  .act.warn { color: var(--bad); }
  .badge { display: inline-flex; align-items: center; gap: 0.4rem; padding: 0.12rem 0.65rem; border: 1px solid var(--line-strong); border-radius: 999px; font-size: 0.78rem; font-weight: 600; line-height: 1.5; color: var(--text-2); max-width: 100%; overflow-wrap: anywhere; }
  .badge::before { content: ""; width: 0.5rem; height: 0.5rem; border-radius: 50%; background: currentColor; flex: none; }
  .badge.login { color: var(--login); border-color: #2d5b50; }
  .badge.key { color: var(--key); border-color: #655028; }
  .badge.on { color: var(--ok); border-color: #2d5f43; }
  .badge.off { color: var(--muted); }
  .badge.local { color: var(--ok); border-color: #2d5f43; }
  .badge.hosted { color: var(--text-2); }
  .facts { list-style: none; margin: 0 0 0.35rem; padding: 0; display: flex; flex-wrap: wrap; gap: 0.25rem 0.75rem; color: var(--text-2); }
  .facts li { overflow-wrap: anywhere; }
  .facts .ok { color: var(--ok); }
  .mono, .url { font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace; font-size: 0.86rem; }
  .url { color: var(--text-2); overflow-wrap: anywhere; }
  .meta { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 0.25rem 0.9rem; margin: 0.6rem 0 0; font-size: 0.92rem; }
  .meta dt { color: var(--muted); }
  .meta dd { margin: 0; overflow-wrap: anywhere; }
  .chip { display: inline-block; padding: 0 0.5rem; margin: 0 0.15rem 0.15rem 0; border-radius: 6px; background: #232836; font-size: 0.82rem; }
  .empty { border: 1px dashed var(--line-strong); border-radius: var(--radius); padding: 1rem 1.1rem; color: var(--muted); }
  .empty p { color: var(--muted); }
  .empty .btn { margin-top: 0.4rem; }
  .tile { display: block; padding: 0.9rem 1rem; min-height: 44px; background: var(--panel); border: 1px solid var(--line); border-radius: 12px; color: var(--text); text-decoration: none; }
  .tile b { display: block; font-weight: 620; }
  .tile span { display: block; color: var(--muted); font-size: 0.88rem; margin-top: 0.15rem; }
  .tile:hover { border-color: var(--link); }
  .seg { display: grid; grid-template-columns: 1fr 1fr; gap: 0.3rem; padding: 0.3rem; margin: 0 0 1.5rem; background: var(--panel); border: 1px solid var(--line); border-radius: 999px; }
  .seg a { display: flex; align-items: center; justify-content: center; min-height: 44px; padding: 0 0.5rem; border-radius: 999px; color: var(--text-2); text-decoration: none; font-weight: 550; text-align: center; }
  .seg a[aria-current="page"] { background: #2b3141; color: var(--text); font-weight: 650; }
  .panel { margin-bottom: 1rem; }
  .panel > h2, fieldset legend { font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); font-weight: 650; margin: 0 0 0.8rem; padding: 0; }
  fieldset { border: 0; margin: 0; padding: 0; min-width: 0; }
  legend { float: left; width: 100%; } legend + * { clear: both; }
  .field { margin: 0 0 1rem; }
  .field label:not(.check) { display: block; margin-bottom: 0.35rem; font-weight: 550; font-size: 0.95rem; }
  input, select, textarea { display: block; width: 100%; min-height: 46px; font: inherit; font-size: 1rem; color: var(--text); background: #0b0d11; border: 1px solid var(--line-strong); border-radius: 12px; padding: 0.65rem 0.85rem; }
  input::placeholder { color: #6f6c66; }
  input:focus, select:focus, textarea:focus { border-color: var(--focus); }
  input[readonly] { color: var(--muted); background: #12151b; }
  textarea { min-height: 6rem; resize: vertical; }
  textarea.mono { min-height: 12rem; line-height: 1.45; }
  .field:has(> .check) { margin-bottom: 0.15rem; }
  .check { display: flex; align-items: flex-start; gap: 0.7rem; min-height: 44px; padding: 0.55rem 0; cursor: pointer; }
  input[type="checkbox"] { width: 1.3rem; height: 1.3rem; min-height: 0; margin: 0.1rem 0 0; padding: 0; flex: none; accent-color: var(--link); }
  .field .check + .hint { margin-top: -0.2rem; padding-left: 2rem; }
  details { margin-top: 0.9rem; border-top: 1px solid var(--line); }
  summary { display: flex; align-items: center; gap: 0.6rem; min-height: 44px; cursor: pointer; font-weight: 550; color: var(--text-2); list-style: none; }
  summary::-webkit-details-marker { display: none; }
  summary::before { content: ""; width: 0.45rem; height: 0.45rem; margin: 0 0.15rem; border-right: 2px solid currentColor; border-bottom: 2px solid currentColor; transform: rotate(-45deg); flex: none; }
  details[open] > summary::before { transform: rotate(45deg); }
  summary:hover { color: var(--text); }
  details > .hint:first-of-type { margin-bottom: 0.9rem; }
  .sub { margin-top: 0.4rem; padding-top: 0.9rem; border-top: 1px dashed var(--line); }
  .sub h3 { margin-bottom: 0.2rem; }
  .actions { display: flex; flex-wrap: wrap; align-items: center; gap: 0.6rem; margin-top: 1.25rem; }
  button, .btn { display: inline-flex; align-items: center; justify-content: center; min-height: 44px; padding: 0.6rem 1.3rem; font: inherit; font-weight: 620; line-height: 1.2; text-align: center; color: #15171c; background: #f2f0ea; border: 1px solid transparent; border-radius: 999px; text-decoration: none; cursor: pointer; }
  button:hover, .btn:hover { background: #fff; }
  button.ghost, .btn.ghost { color: var(--text); background: transparent; border-color: var(--line-strong); }
  button.ghost:hover, .btn.ghost:hover { background: #1c202a; }
  button.danger { color: var(--bad); background: transparent; border-color: #6d3d42; }
  button.danger:hover { background: #2c1a1d; }
  button.danger.solid { color: #2e0f0c; background: var(--bad); border-color: transparent; }
  .danger-zone { margin-top: 2rem; padding-top: 1.25rem; border-top: 1px solid var(--line); }
  .savebar { position: sticky; bottom: 0; margin: 1.25rem -1rem 0; padding: 0.75rem 1rem; background: rgba(13, 15, 19, 0.94); border-top: 1px solid var(--line); z-index: 2; }
  .notice { margin: 0 0 1.25rem; padding: 0.8rem 1rem; border: 1px solid; border-radius: 12px; overflow-wrap: anywhere; }
  .notice.success { color: #d5f3e1; background: #13291d; border-color: #2d6445; }
  .notice.error { color: #ffdad7; background: #351c1f; border-color: #7b3b41; }
  @media (prefers-reduced-motion: no-preference) { button, .btn, nav a, .tile, input, select, textarea { transition: background-color 0.15s, border-color 0.15s, color 0.15s; } }
  @media (max-width: 40rem) {
    .bar-in { padding: 0.4rem 0.75rem 0.6rem; }
    nav { width: 100%; margin-left: 0; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); }
    nav a { padding: 0.35rem 0.3rem; font-size: 0.92rem; text-align: center; line-height: 1.2; }
    main { padding: 1.25rem 0.85rem 3rem; }
    h1 { font-size: 1.45rem; }
    .actions > button, .actions > .btn { flex: 1 1 100%; }
    .savebar { margin-left: -0.85rem; margin-right: -0.85rem; padding-left: 0.85rem; padding-right: 0.85rem; }
    .section-head .btn { flex: 1 1 100%; }
  }
`;

function page({ title, nav, content }) {
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · Vault</title>
<style>${STYLE}</style>
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<header class="bar"><div class="bar-in"><a class="brand" href="/">Vault</a>${nav}</div></header>
<main id="main">
${content}
</main>
</body>
</html>`;
}

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

// Explicit interfaces only; retain the tailnet-only default.
export function chooseBinds(configured, addresses) {
	const value = String(configured ?? "").trim();
	if (!value) return [chooseBind("", addresses)].filter(Boolean);
	return [...new Set(value.split(",").map((item) => {
		if (!item.trim()) throw new Error("NANO_VAULT_BIND contains an empty address");
		return chooseBind(item, addresses);
	}))];
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
	const outcome = await providerPost(url.pathname, form, options) ?? await post(url.pathname, form, options);
	if (outcome.content) return send(res, layout(outcome.content, url.pathname), false, token);
	if (outcome.error) return send(res, layout(`${notice("error", outcome.error)}${outcome.form}`, url.pathname), false, token);
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
	const settings = await providerPage(url, options, token);
	if (settings !== null) return layout(settings, url.pathname);
	const entries = options.read().entries.map(publicEntry);
	const name = url.searchParams.get("name") ?? "";
	const at = (content) => layout(content, url.pathname);
	if (url.pathname === "/") return at(listPage(entries));
	if (url.pathname === "/login/new") return at(loginForm(token, { site: url.searchParams.get("site") ?? "" }));
	if (url.pathname === "/key/new") return at(keyForm(token, {}));
	if (url.pathname === "/edit") return at(editPage(entries, name, token));
	if (url.pathname === "/delete") return at(deletePage(entries, name, token));
	return at(`${notice("error", "That page does not exist.")}<p><a href="/">Back to credentials</a></p>`);
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
		const editing = pathname === "/edit" || pathname === "/key/edit";
		const rebuilt = pathname.includes("key")
			? keyForm(token, { ...form, key: "" }, { action: pathname, editing })
			: loginForm(token, { ...form, password: "", totp: "" }, { action: pathname, editing });
		return { error: message, form: rebuilt };
	}
}

const when = (iso) => String(iso ?? "").slice(0, 10);

function section(id, title, note, add, items, empty) {
	return `<section aria-labelledby="${id}-h">
<div class="section-head"><h2 id="${id}-h">${title}</h2><a class="btn ghost" href="${add.href}">${add.label}</a></div>
<p class="section-note">${note}</p>
${items.length ? `<div class="cards">${items.join("")}</div>` : `<div class="empty"><p>${empty}</p></div>`}
</section>`;
}

function listPage(entries) {
	const logins = entries.filter((entry) => entry.kind === "login");
	const keys = entries.filter((entry) => entry.kind !== "login");
	return `<header class="page-head"><h1>Credentials</h1>
<p class="lede">Write-only. A password or one-time-code seed is never shown again. An API key shows its last four characters.</p></header>
${section("logins", "Website logins", "A username and password (with optional 2FA) Nano uses to sign in to a website in the browser, such as a DeepSeek account.", { href: "/login/new", label: "Add website login" }, logins.map(row), "No website logins yet.")}
${section("keys", "API keys", `A secret sent to a service as a request header. To use a model provider such as DeepSeek for chat, add its key under <a href="/providers">Providers</a> instead.`, { href: "/key/new", label: "Add API key" }, keys.map(row), "No API keys yet.")}`;
}

function row(entry) {
	const login = entry.kind === "login";
	const where = login ? esc(entry.site) : esc((entry.hosts ?? []).join(", "));
	const facts = login
		? `<li>${esc(entry.username)}</li>${entry.totp ? `<li class="ok">2FA saved</li>` : ""}`
		: `<li class="mono">key •••• ${esc(entry.keyLast4)}</li><li>${esc(entry.header)}</li>`;
	const href = encodeURIComponent(entry.name);
	return `<article class="card entry ${login ? "login" : "key"}">
<div class="card-head"><h3>${esc(entry.name)}</h3><span class="badge ${login ? "login" : "key"}">${login ? "Website login" : "API key"}</span></div>
<p class="where">${where}</p>
<ul class="facts">${facts}</ul>
<p class="hint">Updated ${esc(when(entry.updatedAt))}</p>
<div class="card-actions"><a class="act" href="/edit?name=${href}">Edit<span class="sr"> ${esc(entry.name)}</span></a><a class="act warn" href="/delete?name=${href}">Delete<span class="sr"> ${esc(entry.name)}</span></a></div></article>`;
}

function editPage(entries, name, token) {
	const entry = entries.find((item) => item.name === name);
	if (!entry) return `${notice("error", `No entry named ${name}.`)}<p><a href="/">Back to credentials</a></p>`;
	if (entry.kind === "api-key") {
		return keyForm(token, { ...entry, hosts: (entry.hosts ?? []).join("\n"), key: "" }, { action: "/key/edit", editing: true });
	}
	return loginForm(token, { ...entry, password: "", totp: "" }, { action: "/edit", editing: true });
}

function deletePage(entries, name, token) {
	const entry = entries.find((item) => item.name === name);
	if (!entry) return `${notice("error", `No entry named ${name}.`)}<p><a href="/">Back to credentials</a></p>`;
	return `<header class="page-head"><h1>Delete ${esc(entry.name)}</h1>
<p class="lede">This removes the ${esc(entry.kind)} and cannot be undone.</p></header>
<div class="narrow"><form method="post" action="/delete">
${csrf(token)}
${hidden("name", entry.name)}
<div class="actions"><button class="danger solid" type="submit">Delete</button><a class="btn ghost" href="/">Cancel</a></div>
</form></div>`;
}

// Website login and API key are different things; the switch makes the choice explicit.
function kindSwitch(active) {
	const item = (id, href, label) => `<a href="${href}"${id === active ? ' aria-current="page"' : ""}>${label}</a>`;
	return `<div class="seg" role="group" aria-label="Credential type">${item("login", "/login/new", "Website login")}${item("key", "/key/new", "API key")}</div>`;
}

function loginForm(token, values, { action = "/login/new", editing = false } = {}) {
	const lede = editing
		? "Leave a secret blank to keep the saved one."
		: "For a website Nano signs in to through the browser, such as a DeepSeek account. The password and the one-time-code seed are not shown after you save.";
	return `<header class="page-head"><h1>${editing ? "Edit website login" : "Add website login"}</h1><p class="lede">${lede}</p></header>
<div class="narrow">${editing ? "" : kindSwitch("login")}
<form method="post" action="${action}" autocomplete="off">
${csrf(token)}
<section class="card panel"><h2>Account</h2>
${field("Name", "name", values.name, { locked: editing, placeholder: "deepseek-web", hint: editing ? "" : "A short label you and Nano use to find this login." })}
${field("Site", "site", values.site, { placeholder: "platform.deepseek.com", hint: "Use the exact hostname where you sign in. Nano only signs in on this site." })}
${field("Username", "username", values.username, { hint: "Usually your email address." })}
${field("Password", "password", "", { type: "password", autocomplete: "new-password" })}
</section>
<section class="card panel"><h2>Two-step verification</h2>
${field("One-time code seed or otpauth URI", "totp", "", { type: "password", autocomplete: "new-password", hint: "Optional. Only needed if the account uses an authenticator app." })}
${editing ? check("Remove saved 2FA", "removeTotp", false) : ""}
</section>
<div class="actions"><button type="submit">Save</button><a class="btn ghost" href="/">Cancel</a></div>
</form></div>`;
}

function keyForm(token, values, { action = "/key/new", editing = false } = {}) {
	const last4 = editing && values.keyLast4 ? `Current key ends in ${values.keyLast4}. Leave the field blank to keep it.` : "";
	const lede = editing
		? "Edit where this key is sent and how it is attached."
		: "A secret Nano attaches to requests for the hosts you list. To use a model provider for chat, add its key under Providers instead.";
	const customHeader = (values.header !== undefined && values.header !== "Authorization") || (values.prefix !== undefined && values.prefix !== "Bearer ");
	return `<header class="page-head"><h1>${editing ? "Edit API key" : "Add API key"}</h1><p class="lede">${lede}</p></header>
<div class="narrow">${editing ? "" : kindSwitch("key")}
<form method="post" action="${action}" autocomplete="off">
${csrf(token)}
<section class="card panel"><h2>Key</h2>
${field("Name", "name", values.name, { locked: editing, placeholder: "example-api" })}
<div class="field"><label for="f-hosts">Hosts</label><textarea id="f-hosts" name="hosts" aria-describedby="h-hosts" autocapitalize="none" spellcheck="false" placeholder="api.example.com">${esc(values.hosts ?? "")}</textarea><p class="hint" id="h-hosts">One per line. Start a line with *. to include subdomains.</p></div>
${field("Key", "key", "", { type: "password", autocomplete: "new-password", hint: last4 })}
</section>
<details${customHeader ? " open" : ""}><summary>Advanced: how the key is sent</summary>
${field("Header name", "header", values.header || "Authorization")}
${field("Header prefix", "prefix", values.prefix === undefined ? "Bearer " : values.prefix, { hint: "Added before the key, for example Bearer followed by a space." })}
</details>
<div class="actions"><button type="submit">Save</button><a class="btn ghost" href="/">Cancel</a></div>
</form></div>`;
}

function layout(content, pathname = "/") {
	const active = sectionFor(pathname);
	return page({ title: sectionTitle(active), nav: settingsNav(active), content });
}

function send(res, html, head, token) {
	const headers = {
		"content-type": "text/html; charset=utf-8",
		"content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'",
		"cache-control": "no-store",
		// Preserve Origin on same-origin form POSTs; never send referrers off-site.
		"referrer-policy": "same-origin",
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

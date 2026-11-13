// `browser`: a headless Chromium for the agent's shell.
//
// The first command starts a small daemon that owns one persistent browser profile, so
// element refs from `snapshot` stay valid across separate shell calls. The daemon exits
// after NANO_BROWSER_IDLE_MINUTES without commands. Card data never passes through the
// model: `{{card.*}}` placeholders are resolved here from an approved Link spend request,
// typed into the page, and scrubbed from everything this tool prints.

import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import http from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { VAULT_RUN_DIR, VAULT_SOCKET } from "../../vault/lib/paths.mjs";

const SELF = fileURLToPath(import.meta.url);
const INSTALL = process.env.NANO_BROWSER_HOME || "/opt/nano-browser";
const DATA = resolve(process.env.NANO_DATA_DIR || join(process.env.HOME || tmpdir(), ".nano"));
const STATE = resolve(process.env.NANO_BROWSER_DIR || join(DATA, "browser"));
const PROFILE = join(STATE, "profile");
const SHOTS = join(STATE, "screenshots");
const SOCKET = join(tmpdir(), `nano-browser-${createHash("sha256").update(STATE).digest("hex").slice(0, 10)}.sock`);
const idleMinutes = Number(process.env.NANO_BROWSER_IDLE_MINUTES?.trim() || 15);
if (!Number.isFinite(idleMinutes) || idleMinutes < 0) throw new Error("NANO_BROWSER_IDLE_MINUTES must be zero or a positive number");
const IDLE_MS = idleMinutes * 60_000; // Zero disables automatic closing; explicit close still works.
const MAX_OUTPUT = 15_000;

const HELP = `browser: headless Chromium with a persistent profile (${PROFILE})

Pages
  open <url>                     go to a URL in the current tab
  snapshot [-i] [--max N] [ref]  accessibility tree with refs (e5, f1e3 = inside an iframe); -i: interactive only
  text [--max N] [ref]           visible text of the page or one element
  screenshot [path] [--full] [--ref R]   PNG (default under ${SHOTS}); prints the path
  frames                         list frames (iframes) with their URLs
  tabs | tab <n> | tab new [url] | tab close [n]
  back | forward | reload
  wait <ms> | wait <text> | wait --url <part> | wait --gone <text>

Acting (targets are refs from the latest snapshot, or Playwright selectors such as "text=Pay" or "#email")
  click <target> [--force]
  type <target> <text> [--slow] [--submit]   replace the field's content; --slow types key by key
  insert <text>                  insert text into the focused element as trusted input (CDP Input.insertText)
  press <key>                    Enter, Tab, Escape, ArrowDown, ...
  select <target> <value>...     choose option(s) by value or label
  check <target> | uncheck <target>
  scroll [down|up|top|bottom|<target>]
  eval <js> [--frame <n|url part>]   evaluate a JS expression in the page or a frame

Payments
  --spend-request <lsrq_...>     with type, insert, select and webmcp call: fill {{card.number}} {{card.exp}} (MM/YY)
                                 {{card.exp_month}} {{card.exp_year}} {{card.exp_yy}} {{card.cvc}} {{card.name}}
                                 {{card.line1}} {{card.line2}} {{card.city}} {{card.state}} {{card.postal_code}}
                                 {{card.country}} from the approved Link spend request, never printed
  webmcp list                    WebMCP tools the page exposes (name, description, input schema)
  webmcp call <tool> <json>      invoke a WebMCP tool as an agent
  lpt detect                     look for Stripe's Link Pay Token block (.AiAgentPaymentSteering)
  lpt fill <lsrq_...>            put the approved request's Link Pay Token into that block

Session
  status | close`;

// ---------------------------------------------------------------------------------------
// Pure helpers (exported for tests)

function luhn(digits) {
	let sum = 0;
	for (let i = 0; i < digits.length; i++) {
		let d = Number(digits[digits.length - 1 - i]);
		if (i % 2 === 1) {
			d *= 2;
			if (d > 9) d -= 9;
		}
		sum += d;
	}
	return sum % 10 === 0;
}

const CVC_LINE = /^(\s*-\s*textbox\s+"[^"]*(?:cvc|cvv|csc|security|verification)[^"]*"[^:\n]*:\s*)\S.*$/gim;
const CVC_VALUE = /((?:cvc|cvv|cvn|csc|security code|card code)[^\n\d]{0,40}?)\b\d{3,4}\b/gi;
/** Inputs masked in every screenshot, in every frame: card number, expiry and security code fields. */
const CARD_INPUTS =
	'input[autocomplete^="cc-"], input[name*="card" i], input[name*="cvc" i], input[name*="cvv" i], input[name*="exp" i]';

/** Hide card numbers (Luhn-valid 13-19 digits), security codes and known secrets. */
export function redact(text, secrets = [], options = {}) {
	const minLength = options.minLength ?? 8;
	let out = String(text);
	const list = [...new Set([...secrets].map((secret) => String(secret ?? "")).filter((secret) => secret.length >= minLength))];
	list.sort((a, b) => b.length - a.length);
	for (const secret of list) out = out.split(secret).join("[redacted]");
	out = out.replace(/\b\d(?:[ -]?\d){12,18}\b/g, (match) => {
		const digits = match.replace(/\D/g, "");
		return luhn(digits) ? `[card •••• ${digits.slice(-4)}]` : match;
	});
	return out.replace(CVC_LINE, "$1[redacted]").replace(CVC_VALUE, "$1[redacted]");
}

const PLACEHOLDER = /\{\{\s*card\.([a-z0-9_]+)\s*\}\}/g;

export function hasPlaceholders(text) {
	return new RegExp(PLACEHOLDER.source).test(String(text));
}

/** Values a `{{card.<field>}}` placeholder can name, from a Link spend request's `card` object. */
export function cardFields(card) {
	const month = String(card.exp_month ?? "").padStart(2, "0");
	const year = String(card.exp_year ?? "");
	const yy = year.slice(-2);
	const billing = card.billing_address ?? {};
	return {
		number: String(card.number ?? ""),
		cvc: String(card.cvc ?? ""),
		exp_month: month,
		exp_year: year.length === 2 ? `20${year}` : year,
		exp_yy: yy,
		exp: `${month}/${yy}`,
		name: billing.name ?? "",
		line1: billing.line1 ?? "",
		line2: billing.line2 ?? "",
		city: billing.city ?? "",
		state: billing.state ?? "",
		postal_code: billing.postal_code ?? "",
		country: billing.country ?? "",
	};
}

export function fillPlaceholders(text, fields) {
	return String(text).replace(PLACEHOLDER, (_, name) => {
		if (!(name in fields)) throw new Error(`unknown placeholder {{card.${name}}}`);
		return fields[name];
	});
}

/** Splits argv into positionals and --flags. Flags listed in `booleans` take no value. */
export function parseArgs(argv, booleans = []) {
	const positional = [];
	const flags = {};
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "-i") flags.interactive = true;
		else if (arg.startsWith("--")) {
			const name = arg.slice(2);
			if (booleans.includes(name) || i + 1 >= argv.length) flags[name] = true;
			else flags[name] = argv[++i];
		} else positional.push(arg);
	}
	return { positional, flags };
}

const INTERACTIVE = /^\s*-\s*(button|link|textbox|searchbox|combobox|checkbox|radio|option|menuitem\w*|tab|switch|slider|spinbutton|listbox|heading|iframe)\b/;

/** Keep interactive elements, headings and iframe markers from an AI-mode aria snapshot. */
export function interactiveOnly(snapshot) {
	return snapshot
		.split("\n")
		.filter((line) => INTERACTIVE.test(line))
		.join("\n");
}

function cap(text, max = MAX_OUTPUT) {
	return text.length > max ? `${text.slice(0, max)}\n[cut at ${max} of ${text.length} chars; use --max, a ref, or -i]` : text;
}

// The vault directory is created by root and owned by the vault user. A directory
// the agent made for itself does not count: that would let it impersonate the vault.
function vaultControlled() {
	try {
		const st = statSync(VAULT_RUN_DIR);
		return st.isDirectory() && st.uid !== process.getuid();
	} catch {
		return false;
	}
}

function activeSocket() {
	return vaultControlled() ? VAULT_SOCKET : SOCKET;
}

function linkCli(args) {
	return new Promise((resolvePromise, reject) => {
		execFile("link-cli", [...args, "--format", "json"], { timeout: 60_000, maxBuffer: 10 * 1024 * 1024, env: process.env }, (error, stdout, stderr) => {
			if (error) {
				// stdout may hold credentials; report only the CLI's error code and message.
				let reason = "link-cli failed";
				for (const text of [stderr, stdout]) {
					try {
						const parsed = JSON.parse(text);
						const item = Array.isArray(parsed) ? parsed[0] : parsed;
						if (item?.code || item?.message) reason = `${item.code ?? "error"}: ${item.message ?? ""}`;
					} catch {
						// not JSON
					}
				}
				reject(new Error(reason));
				return;
			}
			try {
				const parsed = JSON.parse(stdout);
				resolvePromise(Array.isArray(parsed) ? parsed[parsed.length - 1] : parsed);
			} catch {
				reject(new Error("link-cli returned output that is not JSON"));
			}
		});
	});
}

async function spendRequest(id, include) {
	if (!/^lsrq_[A-Za-z0-9_]+$/.test(String(id))) throw new Error("--spend-request needs an id like lsrq_...");
	const request = await linkCli(["spend-request", "retrieve", id, "--include", include]);
	if (request?.status !== "approved") throw new Error(`spend request ${id} is ${request?.status ?? "unknown"}, not approved`);
	return request;
}

/** Resolve Link card data in this process. The returned object is never printed. */
async function cardSideChannel(argv) {
	const [command, ...rest] = argv;
	const { positional, flags } = parseArgs(rest, ["full", "force", "slow", "submit"]);
	if (command === "lpt" && positional[0] === "fill") {
		const request = await spendRequest(positional[1], "link_pay_token");
		const token = typeof request.link_pay_token === "string" ? request.link_pay_token : request.link_pay_token?.token;
		if (!token) throw new Error("that spend request returned no Link Pay Token");
		return { token };
	}
	if (!hasPlaceholders(positional.join(" "))) return undefined;
	if (!flags["spend-request"]) throw new Error("{{card.*}} placeholders need --spend-request <lsrq_...>");
	const request = await spendRequest(flags["spend-request"], "card");
	if (!request.card?.number) throw new Error("that spend request has no card credential (is it a card request?)");
	return { fields: cardFields(request.card) };
}

function clientShotPath(argv) {
	const { positional } = parseArgs(argv.slice(1), ["full"]);
	const arg = positional[0];
	if (!arg) {
		const dir = join(DATA, "browser", "screenshots");
		mkdirSync(dir, { recursive: true });
		return join(dir, `shot-${new Date().toISOString().replace(/[:.]/g, "-")}.png`);
	}
	return isAbsolute(arg) ? arg : resolve(process.cwd(), arg);
}

function safeDownloadName(name) {
	const cleaned = basename(String(name || "download")).replace(/[^A-Za-z0-9._-]/g, "_").replace(/^\.+/, "").slice(0, 80);
	return cleaned || "download";
}

// ---------------------------------------------------------------------------------------
// Client

function call(body, timeoutMs = 300_000) {
	return new Promise((resolvePromise, reject) => {
		const req = http.request({ socketPath: activeSocket(), path: "/", method: "POST", timeout: timeoutMs }, (res) => {
			let data = "";
			res.setEncoding("utf8");
			res.on("data", (chunk) => (data += chunk));
			res.on("end", () => {
				try {
					resolvePromise(JSON.parse(data));
				} catch (error) {
					reject(error);
				}
			});
		});
		req.on("timeout", () => req.destroy(new Error("browser daemon did not answer in time")));
		req.on("error", reject);
		req.end(JSON.stringify(body));
	});
}

async function alive() {
	try {
		return (await call({ argv: ["ping"] }, 3000)).ok === true;
	} catch {
		return false;
	}
}

async function startDaemon() {
	mkdirSync(STATE, { recursive: true });
	const log = openSync(join(STATE, "daemon.log"), "a");
	spawn(process.execPath, [SELF, "--daemon"], { detached: true, stdio: ["ignore", log, log], env: process.env }).unref();
	for (let i = 0; i < 100; i++) {
		await new Promise((r) => setTimeout(r, 200));
		if (await alive()) return;
	}
	throw new Error(`browser daemon did not start; see ${join(STATE, "daemon.log")}`);
}

async function client(argv) {
	const command = argv[0];
	const vault = vaultControlled();
	if (!command || command === "help" || command === "--help" || command === "-h") {
		console.log(vault ? `${HELP}\n  login <name> [--user ref] [--password ref] [--otp ref]\n                                 fill the saved vault login for this site` : HELP);
		return 0;
	}
	if (!(await alive())) {
		if (command === "close") {
			console.log("browser is not running");
			return 0;
		}
		if (command === "status") {
			console.log(vault ? "browser is not running (held by the vault)" : `browser is not running (profile ${PROFILE})`);
			return 0;
		}
		if (vault) {
			for (let i = 0; i < 50 && !(await alive()); i++) await new Promise((r) => setTimeout(r, 200));
			if (!(await alive())) throw new Error("the vault browser is not running");
		} else {
			await startDaemon();
		}
	}
	const card = vault ? await cardSideChannel(argv) : undefined;
	const result = await call({ argv, cwd: process.cwd(), ...(card ? { card } : {}) });
	if (result.png) {
		const path = clientShotPath(argv);
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, Buffer.from(result.png, "base64"));
		console.log(path);
		return result.ok ? 0 : 1;
	}
	if (result.text) (result.ok ? process.stdout : process.stderr).write(`${result.text}\n`);
	return result.ok ? 0 : 1;
}

// ---------------------------------------------------------------------------------------
// Daemon

async function daemon() {
	createBrowserHost();
}

/** @param {object} [options] */
export function createBrowserHost(options = {}) {
	const vault = options.vault === true;
	const profileDir = options.profileDir || PROFILE;
	const downloadsDir = options.downloadsDir || join(STATE, "downloads");
	const require = createRequire(join(INSTALL, "node_modules", "noop.js"));
	process.env.PLAYWRIGHT_BROWSERS_PATH ||= join(INSTALL, "browsers");
	const { chromium } = require("playwright-core");

	/** @type {any} */ let context;
	/** @type {any} */ let page;
	const notes = [];
	const secrets = new Set();
	const secretFields = new WeakMap(); // page -> locators that received card data (masked in screenshots)
	const mcp = new WeakMap(); // page -> { session, tools: Map<key, tool> }
	let idle;
	let requestCard = null;

	function userAgent() {
		try {
			const browsers = JSON.parse(readFileSync(join(INSTALL, "node_modules", "playwright-core", "browsers.json"), "utf8")).browsers;
			const version = browsers.find((b) => b.name === "chromium-headless-shell" || b.name === "chromium")?.browserVersion;
			const major = String(version ?? "").split(".")[0];
			if (major) return `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`;
		} catch {
			// fall back to Chromium's own user agent
		}
		return undefined;
	}

	function watch(p) {
		p.on("dialog", (dialog) => {
			notes.push(`[page ${dialog.type()} accepted: ${dialog.message().slice(0, 200)}]`);
			void dialog.accept().catch(() => {});
		});
		p.on("download", async (download) => {
			mkdirSync(downloadsDir, { recursive: true });
			let name = safeDownloadName(download.suggestedFilename());
			if ([...secrets].some((secret) => secret && name.includes(secret))) name = "download";
			let path = join(downloadsDir, name);
			if (existsSync(path)) path = join(downloadsDir, `${Date.now()}-${name}`);
			await download.saveAs(path).catch(() => {});
			if (vault) {
				try {
					chmodSync(path, 0o644);
				} catch {
					// the download was not written
				}
			}
			notes.push(`[download saved: ${path}]`);
		});
		if (!options.allowNavigation) return;
		p.on("framenavigated", (frame) => {
			const url = frame.url();
			if (options.allowNavigation(url, { top: frame === p.mainFrame() })) return;
			notes.push("[blocked a navigation to a forbidden URL scheme]");
			void frame.goto("about:blank").catch(() => {});
		});
	}

	async function ensureBrowser() {
		if (context) return;
		mkdirSync(profileDir, { recursive: true });
		// A crash or a different container hostname leaves a lock behind that blocks launch.
		for (const lock of ["SingletonLock", "SingletonSocket", "SingletonCookie"]) rmSync(join(profileDir, lock), { force: true });
		context = await chromium.launchPersistentContext(profileDir, {
			headless: true,
			// Use full Chromium's current headless mode rather than the separate headless shell.
			channel: "chromium",
			// Give cross-origin frames separate CDP targets so WebMCP can discover their tools.
			args: ["--enable-features=WebMCP,WebMCPTesting,DevToolsWebMCPSupport", "--site-per-process", "--disable-dev-shm-usage", "--disable-blink-features=AutomationControlled"],
			viewport: { width: 1280, height: 900 },
			userAgent: userAgent(),
			locale: "en-US",
			acceptDownloads: true,
		});
		context.setDefaultTimeout(15_000);
		context.setDefaultNavigationTimeout(45_000);
		context.on("close", () => {
			context = undefined;
			page = undefined;
		});
		context.on("page", (p) => {
			watch(p);
			page = p;
			notes.push("[a new tab opened and is now active; see `browser tabs`]");
		});
		for (const p of context.pages()) watch(p);
		page = context.pages()[0] ?? (await context.newPage());
		if (options.allowNavigation) {
			await context.route("**/*", async (route) => {
				const request = route.request();
				if (request.isNavigationRequest() && !options.allowNavigation(request.url(), { top: false })) {
					await route.abort("blockedbyclient").catch(() => {});
					return;
				}
				await route.continue().catch(() => {});
			});
		}
	}

	async function current() {
		await ensureBrowser();
		if (!page || page.isClosed()) {
			const pages = context.pages();
			page = pages[pages.length - 1] ?? (await context.newPage());
		}
		return page;
	}

	async function settle(p, ms = 4000) {
		await p.waitForLoadState("domcontentloaded", { timeout: 15_000 }).catch(() => {});
		await p.waitForLoadState("networkidle", { timeout: ms }).catch(() => {});
	}

	function target(p, ref) {
		if (!ref) throw new Error("missing target (a ref like e5 from `browser snapshot`, or a selector)");
		return /^(f\d+)?e\d+$/.test(ref) ? p.getByRef(ref) : p.locator(ref).first();
	}

	async function frameFor(p, which) {
		if (which === undefined || which === true) return p.mainFrame();
		const frames = p.frames();
		if (/^\d+$/.test(which)) {
			const frame = frames[Number(which)];
			if (!frame) throw new Error(`no frame ${which}; see \`browser frames\``);
			return frame;
		}
		const frame = frames.find((f) => f.url().includes(which) || f.name() === which);
		if (!frame) throw new Error(`no frame matching "${which}"; see \`browser frames\``);
		return frame;
	}

	async function resolveSecrets(text, flags) {
		if (!hasPlaceholders(text)) return { value: text, secret: false };
		let fields;
		if (vault) {
			fields = requestCard?.fields;
			if (!fields) throw new Error("{{card.*}} placeholders need --spend-request <lsrq_...>");
		} else {
			if (!flags["spend-request"]) throw new Error("{{card.*}} placeholders need --spend-request <lsrq_...>");
			const request = await spendRequest(flags["spend-request"], "card");
			if (!request.card?.number) throw new Error("that spend request has no card credential (is it a card request?)");
			fields = cardFields(request.card);
		}
		secrets.add(fields.number);
		secrets.add(String(fields.number).replace(/(\d{4})(?=\d)/g, "$1 "));
		return { value: fillPlaceholders(text, fields), secret: true, cvc: fields.cvc };
	}

	function rememberSecretField(p, locator) {
		const list = secretFields.get(p) ?? [];
		list.push(locator);
		secretFields.set(p, list);
	}

	function scrub(text) {
		for (const secret of options.secretValues?.() ?? []) secrets.add(secret);
		return redact(text, secrets, { minLength: vault ? 6 : 8 });
	}

	function out(text) {
		const extra = notes.splice(0);
		return scrub([text, ...extra].filter(Boolean).join("\n"));
	}

	function masksFor(p) {
		const mask = [...(secretFields.get(p) ?? [])];
		for (const frame of p.frames()) {
			mask.push(frame.locator(CARD_INPUTS));
			if (vault) {
				mask.push(frame.locator("input[type=password]"));
				mask.push(frame.locator("[data-vault-secret]"));
			}
		}
		return mask;
	}

	/**
	 * Text redaction cannot reach pixels. If a page prints a saved secret (a failed
	 * login that echoes the password, say), a screenshot would show it, so refuse.
	 * Masked fields (password inputs, fields the vault filled) are not counted.
	 */
	async function showsSecret(p) {
		const list = [...new Set(options.secretValues?.() ?? [])].filter((secret) => secret && secret.length >= 6);
		if (list.length === 0) return false;
		const texts = [await p.ariaSnapshot({ mode: "ai" }).catch(() => "")];
		for (const frame of p.frames()) {
			texts.push(
				await frame
					.evaluate(() => {
						const parts = [document.documentElement?.innerText ?? ""];
						for (const el of document.querySelectorAll("input, textarea")) {
							if (el.type === "password" || el.hasAttribute("data-vault-secret")) continue;
							parts.push(el.value ?? "");
						}
						return parts.join("\n");
					})
					.catch(() => ""),
			);
		}
		const all = texts.join("\n");
		return list.some((secret) => all.includes(secret));
	}

	function guardOpen(url) {
		if (!options.allowNavigation) return;
		if (!options.allowNavigation(url, { top: true })) {
			const scheme = url.includes(":") ? url.slice(0, url.indexOf(":") + 1) : "that";
			throw new Error(`refusing to open ${scheme} URLs`);
		}
	}

	/**
	 * WebMCP tools of a page, over CDP: one session for the page plus one per out-of-process
	 * iframe. Enabling the domain replays every registered tool, so each call re-enables it
	 * to get the current set rather than tracking navigations.
	 */
	async function webmcp(p) {
		let state = mcp.get(p);
		if (!state) {
			state = { sessions: new Map(), tools: new Map(), responses: new Map(), urls: new Map() };
			mcp.set(p, state);
		}
		const attach = async (owner) => {
			if (state.sessions.has(owner)) return;
			const session = await context.newCDPSession(owner);
			state.sessions.set(owner, session);
			const key = (t) => t.toolId ?? `${t.frameId}:${t.name}`;
			session.on("WebMCP.toolsAdded", (e) => {
				for (const t of e.tools) state.tools.set(key(t), { ...t, session });
			});
			session.on("WebMCP.toolsRemoved", (e) => {
				for (const t of e.tools) state.tools.delete(key(t));
			});
			session.on("WebMCP.toolResponded", (e) => state.responses.set(e.invocationId, e));
		};
		await attach(p);
		for (const frame of p.frames().slice(1)) {
			// Only out-of-process (cross-origin) frames have their own session; the rest are covered by the page's.
			await attach(frame).catch(() => {});
		}
		state.tools.clear();
		state.urls.clear();
		const walk = (node) => {
			state.urls.set(node.frame.id, node.frame.url);
			for (const child of node.childFrames ?? []) walk(child);
		};
		for (const [owner, session] of state.sessions) {
			if (owner !== p && owner.isDetached()) {
				state.sessions.delete(owner);
				continue;
			}
			await session.send("WebMCP.disable").catch(() => {});
			await session.send("WebMCP.enable").catch(() => {});
			await session.send("Page.getFrameTree").then((r) => walk(r.frameTree), () => {});
		}
		await new Promise((r) => setTimeout(r, 300));
		return state;
	}

	const commands = {
		async ping() {
			return "pong";
		},

		async status() {
			if (!context) return `daemon running, browser not started (profile ${profileDir})`;
			const p = await current();
			return `running, ${context.pages().length} tab(s), active: ${await p.title().catch(() => "")} ${p.url()}\nprofile ${profileDir}`;
		},

		async close() {
			await context?.close().catch(() => {});
			if (!vault) setTimeout(() => process.exit(0), 50);
			return "browser closed";
		},

		async open({ positional }) {
			let url = positional[0];
			if (!url) throw new Error("usage: browser open <url>");
			if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) url = `https://${url}`;
			guardOpen(url);
			const p = await current();
			const response = await p.goto(url, { waitUntil: "domcontentloaded" });
			await settle(p);
			return `${response ? `HTTP ${response.status()} ` : ""}${await p.title().catch(() => "")}\n${p.url()}`;
		},

		async snapshot({ positional, flags }) {
			const p = await current();
			const raw = positional[0] ? await target(p, positional[0]).ariaSnapshot({ mode: "ai" }) : await p.ariaSnapshot({ mode: "ai" });
			const body = flags.interactive ? interactiveOnly(raw) : raw;
			return `${await p.title().catch(() => "")} | ${p.url()}\n${cap(scrub(body), Number(flags.max) || MAX_OUTPUT)}`;
		},

		async text({ positional, flags }) {
			const p = await current();
			const value = positional[0] ? await target(p, positional[0]).innerText() : await p.locator("body").innerText();
			return cap(scrub(value.replace(/\n{3,}/g, "\n\n").trim()), Number(flags.max) || MAX_OUTPUT);
		},

		async screenshot({ positional, flags }, cwd) {
			const p = await current();
			const mask = masksFor(p);
			if (vault) {
				if (await showsSecret(p)) throw new Error("refusing a screenshot: this page is showing a saved secret as text. Use snapshot or text, which redact it.");
				const buffer = flags.ref ? await target(p, flags.ref).screenshot({ mask }) : await p.screenshot({ fullPage: Boolean(flags.full), mask });
				return { text: "", png: buffer.toString("base64") };
			}
			mkdirSync(SHOTS, { recursive: true });
			const path = positional[0]
				? isAbsolute(positional[0])
					? positional[0]
					: resolve(cwd, positional[0])
				: join(SHOTS, `shot-${new Date().toISOString().replace(/[:.]/g, "-")}.png`);
			if (flags.ref) await target(p, flags.ref).screenshot({ path, mask });
			else await p.screenshot({ path, fullPage: Boolean(flags.full), mask });
			return path;
		},

		async frames() {
			const p = await current();
			return p
				.frames()
				.map((f, i) => `${i}${f === p.mainFrame() ? " (main)" : ""} ${f.name() ? `name=${f.name()} ` : ""}${f.url().slice(0, 160)}`)
				.join("\n");
		},

		async tabs() {
			await ensureBrowser();
			const p = await current();
			const lines = [];
			for (const [i, t] of context.pages().entries()) lines.push(`${t === p ? "*" : " "} ${i} ${await t.title().catch(() => "")} ${t.url()}`);
			return lines.join("\n");
		},

		async tab({ positional }) {
			await ensureBrowser();
			const [action, arg] = positional;
			if (action === "new") {
				page = await context.newPage();
				notes.splice(0);
				if (arg) return commands.open({ positional: [arg], flags: {} });
				return "new tab";
			}
			if (action === "close") {
				const victim = arg === undefined ? await current() : context.pages()[Number(arg)];
				if (!victim) throw new Error(`no tab ${arg}`);
				await victim.close();
				page = undefined;
				return commands.tabs();
			}
			const chosen = context.pages()[Number(action)];
			if (!chosen) throw new Error(`no tab ${action}; see \`browser tabs\``);
			page = chosen;
			await chosen.bringToFront();
			return `${await chosen.title().catch(() => "")} ${chosen.url()}`;
		},

		async back() {
			const p = await current();
			await p.goBack();
			await settle(p);
			return p.url();
		},

		async forward() {
			const p = await current();
			await p.goForward();
			await settle(p);
			return p.url();
		},

		async reload() {
			const p = await current();
			await p.reload();
			await settle(p);
			return p.url();
		},

		async wait({ positional, flags }) {
			const p = await current();
			const timeout = Number(flags.timeout) * 1000 || 30_000;
			if (flags.url) await p.waitForURL((u) => u.href.includes(flags.url), { timeout });
			else if (flags.gone) await p.getByText(flags.gone).first().waitFor({ state: "hidden", timeout });
			else if (/^\d+$/.test(positional[0] ?? "")) await p.waitForTimeout(Math.min(Number(positional[0]), 120_000));
			else if (positional[0]) await p.getByText(positional.join(" ")).first().waitFor({ timeout });
			else await settle(p, 10_000);
			return `ok ${p.url()}`;
		},

		async click({ positional, flags }) {
			const p = await current();
			await target(p, positional[0]).click({ force: Boolean(flags.force) });
			await settle(p, 3000);
			return `clicked ${positional[0]} | ${await p.title().catch(() => "")} ${p.url()}`;
		},

		async type({ positional, flags }) {
			const p = await current();
			const [ref, ...words] = positional;
			const { value, secret } = await resolveSecrets(words.join(" "), flags);
			const field = target(p, ref);
			if (flags.slow) {
				await field.click();
				await field.fill("").catch(() => {});
				await field.pressSequentially(value, { delay: 60 });
			} else {
				try {
					await field.fill(value);
				} catch {
					await field.click();
					await p.keyboard.insertText(value);
				}
			}
			if (secret) rememberSecretField(p, field);
			if (flags.submit) {
				await field.press("Enter");
				await settle(p, 3000);
			}
			return `typed into ${ref}${secret ? " (card data from the spend request)" : ""}`;
		},

		async insert({ positional, flags }) {
			const p = await current();
			const { value, secret } = await resolveSecrets(positional.join(" "), flags);
			await p.keyboard.insertText(value);
			if (secret) notes.push("[card data inserted; screenshots mask only recognisable card fields, avoid them until submitted]");
			return `inserted ${secret ? "card data" : `${value.length} chars`} into the focused element`;
		},

		async press({ positional }) {
			const p = await current();
			await p.keyboard.press(positional[0] ?? "Enter");
			await settle(p, 2000);
			return `pressed ${positional[0] ?? "Enter"}`;
		},

		async select({ positional, flags }) {
			const p = await current();
			const [ref, ...given] = positional;
			const values = [];
			for (const value of given) values.push((await resolveSecrets(value, flags)).value);
			const field = target(p, ref);
			let chosen;
			try {
				chosen = await field.selectOption(values);
			} catch {
				chosen = await field.selectOption(values.map((label) => ({ label })));
			}
			return `selected ${chosen.join(", ")} in ${ref}`;
		},

		async check({ positional }) {
			const p = await current();
			await target(p, positional[0]).setChecked(true);
			return `checked ${positional[0]}`;
		},

		async uncheck({ positional }) {
			const p = await current();
			await target(p, positional[0]).setChecked(false);
			return `unchecked ${positional[0]}`;
		},

		async scroll({ positional }) {
			const p = await current();
			const where = positional[0] ?? "down";
			if (where === "down" || where === "up") await p.mouse.wheel(0, where === "down" ? 700 : -700);
			else if (where === "top" || where === "bottom") await p.evaluate((top) => window.scrollTo(0, top ? 0 : document.body.scrollHeight), where === "top");
			else await target(p, where).scrollIntoViewIfNeeded();
			await p.waitForTimeout(300);
			return `scrolled ${where}`;
		},

		async eval({ positional, flags }) {
			const p = await current();
			const frame = await frameFor(p, flags.frame);
			options.assertEval?.(p.url(), frame.url());
			const result = await frame.evaluate(positional.join(" "));
			return cap(scrub(typeof result === "string" ? result : JSON.stringify(result, null, 1) ?? "undefined"));
		},

		async login(parsed) {
			if (!options.login) throw new Error("browser login is only available when the vault pack is enabled");
			const p = await current();
			return options.login({
				page: p,
				args: parsed,
				settle: () => settle(p),
				target: (ref) => target(p, ref),
				mark: async (locator) => {
					await locator.evaluate((el) => el.setAttribute("data-vault-secret", "1")).catch(() => {});
					rememberSecretField(p, locator);
				},
			});
		},

		async webmcp({ positional, flags }) {
			const p = await current();
			const [action, name, ...rest] = positional;
			const state = await webmcp(p);
			const tools = [...state.tools.values()];
			const frameUrl = (id) => state.urls.get(id) ?? "";
			if (action === "list" || !action) {
				if (tools.length === 0) return "no WebMCP tools on this page";
				return tools
					.map((t) => {
						const notesText = t.annotations ? ` annotations=${JSON.stringify(t.annotations)}` : "";
						return `${t.name}: ${t.description}\n  input ${JSON.stringify(t.inputSchema ?? {})}${notesText}${frameUrl(t.frameId) ? `\n  frame ${frameUrl(t.frameId)}` : ""}`;
					})
					.join("\n");
			}
			if (action !== "call") throw new Error("usage: browser webmcp list | browser webmcp call <tool> '<json>'");
			const matches = tools.filter((t) => t.name === name);
			if (matches.length === 0) throw new Error(`no WebMCP tool "${name}"; see \`browser webmcp list\``);
			const tool = matches[matches.length - 1];
			const { value, secret } = await resolveSecrets(rest.join(" ") || "{}", flags);
			let input;
			try {
				input = JSON.parse(value);
			} catch {
				throw new Error("tool input must be a JSON object");
			}
			const params = { frameId: tool.frameId, input, ...(tool.toolId ? { toolId: tool.toolId } : { toolName: tool.name }) };
			const { invocationId } = await tool.session.send("WebMCP.invokeTool", params);
			const deadline = Date.now() + (Number(flags.timeout) * 1000 || 90_000);
			while (!state.responses.has(invocationId) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 200));
			const response = state.responses.get(invocationId);
			await settle(p, 3000);
			if (!response) return `${name} was invoked${secret ? " with card data" : ""}; no response yet. Check the page with snapshot.`;
			const detail = response.output !== undefined ? JSON.stringify(response.output) : (response.errorText ?? "");
			return `${name}: ${response.status}${secret ? " (card data from the spend request)" : ""}\n${cap(detail)}`;
		},

		async lpt({ positional }) {
			const p = await current();
			const [action, id] = positional;
			const probe = () => {
				const block = document.querySelector(".AiAgentPaymentSteering");
				if (!block) return null;
				const holder = block.matches("[data-stripe-merchant-account]") ? block : block.querySelector("[data-stripe-merchant-account]");
				return {
					account: holder?.getAttribute("data-stripe-merchant-account") || null,
					input: Boolean(block.querySelector('input[name="link_pay_token"]') || document.querySelector('input[name="link_pay_token"]')),
				};
			};
			const found = [];
			for (const frame of p.frames()) {
				const result = await frame.evaluate(probe).catch(() => null);
				if (result) found.push({ frame, ...result });
			}
			const usable = found.find((f) => f.account && f.input);
			if (action === "detect" || !action) {
				if (found.length === 0) return "no Link Pay Token block on this page: use a card spend request";
				return found
					.map((f) => `${f.account && f.input ? "usable" : "incomplete"}: merchant account ${f.account ?? "missing"}, token input ${f.input ? "present" : "missing"}, frame ${f.frame.url().slice(0, 120)}`)
					.join("\n");
			}
			if (action !== "fill") throw new Error("usage: browser lpt detect | browser lpt fill <lsrq_...>");
			if (!usable) throw new Error("no usable Link Pay Token block on this page (run `browser lpt detect`)");
			let token;
			if (vault) {
				token = requestCard?.token;
			} else {
				const request = await spendRequest(id, "link_pay_token");
				token = typeof request.link_pay_token === "string" ? request.link_pay_token : request.link_pay_token?.token;
			}
			if (!token) throw new Error("that spend request returned no Link Pay Token");
			secrets.add(token);
			await usable.frame.evaluate((value) => {
				const input = document.querySelector('.AiAgentPaymentSteering input[name="link_pay_token"]') || document.querySelector('input[name="link_pay_token"]');
				Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, value);
				input.dispatchEvent(new Event("input", { bubbles: true }));
				input.dispatchEvent(new Event("change", { bubbles: true }));
			}, token);
			await settle(p, 5000);
			return "Link Pay Token filled. Wait for the card form to turn into a saved card, then click the pay button.";
		},
	};

	const booleans = ["full", "force", "slow", "submit"];

	function absorbCard(card) {
		if (!card) return;
		if (typeof card.token === "string") secrets.add(card.token);
		for (const value of Object.values(card.fields ?? {})) if (typeof value === "string" && value) secrets.add(value);
	}

	async function handle(request) {
		if (vault) clearTimeout(idle);
		try {
			requestCard = request.card ?? null;
			absorbCard(request.card);
			const [name, ...rest] = request.argv ?? [];
			const handler = Object.hasOwn(commands, name) ? commands[name] : undefined;
			if (!handler) throw new Error(`unknown command "${name}"; run \`browser help\``);
			const result = await handler(parseArgs(rest, booleans), request.cwd || process.cwd());
			if (result && typeof result === "object" && result.png) return { text: out(result.text ?? ""), png: result.png };
			return { text: out(String(result ?? "")) };
		} finally {
			if (vault && IDLE_MS > 0) idle = setTimeout(() => void context?.close().catch(() => {}), IDLE_MS);
		}
	}

	if (vault) return { handle };

	let queue = Promise.resolve();
	const server = http.createServer((req, res) => {
		let body = "";
		req.setEncoding("utf8");
		req.on("data", (chunk) => {
			body += chunk;
			if (body.length > 2_000_000) req.destroy();
		});
		req.on("end", () => {
			queue = queue.then(async () => {
				clearTimeout(idle);
				let reply;
				try {
					const parsed = JSON.parse(body);
					const result = await handle({ argv: parsed.argv ?? [], cwd: parsed.cwd, card: parsed.card });
					reply = { ok: true, text: result.text, ...(result.png ? { png: result.png } : {}) };
				} catch (error) {
					const message = String(error?.message ?? error).split("\n").slice(0, 6).join("\n");
					reply = { ok: false, text: out(`error: ${message}`) };
				}
				if (IDLE_MS > 0) idle = setTimeout(() => void commands.close(), IDLE_MS);
				if (!res.writableEnded) {
					res.writeHead(200, { "content-type": "application/json" });
					res.end(JSON.stringify(reply));
				}
			});
		});
	});

	void (async () => {
		if (existsSync(SOCKET)) {
			if (await alive()) process.exit(0);
			rmSync(SOCKET, { force: true });
		}
		server.listen(SOCKET, () => console.error(`browser daemon listening on ${SOCKET}`));
		if (IDLE_MS > 0) idle = setTimeout(() => void commands.close(), IDLE_MS);
	})();
	for (const signal of ["SIGTERM", "SIGINT"]) {
		process.on(signal, async () => {
			await context?.close().catch(() => {});
			process.exit(0);
		});
	}
	process.on("exit", () => rmSync(SOCKET, { force: true }));
}

if (process.argv[1] && resolve(process.argv[1]) === SELF) {
	if (process.argv[2] === "--daemon") {
		daemon().catch((error) => {
			console.error(error);
			process.exit(1);
		});
	} else {
		client(process.argv.slice(2)).then(
			(code) => process.exit(code),
			(error) => {
				console.error(`browser: ${error?.message ?? error}`);
				process.exit(1);
			},
		);
	}
}

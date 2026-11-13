// Vault daemon. Runs as the nano-vault user. Serves the browser, the credential
// store and the portal. Nothing returned on the socket contains a secret.

import { chmodSync, existsSync, mkdirSync, rmSync, statSync } from "node:fs";
import http from "node:http";
import { networkInterfaces } from "node:os";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createBrowserHost, redact } from "../../purchases/lib/browser.mjs";
import { authorizedFetch, httpsTransport, parseFetchArgs } from "./fetch.mjs";
import { fillLogin } from "./login.mjs";
import { normalizeIp, parseAllow } from "./net.mjs";
import { DEFAULT_DOWNLOADS, DEFAULT_PORT, DEFAULT_VAULT_DIR, VAULT_SOCKET } from "./paths.mjs";
import { evalAllowed, loginUrlAllowed, navigationAllowed, normalizeSite } from "./policy.mjs";
import { chooseBinds, createPortal } from "./portal.mjs";
import { handleProviderApi } from "./provider-api.mjs";
import { providerSecrets } from "./providers.mjs";
import { collectSecrets } from "./secrets.mjs";
import { assertVaultDir, deleteEntry, getEntry, isMountPoint, loadStore, publicEntry, saveStore, upsertKey, upsertLogin } from "./store.mjs";

const SELF = fileURLToPath(import.meta.url);
const MAX_REQUEST = 2_000_000;

function enabled(name) {
	const value = process.env[name];
	return value === "1" || value === "true";
}

function ownAddresses() {
	const found = new Set();
	for (const list of Object.values(networkInterfaces())) {
		for (const info of list ?? []) found.add(normalizeIp(info.address));
	}
	return found;
}

function ipv4Addresses() {
	const found = [];
	for (const list of Object.values(networkInterfaces())) {
		for (const info of list ?? []) {
			if (info.family === "IPv4" || info.family === 4) found.push(normalizeIp(info.address));
		}
	}
	return found;
}

function assertOutside(path, parent, label) {
	const child = resolve(path);
	const root = resolve(parent);
	if (child === root || child.startsWith(root + sep)) throw new Error(`${label} must not be inside ${root}`);
}

function main() {
	const dir = resolve(process.env.NANO_VAULT_DIR || DEFAULT_VAULT_DIR);
	const downloads = resolve(process.env.NANO_VAULT_DOWNLOADS || DEFAULT_DOWNLOADS);
	const socketPath = process.env.NANO_VAULT_SOCKET || VAULT_SOCKET;
	const allowHttpLoopback = enabled("NANO_VAULT_ALLOW_HTTP_LOOPBACK");
	const insecureLocal = enabled("NANO_VAULT_INSECURE_ALLOW_LOCAL");
	const insecureTls = enabled("NANO_VAULT_INSECURE_TLS");

	assertVaultDir(dir);
	if (!isMountPoint(dir)) console.error(`nano-vault: warning: ${dir} is not a mount point; saved credentials will be lost when the container is recreated`);
	assertOutside(downloads, dir, "downloads directory");
	mkdirSync(downloads, { recursive: true, mode: 0o755 });
	chmodSync(downloads, 0o755);
	const downloadsStat = statSync(downloads);
	if (downloadsStat.uid !== process.getuid()) throw new Error("downloads directory is not owned by the vault user");
	if ((downloadsStat.mode & 0o022) !== 0) throw new Error("downloads directory must not be writable by the group or others");

	const runDir = dirname(socketPath);
	const runStat = statSync(runDir);
	if (!runStat.isDirectory() || runStat.uid !== process.getuid()) throw new Error("socket directory is not owned by the vault user");
	if ((runStat.mode & 0o022) !== 0) throw new Error("socket directory must not be writable by the group or others");

	if (insecureLocal) console.error("nano-vault: WARNING: NANO_VAULT_INSECURE_ALLOW_LOCAL is on; loopback clients can open the portal. For tests only.");
	if (allowHttpLoopback) console.error("nano-vault: WARNING: NANO_VAULT_ALLOW_HTTP_LOOPBACK is on; http://127.0.0.1 may be used for a saved login. For tests only.");
	if (insecureTls) console.error("nano-vault: WARNING: NANO_VAULT_INSECURE_TLS is on; TLS certificates are not checked. For tests only.");

	let data = loadStore(dir);
	const write = (mutator) => {
		const next = mutator(data);
		saveStore(dir, next);
		data = next;
	};
	const sites = () => data.entries.filter((entry) => entry.kind === "login").map((entry) => entry.site);

	const browser = createBrowserHost({
		vault: true,
		profileDir: resolve(dir, "browser"),
		downloadsDir: downloads,
		secretValues: () => [...collectSecrets(data.entries), ...providerSecrets(data)],
		allowNavigation: (url, info) => navigationAllowed(url, info),
		assertEval(pageUrl, frameUrl) {
			if (!evalAllowed(pageUrl, frameUrl, sites())) throw new Error("eval is refused on a site that has a saved login");
		},
		login({ page, args, settle, target, mark }) {
			const name = args.positional[0];
			if (!name) throw new Error("usage: browser login <name> [--user ref] [--password ref] [--otp ref]");
			const entry = getEntry(data, name);
			if (!entry || entry.kind !== "login") throw new Error(`no saved login named ${name}`);
			const hint = (value) => (typeof value === "string" ? value : undefined);
			return fillLogin({
				page,
				entry,
				hints: { user: hint(args.flags.user), password: hint(args.flags.password), otp: hint(args.flags.otp) },
				allow: (url, site) => loginUrlAllowed(url, site, { allowHttpLoopback }),
				mark,
				settle,
				target,
			});
		},
	});

	let portalAddress = "";
	let binds = [];
	try {
		binds = chooseBinds(process.env.NANO_VAULT_BIND, ipv4Addresses());
	} catch (error) {
		console.error(`nano-vault: ${error.message}`);
		binds = [];
	}
	const port = Number(process.env.NANO_VAULT_PORT || DEFAULT_PORT);
	const portalOptions = {
		port,
		allow: parseAllow(process.env.NANO_VAULT_ALLOW),
		ownAddresses,
		insecureLocal,
		providerCatalogs: new Map(),
		hosts: (process.env.NANO_VAULT_HOSTS ?? "").split(",").map((item) => item.trim()).filter(Boolean),
		read: () => data,
		write,
		saveLogin: (store, form) => upsertLogin(store, { ...form, removeTotp: form.removeTotp === "yes" }),
		saveKey: (store, form) => upsertKey(store, form),
		remove: (store, name) => deleteEntry(store, name),
		log: (event) => console.error(`nano-vault: ${String(event).replace(/[\r\n]/g, " ")}`),
	};
	const portals = [];
	if (!binds.length) {
		console.error("nano-vault: no tailnet address found; portal not started. Set NANO_VAULT_BIND to an explicit address.");
	}
	for (const bind of binds) {
		const host = createPortal({ ...portalOptions, bind });
		portals.push(host);
		host.listen(port, bind, () => {
			const address = `http://${bind}:${port}`;
			if (!portalAddress || bind === binds[0]) portalAddress = address;
			console.error(`nano-vault: portal listening on ${address}`);
		});
		host.on("error", (error) => console.error(`nano-vault: portal failed (${error.code ?? "error"})`));
	}

	const socket = http.createServer((req, res) => {
		if (req.url?.startsWith("/providers/")) {
			void handleProviderApi(req, res, { read: () => data, scrub });
			return;
		}
		const chunks = [];
		let size = 0;
		req.on("data", (chunk) => {
			size += chunk.length;
			if (size > MAX_REQUEST) req.destroy();
			else chunks.push(chunk);
		});
		req.on("end", () => {
			void answer(Buffer.concat(chunks).toString("utf8"))
				.then((reply) => {
					if (res.writableEnded) return;
					res.writeHead(200, { "content-type": "application/json" });
					res.end(JSON.stringify(reply));
				})
				.catch(() => {
					if (!res.writableEnded) res.end();
				});
		});
	});

	// One browser command at a time. Without this a second command could move the
	// tab to another site between the login check and the password being typed.
	let queue = Promise.resolve();
	function inTurn(job) {
		const run = queue.then(job);
		queue = run.catch(() => {});
		return run;
	}

	async function answer(raw) {
		let parsed;
		try {
			parsed = JSON.parse(raw);
		} catch {
			return { ok: false, text: "bad request" };
		}
		const argv = Array.isArray(parsed.argv) ? parsed.argv.map(String) : [];
		const name = argv[0] ?? "";
		try {
			if (name === "list" || name === "url" || name === "fetch") return { ok: true, text: scrub(await vaultCommand(name, argv.slice(1))) };
			const result = await inTurn(() => browser.handle({ argv, cwd: parsed.cwd, card: parsed.card }));
			return { ok: true, text: scrub(result.text ?? ""), ...(result.png ? { png: result.png } : {}) };
		} catch (error) {
			const message = String(error?.message ?? "failed").split("\n").slice(0, 6).join("\n");
			console.error(`nano-vault: ${name || "command"} failed`);
			return { ok: false, text: scrub(`error: ${message}`) };
		}
	}

	function scrub(text) {
		return redact(text, [...collectSecrets(data.entries), ...providerSecrets(data)], { minLength: 6 });
	}

	async function vaultCommand(name, rest) {
		if (name === "list") {
			if (data.entries.length === 0) return "vault: nothing saved";
			return data.entries.map(describe).join("\n");
		}
		if (name === "url") {
			if (!portalAddress) return "vault: the portal is not listening. Set NANO_VAULT_BIND to a tailnet address.";
			let site = "";
			for (let i = 0; i < rest.length; i++) if (rest[i] === "--add") site = rest[++i] ?? "";
			if (!site) return `${portalAddress}/`;
			return `${portalAddress}/login/new?site=${encodeURIComponent(normalizeSite(site))}`;
		}
		const args = parseFetchArgs(rest);
		const entry = getEntry(data, args.name);
		if (!entry || entry.kind !== "api-key") throw new Error(`no API key named ${args.name}`);
		return authorizedFetch({
			entry,
			url: args.url,
			method: args.method,
			headers: args.headers,
			body: args.body,
			transport: httpsTransport({ rejectUnauthorized: !insecureTls }),
			anyPort: insecureTls,
		});
	}

	if (existsSync(socketPath)) rmSync(socketPath);
	socket.listen(socketPath, () => {
		chmodSync(socketPath, 0o666);
		console.error("nano-vault: listening");
	});
	for (const signal of ["SIGTERM", "SIGINT"]) {
		process.on(signal, () => {
			socket.close();
			for (const portal of portals) portal.close();
			process.exit(0);
		});
	}
}

function describe(entry) {
	const pub = publicEntry(entry);
	if (pub.kind === "login") {
		return `${pub.name}\tlogin\tsite=${pub.site}\tuser=${pub.username}${pub.totp ? "\t2FA" : ""}\tupdated=${pub.updatedAt}`;
	}
	return `${pub.name}\tapi-key\thosts=${pub.hosts.join(",")}\theader=${pub.header}\tkey=••••${pub.keyLast4}\tupdated=${pub.updatedAt}`;
}

if (process.argv[1] && resolve(process.argv[1]) === SELF) {
	try {
		main();
	} catch (error) {
		console.error(`nano-vault: ${error?.message ?? "failed to start"}`);
		process.exit(1);
	}
}

// Browser rules that only apply when the vault owns Chromium.

export function hostMatchesSite(hostname, site) {
	const host = String(hostname ?? "").toLowerCase().replace(/\.$/, "");
	const base = String(site ?? "").toLowerCase().replace(/\.$/, "");
	if (!host || !base) return false;
	return host === base || host.endsWith(`.${base}`);
}

export function navigationAllowed(raw, { top = false } = {}) {
	let url;
	try {
		url = new URL(raw);
	} catch {
		return false;
	}
	if (url.protocol === "http:" || url.protocol === "https:") return true;
	if (url.protocol === "about:") {
		if (url.href === "about:blank" || url.href.startsWith("about:blank#") || url.href.startsWith("about:blank?")) return true;
		if (!top && (url.href === "about:srcdoc" || url.href.startsWith("about:srcdoc"))) return true;
		return false;
	}
	return false;
}

/**
 * Login fill requires https on the saved site (or a subdomain).
 * `allowHttpLoopback` is read from the daemon environment at start and only
 * unlocks http on 127.0.0.1, for the fixture server. The nano user cannot set it.
 */
export function loginUrlAllowed(raw, site, { allowHttpLoopback = false } = {}) {
	let url;
	try {
		url = new URL(raw);
	} catch {
		return false;
	}
	if (url.username || url.password) return false;
	if (!hostMatchesSite(url.hostname, site)) return false;
	if (url.protocol === "https:") return true;
	return Boolean(allowHttpLoopback && url.protocol === "http:" && url.hostname === "127.0.0.1");
}

export function urlMatchesSite(raw, site) {
	let url;
	try {
		url = new URL(raw);
	} catch {
		return false;
	}
	return hostMatchesSite(url.hostname, site);
}

export function evalAllowed(pageUrl, frameUrl, sites) {
	for (const site of sites) {
		if (urlMatchesSite(pageUrl, site) || urlMatchesSite(frameUrl, site)) return false;
	}
	return true;
}

export function normalizeSite(input) {
	let site = String(input ?? "").trim().toLowerCase();
	site = site.replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/\.$/, "");
	if (!site || site.length > 253 || site.includes("..")) throw new Error("site must be a hostname");
	if (!/^[a-z0-9.-]+$/.test(site)) throw new Error("site must be a hostname");
	return site;
}

export function normalizeHostPin(input) {
	let pin = String(input ?? "").trim().toLowerCase();
	const wild = pin.startsWith("*.");
	if (wild) pin = pin.slice(2);
	pin = pin.replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/\.$/, "");
	if (!pin || pin.includes("..") || pin.includes("*") || pin.includes("/")) throw new Error("host pin must be a hostname or an address");
	if (wild && pin) return `*.${pin}`;
	return pin;
}

const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export function checkName(name) {
	if (!NAME.test(String(name ?? ""))) throw new Error("name must be letters, digits, dots, dashes or underscores");
	return String(name);
}

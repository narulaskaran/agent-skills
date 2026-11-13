// Everything the daemon must scrub from text it returns. Usernames are not secrets.

import { totpWindow } from "./totp.mjs";

export function collectSecrets(entries, now = Date.now()) {
	const secrets = [];
	for (const entry of entries) {
		if (entry.kind === "login") {
			secrets.push(...variants(entry.password));
			if (entry.totp?.secret) {
				secrets.push(...variants(entry.totp.secret));
				secrets.push(...variants(entry.totp.secret.toLowerCase()));
				for (const code of totpWindow(entry.totp, now)) secrets.push(code);
			}
		} else if (entry.kind === "api-key") {
			secrets.push(...variants(entry.key));
		}
	}
	return [...new Set(secrets.filter((secret) => secret && secret.length >= 6))];
}

function variants(value) {
	const text = String(value ?? "");
	if (!text) return [];
	const out = [text];
	const encoded = encodeURIComponent(text);
	if (encoded !== text) out.push(encoded);
	const html = text.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
	if (html !== text) out.push(html);
	return out;
}

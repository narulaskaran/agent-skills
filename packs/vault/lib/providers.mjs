// Owner-managed connections and capability routes. Secrets never leave the daemon.
import { collectSecrets } from "./secrets.mjs";
import {
	normalizeCustom,
	anthropicRequest,
	anthropicResponse,
	completion,
	completionResponse,
	customRequest,
	customVariables,
	jsonField,
} from "./provider-shapes.mjs";
import http from "node:http";
import https from "node:https";
import { isIP } from "node:net";
import { checkName } from "./policy.mjs";
import { isLoopback, isPrivate, isRestricted } from "./net.mjs";
import { resolveHost } from "./fetch.mjs";

export const ROLES = {
	main: "Main conversation",
	background: "Background tasks",
	local: "Private / local work",
	stt: "Speech to text",
	tts: "Text to speech",
};
export const FORMATS = {
	openai: "OpenAI-compatible",
	anthropic: "Anthropic Messages",
	custom: "Custom request / response mapping",
	bark: "Bark (raw WAV)",
	woof: "Woof (plain text)",
};
export const PRESETS = {
	anthropic: { name: "Anthropic", baseUrl: "https://api.anthropic.com/v1", format: "anthropic", capabilities: ["chat"] },
	deepseek: { name: "DeepSeek", baseUrl: "https://api.deepseek.com", format: "openai", capabilities: ["chat"] },
	openrouter: { name: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", format: "openai", capabilities: ["chat", "stt", "tts"] },
	custom: { name: "", baseUrl: "", format: "openai", capabilities: ["chat"] },
};
const capability = (role) => (["main", "background", "local"].includes(role) ? "chat" : role);
export function publicProvider(p) {
	const { key, ...rest } = p;
	return { ...rest, hasKey: Boolean(key) };
}
export function providerSecrets(data) {
	return collectSecrets((data.providers ?? []).map((p) => ({ kind: "api-key", key: p.key })));
}
export function normalizeBase(raw, local) {
	let url;
	try {
		url = new URL(String(raw).trim());
	} catch {
		throw new Error("Enter a complete base URL, including http:// or https://.");
	}
	if (url.username || url.password || url.search || url.hash)
		throw new Error("Base URL must not contain credentials, query parameters or fragments.");
	if (!["http:", "https:"].includes(url.protocol)) throw new Error("Use an HTTP or HTTPS base URL.");
	if (local) {
		if (!isIP(url.hostname) || !(isLoopback(url.hostname) || isPrivate(url.hostname)))
			throw new Error("Local connections must use a literal loopback or private network IP address.");
	} else if (url.protocol !== "https:") throw new Error("Hosted connections require HTTPS.");
	return url.href.replace(/\/+$/, "");
}
export function saveProvider(data, form) {
	const id = checkName(String(form.id ?? "").trim());
	const previous = (data.providers ?? []).find((p) => p.id === id);
	const local = form.local === "yes";
	const baseUrl = normalizeBase(form.baseUrl, local);
	const format = form.format;
	if (!Object.hasOwn(FORMATS, format)) throw new Error("Choose an API format.");
	const capabilities = ["chat", "stt", "tts"].filter((c) => form[`cap_${c}`] === "yes");
	if (!capabilities.length) throw new Error("Choose at least one supported capability.");
	if (format === "anthropic" && capabilities.some((c) => c !== "chat"))
		throw new Error("Anthropic Messages supports chat; use another connection for speech.");
	if ((format === "bark" && capabilities.some((c) => c !== "stt")) || (format === "woof" && capabilities.some((c) => c !== "tts")))
		throw new Error("The API format does not support those capabilities.");
	const name =
		String(form.name ?? "")
			.trim()
			.slice(0, 100) || id;
	const supplied = String(form.key ?? "");
	if (supplied && supplied.length < 8) throw new Error("API key must be at least 8 characters.");
	if (supplied && /[\r\n]/.test(supplied)) throw new Error("API keys cannot contain line breaks.");
	// Changing the destination must never carry an old key to a new server.
	const sameDestination = previous?.baseUrl === baseUrl;
	const key = form.removeKey === "yes" ? "" : supplied || (sameDestination ? previous?.key : "") || "";
	const authHeader = String(form.authHeader || (format === "anthropic" ? "x-api-key" : "Authorization")).trim();
	if (
		!/^[A-Za-z0-9-]{1,64}$/.test(authHeader) ||
		["host", "connection", "content-length", "transfer-encoding", "upgrade", "proxy-authorization", "te", "trailer", "keep-alive"].includes(
			authHeader.toLowerCase(),
		)
	)
		throw new Error("Choose a valid authentication header.");
	const authPrefix = form.authPrefix ?? (format === "anthropic" ? "" : "Bearer ");
	if (String(authPrefix).length > 100 || /[\r\n]/.test(authPrefix)) throw new Error("Invalid authentication prefix.");
	const custom = format === "custom" ? normalizeCustom(form.custom, capabilities) : null;
	const provider = {
		id,
		name,
		baseUrl,
		format,
		local,
		capabilities,
		key,
		authHeader,
		authPrefix,
		custom,
		...(sameDestination && previous?.catalog ? { catalog: previous.catalog } : {}),
	};
	const next = { ...data, providers: [...(data.providers ?? []).filter((p) => p.id !== id), provider] };
	validateRoutes(next);
	return next;
}
export function deleteProvider(data, id) {
	if (Object.values(data.roles ?? {}).some((r) => r?.provider === id || r?.fallback?.provider === id))
		throw new Error("Choose another connection for its assigned jobs before deleting this provider.");
	return { ...data, providers: (data.providers ?? []).filter((p) => p.id !== id) };
}
function routeFromForm(form, prefix) {
	const provider = String(form[`${prefix}provider`] ?? "");
	if (!provider) return null;
	const model = String(form[`${prefix}model`] ?? "")
		.trim()
		.slice(0, 200);
	const voice = String(form[`${prefix}voice`] ?? "")
		.trim()
		.slice(0, 100);
	const contextWindow = Number(form[`${prefix}contextWindow`] || 32768);
	if (!Number.isInteger(contextWindow) || contextWindow < 2048 || contextWindow > 10000000)
		throw new Error("Context window must be between 2048 and 10000000 tokens.");
	return { provider, model, voice, contextWindow };
}
export function saveRoles(data, form) {
	const roles = {};
	for (const role of Object.keys(ROLES)) {
		const route = routeFromForm(form, `${role}_`);
		if (route) {
			route.fallback = routeFromForm(form, `${role}_fallback_`);
			roles[role] = route;
		} else if (form[`${role}_fallback_provider`]) throw new Error("Set a primary connection before choosing a fallback.");
	}
	const next = { ...data, roles };
	validateRoutes(next);
	return next;
}
export function validateRoutes(data) {
	for (const [role, route] of Object.entries(data.roles ?? {})) {
		for (const r of [route, route.fallback].filter(Boolean)) {
			const p = (data.providers ?? []).find((p) => p.id === r.provider);
			if (!p || !p.capabilities.includes(capability(role)))
				throw new Error(`${ROLES[role]} needs a connection that supports ${capability(role)}.`);
			if (role === "local" && !p.local) throw new Error("Private work and its fallback must use a local connection.");
			if (p.catalog?.[capability(role)] && !p.catalog[capability(role)].includes(r.model))
				throw new Error(`${ROLES[role]}: this model is not listed for that capability. Test the connection again to refresh models.`);
			if ((capability(role) === "chat" || ["openai", "anthropic"].includes(p.format)) && !r.model)
				throw new Error(`${ROLES[role]} needs a model ID.`);
		}
	}
}
export function roleRoute(data, role) {
	if (!Object.hasOwn(ROLES, role)) throw new Error("Unknown job.");
	const route = data.roles?.[role] ?? (role === "background" ? data.roles?.main : null);
	if (!route) return null;
	const p = (data.providers ?? []).find((p) => p.id === route.provider);
	if (!p || !p.capabilities.includes(capability(role)) || (role === "local" && !p.local))
		throw new Error("The job has an invalid provider configuration.");
	return { ...route, connection: p };
}
export function publicSettings(data) {
	return {
		providers: (data.providers ?? []).map((p) => ({
			id: p.id,
			name: p.name,
			format: p.format,
			local: p.local,
			capabilities: p.capabilities,
			catalogProvider:
				p.format === "openai" ? ({ "api.deepseek.com": "deepseek", "openrouter.ai": "openrouter" }[new URL(p.baseUrl).hostname] ?? "") : "",
		})),
		roles: data.roles ?? {},
	};
}

// Resolve and pin DNS on each request; redirects and supplied headers are never forwarded.
export async function providerRequest(provider, path, { method = "GET", body, contentType, signal } = {}) {
	const url = new URL(provider.baseUrl + path);
	const addresses = await resolveHost(url.hostname);
	if (!addresses.length) throw new Error("Provider host did not resolve.");
	if (!provider.local && addresses.some(isRestricted)) throw new Error("Hosted providers cannot resolve to private network addresses.");
	if (provider.local) normalizeBase(provider.baseUrl, true);
	const headers = {
		...(contentType ? { "content-type": contentType } : {}),
		...(provider.format === "anthropic" ? { "anthropic-version": "2023-06-01" } : {}),
		...(provider.key ? { [provider.authHeader || "Authorization"]: `${provider.authPrefix ?? "Bearer "}${provider.key}` } : {}),
	};
	return new Promise((resolve, reject) => {
		const req = (url.protocol === "https:" ? https : http).request(
			url,
			{
				method,
				headers,
				signal,
				timeout: 120000,
				lookup: (_name, opts, cb) => {
					const result = { address: addresses[0], family: isIP(addresses[0]) };
					if (opts?.all) cb(null, [result]);
					else cb(null, result.address, result.family);
				},
			},
			(res) => {
				const chunks = [];
				let size = 0;
				res.on("data", (chunk) => {
					size += chunk.length;
					if (size > 32 * 1024 * 1024) {
						res.destroy(new Error("Provider response is too large."));
					} else chunks.push(chunk);
				});
				res.on("error", () => reject(new Error("Provider response failed.")));
				res.on("end", () =>
					resolve({
						status: res.statusCode,
						contentType: res.headers["content-type"] ?? "application/octet-stream",
						body: Buffer.concat(chunks),
					}),
				);
			},
		);
		req.on("timeout", () => req.destroy(new Error("Provider request timed out.")));
		req.on("error", () => reject(new Error("Could not reach the provider.")));
		req.end(body);
	});
}
export async function testProvider(provider, request = providerRequest) {
	const result = await request(
		provider,
		["openai", "anthropic"].includes(provider.format) ? "/models" : provider.custom?.healthPath || "/health",
	);
	if (result.status < 200 || result.status >= 300)
		throw new Error(`Connection test failed: HTTP ${result.status}. Check the base URL and API key.`);
	if (!["openai", "anthropic"].includes(provider.format)) return { message: "Service is reachable.", models: [] };
	let parsed;
	try {
		parsed = JSON.parse(result.body);
	} catch {
		throw new Error("The endpoint did not return a compatible model list.");
	}
	if (!Array.isArray(parsed.data)) throw new Error("The endpoint did not return a compatible model list.");
	const catalogs = {};
	if (new URL(provider.baseUrl).hostname === "openrouter.ai") {
		catalogs.chat = parsed.data.map((m) => String(m.id));
		for (const [cap, modality] of [
			["stt", "transcription"],
			["tts", "audio"],
		]) {
			if (!provider.capabilities.includes(cap)) continue;
			const audio = await request(provider, `/models?output_modalities=${modality}`);
			if (audio.status !== 200) throw new Error(`Could not list ${cap} models: HTTP ${audio.status}.`);
			let list;
			try {
				list = JSON.parse(audio.body);
			} catch {
				throw new Error("Invalid audio model list.");
			}
			if (!Array.isArray(list.data)) throw new Error("Invalid audio model list.");
			catalogs[cap] = list.data.map((m) => String(m.id));
		}
	}
	const secrets = providerSecrets({ providers: [provider] });
	const models = [...new Set([...parsed.data.map((m) => String(m.id)), ...Object.values(catalogs).flat()])]
		.filter((id) => id && !secrets.some((secret) => id.includes(secret)))
		.slice(0, 5000);
	for (const cap of Object.keys(catalogs)) catalogs[cap] = catalogs[cap].filter((id) => !secrets.some((secret) => id.includes(secret)));
	return { message: `Connected. ${models.length} models available.`, models, catalogs };
}
export async function runRole(data, role, payload, request = providerRequest, { signal } = {}) {
	const send = (provider, path, options = {}) => request(provider, path, { ...options, signal });
	const route = roleRoute(data, role);
	if (!route) throw new Error(`No provider is configured for ${ROLES[role]}.`);
	const attempt = async (r) => {
		const provider = (data.providers ?? []).find((p) => p.id === r.provider);
		if (!provider || !provider.capabilities.includes(capability(role)) || (role === "local" && !provider.local))
			throw new Error("Invalid fallback connection.");
		if (provider.format === "custom") {
			const shape = provider.custom[capability(role)];
			const response = await customRequest(provider, shape, customVariables(payload, r), send);
			if (response.status < 200 || response.status >= 300) return response;
			if (role === "tts" && !shape.response?.audio) return response;
			let parsed;
			try {
				parsed = JSON.parse(response.body);
			} catch {
				throw new Error("Custom API returned invalid JSON.");
			}
			if (role === "tts") {
				const audio = jsonField(parsed, shape.response.audio);
				if (typeof audio !== "string" || !audio) throw new Error("Custom audio response field is missing.");
				return { status: 200, contentType: "audio/wav", body: Buffer.from(audio, "base64") };
			}
			const text = jsonField(parsed, shape.response.text);
			const tools = shape.response.toolCalls ? jsonField(parsed, shape.response.toolCalls) : [];
			if (tools != null && !Array.isArray(tools)) throw new Error("Custom toolCalls field must be an array.");
			if (typeof text !== "string" && !tools?.length) throw new Error("Custom response text field is missing.");
			if (role === "stt") return { status: 200, contentType: "application/json", body: Buffer.from(JSON.stringify({ text })) };
			return completionResponse(completion(r.model, text, tools), payload.stream);
		}
		if (capability(role) === "chat") {
			const { api_key, apiKey, base_url, baseUrl, ...input } = payload;
			if (provider.format === "anthropic") {
				const response = await send(provider, "/messages", {
					method: "POST",
					contentType: "application/json",
					body: JSON.stringify(anthropicRequest(input, r.model)),
				});
				if (response.status < 200 || response.status >= 300) return response;
				let parsed;
				try {
					parsed = JSON.parse(response.body);
				} catch {
					throw new Error("Anthropic returned invalid JSON.");
				}
				return completionResponse(anthropicResponse(parsed, r.model), payload.stream);
			}
			return send(provider, "/chat/completions", {
				method: "POST",
				contentType: "application/json",
				body: JSON.stringify({ ...input, model: r.model }),
			});
		}
		if (role === "stt") {
			const audio = Buffer.from(String(payload.audio ?? ""), "base64");
			if (!audio.length || audio.length > 24 * 1024 * 1024) throw new Error("Audio must be between 1 byte and 24 MB.");
			if (provider.format === "bark") return send(provider, "/transcribe", { method: "POST", contentType: "audio/wav", body: audio });
			const form = new FormData();
			form.append("model", r.model);
			form.append("file", new Blob([audio], { type: "audio/wav" }), "audio.wav");
			const encoded = new Response(form);
			return send(provider, "/audio/transcriptions", {
				method: "POST",
				contentType: encoded.headers.get("content-type"),
				body: Buffer.from(await encoded.arrayBuffer()),
			});
		}
		const text = String(payload.text ?? "");
		if (!text.trim() || text.length > 30000) throw new Error("Speech text must be between 1 and 30000 characters.");
		if (provider.format === "woof")
			return send(provider, "/speak", { method: "POST", contentType: "text/plain; charset=utf-8", body: text });
		return send(provider, "/audio/speech", {
			method: "POST",
			contentType: "application/json",
			body: JSON.stringify({ model: r.model, input: text, voice: r.voice || "alloy", response_format: "wav" }),
		});
	};
	let response;
	try {
		response = await attempt(route);
	} catch (e) {
		if (!route.fallback) throw e;
	}
	// Auth/configuration errors do not silently send content to a different provider.
	if ((!response || response.status === 429 || response.status >= 500) && route.fallback) response = await attempt(route.fallback);
	if (!response) throw new Error("Provider request failed.");
	if (response.status < 200 || response.status >= 300)
		throw new Error(`Provider returned HTTP ${response.status}. Check its settings and model ID.`);
	return response;
}

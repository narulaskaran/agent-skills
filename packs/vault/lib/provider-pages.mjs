import { FORMATS, PRESETS, ROLES, publicProvider } from "./providers.mjs";
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const hidden = (name, value) => `<input type="hidden" name="${esc(name)}" value="${esc(value)}">`;
const input = (label, name, value = "", type = "text", extra = "") =>
	`<label><span>${esc(label)}</span><input type="${type}" name="${esc(name)}" value="${esc(value)}" ${extra}></label>`;
const csrf = (token) => hidden("csrf", token);
const options = (items, selected) =>
	items.map(([id, label]) => `<option value="${esc(id)}"${id === selected ? " selected" : ""}>${esc(label)}</option>`).join("");
const select = (label, name, items, selected) =>
	`<label><span>${esc(label)}</span><select name="${esc(name)}">${options(items, selected)}</select></label>`;
const check = (label, name, checked) =>
	`<label class="check"><input type="checkbox" name="${esc(name)}" value="yes"${checked ? " checked" : ""}> ${esc(label)}</label>`;
export const settingsNav = `<nav><a href="/">Credentials</a><a href="/providers">Providers</a><a href="/models">Models &amp; voice</a></nav>`;
export function providersPage(data, token) {
	const providers = (data.providers ?? []).map(publicProvider);
	return `<h1>Providers</h1><p class="muted">Save each connection once, then assign it to jobs in Models &amp; voice. API keys stay in the vault.</p>
 ${providers.map((p) => `<article class="card"><b>${esc(p.name)}</b><p>${esc(p.baseUrl)}</p><p class="muted">${esc(FORMATS[p.format])} · ${esc(p.capabilities.join(", "))} · ${p.local ? "Local network" : "Hosted"} · ${p.hasKey ? "Key saved" : "No key"}</p><a href="/providers/edit?id=${encodeURIComponent(p.id)}">Edit connection</a><form method="post" action="/providers/test">${csrf(token)}${hidden("id", p.id)}<button>Test connection</button></form></article>`).join("") || "<p>No providers saved yet. Existing environment settings remain active until you assign jobs.</p>"}
 <div class="actions">${Object.entries(PRESETS)
		.map(([id, p]) => `<a class="btn" href="/providers/new?preset=${id}">Add ${esc(p.name || "custom endpoint")}</a>`)
		.join("")}</div>`;
}
export function providerForm(token, values, editing = false) {
	return `<h1>${editing ? "Edit provider" : "Add provider"}</h1><form method="post" action="/providers/save">${csrf(token)}
 ${input("Connection ID", "id", values.id, "text", editing ? "readonly" : 'required pattern="[A-Za-z0-9][A-Za-z0-9._-]{0,63}"')}
 ${input("Display name", "name", values.name)}${input("Base URL (include /v1 when the service requires it)", "baseUrl", values.baseUrl, "url", "required")}
 ${select("API format", "format", Object.entries(FORMATS), values.format || "openai")}
 <p class="muted">Compatible API uses /chat/completions, /audio/transcriptions and /audio/speech. Enable only the capabilities your service supports.</p>
 <fieldset><legend>Supported capabilities</legend>${["chat", "stt", "tts"].map((c) => check({ chat: "Chat and background work", stt: "Speech to text", tts: "Text to speech" }[c], `cap_${c}`, values.capabilities?.includes(c))).join("")}</fieldset>
 ${check("Runs on my local network (required for private work)", "local", values.local)}
 <p class="muted">Local endpoints use a literal private or loopback IP. Hosted endpoints require HTTPS.</p>
 ${input(editing && values.hasKey ? "API key (leave blank to keep saved key)" : "API key (optional for local services)", "key", "", "password", 'autocomplete="new-password"')}
 <p class="muted">Changing the base URL clears the saved key unless you enter it again.</p>
 ${input("Authentication header (default depends on API format)", "authHeader", values.authHeader || "")}
 ${input("Authentication prefix (for example Bearer followed by a space)", "authPrefix", values.authPrefix ?? (values.format === "anthropic" ? "" : "Bearer "))}
 <details${values.format === "custom" ? " open" : ""}><summary>Custom API shape</summary><p class="muted">For Custom format, enter JSON mappings for enabled capabilities (chat, stt, tts). Each has a path, request template and response field paths. Available variables: {{model}}, {{messages}}, {{system}}, {{tools}}, {{text}}, {{audio_base64}}, {{voice}}, {{max_tokens}}. Exact placeholders preserve JSON types. Put credentials in the API key field. Chat toolCalls, when mapped, must use compatible function-call objects. TTS returns audio bytes, or set response.audio to a base64 field path.</p><label><span>Mapping JSON</span><textarea name="custom" rows="12">${esc(typeof values.custom === "string" ? values.custom : JSON.stringify(values.custom || { healthPath: "/health", chat: { path: "/generate", request: { model: "{{model}}", messages: "{{messages}}", tools: "{{tools}}" }, response: { text: "result.text", toolCalls: "result.tool_calls" } } }, null, 2))}</textarea></label></details>
 ${editing ? check("Remove saved API key", "removeKey", false) : ""}
 <div class="actions"><button>Save connection</button><a href="/providers">Cancel</a></div></form>
 ${editing ? `<form method="post" action="/providers/delete">${csrf(token)}${hidden("id", values.id)}<button class="quiet">Delete connection</button><p class="muted">Connections assigned to a job cannot be deleted.</p></form>` : ""}`;
}
function routeFields(role, route, providers, fallback = false) {
	const prefix = `${role}_${fallback ? "fallback_" : ""}`;
	const cap = ["main", "background", "local"].includes(role) ? "chat" : role;
	const available = providers.filter((p) => p.capabilities.includes(cap) && (role !== "local" || p.local));
	return `${select(fallback ? "Fallback connection (used for outages or rate limits)" : "Connection", `${prefix}provider`, [["", fallback ? "No fallback" : role === "background" ? "Follow main conversation" : "Use environment / existing configuration"], ...available.map((p) => [p.id, p.name])], route?.provider || "")}
 ${input("Model ID (required for chat, optional for native speech formats)", `${prefix}model`, route?.model, "text", 'list="model-ids"')}
 ${role === "tts" ? input("Voice", `${prefix}voice`, route?.voice) + '<p class="muted">Compatible and custom APIs use this voice setting. Woof uses the voice configured by its service.</p>' : ""}
 ${cap === "chat" ? input("Context window (tokens)", `${prefix}contextWindow`, route?.contextWindow || 32768, "number", 'min="2048" max="10000000"') : ""}`;
}
export function modelsPage(data, token, catalogs = new Map()) {
	return `<h1>Models &amp; voice</h1><p class="muted">Choose a connection and model for each job. Saved changes apply to the next model or speech request. A request already sent finishes with its current provider.</p>
 <form method="post" action="/models/save">${csrf(token)}
 ${Object.entries(ROLES)
		.map(
			([role, label]) =>
				`<fieldset><legend>${esc(label)}</legend>${routeFields(role, data.roles?.[role], data.providers ?? [])}<details><summary>Optional fallback</summary><p class="muted">Content may be sent to the fallback if the primary is unavailable. Private work only allows local connections.</p>${routeFields(role, data.roles?.[role]?.fallback, data.providers ?? [], true)}</details></fieldset>`,
		)
		.join("")}
 <datalist id="model-ids">${[...new Set([...catalogs.values()].flat())].map((id) => `<option value="${esc(id)}">`).join("")}</datalist>
 <div class="actions"><button>Save settings</button></div></form><p><a href="/providers">Manage connections and test their availability</a></p>`;
}
export async function providerPage(url, options, token) {
	const data = options.read();
	if (url.pathname === "/providers") return providersPage(data, token);
	if (url.pathname === "/models") return modelsPage(data, token, options.providerCatalogs);
	if (url.pathname === "/providers/new") {
		const preset = PRESETS[url.searchParams.get("preset")] ?? PRESETS.custom;
		return providerForm(token, { ...preset, id: url.searchParams.get("preset") === "custom" ? "" : url.searchParams.get("preset") });
	}
	if (url.pathname === "/providers/edit") {
		const p = (data.providers ?? []).find((p) => p.id === url.searchParams.get("id"));
		if (!p) return '<p class="error">Provider not found.</p>';
		return providerForm(token, publicProvider(p), true);
	}
	return null;
}
export async function providerPost(path, form, options) {
	const { saveProvider, saveRoles, deleteProvider, testProvider } = await import("./providers.mjs");
	try {
		if (path === "/providers/save") {
			options.write((data) => saveProvider(data, form));
			return { content: `<p class="success">Connection saved.</p>${providersPage(options.read(), form.csrf)}` };
		}
		if (path === "/models/save") {
			options.write((data) => saveRoles(data, form));
			return {
				content: `<p class="success">Settings saved. They apply on the next request.</p>${modelsPage(options.read(), form.csrf, options.providerCatalogs)}`,
			};
		}
		if (path === "/providers/delete") {
			options.write((data) => deleteProvider(data, form.id));
			return { content: providersPage(options.read(), form.csrf) };
		}
		if (path === "/providers/test") {
			const p = (options.read().providers ?? []).find((p) => p.id === form.id);
			if (!p) throw new Error("Provider not found.");
			const result = await testProvider(p);
			options.providerCatalogs?.set(p.id, result.models);
			if (Object.keys(result.catalogs ?? {}).length)
				options.write((data) => ({
					...data,
					providers: (data.providers ?? []).map((item) => (item.id === p.id ? { ...item, catalog: result.catalogs } : item)),
				}));
			return {
				content: `<p class="success">${esc(result.message)}</p>${providersPage(options.read(), form.csrf)}<p><a href="/models">Choose models</a></p>`,
			};
		}
	} catch (error) {
		const content =
			path === "/models/save"
				? modelsPage(options.read(), form.csrf, options.providerCatalogs)
				: path === "/providers/save"
					? providerForm(
							form.csrf,
							{
								...form,
								hasKey: false,
								local: form.local === "yes",
								capabilities: ["chat", "stt", "tts"].filter((c) => form[`cap_${c}`] === "yes"),
							},
							(options.read().providers ?? []).some((p) => p.id === form.id),
						)
					: providersPage(options.read(), form.csrf);
		return { content: `<p class="error">${esc(error.message)}</p>${content}` };
	}
	return null;
}

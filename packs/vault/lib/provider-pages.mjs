import { FORMATS, PRESETS, ROLES, publicProvider } from "./providers.mjs";

// Shared page helpers. portal.mjs reuses these for the credential forms so every
// page speaks one visual language. All output is escaped, server rendered, no script.
export const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
export const hidden = (name, value) => `<input type="hidden" name="${esc(name)}" value="${esc(value)}">`;
export const csrf = (token) => hidden("csrf", token);
export const notice = (kind, text) =>
	`<div class="notice ${kind}" role="${kind === "error" ? "alert" : "status"}">${esc(text)}</div>`;
const hintFor = (name, hint) => (hint ? `<p class="hint" id="h-${esc(name)}">${esc(hint)}</p>` : "");
const describedBy = (name, hint) => (hint ? ` aria-describedby="h-${esc(name)}"` : "");

// Label above the control, optional helper text linked with aria-describedby.
// `extra` is trusted markup for attributes (never user data).
export function field(label, name, value = "", { type = "text", hint = "", extra = "", placeholder = "", locked = false, autocomplete = "off" } = {}) {
	const secret = type === "password";
	return `<div class="field"><label for="f-${esc(name)}">${esc(label)}</label><input id="f-${esc(name)}" type="${type}" name="${esc(name)}" value="${esc(secret ? "" : value)}" autocomplete="${autocomplete}" autocapitalize="none" spellcheck="false"${placeholder ? ` placeholder="${esc(placeholder)}"` : ""}${locked ? " readonly" : ""}${describedBy(name, hint)} ${extra}>${hintFor(name, hint)}</div>`;
}
export const select = (label, name, items, selected, hint = "") =>
	`<div class="field"><label for="f-${esc(name)}">${esc(label)}</label><select id="f-${esc(name)}" name="${esc(name)}"${describedBy(name, hint)}>${items
		.map(([id, text]) => `<option value="${esc(id)}"${id === selected ? " selected" : ""}>${esc(text)}</option>`)
		.join("")}</select>${hintFor(name, hint)}</div>`;
export const check = (label, name, checked, hint = "") =>
	`<div class="field"><label class="check"><input type="checkbox" name="${esc(name)}" value="yes"${checked ? " checked" : ""}${describedBy(name, hint)}><span>${esc(label)}</span></label>${hintFor(name, hint)}</div>`;

const SECTIONS = [
	["credentials", "/", "Credentials"],
	["providers", "/providers", "Providers"],
	["models", "/models", "Models &amp; voice"],
];
export const sectionFor = (pathname) => (pathname.startsWith("/providers") ? "providers" : pathname.startsWith("/models") ? "models" : "credentials");
export const sectionTitle = (section) => SECTIONS.find(([id]) => id === section)?.[2].replace("&amp;", "&") ?? "Vault";
export const settingsNav = (active = "credentials") =>
	`<nav aria-label="Vault sections">${SECTIONS.map(([id, href, label]) => `<a href="${href}"${id === active ? ' aria-current="page"' : ""}>${label}</a>`).join("")}</nav>`;

const head = (title, lede) => `<header class="page-head"><h1>${title}</h1>${lede ? `<p class="lede">${lede}</p>` : ""}</header>`;
const formats = FORMATS;

function providerCard(p, token) {
	return `<article class="card provider">
<div class="card-head"><h3>${esc(p.name)}</h3><span class="badge ${p.local ? "local" : "hosted"}">${p.local ? "Local network" : "Hosted"}</span></div>
<p class="url">${esc(p.baseUrl)}</p>
<dl class="meta"><dt>Format</dt><dd>${esc(formats[p.format])}</dd><dt>Used for</dt><dd>${p.capabilities.map((c) => `<span class="chip">${esc(c)}</span>`).join(" ")}</dd><dt>API key</dt><dd>${p.hasKey ? "Saved" : "None"}</dd></dl>
<div class="card-actions"><form method="post" action="/providers/test">${csrf(token)}${hidden("id", p.id)}<button class="ghost">Test connection</button></form><a class="act" href="/providers/edit?id=${encodeURIComponent(p.id)}">Edit connection</a></div>
</article>`;
}

export function providersPage(data, token) {
	const providers = (data.providers ?? []).map(publicProvider);
	const saved = providers.length
		? `<div class="cards">${providers.map((p) => providerCard(p, token)).join("")}</div>`
		: `<div class="empty">No providers saved yet. Existing environment settings remain active until you assign jobs.</div>`;
	const tiles = Object.entries(PRESETS)
		.map(
			([id, p]) =>
				`<a class="tile" href="/providers/new?preset=${id}"><b>Add ${esc(p.name || "custom endpoint")}</b><span>${esc(FORMATS[p.format])} · ${esc(p.capabilities.join(", "))}</span></a>`,
		)
		.join("");
	return `${head("Providers", "Save each connection once, then assign it to jobs in Models &amp; voice. API keys stay in the vault.")}
<section aria-labelledby="saved-h"><h2 id="saved-h">Your connections</h2>${saved}</section>
<section aria-labelledby="add-h"><h2 id="add-h">Add a connection</h2>
<p class="hint">Providers use an <b>API key</b> to call models. To sign in to a website with a username and password, add a <a href="/login/new">website login</a> under Credentials.</p>
<div class="tiles">${tiles}</div></section>`;
}

export function providerForm(token, values, editing = false) {
	const customOpen = values.format === "custom";
	const authOpen = Boolean(values.authHeader);
	const keyLabel = editing && values.hasKey ? "API key" : "API key (optional for local services)";
	const keyHint = editing && values.hasKey ? "A key is saved. Enter a new one to replace it, or leave blank to keep it. Changing the base URL clears the saved key unless you enter it again." : "Changing the base URL clears the saved key unless you enter it again.";
	return `${head(editing ? "Edit provider" : "Add provider", "A connection holds one endpoint and its API key. Assign it to jobs afterwards in Models &amp; voice.")}
<div class="narrow"><form method="post" action="/providers/save">${csrf(token)}
<section class="card panel"><h2>Connection</h2>
${field("Connection ID", "id", values.id, { locked: editing, extra: editing ? "" : 'required pattern="[A-Za-z0-9][A-Za-z0-9._-]{0,63}"' })}
${field("Display name", "name", values.name)}
${field("Base URL", "baseUrl", values.baseUrl, { type: "url", extra: "required", hint: "Include /v1 when the service requires it." })}
${select("API format", "format", Object.entries(FORMATS), values.format || "openai", "Compatible API uses /chat/completions, /audio/transcriptions and /audio/speech. Enable only the capabilities your service supports.")}
</section>
<section class="card panel"><fieldset><legend>Supported capabilities</legend>${["chat", "stt", "tts"].map((c) => check({ chat: "Chat and background work", stt: "Speech to text", tts: "Text to speech" }[c], `cap_${c}`, values.capabilities?.includes(c))).join("")}
${check("Runs on my local network (required for private work)", "local", values.local, "Local endpoints use a literal private or loopback IP. Hosted endpoints require HTTPS.")}</fieldset></section>
<section class="card panel"><h2>Authentication</h2>
${field(keyLabel, "key", "", { type: "password", autocomplete: "new-password", hint: keyHint })}
${editing ? check("Remove saved API key", "removeKey", false) : ""}
<details${authOpen ? " open" : ""}><summary>Advanced: authentication header</summary>
${field("Authentication header", "authHeader", values.authHeader || "", { hint: "Default depends on the API format." })}
${field("Authentication prefix", "authPrefix", values.authPrefix ?? (values.format === "anthropic" ? "" : "Bearer "), { hint: "For example Bearer followed by a space." })}
</details>
<details${customOpen ? " open" : ""}><summary>Advanced: custom API shape</summary><p class="hint">For Custom format, enter JSON mappings for enabled capabilities (chat, stt, tts). Each has a path, request template and response field paths. Available variables: {{model}}, {{messages}}, {{system}}, {{tools}}, {{text}}, {{audio_base64}}, {{voice}}, {{max_tokens}}. Exact placeholders preserve JSON types. Put credentials in the API key field. Chat toolCalls, when mapped, must use compatible function-call objects. TTS returns audio bytes, or set response.audio to a base64 field path.</p><div class="field"><label for="f-custom">Mapping JSON</label><textarea id="f-custom" class="mono" name="custom" rows="12" spellcheck="false" autocapitalize="none">${esc(typeof values.custom === "string" ? values.custom : JSON.stringify(values.custom || { healthPath: "/health", chat: { path: "/generate", request: { model: "{{model}}", messages: "{{messages}}", tools: "{{tools}}" }, response: { text: "result.text", toolCalls: "result.tool_calls" } } }, null, 2))}</textarea></div></details>
</section>
<div class="actions"><button>Save connection</button><a class="btn ghost" href="/providers">Cancel</a></div></form>
${editing ? `<form class="danger-zone" method="post" action="/providers/delete">${csrf(token)}${hidden("id", values.id)}<button class="danger">Delete connection</button><p class="hint">Connections assigned to a job cannot be deleted.</p></form>` : ""}</div>`;
}

const ROLE_HELP = {
	main: "Your everyday conversations.",
	background: "Behind-the-scenes work. Follows the main conversation unless set.",
	local: "Private work. Only local-network connections can be chosen.",
	stt: "Turns voice messages into text.",
	tts: "Speaks audio replies.",
};

function routeFields(role, route, providers, fallback = false) {
	const prefix = `${role}_${fallback ? "fallback_" : ""}`;
	const cap = ["main", "background", "local"].includes(role) ? "chat" : role;
	const available = providers.filter((p) => p.capabilities.includes(cap) && (role !== "local" || p.local));
	const none = available.length ? "" : role === "local" ? "No local-network connection supports this yet. Add one under Providers." : "No connection supports this yet. Add one under Providers.";
	const modelHint = fallback ? "" : cap === "chat" ? "Needed once you choose a connection. Suggestions appear after you test it." : "Needed for OpenAI-compatible connections; optional for Bark and Woof.";
	return `${select(fallback ? "Fallback connection" : "Connection", `${prefix}provider`, [["", fallback ? "No fallback" : role === "background" ? "Follow main conversation" : "Use environment / existing configuration"], ...available.map((p) => [p.id, p.name])], route?.provider || "", fallback ? "Used for outages or rate limits." : none)}
${field("Model ID", `${prefix}model`, route?.model, { extra: 'list="model-ids"', hint: modelHint })}
${role === "tts" ? field("Voice", `${prefix}voice`, route?.voice, { hint: fallback ? "" : "Compatible and custom APIs use this voice setting. Woof uses the voice configured by its service." }) : ""}`;
}
const contextField = (prefix, route) =>
	field("Context window (tokens)", `${prefix}contextWindow`, route?.contextWindow || 32768, { type: "number", extra: 'min="2048" max="10000000"' });

function roleCard(role, label, route, providers) {
	const chat = ["main", "background", "local"].includes(role);
	const assigned = providers.find((p) => p.id === route?.provider);
	const status = route?.provider
		? `<span class="badge on">${esc(assigned?.name || route.provider)}${route.model ? ` · ${esc(route.model)}` : ""}</span>`
		: `<span class="badge off">${role === "background" ? "Follows main" : "Environment default"}</span>`;
	const hasFallback = Boolean(route?.fallback?.provider);
	return `<section class="card job" role="group" aria-labelledby="job-${role}">
<div class="card-head"><h2 id="job-${role}">${esc(label)}</h2>${status}</div>
<p class="hint">${esc(ROLE_HELP[role] ?? "")}</p>
${routeFields(role, route, providers)}
<details${hasFallback ? " open" : ""}><summary>${chat ? "Context window &amp; fallback" : "Fallback"}${hasFallback ? ' <span class="badge on">Fallback set</span>' : ""}</summary>
${chat ? contextField(`${role}_`, route) : ""}
<div class="sub"><h3>Fallback</h3><p class="hint">Content may be sent to the fallback if the primary is unavailable. Private work only allows local connections.</p>${routeFields(role, route?.fallback, providers, true)}${chat ? contextField(`${role}_fallback_`, route?.fallback) : ""}</div></details>
</section>`;
}

export function modelsPage(data, token, catalogs = new Map()) {
	const providers = data.providers ?? [];
	return `${head("Models &amp; voice", "Choose a connection and model for each job. Saved changes apply to the next model or speech request. A request already sent finishes with its current provider.")}
<form method="post" action="/models/save">${csrf(token)}
<div class="jobs">${Object.entries(ROLES)
		.map(([role, label]) => roleCard(role, label, data.roles?.[role], providers))
		.join("")}</div>
<datalist id="model-ids">${[...new Set([...catalogs.values()].flat())].map((id) => `<option value="${esc(id)}">`).join("")}</datalist>
<div class="actions savebar"><button>Save settings</button><a class="btn ghost" href="/providers">Manage connections and test their availability</a></div></form>`;
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
		if (!p) return notice("error", "Provider not found.");
		return providerForm(token, publicProvider(p), true);
	}
	return null;
}
export async function providerPost(path, form, options) {
	const { saveProvider, saveRoles, deleteProvider, testProvider } = await import("./providers.mjs");
	try {
		if (path === "/providers/save") {
			options.write((data) => saveProvider(data, form));
			return { content: `${notice("success", "Connection saved.")}${providersPage(options.read(), form.csrf)}` };
		}
		if (path === "/models/save") {
			options.write((data) => saveRoles(data, form));
			return {
				content: `${notice("success", "Settings saved. They apply on the next request.")}${modelsPage(options.read(), form.csrf, options.providerCatalogs)}`,
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
				content: `${notice("success", result.message)}${providersPage(options.read(), form.csrf)}<p><a class="btn" href="/models">Choose models</a></p>`,
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
		return { content: `${notice("error", error.message)}${content}` };
	}
	return null;
}

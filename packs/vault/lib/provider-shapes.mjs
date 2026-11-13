// JSON templates, not executable code. Chat callers always speak one canonical
// tool-capable format; adapters translate only at the trusted provider boundary.
const VARIABLES = new Set(["model", "messages", "system", "tools", "text", "audio_base64", "voice", "max_tokens"]);
const DANGEROUS = new Set(["__proto__", "prototype", "constructor"]);
export function jsonField(value, path) {
	if (!path) return undefined;
	return String(path)
		.split(".")
		.reduce((obj, key) => (!DANGEROUS.has(key) && obj != null && Object.hasOwn(Object(obj), key) ? obj[key] : undefined), value);
}
export function renderTemplate(template, variables) {
	if (typeof template === "string") {
		const exact = /^\{\{([a-z_]+)\}\}$/.exec(template);
		if (exact) {
			if (!VARIABLES.has(exact[1])) throw new Error("Unknown template variable.");
			return variables[exact[1]] ?? null;
		}
		return template.replace(/\{\{([a-z_]+)\}\}/g, (_, name) => {
			if (!VARIABLES.has(name)) throw new Error("Unknown template variable.");
			const v = variables[name];
			return typeof v === "object" ? JSON.stringify(v) : String(v ?? "");
		});
	}
	if (Array.isArray(template)) return template.map((v) => renderTemplate(v, variables));
	if (template && typeof template === "object")
		return Object.fromEntries(
			Object.entries(template).map(([k, v]) => {
				if (DANGEROUS.has(k)) throw new Error("Invalid template property.");
				return [k, renderTemplate(v, variables)];
			}),
		);
	return template;
}
export function normalizeCustom(raw, capabilities) {
	let custom;
	try {
		custom = typeof raw === "string" ? JSON.parse(raw) : raw;
	} catch {
		throw new Error("Custom API mapping must be valid JSON.");
	}
	if (!custom || typeof custom !== "object" || Array.isArray(custom)) throw new Error("Custom API mapping must be a JSON object.");
	for (const c of capabilities) {
		const shape = custom[c];
		if (!shape || !validPath(shape.path) || shape.request === undefined)
			throw new Error(`Custom ${c} mapping needs a path and request template.`);
		if (c !== "tts" && !shape.response?.text) throw new Error(`Custom ${c} mapping needs a response.text field path.`);
		renderTemplate(shape.request, {});
	}
	if (custom.healthPath && !validPath(custom.healthPath)) throw new Error("Custom health path must start with a single slash.");
	return custom;
}
function validPath(path) {
	return typeof path === "string" && path.startsWith("/") && !path.startsWith("//") && !/[\r\n#]/.test(path);
}
const textOf = (content) =>
	typeof content === "string"
		? content
		: (content ?? [])
				.filter((b) => b.type === "text")
				.map((b) => b.text)
				.join("\n");
export function anthropicRequest(input, model) {
	const system = (input.messages ?? [])
		.filter((m) => m.role === "system" || m.role === "developer")
		.map((m) => textOf(m.content))
		.join("\n");
	const messages = [];
	for (const m of input.messages ?? []) {
		if (["system", "developer"].includes(m.role)) continue;
		let content;
		if (m.role === "tool") content = [{ type: "tool_result", tool_use_id: m.tool_call_id, content: textOf(m.content) }];
		else {
			content =
				typeof m.content === "string"
					? [{ type: "text", text: m.content }]
					: (m.content ?? []).map((b) => {
							if (b.type === "text") return { type: "text", text: b.text };
							if (b.type === "image_url") {
								const raw = b.image_url?.url ?? "";
								const match = /^data:([^;]+);base64,(.*)$/.exec(raw);
								return {
									type: "image",
									source: match ? { type: "base64", media_type: match[1], data: match[2] } : { type: "url", url: raw },
								};
							}
							throw new Error("Unsupported Anthropic message content.");
						});
			for (const tool of m.tool_calls ?? []) {
				let args;
				try {
					args = JSON.parse(tool.function.arguments || "{}");
				} catch {
					throw new Error("Invalid tool arguments.");
				}
				content.push({ type: "tool_use", id: tool.id, name: tool.function.name, input: args });
			}
		}
		const role = m.role === "assistant" ? "assistant" : "user";
		if (!content.length) continue;
		if (messages.at(-1)?.role === role) messages.at(-1).content.push(...content);
		else messages.push({ role, content });
	}
	return {
		model,
		max_tokens: input.max_tokens ?? input.max_completion_tokens ?? 4096,
		messages,
		...(system ? { system } : {}),
		...(input.tools?.length
			? {
					tools: input.tools.map((t) => ({
						name: t.function.name,
						description: t.function.description,
						input_schema: t.function.parameters,
					})),
				}
			: {}),
		stream: false,
	};
}
export function completion(model, text, tools = [], usage = {}) {
	return {
		id: "nano-" + Date.now(),
		object: "chat.completion",
		created: Math.floor(Date.now() / 1000),
		model,
		choices: [
			{
				index: 0,
				message: { role: "assistant", content: text || "", ...(tools.length ? { tool_calls: tools } : {}) },
				finish_reason: tools.length ? "tool_calls" : "stop",
			},
		],
		usage,
	};
}
export function anthropicResponse(data, model) {
	const text = (data.content ?? [])
		.filter((b) => b.type === "text")
		.map((b) => b.text)
		.join("");
	const tools = (data.content ?? [])
		.filter((b) => b.type === "tool_use")
		.map((b) => ({ id: b.id, type: "function", function: { name: b.name, arguments: JSON.stringify(b.input) } }));
	const result = completion(model, text, tools, {
		prompt_tokens: data.usage?.input_tokens ?? 0,
		completion_tokens: data.usage?.output_tokens ?? 0,
	});
	if (data.stop_reason === "max_tokens") result.choices[0].finish_reason = "length";
	return result;
}
export function completionResponse(value, stream) {
	if (!stream) return { status: 200, contentType: "application/json", body: Buffer.from(JSON.stringify(value)) };
	const choice = value.choices[0];
	const delta = {
		...choice.message,
		...(choice.message.tool_calls ? { tool_calls: choice.message.tool_calls.map((t, index) => ({ ...t, index })) } : {}),
	};
	const base = { id: value.id, object: "chat.completion.chunk", created: value.created, model: value.model };
	const chunks = [
		{ ...base, choices: [{ index: 0, delta, finish_reason: null }] },
		{ ...base, choices: [{ index: 0, delta: {}, finish_reason: choice.finish_reason }], usage: value.usage },
	];
	return {
		status: 200,
		contentType: "text/event-stream",
		body: Buffer.from(chunks.map((c) => "data: " + JSON.stringify(c) + "\n\n").join("") + "data: [DONE]\n\n"),
	};
}
export async function customRequest(provider, shape, variables, request) {
	const value = renderTemplate(shape.request, variables);
	const response = await request(provider, shape.path, {
		method: "POST",
		contentType: typeof value === "string" ? "text/plain; charset=utf-8" : "application/json",
		body: typeof value === "string" ? value : JSON.stringify(value),
	});
	return response;
}
export function customVariables(payload, route) {
	return {
		model: route.model,
		messages: payload.messages ?? [],
		system: (payload.messages ?? [])
			.filter((m) => ["system", "developer"].includes(m.role))
			.map((m) => textOf(m.content))
			.join("\n"),
		tools: payload.tools ?? [],
		text: payload.text ?? textOf((payload.messages ?? []).filter((m) => m.role === "user").at(-1)?.content),
		audio_base64: payload.audio ?? "",
		voice: route.voice,
		max_tokens: payload.max_tokens ?? payload.max_completion_tokens ?? 4096,
	};
}

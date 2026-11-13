import { publicSettings, runRole } from "./providers.mjs";

// Redact parsed values rather than JSON source: a decimal that resembles a
// card number must not become an unquoted marker in the wire representation.
export function scrubProviderText(body, contentType, scrub) {
	const visit = (value) => {
		if (typeof value === "string") return scrub(value);
		if (typeof value === "number") {
			const text = String(value);
			const safe = scrub(text);
			return safe === text ? value : safe;
		}
		if (Array.isArray(value)) return value.map(visit);
		if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, v]) => [scrub(key), visit(v)]));
		return value;
	};
	if (contentType.includes("text/event-stream"))
		return body
			.split("\n")
			.map((line) => {
				if (!line.startsWith("data:")) return scrub(line);
				const data = line.slice(5).trim();
				if (data === "[DONE]") return line;
				try {
					return "data: " + JSON.stringify(visit(JSON.parse(data)));
				} catch {
					throw new Error("Provider returned an invalid event.");
				}
			})
			.join("\n");
	try {
		return JSON.stringify(visit(JSON.parse(body)));
	} catch {
		if (contentType.includes("json")) throw new Error("Provider returned invalid JSON.");
		return scrub(body);
	}
}

// Available only on the agent's Unix socket. No settings mutation endpoints.
export async function handleProviderApi(req, res, { read, scrub }) {
	if (req.url === "/providers/config" && req.method === "GET") {
		req.resume();
		res.writeHead(200, { "content-type": "application/json" });
		res.end(scrubProviderText(JSON.stringify(publicSettings(read())), "application/json", scrub));
		return;
	}
	const match = /^\/providers\/run\/(main|background|local|stt|tts)$/.exec(req.url);
	if (!match || req.method !== "POST") {
		req.resume();
		res.writeHead(404);
		res.end();
		return;
	}
	try {
		const chunks = [];
		let size = 0;
		for await (const chunk of req) {
			size += chunk.length;
			if (size > 35 * 1024 * 1024) throw new Error("Provider request is too large.");
			chunks.push(chunk);
		}
		const payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
		if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("Invalid provider request.");
		const controller = new AbortController();
		res.on("close", () => {
			if (!res.writableFinished) controller.abort();
		});
		const result = await runRole(read(), match[1], payload, undefined, { signal: controller.signal });
		const body = match[1] === "tts" ? result.body : Buffer.from(scrubProviderText(result.body.toString("utf8"), result.contentType, scrub));
		res.writeHead(200, { "content-type": result.contentType, "cache-control": "no-store" });
		res.end(body);
	} catch (error) {
		res.writeHead(502, { "content-type": "application/json", "cache-control": "no-store" });
		res.end(JSON.stringify({ error: { message: scrub(error.message ?? "Provider request failed.") } }));
	}
}

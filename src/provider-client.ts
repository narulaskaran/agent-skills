// The only transport for owner-configured providers. It cannot read their keys.
import http from "node:http";
import { existsSync } from "node:fs";

export const PROVIDER_SOCKET = "/run/nano-vault/vault.sock";
export const providerSettingsAvailable = () => existsSync(PROVIDER_SOCKET);

export function providerFetch(path: string, body?: string, signal?: AbortSignal, socketPath = PROVIDER_SOCKET): Promise<Response> {
	return new Promise((resolve, reject) => {
		const req = http.request(
			{
				socketPath,
				path,
				method: body === undefined ? "GET" : "POST",
				headers: { "content-type": "application/json" },
				signal,
				timeout: 150_000,
			},
			(res) => {
				const chunks: Buffer[] = [];
				let size = 0;
				res.on("data", (chunk: Buffer) => {
					size += chunk.length;
					if (size > 36 * 1024 * 1024) res.destroy(new Error("Provider response is too large"));
					else chunks.push(chunk);
				});
				res.on("error", reject);
				res.on("end", () =>
					resolve(
						new Response(Buffer.concat(chunks), {
							status: res.statusCode,
							headers: { "content-type": String(res.headers["content-type"] || "application/json") },
						}),
					),
				);
			},
		);
		req.on("error", () => reject(new Error("The provider service is unavailable")));
		req.on("timeout", () => req.destroy(new Error("Provider request timed out")));
		req.end(body);
	});
}

export const roleFetch =
	(role: string, socketPath = PROVIDER_SOCKET): typeof fetch =>
	async (_url, init) => {
		if (typeof init?.body !== "string") throw new Error("Expected a JSON provider request");
		return providerFetch(`/providers/run/${role}`, init.body, init.signal ?? undefined, socketPath);
	};

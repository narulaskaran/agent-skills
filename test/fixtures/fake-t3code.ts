import { createHash } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * A stand-in for T3 Code's MCP endpoint and its OAuth server, shaped like the real one:
 * register -> decision (pairing code) -> token (form-encoded only) -> bearer on `/mcp`
 * (streamable HTTP answered with plain JSON).
 */
export async function startFakeT3Code(options: { pairingCode: string }) {
	const token = "fake-t3-token";
	const codes = new Map<string, { challenge: string; access: string }>();
	let pairingCodeUsed = false;
	const calls: { tool: string; args: Record<string, unknown> }[] = [];
	let origin = "";

	const tools = [
		{ name: "t3_project_list", description: "List projects. Pages can shift.", inputSchema: { type: "object", properties: {} } },
		{
			name: "t3_thread_launch",
			description: "Create one new top-level thread in a project. Task in `message`. Mention it with its `link`.",
			inputSchema: {
				type: "object",
				properties: { projectId: { type: "string" }, title: { type: "string" }, message: { type: "string" } },
				required: ["title"],
			},
		},
		{ name: "t3_project_delete", description: "Delete one project.", inputSchema: { type: "object", properties: { projectId: { type: "string" } } } },
	];

	function callTool(name: string, args: Record<string, unknown>) {
		calls.push({ tool: name, args });
		if (name === "t3_project_list") {
			const data = { projects: [{ id: "proj-1", title: "demo-repo", workspaceRoot: "/home/user/repos/demo-repo" }], nextCursor: null };
			return { content: [{ type: "text", text: JSON.stringify(data) }], structuredContent: data };
		}
		if (name === "t3_thread_launch") {
			const data = { threadId: "thread-1", title: args.title, link: `${origin}/env-1/thread-1` };
			return { content: [{ type: "text", text: JSON.stringify(data) }], structuredContent: data };
		}
		return { content: [{ type: "text", text: `unexpected call to ${name}` }], isError: true };
	}

	function rpc(request: { id?: number | string; method: string; params?: Record<string, unknown> }) {
		switch (request.method) {
			case "initialize":
				return { protocolVersion: request.params?.protocolVersion ?? "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "fake-t3", version: "0" } };
			case "ping":
				return {};
			case "tools/list":
				return { tools };
			case "tools/call":
				return callTool(String(request.params?.name), (request.params?.arguments ?? {}) as Record<string, unknown>);
			default:
				return undefined;
		}
	}

	const json = (res: ServerResponse, status: number, body: unknown) => {
		res.writeHead(status, { "content-type": "application/json" });
		res.end(JSON.stringify(body));
	};

	async function body(req: IncomingMessage): Promise<string> {
		let text = "";
		for await (const chunk of req) text += chunk;
		return text;
	}

	const server = createServer(async (req, res) => {
		const url = new URL(req.url ?? "/", origin);
		const text = await body(req);
		const type = req.headers["content-type"] ?? "";
		if (req.method === "POST" && url.pathname === "/oauth/mcp/register") {
			const meta = JSON.parse(text);
			return json(res, 201, { client_id: "fake-client", client_name: meta.client_name, redirect_uris: meta.redirect_uris });
		}
		if (req.method === "POST" && url.pathname === "/oauth/mcp/decision") {
			const { authorization, decision } = JSON.parse(text);
			if (decision.code !== options.pairingCode || pairingCodeUsed) {
				return json(res, 400, { _tag: "AuthMcpApprovalError", message: "That pairing code is unknown, expired, or already used." });
			}
			pairingCodeUsed = true;
			codes.set("auth-code", { challenge: authorization.code_challenge, access: decision.access });
			const redirect = new URL(authorization.redirect_uri);
			redirect.searchParams.set("code", "auth-code");
			redirect.searchParams.set("state", authorization.state);
			return json(res, 200, { redirectTo: redirect.toString() });
		}
		if (req.method === "POST" && url.pathname === "/oauth/mcp/token") {
			if (!type.startsWith("application/x-www-form-urlencoded")) return json(res, 415, { message: `Unsupported content-type: ${type}` });
			const form = new URLSearchParams(text);
			const pending = codes.get(form.get("code") ?? "");
			const verifier = form.get("code_verifier") ?? "";
			if (!pending || createHash("sha256").update(verifier).digest("base64url") !== pending.challenge) {
				return json(res, 400, { error: "invalid_grant", error_description: "The authorization code is invalid or expired." });
			}
			codes.delete(form.get("code") ?? "");
			return json(res, 200, { access_token: token, token_type: "Bearer", expires_in: 30 * 86_400, scope: "orchestration:read orchestration:operate" });
		}
		if (url.pathname === "/mcp") {
			if (req.headers.authorization !== `Bearer ${token}`) return json(res, 401, { error: "invalid_mcp_credential" });
			if (req.method !== "POST") {
				res.writeHead(req.method === "DELETE" ? 200 : 405);
				return res.end();
			}
			const message = JSON.parse(text);
			if (message.id === undefined) {
				res.writeHead(202);
				return res.end();
			}
			const result = rpc(message);
			return json(res, 200, result === undefined ? { jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "not found" } } : { jsonrpc: "2.0", id: message.id, result });
		}
		json(res, 404, { message: "not found" });
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
	return {
		url: origin,
		calls,
		close: () =>
			new Promise<void>((resolve) => {
				server.closeAllConnections();
				server.close(() => resolve());
			}),
	};
}

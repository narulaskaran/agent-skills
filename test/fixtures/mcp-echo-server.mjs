#!/usr/bin/env node
// A tiny stdio MCP server for tests: newline-delimited JSON-RPC with one tool, `reverse_text`.
import { createInterface } from "node:readline";

const tools = [
	{
		name: "reverse_text",
		description: "Reverse a piece of text character by character. Fixture tool for the Nano MCP pack tests.",
		inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
		annotations: { readOnlyHint: true },
	},
];

function send(message) {
	process.stdout.write(`${JSON.stringify(message)}\n`);
}

function handle(request) {
	switch (request.method) {
		case "initialize":
			return {
				protocolVersion: request.params?.protocolVersion ?? "2025-06-18",
				capabilities: { tools: {} },
				serverInfo: { name: "nano-test-echo", version: "1.0.0" },
				instructions: "Test fixture that reverses text.",
			};
		case "ping":
			return {};
		case "tools/list":
			return { tools };
		case "tools/call": {
			if (request.params?.name !== "reverse_text") throw { code: -32602, message: `unknown tool ${request.params?.name}` };
			const text = String(request.params?.arguments?.text ?? "");
			return { content: [{ type: "text", text: `reversed: ${[...text].reverse().join("")}` }] };
		}
		default:
			throw { code: -32601, message: `method not found: ${request.method}` };
	}
}

createInterface({ input: process.stdin }).on("line", (line) => {
	if (!line.trim()) return;
	let request;
	try {
		request = JSON.parse(line);
	} catch {
		return;
	}
	if (request.id === undefined) return; // notifications need no answer
	try {
		send({ jsonrpc: "2.0", id: request.id, result: handle(request) });
	} catch (error) {
		send({ jsonrpc: "2.0", id: request.id, error: { code: error.code ?? -32603, message: error.message ?? String(error) } });
	}
});

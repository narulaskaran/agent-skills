import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";
import type { PackContext } from "../../src/packs.ts";
import {
	ACCESS_LEVELS,
	DEFAULT_ACCESS,
	describeCredentials,
	isAccess,
	isExpired,
	mcpServerConfig,
	pairWithCode,
	readCredentials,
	rewriteLinks,
	t3Origin,
	writeCredentials,
} from "./auth.ts";

const SERVER = "t3code";

/** "T3 pairing code: <code> [access]" anywhere in a message. */
const PAIRING_RE = new RegExp(`\\bT3(?:\\s*Code)?\\s+pairing\\s+code\\s*[:=]?\\s*(\\S{6,})(?:\\s+(${ACCESS_LEVELS.join("|")}))?`, "i");

export function findPairingCode(text: string): { code: string; access?: string } | undefined {
	const m = PAIRING_RE.exec(text);
	if (!m?.[1]) return undefined;
	return { code: m[1].replace(/[.,;]+$/, ""), access: m[2]?.toLowerCase() };
}

/**
 * Registers T3 Code's MCP server once Nano holds a token (see `t3code-connect`), and keeps the
 * registration in step with the stored token. A pairing code the owner texts is redeemed here,
 * before the model runs, and replaced in the message, so the code never reaches the model.
 */
export default function t3code(ctx: PackContext): ExtensionFactory {
	const { dataDir } = ctx.config;
	if (!ctx.config.packs.includes("mcp")) console.error('nano: the t3code pack needs the mcp pack (NANO_PACKS="...,mcp,t3code")');

	return (pi) => {
		let registered: string | undefined;
		let origin: string | undefined;

		const sync = () => {
			const credentials = readCredentials(dataDir);
			const token = credentials && !isExpired(credentials) ? credentials.token : undefined;
			if (token === registered) return;
			if (registered) pi.unregisterMcpServer(SERVER);
			if (credentials && token) pi.registerMcpServer(SERVER, mcpServerConfig(credentials));
			registered = token;
			origin = credentials?.url;
		};
		sync();

		pi.on("input", async (event) => {
			const found = findPairingCode(event.text);
			if (!found) {
				sync();
				return { action: "continue" };
			}
			// Nano quotes recent turns when a new context window starts, so the same code can come back later.
			const seen = join(dataDir, "t3code", "redeemed-codes");
			const digest = createHash("sha256").update(found.code).digest("hex");
			let outcome: string;
			if (existsSync(seen) && readFileSync(seen, "utf8").split("\n").includes(digest)) {
				outcome = "it was redeemed earlier and is used up";
			} else {
				mkdirSync(dirname(seen), { recursive: true, mode: 0o700 });
				appendFileSync(seen, `${digest}\n`, { mode: 0o600 });
				const access = found.access ?? process.env.NANO_T3CODE_ACCESS ?? DEFAULT_ACCESS;
				try {
					if (!isAccess(access)) throw new Error(`unknown access level ${access}`);
					const credentials = await pairWithCode({ url: t3Origin(), code: found.code, access });
					writeCredentials(dataDir, credentials);
					outcome = `redeemed. ${describeCredentials(credentials)}`;
				} catch (error) {
					outcome = `redeeming it failed: ${(error as Error)?.message ?? error}. The code is used up; the owner needs a new one.`;
				}
			}
			sync();
			const text = event.text.split(found.code).join("[removed]");
			return { action: "transform", text: `${text}\n[The T3 pairing code in this message was removed by Nano before you saw it; ${outcome}]` };
		});

		pi.on("tool_result", async (event) => {
			const webUrl = process.env.NANO_T3CODE_WEB_URL;
			if (!webUrl || !origin || !event.toolName.startsWith(`mcp__${SERVER}__`)) return undefined;
			const from = origin;
			const content = event.content.map((part) => (part.type === "text" ? { ...part, text: rewriteLinks(part.text, from, webUrl) } : part));
			const structuredContent =
				event.structuredContent === undefined ? undefined : JSON.parse(rewriteLinks(JSON.stringify(event.structuredContent), from, webUrl));
			return { content, structuredContent };
		});
	};
}

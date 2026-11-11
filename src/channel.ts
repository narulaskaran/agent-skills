import { mkdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { createInterface } from "node:readline";
import type { Config } from "./config.ts";

export interface InboundFile {
	path: string;
	name: string;
	mimeType: string;
	kind: "image" | "voice" | "file";
}

export interface Inbound {
	spaceId: string;
	senderId: string;
	messageId: string;
	text: string;
	files: InboundFile[];
}

export interface Channel {
	/** Resolves when the channel stops. `onMessage` must not throw. */
	start(onMessage: (message: Inbound) => void): Promise<void>;
	send(spaceId: string, text: string): Promise<void>;
	sendFile(spaceId: string, path: string, caption?: string): Promise<void>;
	typing(spaceId: string, on: boolean): Promise<void>;
	stop(): Promise<void>;
}

const URL_RE = /https?:\/\/[^\s)'"<>]+/i;
const MARKDOWN_RE = /(\*\*[^*]+\*\*|^\s*[-*] |^#{1,6} |`[^`]+`)/m;
const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;

/**
 * Markdown bubbles turn on data detection upstream, which can fail on raw
 * URLs. iMessage links plain URLs by itself, so anything with a URL goes out
 * as plain text.
 */
export function chooseFormat(body: string): "markdown" | "text" {
	return MARKDOWN_RE.test(body) && !URL_RE.test(body) ? "markdown" : "text";
}

function safeName(name: string): string {
	return basename(name).replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 80) || "file";
}

export async function createPhotonChannel(config: Config): Promise<Channel> {
	const core = await import("@spectrum-ts/core");
	const { imessage } = await import("@spectrum-ts/imessage");
	const app = await core.Spectrum({
		projectId: config.photonProjectId,
		projectSecret: config.photonProjectSecret,
		providers: [imessage.config()],
		options: { flattenGroups: true },
	});

	type AnySpace = any;
	const spaces = new Map<string, AnySpace>();
	const seen = new Set<string>();
	const allowed = new Set(config.allowedUsers);
	let stopped = false;

	async function resolveSpace(spaceId: string): Promise<AnySpace> {
		const cached = spaces.get(spaceId);
		if (cached) return cached;
		const im = imessage(app as never) as AnySpace;
		const phone = /^(?:any;-;)?(\+\d{6,})$/.exec(spaceId)?.[1];
		const space = phone ? await im.space.create(phone) : await im.space.get(spaceId);
		if (!space) throw new Error(`cannot resolve conversation ${spaceId}`);
		spaces.set(spaceId, space);
		return space;
	}

	async function saveBinary(content: AnySpace, messageId: string): Promise<InboundFile | undefined> {
		if (typeof content.size === "number" && content.size > MAX_ATTACHMENT_BYTES) return undefined;
		const bytes: Buffer = Buffer.from(await content.read());
		if (bytes.length > MAX_ATTACHMENT_BYTES) return undefined;
		const mimeType: string = content.mimeType ?? "application/octet-stream";
		const day = new Date().toISOString().slice(0, 10);
		const dir = join(config.dataDir, "inbox", day);
		mkdirSync(dir, { recursive: true });
		const name = safeName(content.name ?? `${content.type}-${messageId}`);
		const path = join(dir, `${Date.now()}-${name}`);
		writeFileSync(path, bytes);
		const kind = content.type === "voice" ? "voice" : mimeType.startsWith("image/") ? "image" : "file";
		return { path, name, mimeType, kind };
	}

	async function normalize(content: AnySpace, messageId: string, out: { text: string[]; files: InboundFile[] }) {
		if (!content || typeof content !== "object") return;
		switch (content.type) {
			case "text":
				if (content.text) out.text.push(content.text);
				break;
			case "richlink":
				if (content.url) out.text.push(content.url);
				break;
			case "attachment":
			case "voice": {
				try {
					const file = await saveBinary(content, messageId);
					if (file) out.files.push(file);
					else out.text.push(`[attachment too large to receive: ${content.name ?? content.type}]`);
				} catch (error) {
					console.error("nano: failed to read attachment:", error);
					out.text.push(`[attachment could not be read: ${content.name ?? content.type}]`);
				}
				break;
			}
			case "group":
				for (const item of Array.isArray(content.items) ? content.items : []) {
					await normalize(item?.content ?? item, messageId, out);
				}
				break;
			default:
				// reactions, read receipts, typing, edits: not conversation input for now
				break;
		}
	}

	return {
		async start(onMessage) {
			let backoff = 1000;
			while (!stopped) {
				try {
					for await (const [space, message] of app.messages as AsyncIterable<[AnySpace, AnySpace]>) {
						backoff = 1000;
						if (message?.direction && message.direction !== "inbound") continue;
						const messageId = String(message.id ?? "");
						if (messageId && seen.has(messageId)) continue;
						if (messageId) {
							seen.add(messageId);
							if (seen.size > 2000) seen.delete(seen.values().next().value as string);
						}
						const senderId = String(message.sender?.id ?? "");
						if (!allowed.has(senderId)) {
							if (senderId) console.error(`nano: ignoring message from non-allowed sender (${senderId.slice(0, 4)}…)`);
							continue;
						}
						// A direct chat is keyed by the phone number, the same id proactive sends use.
						const rawSpaceId = String(space.id ?? message.space?.id ?? senderId);
						const spaceId = /^any;-;(\+\d{6,})$/.exec(rawSpaceId)?.[1] ?? rawSpaceId;
						spaces.set(spaceId, space);
						const out = { text: [] as string[], files: [] as InboundFile[] };
						await normalize(message.content, messageId, out);
						if (out.text.length === 0 && out.files.length === 0) continue;
						void Promise.resolve(message.read?.()).catch(() => {});
						onMessage({ spaceId, senderId, messageId, text: out.text.join("\n"), files: out.files });
					}
					if (!stopped) console.error("nano: inbound stream ended, re-subscribing");
				} catch (error) {
					if (stopped) break;
					console.error("nano: inbound stream error, re-subscribing:", (error as Error)?.message ?? error);
				}
				await new Promise((r) => setTimeout(r, backoff + Math.random() * backoff * 0.2));
				backoff = Math.min(backoff * 2, 30_000);
			}
		},
		async send(spaceId, body) {
			const space = await resolveSpace(spaceId);
			const builder = chooseFormat(body) === "markdown" ? core.markdown(body) : core.text(body);
			await space.send(builder);
		},
		async sendFile(spaceId, path, caption) {
			const space = await resolveSpace(spaceId);
			await space.send(core.attachment(path, { name: basename(path) }));
			if (caption) await space.send(core.text(caption));
		},
		async typing(spaceId, on) {
			try {
				const space = await resolveSpace(spaceId);
				await space.send(core.typing(on ? "start" : "stop"));
			} catch {
				// typing indicators are polish, never a failure
			}
		},
		async stop() {
			stopped = true;
			await app.stop();
		},
	};
}

/** Local test channel: one line on stdin is one inbound message; replies go to stdout. */
export function createStdinChannel(): Channel {
	let rl: ReturnType<typeof createInterface> | undefined;
	return {
		start(onMessage) {
			rl = createInterface({ input: process.stdin });
			let n = 0;
			rl.on("line", (line) => {
				if (!line.trim()) return;
				onMessage({ spaceId: "stdin", senderId: "stdin", messageId: `stdin-${++n}`, text: line, files: [] });
			});
			return new Promise((resolve) => rl?.on("close", resolve));
		},
		async send(_spaceId, body) {
			process.stdout.write(`\nnano> ${body}\n`);
		},
		async sendFile(_spaceId, path, caption) {
			process.stdout.write(`\nnano> [file ${path}]${caption ? ` ${caption}` : ""}\n`);
		},
		async typing() {},
		async stop() {
			rl?.close();
		},
	};
}

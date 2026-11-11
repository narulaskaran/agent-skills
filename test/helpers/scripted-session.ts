import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type FauxResponseStep, fauxProvider } from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { Conversation, StateStore } from "../../src/agent.ts";
import type { Channel } from "../../src/channel.ts";
import { type Config, loadConfig } from "../../src/config.ts";
import { Scheduler } from "../../src/scheduler.ts";

/** Text of every tool result in a model request, newest last. */
export function toolResults(context: { messages: readonly unknown[] }): string[] {
	return context.messages
		.filter((m): m is { role: "toolResult"; content: { type: string; text?: string }[] } => (m as { role?: string }).role === "toolResult")
		.map((m) => m.content.map((c) => c.text ?? "").join(""));
}

/**
 * A Nano conversation as the stdin channel runs it, with a scripted model instead of a real one.
 * Replies the agent sends are collected in `sent`; `next()` resolves with the next one.
 */
export async function scriptedConversation(options: { packs: string; env?: Record<string, string>; dataDir?: string }) {
	const dataDir = options.dataDir ?? mkdtempSync(join(tmpdir(), "nano-test-"));
	const faux = fauxProvider({ provider: "faux", models: [{ id: "scripted" }] });
	const config: Config = loadConfig({
		NANO_CHANNEL: "stdin",
		NANO_DATA_DIR: dataDir,
		NANO_PACKS: options.packs,
		NANO_MODEL: "faux/scripted",
		NANO_THINKING: "off",
		...options.env,
	});
	const runtime = await ModelRuntime.create({ authPath: join(dataDir, "pi", "auth.json"), modelsPath: null, refreshOnCreate: false });
	runtime.registerNativeProvider(faux.provider);

	const sent: string[] = [];
	const waiters: ((text: string) => void)[] = [];
	const channel: Channel = {
		async start() {},
		async send(_space, text) {
			const waiter = waiters.shift();
			if (waiter) waiter(text);
			else sent.push(text);
		},
		async sendFile() {},
		async typing() {},
		async stop() {},
	};
	const scheduler = new Scheduler(config, { send: async () => {}, task: async () => {} });
	const conversation = new Conversation("stdin", config, channel, new StateStore(dataDir), runtime, scheduler);
	return {
		config,
		dataDir,
		conversation,
		script(steps: FauxResponseStep[]) {
			faux.setResponses(steps);
		},
		say(text: string) {
			conversation.receive({ spaceId: "stdin", senderId: "stdin", messageId: `m-${Date.now()}`, text, files: [] });
		},
		next(timeoutMs = 20_000): Promise<string> {
			const ready = sent.shift();
			if (ready !== undefined) return Promise.resolve(ready);
			return new Promise((resolve, reject) => {
				const timer = setTimeout(() => reject(new Error("no reply from the agent")), timeoutMs);
				waiters.push((text) => {
					clearTimeout(timer);
					resolve(text);
				});
			});
		},
		pending: () => faux.getPendingResponseCount(),
	};
}

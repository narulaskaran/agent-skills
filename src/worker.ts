import { join } from "node:path";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { Channel } from "./channel.ts";
import { type Config, localStamp } from "./config.ts";
import { resolveModel } from "./models.ts";
import { packExtensions } from "./packs.ts";
import { buildSystemPrompt } from "./prompt.ts";
import type { Scheduler } from "./scheduler.ts";
import { assistantText, createNanoSession } from "./session.ts";
import type { TaskRunner } from "./tasks.ts";
import { nanoTools } from "./tools.ts";

/** A channel that reaches no one: what a worker sends is kept for its result. */
export function bufferedChannel(): { channel: Channel; texts: string[]; files: string[] } {
	const texts: string[] = [];
	const files: string[] = [];
	const channel: Channel = {
		start: async () => {},
		send: async (_spaceId, text) => void texts.push(text),
		sendFile: async (_spaceId, path, caption) => {
			files.push(path);
			if (caption) texts.push(caption);
		},
		typing: async () => {},
		stop: async () => {},
	};
	return { channel, texts, files };
}

/** Runs a task in its own Pi session with the main agent's tools and skills, minus delegation and direct messaging. */
export function createWorkerRunner(deps: { config: Config; modelRuntime: ModelRuntime; scheduler: Scheduler }): TaskRunner {
	const { config, modelRuntime, scheduler } = deps;
	return async (task, signal, update) => {
		const { model, label, note } = resolveModel(config, modelRuntime, task.role, task.private);
		update({ model: label });
		const out = bufferedChannel();
		const session = await createNanoSession({
			config,
			modelRuntime,
			model,
			systemPrompt: buildSystemPrompt(config, { private: task.private }),
			extensionFactories: [
				nanoTools(config, out.channel, scheduler, task.spaceId, { modelRuntime, worker: true }),
				...(await packExtensions({
					config,
					channel: out.channel,
					scheduler,
					spaceId: task.spaceId,
					Type,
					worker: { taskId: task.id, title: task.title, private: task.private },
				})),
			],
			sessionsDir: join(config.dataDir, "sessions", "tasks"),
		});
		update({ sessionFile: session.sessionFile, model: label });

		let lastError: string | undefined;
		const unsubscribe = session.subscribe((event) => {
			if (event.type === "message_end" && (event.message as { role?: string }).role === "assistant") lastError = assistantText(event.message).error;
		});
		const stop = () => void session.abort().catch(() => {});
		signal.addEventListener("abort", stop, { once: true });
		try {
			if (signal.aborted) throw new Error(String(signal.reason));
			await session.prompt(`[${localStamp(config)}] Task: ${task.title}\n\n${task.instructions}`);
			if (signal.aborted) throw new Error(String(signal.reason));
			if (lastError) throw new Error(`model error: ${lastError.slice(0, 300)}`);
			const answer = session.getLastAssistantText()?.trim() ?? "";
			const sent = out.texts.length > 0 ? `\n\n(Messages the task tried to send: ${out.texts.join(" / ").slice(0, 1000)})` : "";
			return { text: answer + sent, files: out.files, model: label, note };
		} finally {
			signal.removeEventListener("abort", stop);
			unsubscribe();
			session.dispose();
		}
	};
}

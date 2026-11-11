import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import type { ModelRole } from "./models.ts";

/**
 * Background tasks: self-contained work that runs in its own Pi session so the main
 * conversation stays free. This file knows nothing about Pi; the runner that does the work
 * is passed in (see worker.ts), which keeps queueing, limits and hand-back testable.
 */

export type TaskStatus = "queued" | "running" | "done" | "failed" | "cancelled" | "lost";

export interface TaskSpec {
	title: string;
	/** Standalone instructions: the worker sees nothing else of the conversation. */
	instructions: string;
	role: ModelRole;
	/** Private work runs on the local model or not at all. */
	private: boolean;
	spaceId: string;
	/** "schedule": started by a background scheduled job; a [silent] result is dropped. */
	source: "delegate" | "schedule";
}

export interface TaskResult {
	text: string;
	files: string[];
	model?: string;
	note?: string;
}

export interface Task extends TaskSpec {
	id: string;
	status: TaskStatus;
	createdAt: number;
	startedAt?: number;
	endedAt?: number;
	result?: string;
	files?: string[];
	error?: string;
	sessionFile?: string;
	model?: string;
	note?: string;
	/** A lost task has been reported to the owner once. */
	reported?: boolean;
}

export type TaskRunner = (task: Task, signal: AbortSignal, update: (fields: Pick<Task, "sessionFile" | "model">) => void) => Promise<TaskResult>;

export interface TaskManagerOptions {
	/** JSON file that survives restarts. */
	path: string;
	maxConcurrent: number;
	timeoutMs: number;
	runner: TaskRunner;
	/** Hands a finished task to the main conversation as a non-owner event. Calls arrive in completion order. */
	handBack: (spaceId: string, prompt: string) => Promise<void>;
	now?: () => number;
}

const KEEP_FINISHED = 50;
const RESULT_CHARS = 4000;

export const isSilent = (text: string | undefined): boolean => /^\[silent\]\.?$/i.test((text ?? "").trim());

function clip(text: string, max: number): string {
	return text.length > max ? `${text.slice(0, max)}\n[cut at ${max} of ${text.length} characters]` : text;
}

/** What the main agent receives when a task ends, or undefined when nothing should reach it. */
export function handBackPrompt(task: Task): string | undefined {
	const head = `Background task ${task.id} "${task.title}"`;
	const scheduled = task.source === "schedule";
	if (task.status === "done") {
		if (scheduled && isSilent(task.result)) return undefined;
		return [
			`${head} finished${task.model ? ` (ran on ${task.model})` : ""}.`,
			task.note ?? "",
			`Result:\n${clip(task.result?.trim() || "(no answer)", RESULT_CHARS)}`,
			task.files?.length ? `Files it produced: ${task.files.join(", ")}` : "",
			scheduled
				? "It was a scheduled background job. Pass on what matters to the owner, briefly and in your own words, or reply exactly [silent] if nothing does."
				: "Tell the owner what they need from this, briefly and in your own words. Send files they should have with send_file.",
		]
			.filter(Boolean)
			.join("\n");
	}
	if (task.status === "failed") {
		return `${head} failed: ${task.error ?? "unknown error"}\nTell the owner briefly, and offer to retry if it still matters.`;
	}
	return undefined;
}

export function lostPrompt(tasks: Task[]): string {
	const lines = tasks.map((t) => `- ${t.id} "${t.title}"${t.source === "schedule" ? " (scheduled job)" : ""}`);
	return `These background tasks were interrupted by a restart and did not finish:\n${lines.join("\n")}\nTell the owner briefly, and offer to rerun the ones that still matter.`;
}

export function describeTask(task: Task, now = Date.now()): string {
	const since = task.startedAt ?? task.createdAt;
	const minutes = Math.round(((task.endedAt ?? now) - since) / 60_000);
	const outcome = task.status === "failed" ? ` | ${task.error}` : task.status === "done" ? ` | ${(task.result ?? "").replace(/\s+/g, " ").slice(0, 200)}` : "";
	return `${task.id} | ${task.status} | ${task.title} | ${task.model ?? task.role}${task.private ? ", private" : ""} | ${minutes} min${outcome}`;
}

export class TaskManager {
	private tasks: Task[] = [];
	private readonly controllers = new Map<string, AbortController>();
	private readonly options: TaskManagerOptions;
	private readonly now: () => number;
	private stopping = false;

	constructor(options: TaskManagerOptions) {
		this.options = options;
		this.now = options.now ?? Date.now;
		try {
			if (existsSync(options.path)) this.tasks = JSON.parse(readFileSync(options.path, "utf8")).tasks ?? [];
		} catch (error) {
			console.error("nano: could not read tasks file, starting empty:", (error as Error)?.message ?? error);
		}
		// Anything that was queued or running belonged to a previous process and is gone.
		for (const task of this.tasks) {
			if (task.status === "queued" || task.status === "running") {
				task.status = "lost";
				task.endedAt = this.now();
			}
		}
		this.save();
	}

	list(): Task[] {
		return [...this.tasks];
	}

	get(id: string): Task | undefined {
		return this.tasks.find((t) => t.id === id);
	}

	active(): Task[] {
		return this.tasks.filter((t) => t.status === "queued" || t.status === "running");
	}

	start(spec: TaskSpec): Task {
		let id = randomBytes(2).toString("hex");
		while (this.get(id)) id = randomBytes(2).toString("hex");
		const task: Task = { ...spec, id, status: "queued", createdAt: this.now() };
		this.tasks.push(task);
		this.save();
		this.pump();
		return task;
	}

	/** Cancelled tasks are not handed back: whoever cancelled already knows. */
	cancel(id: string): Task | undefined {
		const task = this.get(id);
		if (!task) return undefined;
		if (task.status === "queued") {
			task.status = "cancelled";
			task.endedAt = this.now();
			this.save();
		} else if (task.status === "running") {
			this.controllers.get(id)?.abort("cancelled");
		}
		return task;
	}

	/** Report tasks lost in a restart, once. Call after the conversations can receive events. */
	async reportLost(): Promise<void> {
		const lost = this.tasks.filter((t) => t.status === "lost" && !t.reported);
		const bySpace = new Map<string, Task[]>();
		for (const task of lost) bySpace.set(task.spaceId, [...(bySpace.get(task.spaceId) ?? []), task]);
		for (const task of lost) task.reported = true;
		this.save();
		await Promise.all([...bySpace].map(([spaceId, tasks]) => this.options.handBack(spaceId, lostPrompt(tasks))));
	}

	/** Shutdown: stop the workers but leave them marked running, so the next start reports them as lost. */
	stop(): void {
		this.stopping = true;
		for (const controller of this.controllers.values()) controller.abort("shutdown");
	}

	private pump(): void {
		if (this.stopping) return;
		const running = this.tasks.filter((t) => t.status === "running").length;
		const next = this.tasks.filter((t) => t.status === "queued").slice(0, Math.max(0, this.options.maxConcurrent - running));
		for (const task of next) void this.run(task);
	}

	private async run(task: Task): Promise<void> {
		const controller = new AbortController();
		this.controllers.set(task.id, controller);
		task.status = "running";
		task.startedAt = this.now();
		this.save();
		const timer = setTimeout(() => controller.abort("timeout"), this.options.timeoutMs);
		timer.unref();
		// Stop waiting as soon as the task is aborted, even if the runner is slow to notice.
		const aborted = new Promise<never>((_, reject) =>
			controller.signal.addEventListener("abort", () => reject(new Error(String(controller.signal.reason))), { once: true }),
		);
		aborted.catch(() => {});
		try {
			const update = (fields: Pick<Task, "sessionFile" | "model">) => {
				Object.assign(task, fields);
				this.save();
			};
			const result = await Promise.race([this.options.runner(task, controller.signal, update), aborted]);
			this.finish(task, "done", { result: result.text, files: result.files, model: result.model ?? task.model, note: result.note });
		} catch (error) {
			const reason = controller.signal.aborted ? controller.signal.reason : undefined;
			if (reason === "shutdown") return;
			if (reason === "cancelled") this.finish(task, "cancelled", {});
			else if (reason === "timeout") {
				this.finish(task, "failed", { error: `timed out after ${Math.round(this.options.timeoutMs / 60_000)} minutes and was stopped` });
			} else this.finish(task, "failed", { error: ((error as Error)?.message ?? String(error)).slice(0, 500) });
		} finally {
			clearTimeout(timer);
			this.controllers.delete(task.id);
			this.pump();
		}
	}

	private finish(task: Task, status: TaskStatus, fields: Partial<Task>): void {
		Object.assign(task, fields, { status, endedAt: this.now() });
		this.save();
		console.error(`nano: task ${task.id} (${task.title}) ${status}${task.error ? `: ${task.error}` : ""}`);
		const prompt = handBackPrompt(task);
		if (prompt) {
			this.options.handBack(task.spaceId, prompt).catch((error) => console.error(`nano: hand-back of task ${task.id} failed:`, error));
		}
	}

	private save(): void {
		const finished = this.tasks.filter((t) => t.status !== "queued" && t.status !== "running" && (t.status !== "lost" || t.reported));
		if (finished.length > KEEP_FINISHED) {
			const drop = new Set(finished.slice(0, finished.length - KEEP_FINISHED));
			this.tasks = this.tasks.filter((t) => !drop.has(t));
		}
		const tmp = `${this.options.path}.tmp`;
		writeFileSync(tmp, JSON.stringify({ tasks: this.tasks }, null, 2));
		renameSync(tmp, this.options.path);
	}
}

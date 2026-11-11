import { appendFileSync, existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	type AgentSession,
	createAgentSession,
	DefaultResourceLoader,
	ModelRuntime,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import type { Channel, Inbound } from "./channel.ts";
import { type Config, currentTimezone, localStamp } from "./config.ts";
import { packExtensions, skillPaths } from "./packs.ts";
import { buildSystemPrompt } from "./prompt.ts";
import type { Scheduler } from "./scheduler.ts";
import { nanoTools } from "./tools.ts";
import { Type } from "typebox";

interface Turn {
	role: "owner" | "nano";
	text: string;
	at: number;
}

interface SpaceState {
	sessionFile?: string;
	lastActivity: number;
	recent: Turn[];
}

const BURST_MS = 1200;
const TYPING_REFRESH_MS = 25_000;
const RECENT_KEEP = 12;
const CARRY_CHARS = 3000;

/** Small JSON store for what must survive a restart: which Pi session each conversation is on. */
export class StateStore {
	private readonly path: string;
	private data: { spaces: Record<string, SpaceState> };

	constructor(dataDir: string) {
		this.path = join(dataDir, "state.json");
		try {
			this.data = existsSync(this.path) ? JSON.parse(readFileSync(this.path, "utf8")) : { spaces: {} };
		} catch {
			this.data = { spaces: {} };
		}
		this.data.spaces ??= {};
	}

	space(id: string): SpaceState {
		this.data.spaces[id] ??= { lastActivity: 0, recent: [] };
		return this.data.spaces[id];
	}

	save(): void {
		const tmp = `${this.path}.tmp`;
		writeFileSync(tmp, JSON.stringify(this.data, null, 2));
		renameSync(tmp, this.path);
	}
}

/** Text of the turns just before an idle gap, so a fresh context window still knows what was being discussed. */
export function carryOver(recent: Turn[], maxChars = CARRY_CHARS): string {
	const lines: string[] = [];
	let used = 0;
	for (const turn of [...recent].reverse()) {
		const line = `${turn.role === "owner" ? "Owner" : "You"}: ${turn.text.replace(/\s+/g, " ").slice(0, 600)}`;
		if (used + line.length > maxChars) break;
		lines.unshift(line);
		used += line.length;
	}
	return lines.join("\n");
}

export function isIdle(lastActivity: number, idleHours: number, now = Date.now()): boolean {
	return lastActivity > 0 && now - lastActivity > idleHours * 3_600_000;
}

function assistantText(message: unknown): { text: string; error?: string } {
	const m = message as { role?: string; content?: unknown; stopReason?: string; errorMessage?: string };
	if (m?.role !== "assistant") return { text: "" };
	const parts = Array.isArray(m.content) ? m.content : [];
	const text = parts
		.filter((p): p is { type: "text"; text: string } => p?.type === "text" && typeof p.text === "string")
		.map((p) => p.text)
		.join("")
		.trim();
	return { text, error: m.stopReason === "error" ? (m.errorMessage ?? "model error") : undefined };
}

export class Conversation {
	private session?: AgentSession;
	private unsubscribe?: () => void;
	private pending: Inbound[] = [];
	private timer?: NodeJS.Timeout;
	private busy = false;
	private readonly state: SpaceState;
	private readonly spaceId: string;
	private readonly config: Config;
	private readonly channel: Channel;
	private readonly store: StateStore;
	private readonly modelRuntime: ModelRuntime;
	private readonly scheduler: Scheduler;

	constructor(
		spaceId: string,
		config: Config,
		channel: Channel,
		store: StateStore,
		modelRuntime: ModelRuntime,
		scheduler: Scheduler,
	) {
		this.spaceId = spaceId;
		this.config = config;
		this.channel = channel;
		this.store = store;
		this.modelRuntime = modelRuntime;
		this.scheduler = scheduler;
		this.state = store.space(spaceId);
	}

	/** Texts often arrive in bursts; wait a beat and handle them as one message. */
	receive(message: Inbound): void {
		this.pending.push(message);
		clearTimeout(this.timer);
		this.timer = setTimeout(() => void this.flush(), BURST_MS);
	}

	/** Run a prompt that did not come from the owner (scheduled jobs, reminders). */
	async inject(prompt: string): Promise<void> {
		this.pending.push({ spaceId: this.spaceId, senderId: "system", messageId: `sys-${Date.now()}`, text: prompt, files: [] });
		await this.flush(true);
	}

	/** Send text to the owner that the agent did not write this turn (plain reminders, script output). */
	async deliver(text: string): Promise<void> {
		await this.say(text);
	}

	async dispose(): Promise<void> {
		clearTimeout(this.timer);
		this.unsubscribe?.();
		if (this.session?.isStreaming) await this.session.abort().catch(() => {});
		// AgentSession.dispose() does not emit session_shutdown; extensions (MCP servers) clean up on it.
		await this.session?.extensionRunner.emit({ type: "session_shutdown", reason: "quit" }).catch(() => {});
		this.session?.dispose();
		this.session = undefined;
	}

	private async flush(system = false): Promise<void> {
		const batch = this.pending.splice(0);
		if (batch.length === 0) return;
		const body = batch.map((m) => m.text).filter(Boolean).join("\n");
		const files = batch.flatMap((m) => m.files);
		const images = files
			.filter((f) => f.kind === "image")
			.map((f) => ({ type: "image" as const, data: readFileSync(f.path).toString("base64"), mimeType: f.mimeType }));
		const fileNotes = files.map((f) => `[${f.kind} received: ${f.path}]`).join("\n");
		const spoken = [body, fileNotes].filter(Boolean).join("\n");
		if (!system) this.record("owner", spoken);

		// A message that lands mid-run steers the run instead of waiting behind it.
		if (this.busy && this.session?.isStreaming) {
			await this.session.steer(this.stamp(spoken, system), images).catch((error) => this.fail(error));
			return;
		}
		if (this.busy) {
			this.pending.unshift(...batch);
			return;
		}

		this.busy = true;
		const typing = setInterval(() => void this.channel.typing(this.spaceId, true), TYPING_REFRESH_MS);
		void this.channel.typing(this.spaceId, true);
		try {
			const { session, carry } = await this.ensureSession();
			const intro = carry
				? `[New context window after a gap. The last messages before it, for continuity only:\n${carry}]\n\n`
				: "";
			await session.prompt(intro + this.stamp(spoken, system), images.length > 0 ? { images } : undefined);
		} catch (error) {
			await this.fail(error);
		} finally {
			clearInterval(typing);
			void this.channel.typing(this.spaceId, false);
			this.busy = false;
			this.state.sessionFile = this.session?.sessionFile ?? this.state.sessionFile;
			this.store.save();
			if (this.pending.length > 0) void this.flush();
		}
	}

	private stamp(body: string, system: boolean): string {
		const when = `[${localStamp(this.config)}]`;
		return system ? `${when} [Not from the owner. Scheduled task for you to carry out]\n${body}` : `${when}\n${body}`;
	}

	private async ensureSession(): Promise<{ session: AgentSession; carry: string }> {
		const idle = isIdle(this.state.lastActivity, this.config.idleHours);
		if (this.session && !idle) return { session: this.session, carry: "" };
		if (this.session) await this.dispose();

		const resume = !idle && this.state.sessionFile && existsSync(this.state.sessionFile);
		const cwd = join(this.config.dataDir, "workspace");
		const agentDir = join(this.config.dataDir, "pi");
		const loader = new DefaultResourceLoader({
			cwd,
			agentDir,
			systemPrompt: buildSystemPrompt(this.config),
			appendSystemPrompt: [],
			additionalSkillPaths: skillPaths(this.config),
			extensionFactories: [
				nanoTools(this.config, this.channel, this.scheduler, this.spaceId),
				...(await packExtensions({
					config: this.config,
					channel: this.channel,
					scheduler: this.scheduler,
					spaceId: this.spaceId,
					Type,
				})),
			],
			noPromptTemplates: true,
			noThemes: true,
			noContextFiles: true,
		});
		await loader.reload();

		const model = this.modelRuntime.getModel(this.config.modelProvider, this.config.modelId);
		if (!model) throw new Error(`Unknown model ${this.config.modelProvider}/${this.config.modelId}`);
		const sessionsDir = join(this.config.dataDir, "sessions");
		const { session } = await createAgentSession({
			cwd,
			agentDir,
			model,
			thinkingLevel: this.config.thinking,
			modelRuntime: this.modelRuntime,
			resourceLoader: loader,
			settingsManager: SettingsManager.inMemory({ compaction: { enabled: true } }),
			sessionManager: resume
				? SessionManager.open(this.state.sessionFile as string)
				: SessionManager.create(cwd, sessionsDir),
		});
		await session.bindExtensions({});

		this.unsubscribe = session.subscribe((event) => {
			if (event.type !== "message_end") return;
			const { text, error } = assistantText(event.message);
			if (text) void this.say(text);
			else if (error) void this.say(`I hit an error talking to the model: ${error.slice(0, 200)}`);
		});
		this.session = session;
		const carry = resume ? "" : carryOver(this.state.recent);
		console.error(`nano: ${resume ? "resumed" : "started"} session for ${this.spaceId.slice(-4)} (${session.sessionFile ?? "memory"})`);
		return { session, carry };
	}

	private async say(text: string): Promise<void> {
		// A scheduled task with nothing worth reporting answers [silent].
		if (/^\[silent\]\.?$/i.test(text.trim())) return;
		this.record("nano", text);
		try {
			await this.channel.send(this.spaceId, text);
		} catch (error) {
			console.error("nano: send failed:", (error as Error)?.message ?? error);
		}
	}

	private async fail(error: unknown): Promise<void> {
		const reason = (error as Error)?.message ?? String(error);
		console.error("nano: turn failed:", error);
		await this.say(`Something went wrong on my side: ${reason.slice(0, 200)}`);
	}

	private record(role: Turn["role"], text: string): void {
		const at = Date.now();
		this.state.lastActivity = at;
		this.state.recent.push({ role, text: text.slice(0, 2000), at });
		if (this.state.recent.length > RECENT_KEEP) this.state.recent.splice(0, this.state.recent.length - RECENT_KEEP);
		this.store.save();
		const tz = currentTimezone(this.config);
		const day = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(at);
		const time = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit" }).format(at);
		appendFileSync(join(this.config.dataDir, "log", `${day}.md`), `- ${time} **${role}**: ${text.replace(/\n/g, "\n  ")}\n`);
	}
}

export async function createModelRuntime(config: Config): Promise<ModelRuntime> {
	return ModelRuntime.create({
		authPath: join(config.dataDir, "pi", "auth.json"),
		modelsPath: join(config.dataDir, "pi", "models.json"),
	});
}

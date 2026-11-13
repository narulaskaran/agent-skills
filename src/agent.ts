import { appendFileSync, existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentSession, ModelRuntime } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { Channel, Inbound } from "./channel.ts";
import { type Config, currentTimezone, localStamp } from "./config.ts";
import { refreshProviderSettings } from "./provider-settings.ts";
import { packExtensions } from "./packs.ts";
import { buildSystemPrompt } from "./prompt.ts";
import type { Scheduler } from "./scheduler.ts";
import { assistantText, createNanoSession } from "./session.ts";
import { taskTools } from "./task-tools.ts";
import { isSilent, type TaskManager } from "./tasks.ts";
import { nanoTools } from "./tools.ts";

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

/**
 * Turns run one at a time, in arrival order. Consecutive items from the same source are
 * merged into one turn; owner text and system events are never mixed in one prompt.
 */
export class TurnQueue<T extends { from: string }> {
	private readonly items: { item: T; done: () => void }[] = [];
	private readonly run: (batch: T[]) => Promise<void>;
	private running = false;

	constructor(run: (batch: T[]) => Promise<void>) {
		this.run = run;
	}

	get busy(): boolean {
		return this.running;
	}

	/** Resolves when the turn that handled `item` has finished. */
	push(item: T): Promise<void> {
		return new Promise((done) => {
			this.items.push({ item, done });
			void this.drain();
		});
	}

	private async drain(): Promise<void> {
		if (this.running || this.items.length === 0) return;
		const batch = [this.items.shift() as { item: T; done: () => void }];
		while (this.items[0] && this.items[0].item.from === batch[0]?.item.from) batch.push(this.items.shift() as { item: T; done: () => void });
		this.running = true;
		try {
			await this.run(batch.map((b) => b.item));
		} catch (error) {
			console.error("nano: turn failed:", error);
		} finally {
			this.running = false;
			for (const b of batch) b.done();
			void this.drain();
		}
	}
}

type Work =
	| { from: "owner"; spoken: string; images: { type: "image"; data: string; mimeType: string }[] }
	| { from: "system"; text: string; note: string };

export class Conversation {
	private session?: AgentSession;
	private providerRevision?: string;
	private unsubscribe?: () => void;
	private pending: Inbound[] = [];
	private timer?: NodeJS.Timeout;
	private readonly queue = new TurnQueue<Work>((batch) => this.turn(batch));
	private readonly state: SpaceState;
	private readonly spaceId: string;
	private readonly config: Config;
	private readonly channel: Channel;
	private readonly store: StateStore;
	private readonly modelRuntime: ModelRuntime;
	private readonly scheduler: Scheduler;
	private readonly tasks: TaskManager;
	/**
	 * When an owner message arrives after the idle gap, the moment it arrived. Recording the message
	 * moves lastActivity to now, so the gap has to be noticed before that, not in ensureSession.
	 */
	private rolloverAt?: number;

	constructor(
		spaceId: string,
		config: Config,
		channel: Channel,
		store: StateStore,
		modelRuntime: ModelRuntime,
		scheduler: Scheduler,
		tasks: TaskManager,
	) {
		this.spaceId = spaceId;
		this.config = config;
		this.channel = channel;
		this.store = store;
		this.modelRuntime = modelRuntime;
		this.scheduler = scheduler;
		this.tasks = tasks;
		this.state = store.space(spaceId);
	}

	/** Texts often arrive in bursts; wait a beat and handle them as one message. */
	receive(message: Inbound): void {
		this.pending.push(message);
		clearTimeout(this.timer);
		this.timer = setTimeout(() => this.flushOwner(), BURST_MS);
	}

	/**
	 * Run a prompt that did not come from the owner (scheduled jobs, reminders, background task
	 * results). It waits for any turn in progress and gets a turn of its own.
	 */
	inject(prompt: string, note = "Scheduled task for you to carry out"): Promise<void> {
		return this.queue.push({ from: "system", text: prompt, note });
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

	private flushOwner(): void {
		const batch = this.pending.splice(0);
		if (batch.length === 0) return;
		const body = batch.map((m) => m.text).filter(Boolean).join("\n");
		const files = batch.flatMap((m) => m.files);
		const images = files
			.filter((f) => f.kind === "image")
			.map((f) => ({ type: "image" as const, data: readFileSync(f.path).toString("base64"), mimeType: f.mimeType }));
		const fileNotes = files.map((f) => `[${f.kind} received: ${f.path}]`).join("\n");
		const spoken = [body, fileNotes].filter(Boolean).join("\n");
		if (isIdle(this.state.lastActivity, this.config.idleHours)) this.rolloverAt ??= Date.now();
		this.record("owner", spoken);

		// A message that lands mid-run steers the run instead of waiting behind it.
		if (this.queue.busy && this.session?.isStreaming) {
			void this.session.steer(this.stamp(spoken), images).catch((error) => this.fail(error));
			return;
		}
		void this.queue.push({ from: "owner", spoken, images });
	}

	private async turn(batch: Work[]): Promise<void> {
		const typing = setInterval(() => void this.channel.typing(this.spaceId, true), TYPING_REFRESH_MS);
		void this.channel.typing(this.spaceId, true);
		try {
			const { session, carry } = await this.ensureSession();
			const intro = carry
				? `[New context window after a gap. The last messages before it, for continuity only:\n${carry}]\n\n`
				: "";
			const images = batch.flatMap((w) => (w.from === "owner" ? w.images : []));
			const body = batch.map((w) => (w.from === "owner" ? this.stamp(w.spoken) : this.stamp(w.text, w.note))).join("\n\n");
			await session.prompt(intro + body, images.length > 0 ? { images } : undefined);
		} catch (error) {
			await this.fail(error);
		} finally {
			clearInterval(typing);
			void this.channel.typing(this.spaceId, false);
			this.state.sessionFile = this.session?.sessionFile ?? this.state.sessionFile;
			this.store.save();
		}
	}

	private stamp(body: string, note?: string): string {
		const when = `[${localStamp(this.config)}]`;
		return note ? `${when} [Not from the owner. ${note}]\n${body}` : `${when}\n${body}`;
	}

	private async ensureSession(): Promise<{ session: AgentSession; carry: string }> {
		await refreshProviderSettings(this.config, this.modelRuntime);
		const selected = this.modelRuntime.getModel(this.config.modelProvider, this.config.modelId);
		if (this.session && selected && (this.session.model?.id !== selected.id || this.session.model?.provider !== selected.provider || this.providerRevision !== this.config.providerRevision)) await this.session.setModel(selected);
		this.providerRevision = this.config.providerRevision;
		const cutoff = this.rolloverAt ?? (isIdle(this.state.lastActivity, this.config.idleHours) ? Date.now() : undefined);
		this.rolloverAt = undefined;
		const idle = cutoff !== undefined;
		if (this.session && !idle) return { session: this.session, carry: "" };
		if (this.session) await this.dispose();

		const resume = !idle && this.state.sessionFile && existsSync(this.state.sessionFile) ? this.state.sessionFile : undefined;
		const model = this.modelRuntime.getModel(this.config.modelProvider, this.config.modelId);
		if (!model) throw new Error(`Unknown model ${this.config.modelProvider}/${this.config.modelId}`);
		const session = await createNanoSession({
			config: this.config,
			modelRuntime: this.modelRuntime,
			model,
			systemPrompt: buildSystemPrompt(this.config),
			extensionFactories: [
				nanoTools(this.config, this.channel, this.scheduler, this.spaceId, { modelRuntime: this.modelRuntime }),
				taskTools(this.config, this.tasks, this.spaceId),
				...(await packExtensions({
					config: this.config,
					channel: this.channel,
					scheduler: this.scheduler,
					spaceId: this.spaceId,
					Type,
				})),
			],
			sessionsDir: join(this.config.dataDir, "sessions"),
			resume,
		});

		this.unsubscribe = session.subscribe((event) => {
			if (event.type !== "message_end") return;
			const { text, error } = assistantText(event.message);
			if (text) void this.say(text);
			else if (error) void this.say(`I hit an error talking to the model: ${error.slice(0, 200)}`);
		});
		this.session = session;
		// Only what came before the gap: the message that ended it is the prompt itself.
		const carry = resume ? "" : carryOver(this.state.recent.filter((turn) => cutoff === undefined || turn.at < cutoff));
		console.error(`nano: ${resume ? "resumed" : "started"} session for ${this.spaceId.slice(-4)} (${session.sessionFile ?? "memory"})`);
		return { session, carry };
	}

	private async say(text: string): Promise<void> {
		// A scheduled task with nothing worth reporting answers [silent].
		if (isSilent(text)) return;
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

import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type Config, currentTimezone } from "./config.ts";

/**
 * What a job does when it fires:
 * - message: send `body` to the owner as is. No model call.
 * - task:    hand `body` to the agent as a prompt. It replies to the owner, or with [silent].
 * - script:  run `body` as a shell command. Empty output means nothing happens. Otherwise the
 *            output is sent as is (`then: "send"`) or handed to the agent (`then: "task"`).
 */
export interface Job {
	id: string;
	name: string;
	kind: "message" | "task" | "script";
	body: string;
	then?: "send" | "task";
	/** One-shot: epoch milliseconds. */
	at?: number;
	/** Recurring: five-field cron expression in the owner's timezone. */
	cron?: string;
	/** Recurring jobs stop after this moment (epoch milliseconds). */
	until?: number;
	spaceId: string;
	createdAt: number;
	lastFired?: number;
}

export interface JobSink {
	send(spaceId: string, text: string): Promise<void>;
	task(spaceId: string, prompt: string): Promise<void>;
}

const TICK_MS = 20_000;
const SCRIPT_TIMEOUT_MS = 120_000;

function fieldMatches(field: string, value: number, min: number, max: number): boolean {
	return field.split(",").some((part) => {
		const [range, stepText] = part.split("/");
		const step = stepText ? Number(stepText) : 1;
		if (!Number.isInteger(step) || step < 1) throw new Error(`bad cron step: ${part}`);
		let lo = min;
		let hi = max;
		if (range !== "*") {
			const [a, b] = (range ?? "").split("-");
			lo = Number(a);
			hi = b === undefined ? (stepText ? max : lo) : Number(b);
			if (!Number.isInteger(lo) || !Number.isInteger(hi) || lo < min || hi > max || lo > hi) {
				throw new Error(`bad cron field: ${part}`);
			}
		}
		return value >= lo && value <= hi && (value - lo) % step === 0;
	});
}

/** Wall-clock parts of `at` in `timeZone`. */
export function zonedParts(at: Date, timeZone: string) {
	const parts = Object.fromEntries(
		new Intl.DateTimeFormat("en-US", {
			timeZone,
			hourCycle: "h23",
			year: "numeric",
			month: "numeric",
			day: "numeric",
			hour: "numeric",
			minute: "numeric",
			weekday: "short",
		})
			.formatToParts(at)
			.map((p) => [p.type, p.value]),
	);
	return {
		minute: Number(parts.minute),
		hour: Number(parts.hour),
		day: Number(parts.day),
		month: Number(parts.month),
		weekday: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.weekday as string),
	};
}

/** Standard five-field cron: minute hour day-of-month month day-of-week (0 or 7 = Sunday). */
export function cronMatches(expression: string, at: Date, timeZone: string): boolean {
	const fields = expression.trim().split(/\s+/);
	if (fields.length !== 5) throw new Error("cron needs five fields: minute hour day month weekday");
	const [minute, hour, day, month, weekday] = fields as [string, string, string, string, string];
	const now = zonedParts(at, timeZone);
	const dayOk = fieldMatches(day, now.day, 1, 31);
	const weekdayOk = fieldMatches(weekday, now.weekday, 0, 7) || (now.weekday === 0 && fieldMatches(weekday, 7, 0, 7));
	// As in cron: when both day fields are restricted, either one matching is enough.
	const dateOk = day !== "*" && weekday !== "*" ? dayOk || weekdayOk : dayOk && weekdayOk;
	return (
		fieldMatches(minute, now.minute, 0, 59) && fieldMatches(hour, now.hour, 0, 23) && fieldMatches(month, now.month, 1, 12) && dateOk
	);
}

/** Parse "2026-11-12T09:00" (owner's wall clock) or any ISO string with an offset into epoch ms. */
export function parseLocalTime(input: string, timeZone: string): number {
	const text = input.trim();
	if (/[zZ]$|[+-]\d\d:?\d\d$/.test(text)) {
		const ms = Date.parse(text);
		if (Number.isNaN(ms)) throw new Error(`cannot read time: ${input}`);
		return ms;
	}
	const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(text);
	if (!m) throw new Error(`time must look like 2026-11-12T09:00 (got ${input})`);
	const [y, mo, d, h, mi, s] = m.slice(1).map((v) => Number(v ?? 0)) as [number, number, number, number, number, number];
	// Find the UTC instant whose wall clock in the zone equals the request: guess, measure the offset, correct twice.
	const wanted = Date.UTC(y, mo - 1, d, h, mi, s);
	let guess = wanted;
	for (let i = 0; i < 2; i++) {
		const p = Object.fromEntries(
			new Intl.DateTimeFormat("en-US", {
				timeZone,
				hourCycle: "h23",
				year: "numeric",
				month: "numeric",
				day: "numeric",
				hour: "numeric",
				minute: "numeric",
				second: "numeric",
			})
				.formatToParts(new Date(guess))
				.map((part) => [part.type, Number(part.value)]),
		) as Record<string, number>;
		const shown = Date.UTC(p.year as number, (p.month as number) - 1, p.day, p.hour, p.minute, p.second);
		guess += wanted - shown;
	}
	return guess;
}

export class Scheduler {
	private readonly path: string;
	private jobs: Job[] = [];
	private timer?: NodeJS.Timeout;
	private running = new Set<string>();
	private readonly config: Config;
	private readonly sink: JobSink;

	constructor(config: Config, sink: JobSink) {
		this.config = config;
		this.sink = sink;
		this.path = join(config.dataDir, "schedule.json");
		try {
			if (existsSync(this.path)) this.jobs = JSON.parse(readFileSync(this.path, "utf8")).jobs ?? [];
		} catch (error) {
			console.error("nano: could not read schedule.json, starting empty:", error);
		}
	}

	start(): void {
		this.timer = setInterval(() => void this.tick(), TICK_MS);
		void this.tick();
	}

	stop(): void {
		clearInterval(this.timer);
	}

	list(): Job[] {
		return [...this.jobs];
	}

	add(input: Omit<Job, "id" | "createdAt">): Job {
		if (!input.at && !input.cron) throw new Error("a job needs a time (at) or a schedule (cron)");
		if (input.cron) cronMatches(input.cron, new Date(), currentTimezone(this.config)); // validates
		const job: Job = { ...input, id: randomBytes(3).toString("hex"), createdAt: Date.now() };
		this.jobs.push(job);
		this.save();
		return job;
	}

	cancel(id: string): Job | undefined {
		const index = this.jobs.findIndex((j) => j.id === id);
		if (index < 0) return undefined;
		const [job] = this.jobs.splice(index, 1);
		this.save();
		return job;
	}

	/**
	 * Other programs on the machine hand Nano something to deliver by dropping a file in
	 * `<data>/outbox`: `*.txt` is sent to the owner as is; `*.json` is
	 * `{"text": "...", "kind": "message" | "task", "to": "<chat id, default owner>"}`.
	 */
	private async drainOutbox(): Promise<void> {
		const dir = join(this.config.dataDir, "outbox");
		mkdirSync(dir, { recursive: true });
		for (const name of readdirSync(dir).sort()) {
			if (!/\.(txt|json)$/.test(name)) continue; // writers use a temp name, then rename
			const path = join(dir, name);
			let item: { text?: string; kind?: string; to?: string };
			try {
				const raw = readFileSync(path, "utf8");
				item = name.endsWith(".json") ? JSON.parse(raw) : { text: raw };
				rmSync(path); // remove before sending so a failure cannot cause a resend loop
			} catch (error) {
				console.error(`nano: bad outbox file ${name}:`, (error as Error)?.message ?? error);
				try {
					renameSync(path, `${path}.bad`);
				} catch {}
				continue;
			}
			const text = item.text?.trim();
			const to = item.to || this.config.owner;
			if (!text || !to) continue;
			console.error(`nano: outbox ${item.kind === "task" ? "task" : "message"} from ${name}`);
			try {
				if (item.kind === "task") await this.sink.task(to, text);
				else await this.sink.send(to, text);
			} catch (error) {
				console.error(`nano: outbox delivery failed for ${name}:`, (error as Error)?.message ?? error);
			}
		}
	}

	async tick(now = new Date()): Promise<void> {
		await this.drainOutbox().catch((error) => console.error("nano: outbox error:", error));
		const tz = currentTimezone(this.config);
		const minute = Math.floor(now.getTime() / 60_000);
		for (const job of [...this.jobs]) {
			if (this.running.has(job.id)) continue;
			let due = false;
			if (job.at !== undefined) {
				due = now.getTime() >= job.at;
			} else if (job.cron) {
				if (job.until !== undefined && now.getTime() > job.until) {
					this.cancel(job.id);
					continue;
				}
				const firedThisMinute = job.lastFired !== undefined && Math.floor(job.lastFired / 60_000) === minute;
				try {
					due = !firedThisMinute && cronMatches(job.cron, now, tz);
				} catch {
					due = false;
				}
			}
			if (!due) continue;

			// Persist before running so a crash mid-run cannot fire the same job twice.
			job.lastFired = now.getTime();
			if (job.at !== undefined) this.jobs = this.jobs.filter((j) => j.id !== job.id);
			this.save();
			this.running.add(job.id);
			void this.fire(job).finally(() => this.running.delete(job.id));
		}
	}

	private async fire(job: Job): Promise<void> {
		console.error(`nano: firing ${job.kind} job ${job.id} (${job.name})`);
		try {
			if (job.kind === "message") {
				await this.sink.send(job.spaceId, job.body);
			} else if (job.kind === "task") {
				await this.sink.task(job.spaceId, `Scheduled task "${job.name}":\n${job.body}`);
			} else {
				const output = await runScript(job.body, join(this.config.dataDir, "workspace"));
				if (!output) return;
				if (job.then === "task") {
					await this.sink.task(job.spaceId, `Scheduled check "${job.name}" produced this output. Decide what, if anything, the owner needs to hear:\n${output}`);
				} else {
					await this.sink.send(job.spaceId, output);
				}
			}
		} catch (error) {
			console.error(`nano: job ${job.id} (${job.name}) failed:`, (error as Error)?.message ?? error);
		}
	}

	private save(): void {
		const tmp = `${this.path}.tmp`;
		writeFileSync(tmp, JSON.stringify({ jobs: this.jobs }, null, 2));
		renameSync(tmp, this.path);
	}
}

function runScript(command: string, cwd: string): Promise<string> {
	return new Promise((resolve, reject) => {
		execFile("bash", ["-lc", command], { cwd, timeout: SCRIPT_TIMEOUT_MS, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
			if (error) reject(new Error(`${error.message}${stderr ? `: ${stderr.slice(0, 300)}` : ""}`));
			else resolve(stdout.trim().slice(0, 8000));
		});
	});
}

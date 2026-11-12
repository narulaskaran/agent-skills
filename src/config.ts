import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface Config {
	channel: "photon" | "stdin";
	photonProjectId: string;
	photonProjectSecret: string;
	/** Senders allowed to talk to Nano (E.164 phone numbers or handles). */
	allowedUsers: string[];
	/** Where proactive messages go. Defaults to the first allowed user. */
	owner: string;
	modelProvider: string;
	modelId: string;
	thinking: "off" | "minimal" | "low" | "medium" | "high";
	/** Hours of silence after which the next message starts a fresh context window. */
	idleHours: number;
	dataDir: string;
	kbDir: string;
	profileDir: string;
	appDir: string;
	packs: string[];
	braveApiKey?: string;
	/** Optional second model on an OpenAI-compatible endpoint the owner runs (llama.cpp, Ollama, ...). */
	local?: LocalModel;
	/** Background tasks that may run at once; more wait in a queue. */
	maxTasks: number;
	/** A background task still running after this long is stopped and reported as failed. */
	taskTimeoutMs: number;
}

export interface LocalModel {
	modelId: string;
	/** OpenAI-compatible base URL ending in /v1. */
	baseUrl: string;
	apiKey?: string;
	contextWindow: number;
}

/** The local model role from the environment, or undefined when it is not configured. */
export function loadLocalModel(env: NodeJS.ProcessEnv = process.env): LocalModel | undefined {
	const modelId = env.NANO_LOCAL_MODEL?.trim();
	const baseUrl = env.NANO_LOCAL_BASE_URL?.trim().replace(/\/+$/, "");
	if (!modelId || !baseUrl) return undefined;
	return { modelId, baseUrl, apiKey: env.NANO_LOCAL_API_KEY || undefined, contextWindow: Number(env.NANO_LOCAL_CONTEXT || 32_768) };
}

function list(value: string | undefined): string[] {
	return (value ?? "")
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean);
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
	const appDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
	const dataDir = resolve(env.NANO_DATA_DIR ?? join(appDir, "data"));
	const channel = env.NANO_CHANNEL === "stdin" ? "stdin" : "photon";
	const allowedUsers = list(env.NANO_ALLOWED_USERS ?? env.PHOTON_ALLOWED_USERS);
	const [modelProvider, ...rest] = (env.NANO_MODEL ?? "deepseek/deepseek-flash").split("/");
	const thinking = (env.NANO_THINKING ?? "low") as Config["thinking"];

	const config: Config = {
		channel,
		photonProjectId: env.PHOTON_PROJECT_ID ?? "",
		photonProjectSecret: env.PHOTON_PROJECT_SECRET ?? "",
		allowedUsers,
		owner: env.NANO_OWNER ?? env.PHOTON_HOME_CHANNEL ?? allowedUsers[0] ?? "",
		modelProvider: modelProvider ?? "deepseek",
		modelId: rest.join("/"),
		thinking,
		idleHours: Number(env.NANO_IDLE_HOURS ?? 4),
		dataDir,
		kbDir: resolve(env.NANO_KB_DIR ?? join(dataDir, "kb")),
		profileDir: resolve(env.NANO_PROFILE_DIR ?? join(dataDir, "profile")),
		appDir,
		packs: list(env.NANO_PACKS ?? "core"),
		braveApiKey: env.BRAVE_SEARCH_API_KEY || undefined,
		local: loadLocalModel(env),
		maxTasks: Math.max(1, Number(env.NANO_MAX_TASKS || 3)),
		taskTimeoutMs: Math.max(1, Number(env.NANO_TASK_TIMEOUT_MINUTES || 30)) * 60_000,
	};

	const problems: string[] = [];
	if (!config.modelId) problems.push("NANO_MODEL must look like provider/model-id");
	if (Boolean(env.NANO_LOCAL_MODEL?.trim()) !== Boolean(env.NANO_LOCAL_BASE_URL?.trim())) {
		problems.push("NANO_LOCAL_MODEL and NANO_LOCAL_BASE_URL must be set together");
	}
	if (config.local && !(config.local.contextWindow > 0)) problems.push("NANO_LOCAL_CONTEXT must be a number of tokens");
	if (channel === "photon") {
		if (!config.photonProjectId) problems.push("PHOTON_PROJECT_ID is not set");
		if (!config.photonProjectSecret) problems.push("PHOTON_PROJECT_SECRET is not set");
		if (allowedUsers.length === 0) problems.push("NANO_ALLOWED_USERS is empty (your phone number, E.164)");
	}
	if (problems.length > 0) {
		throw new Error(`Nano is not configured:\n- ${problems.join("\n- ")}\nSee .env.example.`);
	}

	for (const dir of ["pi", "sessions", "workspace", "inbox", "log"]) {
		mkdirSync(join(dataDir, dir), { recursive: true });
	}
	mkdirSync(config.kbDir, { recursive: true });
	mkdirSync(config.profileDir, { recursive: true });
	return config;
}

export function readIfExists(path: string): string | undefined {
	return existsSync(path) ? readFileSync(path, "utf8") : undefined;
}

let syncedTimezone: string | undefined;

function validZone(tz: unknown): tz is string {
	if (typeof tz !== "string" || !tz) return false;
	try {
		new Intl.DateTimeFormat("en-US", { timeZone: tz });
		return true;
	} catch {
		return false;
	}
}

/**
 * Optional: follow an external source of truth for the owner's timezone (for example a service
 * that switches zones when they travel). `NANO_TZ_URL` must return `{"timezone": "<IANA zone>"}`.
 */
export function startTimezoneSync(url: string | undefined, everyMs = 5 * 60_000): void {
	if (!url) return;
	const refresh = async () => {
		try {
			const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
			const tz = ((await response.json()) as { timezone?: unknown }).timezone;
			if (validZone(tz)) syncedTimezone = tz;
		} catch {
			// keep the last known zone
		}
	};
	void refresh();
	setInterval(() => void refresh(), everyMs).unref();
}

/** Timezone the owner is in: the synced source if any, then `settings.json` from onboarding, then TZ. */
export function currentTimezone(config: Config): string {
	if (syncedTimezone) return syncedTimezone;
	try {
		const raw = readIfExists(join(config.dataDir, "settings.json"));
		const tz = raw ? (JSON.parse(raw).timezone as unknown) : undefined;
		if (validZone(tz)) return tz;
	} catch {
		// fall through to the environment
	}
	return process.env.TZ || "UTC";
}

export function localStamp(config: Config, at: Date = new Date()): string {
	const tz = currentTimezone(config);
	const text = new Intl.DateTimeFormat("en-US", {
		timeZone: tz,
		weekday: "short",
		year: "numeric",
		month: "short",
		day: "numeric",
		hour: "numeric",
		minute: "2-digit",
		timeZoneName: "short",
	}).format(at);
	return text;
}

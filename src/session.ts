import { join } from "node:path";
import type { Api, Model } from "@earendil-works/pi-ai";
import {
	type AgentSession,
	createAgentSession,
	DefaultResourceLoader,
	type ExtensionFactory,
	type ModelRuntime,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import type { Config } from "./config.ts";
import { skillPaths } from "./packs.ts";

export const workspaceDir = (config: Config) => join(config.dataDir, "workspace");

/** A Pi session configured the Nano way. Used by the main conversation and by background workers. */
export async function createNanoSession(options: {
	config: Config;
	modelRuntime: ModelRuntime;
	model: Model<Api>;
	systemPrompt: string;
	extensionFactories: ExtensionFactory[];
	/** Directory for a new session file. */
	sessionsDir: string;
	/** Reopen this session file instead of starting a new one. */
	resume?: string;
}): Promise<AgentSession> {
	const { config } = options;
	const cwd = workspaceDir(config);
	const agentDir = join(config.dataDir, "pi");
	const loader = new DefaultResourceLoader({
		cwd,
		agentDir,
		systemPrompt: options.systemPrompt,
		appendSystemPrompt: [],
		additionalSkillPaths: skillPaths(config),
		extensionFactories: options.extensionFactories,
		noPromptTemplates: true,
		noThemes: true,
		noContextFiles: true,
	});
	await loader.reload();
	const { session } = await createAgentSession({
		cwd,
		agentDir,
		model: options.model,
		thinkingLevel: config.thinking,
		modelRuntime: options.modelRuntime,
		resourceLoader: loader,
		settingsManager: SettingsManager.inMemory({ compaction: { enabled: true } }),
		sessionManager: options.resume ? SessionManager.open(options.resume) : SessionManager.create(cwd, options.sessionsDir),
	});
	await session.bindExtensions({});
	return session;
}

export function assistantText(message: unknown): { text: string; error?: string } {
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

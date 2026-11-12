import { join } from "node:path";
import type { Api, Model } from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import type { Config } from "./config.ts";

/** Pi provider id under which `NANO_LOCAL_*` is registered. */
export const LOCAL_PROVIDER = "nano-local";

export type ModelRole = "main" | "local";

export async function createModelRuntime(config: Config): Promise<ModelRuntime> {
	const runtime = await ModelRuntime.create({
		authPath: join(config.dataDir, "pi", "auth.json"),
		modelsPath: join(config.dataDir, "pi", "models.json"),
	});
	if (config.local) {
		const { modelId, baseUrl, contextWindow } = config.local;
		runtime.registerProvider(LOCAL_PROVIDER, {
			name: "Local",
			baseUrl,
			api: "openai-completions",
			// Resolved from the environment at request time; local servers without auth ignore the dummy value.
			apiKey: config.local.apiKey ? "$NANO_LOCAL_API_KEY" : "local",
			models: [
				{
					id: modelId,
					name: `Local ${modelId}`,
					reasoning: false,
					input: ["text"],
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
					contextWindow,
					maxTokens: Math.min(8192, Math.floor(contextWindow / 4)),
				},
			],
		});
	}
	return runtime;
}

/**
 * Which model a piece of work runs on. The one place the privacy rule lives:
 * - "local" work falls back to the main model when no local model is configured, and says so;
 * - private work never falls back. It runs locally or not at all, so private data cannot reach the cloud by accident.
 */
export function chooseModel(
	role: ModelRole,
	isPrivate: boolean,
	localConfigured: boolean,
): { use: ModelRole; note?: string } | { refuse: string } {
	if (role === "local" || isPrivate) {
		if (localConfigured) return { use: "local" };
		if (isPrivate) return { refuse: "This work is marked private and no local model is configured (NANO_LOCAL_MODEL), so it was not run rather than sent to the cloud model." };
		return { use: "main", note: "No local model is configured, so this ran on the main model." };
	}
	return { use: "main" };
}

export function resolveModel(
	config: Config,
	runtime: ModelRuntime,
	role: ModelRole,
	isPrivate: boolean,
): { model: Model<Api>; label: string; note?: string } {
	const choice = chooseModel(role, isPrivate, Boolean(config.local));
	if ("refuse" in choice) throw new Error(choice.refuse);
	const [provider, id] =
		choice.use === "local" && config.local ? [LOCAL_PROVIDER, config.local.modelId] : [config.modelProvider, config.modelId];
	const model = runtime.getModel(provider, id);
	if (!model) throw new Error(`Unknown model ${provider}/${id}`);
	return { model, label: choice.use === "local" ? `local ${id}` : `${provider}/${id}`, note: choice.note };
}

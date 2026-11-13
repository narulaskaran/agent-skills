import type { Model } from "@earendil-works/pi-ai";
import { streamSimple } from "@earendil-works/pi-ai/api/openai-completions";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import type { Config } from "./config.ts";
import { providerFetch, providerSettingsAvailable, roleFetch } from "./provider-client.ts";

interface Route {
	provider: string;
	model: string;
	contextWindow: number;
}
export interface ProviderSettings {
	providers: { id: string; local: boolean; capabilities: string[]; catalogProvider?: string }[];
	roles: Partial<Record<"main" | "background" | "local", Route>>;
}
const states = new WeakMap<Config, { signature: string; main: [string, string]; local: Config["local"] }>();

/** Read metadata each turn. Endpoint and key selection remain inside the daemon. */
export async function refreshProviderSettings(config: Config, runtime: ModelRuntime): Promise<void> {
	if (!config.packs.includes("vault") || !providerSettingsAvailable()) return;
	const response = await providerFetch("/providers/config");
	if (!response.ok) throw new Error("Could not load provider settings");
	const settings = (await response.json()) as ProviderSettings;
	applyProviderSettings(config, runtime, settings);
}

/** Apply a non-secret snapshot without changing a running request. */
export function applyProviderSettings(config: Config, runtime: ModelRuntime, settings: ProviderSettings): void {
	let state = states.get(config);
	if (!state) {
		state = { signature: "", main: [config.modelProvider, config.modelId], local: config.local };
		states.set(config, state);
	}
	const signature = JSON.stringify(settings);
	if (signature === state.signature) return;
	const roles = { ...settings.roles, background: settings.roles.background ?? settings.roles.main };
	for (const role of ["main", "background", "local"] as const) {
		const route = roles[role];
		if (!route) continue;
		const connection = settings.providers.find((p) => p.id === route.provider);
		if (!connection?.capabilities.includes("chat") || (role === "local" && !connection.local))
			throw new Error("Invalid provider role settings");
		const provider = `nano-vault-${role}`;
		const contextWindow = route.contextWindow || 32768;
		const source = connection.catalogProvider ? runtime.getModel(connection.catalogProvider, route.model) : undefined;
		runtime.registerProvider(provider, {
			name: `Owner configured ${role}`,
			baseUrl: `http://nano-vault/${role}`,
			api: "openai-completions",
			apiKey: "vault-proxy",
			streamSimple: (model, context, options) =>
				streamSimple(model as Model<"openai-completions">, context, { ...options, apiKey: "vault-proxy", fetch: roleFetch(role) }),
			models: [
				{
					id: route.model,
					name: route.model,
					reasoning: source?.reasoning ?? false,
					thinkingLevelMap: source?.thinkingLevelMap,
					input: source?.input ?? ["text", "image"],
					contextWindow,
					maxTokens: Math.min(source?.maxTokens ?? 8192, contextWindow),
					cost: source?.cost ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
					compat: source?.compat ?? { supportsDeveloperRole: false },
				},
			],
		});
	}
	[config.modelProvider, config.modelId] = settings.roles.main ? ["nano-vault-main", settings.roles.main.model] : state.main;
	config.background = roles.background ? { provider: "nano-vault-background", modelId: roles.background.model } : undefined;
	config.local = settings.roles.local
		? {
				modelId: settings.roles.local.model,
				baseUrl: "http://nano-vault/local",
				contextWindow: settings.roles.local.contextWindow || 32768,
				vault: true,
			}
		: state.local;
	config.providerRevision = signature;
	state.signature = signature;
}

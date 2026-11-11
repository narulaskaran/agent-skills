import { Conversation, createModelRuntime, StateStore } from "./agent.ts";
import { type Channel, createPhotonChannel, createStdinChannel } from "./channel.ts";
import { currentTimezone, loadConfig, startTimezoneSync } from "./config.ts";
import { extendPath, skillPaths } from "./packs.ts";
import { profileExists } from "./prompt.ts";
import { Scheduler } from "./scheduler.ts";

async function main(): Promise<void> {
	const config = loadConfig();
	extendPath(config);
	const modelRuntime = await createModelRuntime(config);
	const model = modelRuntime.getModel(config.modelProvider, config.modelId);
	if (!model) {
		const known = modelRuntime.getModels(config.modelProvider).map((m) => m.id);
		throw new Error(
			`Unknown model ${config.modelProvider}/${config.modelId}.` +
				(known.length > 0 ? ` Models for ${config.modelProvider}: ${known.join(", ")}` : " Unknown provider."),
		);
	}

	console.error(
		`nano: model ${config.modelProvider}/${config.modelId}, timezone ${currentTimezone(config)}, ` +
			`packs [${config.packs.join(", ")}], skill dirs ${skillPaths(config).length}, ` +
			`profile ${profileExists(config) ? "found" : "missing (first-run onboarding)"}, kb ${config.kbDir}`,
	);

	// `--check` verifies configuration and model access, then exits. Used by setup and by coding agents.
	if (process.argv.includes("--check")) {
		const available = await modelRuntime.getAllAvailable(config.modelProvider);
		if (!available.some((m) => m.id === config.modelId)) {
			throw new Error(`No credentials for ${config.modelProvider}. Set its API key in .env (see .env.example).`);
		}
		console.error("nano: check ok");
		return;
	}

	const channel: Channel = config.channel === "stdin" ? createStdinChannel() : await createPhotonChannel(config);
	const store = new StateStore(config.dataDir);
	const conversations = new Map<string, Conversation>();
	const scheduler: Scheduler = new Scheduler(config, {
		send: (spaceId, text) => conversation(spaceId).deliver(text),
		task: (spaceId, prompt) => conversation(spaceId).inject(prompt),
	});
	function conversation(spaceId: string): Conversation {
		let c = conversations.get(spaceId);
		if (!c) {
			c = new Conversation(spaceId, config, channel, store, modelRuntime, scheduler);
			conversations.set(spaceId, c);
		}
		return c;
	}

	let stopping = false;
	const shutdown = async (signal: string) => {
		if (stopping) return;
		stopping = true;
		console.error(`nano: ${signal}, shutting down`);
		scheduler.stop();
		await Promise.allSettled([...conversations.values()].map((c) => c.dispose()));
		await channel.stop().catch(() => {});
		process.exit(0);
	};
	process.on("SIGINT", () => void shutdown("SIGINT"));
	process.on("SIGTERM", () => void shutdown("SIGTERM"));

	startTimezoneSync(process.env.NANO_TZ_URL);
	scheduler.start();
	console.error(`nano: listening on ${config.channel}, ${scheduler.list().length} scheduled job(s)`);
	await channel.start((message) => conversation(message.spaceId).receive(message));
	await shutdown("channel closed");
}

main().catch((error) => {
	console.error(`nano: fatal: ${(error as Error)?.message ?? error}`);
	process.exit(1);
});

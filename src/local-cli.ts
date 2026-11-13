import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { providerFetch, providerSettingsAvailable } from "./provider-client.ts";
import { loadLocalModel } from "./config.ts";
import { askLocal } from "./local.ts";

const USAGE = `usage: nano-local [--choices a,b,c] [--max-tokens N] "<instruction>" [file]
Runs one instruction on the local model (NANO_LOCAL_MODEL at NANO_LOCAL_BASE_URL) over a file or stdin
and prints only the answer. With --choices it prints exactly one of the labels.
Never falls back to a cloud model: exits 2 when no local model is configured.`;

async function main(): Promise<number> {
	const { values, positionals } = parseArgs({
		allowPositionals: true,
		options: { choices: { type: "string" }, "max-tokens": { type: "string" }, help: { type: "boolean", short: "h" } },
	});
	const [instruction, file] = positionals;
	if (values.help || !instruction) {
		console.error(USAGE);
		return values.help ? 0 : 64;
	}
	let local = loadLocalModel();
	if (providerSettingsAvailable()) {
		const response = await providerFetch("/providers/config");
		if (!response.ok) throw new Error("Could not load provider settings");
		const settings = await response.json() as { roles: { local?: { model: string; contextWindow: number } } };
		if (settings.roles.local) local = { modelId: settings.roles.local.model, contextWindow: settings.roles.local.contextWindow, baseUrl: "http://nano-vault/local", vault: true };
	}
	if (!local) {
		console.error("nano-local: no local model configured (set NANO_LOCAL_MODEL and NANO_LOCAL_BASE_URL)");
		return 2;
	}
	const input = file ? readFileSync(file, "utf8") : process.stdin.isTTY ? undefined : readFileSync(0, "utf8");
	const choices = values.choices?.split(",").map((c) => c.trim()).filter(Boolean);
	const answer = await askLocal(local, {
		instruction,
		input,
		choices,
		maxTokens: values["max-tokens"] ? Number(values["max-tokens"]) : undefined,
	});
	process.stdout.write(`${answer}\n`);
	return 0;
}

main().then(
	(code) => process.exit(code),
	(error) => {
		console.error(`nano-local: ${(error as Error)?.message ?? error}`);
		process.exit(1);
	},
);

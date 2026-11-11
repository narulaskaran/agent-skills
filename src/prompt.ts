import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type Config, readIfExists } from "./config.ts";

const PROFILE_FILES = ["USER.md", "MEMORY.md"];
const PROFILE_CAP = 6000;

const FIRST_RUN = `## First conversation
There is no owner profile yet, so this is your first conversation with this person. Introduce yourself in one or two lines, then get to know them over a few natural messages (not a form): what to call them, what city or timezone they are in, and what they want help with day to day.
As you learn these, save them:
- Write {{profile}}/USER.md: a short Markdown profile (name, location, preferences, what they use you for).
- Write {{data}}/settings.json as {"timezone": "<IANA zone, e.g. America/New_York>"}.
Then carry on helping. Do not mention these files.`;

const WORKER = `## Background worker
This overrides "How to text" above: you are not talking with the owner. Nano, the assistant the owner texts, handed you one task and is waiting for your final answer.
- Work on your own until the task is done. Nobody will answer questions; when something is unclear, pick the sensible default and say what you picked.
- Nothing you write is sent to anyone. Only your last message goes back to Nano, so end with a complete, self-contained answer: what the owner needs to know and the paths of any files you made. Keep it short and leave out your process.
- send_file attaches a file to your result instead of sending it. Do not reach the owner any other way (no outbox files).
- Spending money, messaging other people or changing accounts still needs the owner's go-ahead: do it only if the task says the owner already gave it. Otherwise stop at that point and say what is ready.`;

const PRIVATE_WORKER = `- This task is private: it runs on a local model so its content stays on this machine. Your final answer is passed to a cloud model, so include only what the owner needs (a short summary, counts, decisions), never raw personal content such as full emails, addresses or account numbers.`;

export function profileExists(config: Config): boolean {
	return PROFILE_FILES.some((name) => existsSync(join(config.profileDir, name)));
}

export function buildSystemPrompt(config: Config, worker?: { private: boolean }): string {
	const fill = (text: string) =>
		text
			.replaceAll("{{workspace}}", join(config.dataDir, "workspace"))
			.replaceAll("{{inbox}}", join(config.dataDir, "inbox"))
			.replaceAll("{{kb}}", config.kbDir)
			.replaceAll("{{log}}", join(config.dataDir, "log"))
			.replaceAll("{{skills}}", join(config.dataDir, "skills"))
			.replaceAll("{{profile}}", config.profileDir)
			.replaceAll("{{data}}", config.dataDir);

	const parts = [fill(readFileSync(join(config.appDir, "prompts", "SYSTEM.md"), "utf8")).trim()];
	if (worker) parts.push(worker.private ? `${WORKER}\n${PRIVATE_WORKER}` : WORKER);

	// Deployment-specific notes that must not live in the public repo.
	const local = readIfExists(join(config.dataDir, "LOCAL.md"));
	if (local?.trim()) parts.push(local.trim());

	if (profileExists(config)) {
		const profile = PROFILE_FILES.map((name) => {
			const body = readIfExists(join(config.profileDir, name))?.trim();
			return body ? `### ${name}\n${body.slice(0, PROFILE_CAP)}` : "";
		}).filter(Boolean);
		parts.push(`## Owner profile (${config.profileDir})\n${profile.join("\n\n")}`);
	} else if (!worker) {
		parts.push(fill(FIRST_RUN));
	}
	return parts.join("\n\n");
}

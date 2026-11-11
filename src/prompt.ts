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

export function profileExists(config: Config): boolean {
	return PROFILE_FILES.some((name) => existsSync(join(config.profileDir, name)));
}

export function buildSystemPrompt(config: Config): string {
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

	// Deployment-specific notes that must not live in the public repo.
	const local = readIfExists(join(config.dataDir, "LOCAL.md"));
	if (local?.trim()) parts.push(local.trim());

	if (profileExists(config)) {
		const profile = PROFILE_FILES.map((name) => {
			const body = readIfExists(join(config.profileDir, name))?.trim();
			return body ? `### ${name}\n${body.slice(0, PROFILE_CAP)}` : "";
		}).filter(Boolean);
		parts.push(`## Owner profile (${config.profileDir})\n${profile.join("\n\n")}`);
	} else {
		parts.push(fill(FIRST_RUN));
	}
	return parts.join("\n\n");
}

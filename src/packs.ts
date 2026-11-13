import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";
import { pathToFileURL } from "node:url";
import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { Channel } from "./channel.ts";
import type { Config } from "./config.ts";
import type { Scheduler } from "./scheduler.ts";

/**
 * A pack is a folder that adds a capability:
 *
 *   <pack>/skills/<skill>/SKILL.md   Agent Skills, advertised to the model
 *   <pack>/extension.ts              optional: default export (ctx) => ExtensionFactory | ExtensionFactory[]
 *   <pack>/bin/                      optional: commands put on PATH for the agent's shell
 *   <pack>/install.sh                optional: run as root when the image is built (repo packs only)
 *   <pack>/start-root.sh             optional: run as root at container start, before privileges drop (repo packs only)
 *   <pack>/env.example               optional: settings the pack reads
 *
 * Packs shipped with Nano live in `packs/`. Private ones live in `<data>/packs/` and are
 * never part of the repository. `NANO_PACKS` names the ones to load; a private pack wins
 * over a shipped pack of the same name.
 */
export interface PackContext {
	config: Config;
	channel: Channel;
	scheduler: Scheduler;
	/** The conversation this session belongs to. */
	spaceId: string;
	/** TypeBox, for tool parameter schemas. Passed in so private packs need no node_modules. */
	Type: typeof Type;
	/**
	 * Set when the session is a background worker rather than the conversation with the owner.
	 * `channel` then collects what is sent into the task's result instead of reaching the owner.
	 */
	worker?: { taskId: string; title: string; private: boolean };
}

type PackExtension = (ctx: PackContext) => ExtensionFactory | ExtensionFactory[];

export function packDirs(config: Config): string[] {
	const dirs: string[] = [];
	for (const name of config.packs) {
		const found = [join(config.dataDir, "packs", name), join(config.appDir, "packs", name)].find((d) => existsSync(d));
		if (found) dirs.push(found);
		else console.error(`nano: pack "${name}" not found in ${config.dataDir}/packs or ${config.appDir}/packs`);
	}
	return dirs;
}

/** Skill folders of the enabled packs, plus loose skills the agent or owner added at runtime. */
export function skillPaths(config: Config): string[] {
	const paths = packDirs(config)
		.map((dir) => join(dir, "skills"))
		.filter((dir) => existsSync(dir));
	const own = join(config.dataDir, "skills");
	if (existsSync(own)) paths.push(own);
	return paths;
}

/** Put Nano's own commands, pack commands and `<data>/bin` on PATH once at startup. */
export function extendPath(config: Config): void {
	const bins = [join(config.appDir, "bin"), ...packDirs(config).map((dir) => join(dir, "bin")), join(config.dataDir, "bin")].filter((dir) =>
		existsSync(dir),
	);
	if (bins.length > 0) process.env.PATH = [...bins, process.env.PATH ?? ""].join(delimiter);
}

export async function packExtensions(ctx: PackContext): Promise<ExtensionFactory[]> {
	const factories: ExtensionFactory[] = [];
	for (const dir of packDirs(ctx.config)) {
		const file = join(dir, "extension.ts");
		if (!existsSync(file)) continue;
		try {
			const module = (await import(pathToFileURL(file).href)) as { default?: PackExtension };
			if (typeof module.default !== "function") throw new Error("extension.ts has no default export function");
			factories.push(...[module.default(ctx)].flat());
		} catch (error) {
			console.error(`nano: pack extension ${file} failed to load:`, (error as Error)?.message ?? error);
		}
	}
	return factories;
}

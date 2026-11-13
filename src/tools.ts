import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import type { ExtensionFactory, ModelRuntime } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { Channel } from "./channel.ts";
import { type Config, currentTimezone } from "./config.ts";
import { ask, askLocal, type ChatFn } from "./local.ts";
import { chooseModel } from "./models.ts";
import { type Job, parseLocalTime, type Scheduler } from "./scheduler.ts";
import { workspaceDir } from "./session.ts";

export const text = (value: string) => ({ content: [{ type: "text" as const, text: value }], details: {} });

export const ModelParam = Type.Optional(
	Type.Union([Type.Literal("main"), Type.Literal("local")], {
		description: 'Model to run on. "local": the owner\'s own local model (falls back to the main model if none is configured). Default "main".',
	}),
);
export const PrivateParam = Type.Optional(
	Type.Boolean({
		description: "Sensitive content (emails, health, finances, documents): runs only on the local model and is refused if there is none. Only the final answer comes back to you.",
	}),
);

/** Refuse private work up front when it could only run on the cloud model. */
export function assertPrivateAllowed(config: Config, isPrivate: boolean | undefined): void {
	const choice = chooseModel("local", Boolean(isPrivate), Boolean(config.local));
	if ("refuse" in choice) throw new Error(choice.refuse);
}

const workspacePath = (config: Config, path: string) => (isAbsolute(path) ? path : join(workspaceDir(config), path));

/** One-shot fallback on the main model, for non-private ask_local calls when no local model is configured. */
function mainChat(config: Config, modelRuntime: ModelRuntime): ChatFn {
	return async (messages, extra, signal) => {
		if (extra.response_format) return { status: 400, text: "constrained output not supported" };
		const model = modelRuntime.getModel(config.modelProvider, config.modelId);
		if (!model) return { status: 404, text: "main model not found" };
		const [system, ...rest] = messages;
		const reply = await modelRuntime.completeSimple(
			model,
			{ systemPrompt: system?.content, messages: rest.map((m) => ({ role: "user" as const, content: m.content, timestamp: Date.now() })) },
			{ maxTokens: 2048, signal },
		);
		if (reply.stopReason === "error") return { status: 500, text: reply.errorMessage ?? "model error" };
		const said = reply.content.flatMap((p) => (p.type === "text" ? [p.text] : [])).join("").trim();
		return { status: 200, text: said };
	};
}

export function htmlToText(html: string): string {
	return html
		.replace(/<(script|style|noscript|svg|head)[\s\S]*?<\/\1>/gi, " ")
		.replace(/<\/(p|div|li|h[1-6]|tr|section|article)>|<br\s*\/?>/gi, "\n")
		.replace(/<[^>]+>/g, " ")
		.replace(/&nbsp;/g, " ")
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/[ \t]+/g, " ")
		.replace(/ *\n */g, "\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

function describeJob(job: Job, timeZone: string): string {
	const when = job.at
		? new Intl.DateTimeFormat("en-US", { timeZone, dateStyle: "medium", timeStyle: "short" }).format(job.at)
		: `cron ${job.cron}${job.until ? ` until ${new Date(job.until).toISOString().slice(0, 10)}` : ""}`;
	const background = job.background ? ` [background${job.private ? ", private" : job.model === "local" ? ", local" : ""}]` : "";
	return `${job.id} | ${job.name} | ${job.kind}${job.then ? `->${job.then}` : ""}${background} | ${when} | ${job.body.replace(/\s+/g, " ").slice(0, 120)}`;
}

/**
 * Tools Nano adds on top of Pi's built-in read/bash/edit/write/grep/find/ls.
 * In a background worker (`worker: true`), `channel` is a buffer: nothing reaches the owner directly.
 */
export function nanoTools(
	config: Config,
	channel: Channel,
	scheduler: Scheduler,
	spaceId: string,
	extra: { modelRuntime: ModelRuntime; worker?: boolean },
): ExtensionFactory {
	return (pi) => {
		pi.registerTool({
			name: "schedule_add",
			label: "Schedule",
			description: [
				"Schedule something for later: a reminder, a recurring check, a monitor.",
				'kind "message": send `body` to the owner word for word at that time. Use for plain reminders.',
				'kind "task": at that time you receive `body` as instructions and act on them with your tools. Use when the reminder depends on checking something first, or for recurring research. Write `body` so it makes sense with no other context. If there is nothing worth telling the owner, reply exactly [silent].',
				'kind "script": run `body` as a shell command. No output means nothing is sent. Output is sent as is (then "send") or handed to you to judge (then "task"). Use for cheap monitors that should only speak on change.',
				"Give exactly one of `at` (one time, owner's local time like 2026-11-12T09:00) or `cron` (five fields, owner's local time).",
				"`background: true` (task, or script with then \"task\"): the work runs in a separate background session so it never blocks chatting; only its final answer comes back to you to pass on, and [silent] still means nothing is sent. Use it for slow jobs (research, browsing, many tool calls). `model` and `private` choose where it runs.",
			].join("\n"),
			parameters: Type.Object({
				name: Type.String({ description: "Short label, e.g. 'Return shoes'" }),
				kind: Type.Union([Type.Literal("message"), Type.Literal("task"), Type.Literal("script")]),
				body: Type.String(),
				at: Type.Optional(Type.String()),
				cron: Type.Optional(Type.String()),
				until: Type.Optional(Type.String({ description: "For cron jobs: stop after this local time" })),
				then: Type.Optional(Type.Union([Type.Literal("send"), Type.Literal("task")])),
				background: Type.Optional(Type.Boolean()),
				model: ModelParam,
				private: PrivateParam,
			}),
			async execute(_id, params) {
				const tz = currentTimezone(config);
				if (Boolean(params.at) === Boolean(params.cron)) throw new Error("Give exactly one of `at` or `cron`.");
				const at = params.at ? parseLocalTime(params.at, tz) : undefined;
				if (at !== undefined && at < Date.now() - 60_000) throw new Error(`That time is in the past (${params.at}, ${tz}).`);
				const then = params.kind === "script" ? (params.then ?? "send") : undefined;
				const usesAgent = params.kind === "task" || then === "task";
				if ((params.background || params.model || params.private) && !usesAgent) {
					throw new Error('background, model and private apply to kind "task" or a script with then "task".');
				}
				// Private or local work only makes sense off the main thread, which always runs on the main model.
				const background = Boolean(params.background || params.private || params.model === "local");
				if (params.private) assertPrivateAllowed(config, true);
				const job = scheduler.add({
					name: params.name,
					kind: params.kind,
					body: params.body,
					then,
					at,
					cron: params.cron,
					until: params.until ? parseLocalTime(params.until, tz) : undefined,
					spaceId,
					...(background ? { background, model: params.model, private: params.private || undefined } : {}),
				});
				return text(`Scheduled: ${describeJob(job, tz)}`);
			},
		});

		pi.registerTool({
			name: "schedule_list",
			label: "List schedule",
			description: "List everything currently scheduled (id | name | kind | when | body).",
			parameters: Type.Object({}),
			async execute() {
				const jobs = scheduler.list();
				const tz = currentTimezone(config);
				return text(jobs.length === 0 ? "Nothing is scheduled." : jobs.map((j) => describeJob(j, tz)).join("\n"));
			},
		});

		pi.registerTool({
			name: "schedule_cancel",
			label: "Cancel schedule",
			description: "Cancel a scheduled job by id (see schedule_list).",
			parameters: Type.Object({ id: Type.String() }),
			async execute(_id, params) {
				const job = scheduler.cancel(params.id);
				if (!job) throw new Error(`No job with id ${params.id}.`);
				return text(`Cancelled: ${job.name}`);
			},
		});

		pi.registerTool({
			name: "send_file",
			label: "Send file",
			description: extra.worker
				? "Attach a file from disk to your result. Nano decides whether to send it to the owner."
				: "Send a file or image from disk to the person you are talking to, as an attachment in the chat. Use for pictures, PDFs, exports. An audio file (m4a/aac, such as a spoken reply from the voice-reply skill) arrives as a native iMessage voice memo that plays inline; pass as_voice: false to send audio as a plain file instead.",
			parameters: Type.Object({
				path: Type.String({ description: "Absolute path, or relative to the workspace" }),
				caption: Type.Optional(Type.String({ description: "Short text sent right after the file" })),
				as_voice: Type.Optional(
					Type.Boolean({
						description:
							"Audio files only. Default (unset): audio is sent as a voice memo. true: insist on a voice memo (m4a/aac plays inline; other formats need conversion). false: send the audio as a plain file attachment.",
					}),
				),
			}),
			async execute(_id, params) {
				const path = workspacePath(config, params.path);
				if (!existsSync(path)) throw new Error(`No such file: ${path}`);
				await channel.sendFile(spaceId, path, params.caption, { asVoice: params.as_voice });
				return text(extra.worker ? `Attached ${path} to your result` : `Sent ${path}`);
			},
		});

		pi.registerTool({
			name: "ask_local",
			label: "Ask local model",
			description: [
				"One-shot classification or extraction on the owner's local model, over a text or a file, without loading that content into this conversation. Returns only the short answer.",
				"Use it for sorting, tagging, yes/no checks and pulling a few fields out of sensitive or bulky material (emails, documents, logs). Give `choices` to get exactly one label back.",
				"Private by default: with no local model configured it refuses. Pass private: false to allow a one-shot call to the main model instead.",
			].join("\n"),
			parameters: Type.Object({
				instruction: Type.String({ description: "What to decide or extract, e.g. 'Is this email a bill that needs paying?'" }),
				text: Type.Optional(Type.String({ description: "The material, if it is short and already in the conversation" })),
				path: Type.Optional(Type.String({ description: "A file to read instead of `text` (absolute, or relative to the workspace)" })),
				choices: Type.Optional(Type.Array(Type.String(), { description: "Allowed labels; the answer is exactly one of them" })),
				private: Type.Optional(Type.Boolean({ description: "Default true" })),
			}),
			async execute(_id, params, signal) {
				const input = params.path ? readFileSync(workspacePath(config, params.path), "utf8") : params.text;
				const options = { instruction: params.instruction, input, choices: params.choices, signal };
				if (config.local) return text(await askLocal(config.local, options));
				const choice = chooseModel("local", params.private ?? true, false);
				if ("refuse" in choice) throw new Error(choice.refuse);
				const answer = await ask(mainChat(config, extra.modelRuntime), options, 64_000);
				return text(`${answer}\n(${choice.note})`);
			},
		});

		pi.registerTool({
			name: "web_fetch",
			label: "Fetch page",
			description: "Fetch a web page or API URL and return its readable text (HTML is stripped, long pages are cut).",
			parameters: Type.Object({
				url: Type.String(),
				max_chars: Type.Optional(Type.Number({ description: "Default 20000" })),
			}),
			async execute(_id, params, signal) {
				const response = await fetch(params.url, {
					signal: signal ?? AbortSignal.timeout(30_000),
					redirect: "follow",
					headers: { "user-agent": "Mozilla/5.0 (compatible; personal-assistant)", accept: "text/html,*/*" },
				});
				const body = await response.text();
				const type = response.headers.get("content-type") ?? "";
				const readable = type.includes("html") ? htmlToText(body) : body;
				const max = params.max_chars ?? 20_000;
				const cut = readable.length > max ? `${readable.slice(0, max)}\n[cut at ${max} of ${readable.length} chars]` : readable;
				return text(`HTTP ${response.status} ${type}\n\n${cut}`);
			},
		});

		if (config.braveApiKey) {
			const key = config.braveApiKey;
			pi.registerTool({
				name: "web_search",
				label: "Web search",
				description: "Search the web. Returns titles, URLs and snippets. Follow up with web_fetch to read a result.",
				parameters: Type.Object({
					query: Type.String(),
					count: Type.Optional(Type.Number({ description: "Results to return, default 6, max 20" })),
				}),
				async execute(_id, params, signal) {
					const url = new URL("https://api.search.brave.com/res/v1/web/search");
					url.searchParams.set("q", params.query);
					url.searchParams.set("count", String(Math.min(params.count ?? 6, 20)));
					const response = await fetch(url, {
						signal: signal ?? AbortSignal.timeout(20_000),
						headers: { accept: "application/json", "x-subscription-token": key },
					});
					if (!response.ok) throw new Error(`Search failed: HTTP ${response.status}`);
					const data = (await response.json()) as {
						web?: { results?: { title: string; url: string; description?: string; age?: string }[] };
					};
					const results = data.web?.results ?? [];
					if (results.length === 0) return text("No results.");
					return text(
						results
							.map((r, i) => `${i + 1}. ${r.title}\n${r.url}\n${htmlToText(r.description ?? "")}${r.age ? ` (${r.age})` : ""}`)
							.join("\n\n"),
					);
				},
			});
		}
	};
}

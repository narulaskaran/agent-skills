import { existsSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { Channel } from "./channel.ts";
import { type Config, currentTimezone } from "./config.ts";
import { type Job, parseLocalTime, type Scheduler } from "./scheduler.ts";

const text = (value: string) => ({ content: [{ type: "text" as const, text: value }], details: {} });

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
	return `${job.id} | ${job.name} | ${job.kind}${job.then ? `->${job.then}` : ""} | ${when} | ${job.body.replace(/\s+/g, " ").slice(0, 120)}`;
}

/** Tools Nano adds on top of Pi's built-in read/bash/edit/write/grep/find/ls. */
export function nanoTools(config: Config, channel: Channel, scheduler: Scheduler, spaceId: string): ExtensionFactory {
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
			].join("\n"),
			parameters: Type.Object({
				name: Type.String({ description: "Short label, e.g. 'Return shoes'" }),
				kind: Type.Union([Type.Literal("message"), Type.Literal("task"), Type.Literal("script")]),
				body: Type.String(),
				at: Type.Optional(Type.String()),
				cron: Type.Optional(Type.String()),
				until: Type.Optional(Type.String({ description: "For cron jobs: stop after this local time" })),
				then: Type.Optional(Type.Union([Type.Literal("send"), Type.Literal("task")])),
			}),
			async execute(_id, params) {
				const tz = currentTimezone(config);
				if (Boolean(params.at) === Boolean(params.cron)) throw new Error("Give exactly one of `at` or `cron`.");
				const at = params.at ? parseLocalTime(params.at, tz) : undefined;
				if (at !== undefined && at < Date.now() - 60_000) throw new Error(`That time is in the past (${params.at}, ${tz}).`);
				const job = scheduler.add({
					name: params.name,
					kind: params.kind,
					body: params.body,
					then: params.kind === "script" ? (params.then ?? "send") : undefined,
					at,
					cron: params.cron,
					until: params.until ? parseLocalTime(params.until, tz) : undefined,
					spaceId,
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
			description:
				"Send a file or image from disk to the person you are talking to, as an attachment in the chat. Use for pictures, PDFs, exports.",
			parameters: Type.Object({
				path: Type.String({ description: "Absolute path, or relative to the workspace" }),
				caption: Type.Optional(Type.String({ description: "Short text sent right after the file" })),
			}),
			async execute(_id, params) {
				const path = isAbsolute(params.path) ? params.path : join(config.dataDir, "workspace", params.path);
				if (!existsSync(path)) throw new Error(`No such file: ${path}`);
				await channel.sendFile(spaceId, path, params.caption);
				return text(`Sent ${path}`);
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

import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import { type Ctx, GMAIL } from "./http.ts";
import {
	choice,
	CliError,
	cut,
	dataDir,
	decodeEntities,
	fmtDateTime,
	htmlToText,
	humanSize,
	idsFrom,
	intOpt,
	mapLimit,
	oneLine,
	parse,
	untrusted,
} from "./util.ts";

interface Header {
	name: string;
	value: string;
}

export interface Part {
	partId?: string;
	mimeType?: string;
	filename?: string;
	headers?: Header[];
	body?: { size?: number; data?: string; attachmentId?: string };
	parts?: Part[];
}

export interface Message {
	id: string;
	threadId: string;
	labelIds?: string[];
	snippet?: string;
	internalDate?: string;
	payload?: Part;
}

interface Attachment {
	n: number;
	filename: string;
	mimeType: string;
	size: number;
	part: Part;
}

const SEARCH_HEADERS = ["From", "To", "Subject", "Date"];
const REPLY_HEADERS = ["From", "Reply-To", "To", "Cc", "Subject", "Message-ID", "References"];
const THREAD_SHOWN = 20;

export function header(part: Part | undefined, name: string): string {
	const lower = name.toLowerCase();
	return part?.headers?.find((h) => h.name.toLowerCase() === lower)?.value ?? "";
}

function walk(part: Part | undefined, visit: (part: Part) => void): void {
	if (!part) return;
	visit(part);
	for (const child of part.parts ?? []) walk(child, visit);
}

function isAttachment(part: Part): boolean {
	return Boolean(part.filename) || /^\s*attachment/i.test(header(part, "Content-Disposition"));
}

function decodePart(part: Part): string {
	const bytes = Buffer.from(part.body?.data ?? "", "base64url");
	const charset = /charset="?([^";\s]+)/i.exec(header(part, "Content-Type"))?.[1] ?? "utf-8";
	try {
		return new TextDecoder(charset).decode(bytes);
	} catch {
		return bytes.toString("utf8");
	}
}

/** Readable body: the plain-text part, or the HTML part as text when plain is missing or a stub. */
export function bodyText(payload: Part | undefined): string {
	const plain: string[] = [];
	const html: string[] = [];
	walk(payload, (part) => {
		if (!part.body?.data || isAttachment(part)) return;
		if (part.mimeType === "text/plain") plain.push(decodePart(part));
		else if (part.mimeType === "text/html") html.push(decodePart(part));
	});
	const text = plain.join("\n\n").replace(/\r\n/g, "\n").trim();
	if (text.length >= 40 || html.length === 0) return text;
	return htmlToText(html.join("\n"));
}

export function attachments(payload: Part | undefined): Attachment[] {
	const found: Attachment[] = [];
	walk(payload, (part) => {
		if (!part.filename || !(part.body?.attachmentId || part.body?.data)) return;
		found.push({ n: found.length + 1, filename: part.filename, mimeType: part.mimeType ?? "application/octet-stream", size: part.body?.size ?? 0, part });
	});
	return found;
}

/** Drop quoted history from a reply so a thread does not repeat itself. */
export function stripQuoted(text: string): string {
	const marker = /^(On [\s\S]{0,300}?wrote:\s*$|-{2,}\s*Original Message\s*-{2,}|_{10,}\s*$|From: .+\n(Sent|Date): .+)/im.exec(text);
	const head = marker && marker.index > 0 ? text.slice(0, marker.index) : text;
	return head
		.split("\n")
		.filter((line) => !line.startsWith(">"))
		.join("\n")
		.trim();
}

const SYSTEM_FLAGS: Record<string, string> = {
	UNREAD: "unread",
	STARRED: "starred",
	SENT: "sent",
	DRAFT: "draft",
	SPAM: "spam",
	TRASH: "trash",
	CATEGORY_PROMOTIONS: "promotions",
	CATEGORY_SOCIAL: "social",
	CATEGORY_UPDATES: "updates",
	CATEGORY_FORUMS: "forums",
};

async function labelNames(ctx: Ctx, messages: Message[]): Promise<Map<string, string>> {
	if (!messages.some((m) => m.labelIds?.some((l) => l.startsWith("Label_")))) return new Map();
	const { labels = [] } = await ctx.api.get<{ labels?: { id: string; name: string }[] }>(`${GMAIL}/labels`);
	return new Map(labels.map((l) => [l.id, l.name]));
}

function flags(labelIds: string[] = [], names: Map<string, string>): string[] {
	const out = labelIds.flatMap((l) => (SYSTEM_FLAGS[l] ? [SYSTEM_FLAGS[l]] : l.startsWith("Label_") ? [names.get(l) ?? l] : []));
	if (!labelIds.includes("INBOX") && !labelIds.includes("SENT") && !labelIds.includes("DRAFT")) out.push("archived");
	return out;
}

const messageDate = (ctx: Ctx, m: Message) => (m.internalDate ? fmtDateTime(Number(m.internalDate), ctx.tz) : header(m.payload, "Date"));

// --- search ------------------------------------------------------------------

async function search(ctx: Ctx, argv: string[]): Promise<void> {
	const { values, positionals } = parse(argv, {
		max: { type: "string" },
		page: { type: "string" },
		format: { type: "string" },
	});
	const format = choice(values.format, ["text", "json", "ids"] as const, "text");
	const max = format === "ids" ? intOpt(values.max, 100, 1, 500) : intOpt(values.max, 10, 1, 50);
	ctx.auth.require("gmail.read");
	const list = await ctx.api.get<{ messages?: { id: string }[]; nextPageToken?: string; resultSizeEstimate?: number }>(`${GMAIL}/messages`, {
		q: positionals.join(" ") || undefined,
		maxResults: max,
		pageToken: values.page,
	});
	const ids = (list.messages ?? []).map((m) => m.id);
	const more = list.nextPageToken ? `more: --page ${list.nextPageToken}` : "";

	if (format === "ids") {
		if (ids.length > 0) ctx.io.out(ids.join("\n"));
		if (more) ctx.io.err(more);
		return;
	}
	const messages = await mapLimit(ids, 8, (id) =>
		ctx.api.get<Message>(`${GMAIL}/messages/${id}`, {
			format: "metadata",
			metadataHeaders: SEARCH_HEADERS,
			fields: "id,threadId,labelIds,snippet,internalDate,payload/headers",
		}),
	);
	const names = await labelNames(ctx, messages);
	const rows = messages.map((m) => ({
		id: m.id,
		threadId: m.threadId,
		date: messageDate(ctx, m),
		from: header(m.payload, "From"),
		to: header(m.payload, "To"),
		subject: header(m.payload, "Subject"),
		flags: flags(m.labelIds, names),
		snippet: decodeEntities(m.snippet ?? ""),
	}));
	if (format === "json") {
		ctx.io.out(JSON.stringify({ messages: rows, next: list.nextPageToken ?? null, estimate: list.resultSizeEstimate ?? rows.length, untrusted: ["from", "to", "subject", "snippet"] }));
		return;
	}
	if (rows.length === 0) {
		ctx.io.out("No messages match.");
		return;
	}
	ctx.io.out(`${rows.length} shown of about ${Math.max(list.resultSizeEstimate ?? 0, rows.length)}${more ? `; ${more}` : ""}. Read one: google gmail read <id>`);
	const lines = rows.map(
		(r) => `${r.id} | ${r.date} | ${oneLine(r.from, 50)} | ${oneLine(r.subject, 90)}${r.flags.length ? ` | ${r.flags.join(", ")}` : ""}\n  ${oneLine(r.snippet, 140)}`,
	);
	ctx.io.out(untrusted("EMAIL", lines.join("\n")));
}

// --- read --------------------------------------------------------------------

function describe(ctx: Ctx, m: Message, names: Map<string, string>, body: string) {
	const files = attachments(m.payload);
	return {
		id: m.id,
		threadId: m.threadId,
		flags: flags(m.labelIds, names),
		from: header(m.payload, "From"),
		to: header(m.payload, "To"),
		cc: header(m.payload, "Cc"),
		date: messageDate(ctx, m),
		subject: header(m.payload, "Subject"),
		attachments: files.map((a) => ({ n: a.n, filename: a.filename, mimeType: a.mimeType, size: a.size })),
		unsubscribe: Boolean(header(m.payload, "List-Unsubscribe")),
		body,
	};
}

function renderText(d: ReturnType<typeof describe>): string {
	const meta = [`Message ${d.id} | thread ${d.threadId}${d.flags.length ? ` | ${d.flags.join(", ")}` : ""}`];
	if (d.attachments.length) meta.push(`Attachments (download: google gmail attachment ${d.id} <n> [--out <path>]):`);
	if (d.unsubscribe) meta.push(`Has unsubscribe info: google gmail unsubscribe ${d.id}`);
	const head = [
		`From: ${d.from}`,
		`To: ${d.to}`,
		d.cc ? `Cc: ${d.cc}` : "",
		`Date: ${d.date}`,
		`Subject: ${d.subject}`,
		...d.attachments.map((a) => `Attachment ${a.n}: ${a.filename} (${a.mimeType}, ${humanSize(a.size)})`),
	].filter(Boolean);
	return `${meta.join("\n")}\n${untrusted("EMAIL", `${head.join("\n")}\n\n${d.body || "(no text body)"}`)}`;
}

async function read(ctx: Ctx, argv: string[]): Promise<void> {
	const { values, positionals } = parse(argv, {
		thread: { type: "boolean" },
		format: { type: "string" },
		"max-chars": { type: "string" },
		quoted: { type: "boolean" },
	});
	const format = choice(values.format, ["text", "json"] as const, "text");
	const ids = await idsFrom(positionals, ctx.io, 50);
	ctx.auth.require("gmail.read");
	const maxChars = intOpt(values["max-chars"], ids.length > 1 || values.thread ? 4000 : 8000, 200, 100_000);

	for (const id of ids) {
		let messages: Message[];
		let omitted = 0;
		if (values.thread) {
			const thread = await ctx.api.get<{ messages?: Message[] }>(`${GMAIL}/threads/${id}`, { format: "full" });
			messages = thread.messages ?? [];
			if (messages.length > THREAD_SHOWN) {
				omitted = messages.length - THREAD_SHOWN;
				messages = [messages[0] as Message, ...messages.slice(-(THREAD_SHOWN - 1))];
			}
		} else {
			messages = [await ctx.api.get<Message>(`${GMAIL}/messages/${id}`, { format: "full" })];
		}
		const names = await labelNames(ctx, messages);
		const perMessage = values.thread ? Math.max(800, Math.floor((maxChars * 3) / Math.max(messages.length, 1))) : maxChars;
		const described = messages.map((m, i) => {
			let body = bodyText(m.payload);
			if (values.thread && !values.quoted && i > 0) body = stripQuoted(body);
			return describe(ctx, m, names, cut(body, perMessage));
		});
		if (format === "json") {
			for (const d of described) ctx.io.out(JSON.stringify(d));
			continue;
		}
		if (values.thread) ctx.io.out(`Thread ${id}: ${described.length + omitted} messages${omitted ? ` (${omitted} in the middle omitted)` : ""}${values.quoted ? "" : ", quoted replies trimmed"}`);
		ctx.io.out(described.map(renderText).join("\n\n"));
	}
}

// --- attachment --------------------------------------------------------------

function safeName(name: string): string {
	return basename(name).replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 100) || "attachment";
}

async function attachment(ctx: Ctx, argv: string[]): Promise<void> {
	const { values, positionals } = parse(argv, { out: { type: "string" } });
	const [id, which] = positionals;
	if (!id || !which) throw new CliError("Usage: google gmail attachment <message-id> <n|filename> [--out <path>]", 2);
	ctx.auth.require("gmail.read");
	const message = await ctx.api.get<Message>(`${GMAIL}/messages/${id}`, { format: "full" });
	const files = attachments(message.payload);
	const found = files.find((a) => String(a.n) === which) ?? files.find((a) => a.filename === which);
	if (!found) throw new CliError(`No attachment "${which}" on ${id}. It has: ${files.map((a) => `${a.n}) ${a.filename}`).join(", ") || "none"}`);
	const data =
		found.part.body?.data ??
		(await ctx.api.get<{ data: string }>(`${GMAIL}/messages/${id}/attachments/${found.part.body?.attachmentId}`)).data;
	const bytes = Buffer.from(data, "base64url");
	let path = values.out ?? join(dataDir(ctx.io.env), "workspace", "attachments", safeName(found.filename));
	if (existsSync(path) && statSync(path).isDirectory()) path = join(path, safeName(found.filename));
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, bytes);
	ctx.io.out(`Saved ${path} (${found.mimeType}, ${humanSize(bytes.length)})`);
}

// --- labels and modify -------------------------------------------------------

interface Label {
	id: string;
	name: string;
	type?: string;
}

async function labels(ctx: Ctx, argv: string[]): Promise<void> {
	parse(argv, {});
	ctx.auth.require("gmail.read");
	const { labels = [] } = await ctx.api.get<{ labels?: Label[] }>(`${GMAIL}/labels`);
	const user = labels.filter((l) => l.type === "user").sort((a, b) => a.name.localeCompare(b.name));
	const system = labels.filter((l) => l.type !== "user" && !l.id.startsWith("CATEGORY_")).map((l) => l.id);
	ctx.io.out(`System: ${system.sort().join(", ")}`);
	ctx.io.out(user.length ? `Yours:\n${user.map((l) => `${l.name} | ${l.id}`).join("\n")}` : "Yours: none");
}

async function modify(ctx: Ctx, argv: string[]): Promise<void> {
	const { values, positionals } = parse(argv, {
		archive: { type: "boolean" },
		inbox: { type: "boolean" },
		read: { type: "boolean" },
		unread: { type: "boolean" },
		star: { type: "boolean" },
		unstar: { type: "boolean" },
		add: { type: "string", multiple: true },
		remove: { type: "string", multiple: true },
		thread: { type: "boolean" },
	});
	const ids = await idsFrom(positionals, ctx.io, 1000);
	ctx.auth.require("gmail.modify");
	const add = new Set<string>();
	const remove = new Set<string>();
	if (values.archive) remove.add("INBOX");
	if (values.inbox) add.add("INBOX");
	if (values.read) remove.add("UNREAD");
	if (values.unread) add.add("UNREAD");
	if (values.star) add.add("STARRED");
	if (values.unstar) remove.add("STARRED");
	if (values.add?.length || values.remove?.length) {
		const { labels: all = [] } = await ctx.api.get<{ labels?: Label[] }>(`${GMAIL}/labels`);
		const resolve = (name: string) => {
			const label = all.find((l) => l.id === name) ?? all.find((l) => l.name.toLowerCase() === name.toLowerCase());
			if (!label) throw new CliError(`No label "${name}". See: google gmail labels`);
			return label.id;
		};
		for (const name of values.add ?? []) add.add(resolve(name));
		for (const name of values.remove ?? []) remove.add(resolve(name));
	}
	if (add.size === 0 && remove.size === 0) throw new CliError("Nothing to change. Use --archive, --read, --star, --add <label> ...", 2);
	const body = { addLabelIds: [...add], removeLabelIds: [...remove] };
	if (values.thread) {
		await mapLimit(ids, 8, (id) => ctx.api.call("POST", `${GMAIL}/threads/${id}/modify`, { json: body }));
	} else {
		await ctx.api.call("POST", `${GMAIL}/messages/batchModify`, { json: { ids, ...body } });
	}
	const changes = [...[...add].map((l) => `+${l}`), ...[...remove].map((l) => `-${l}`)].join(" ");
	ctx.io.out(`Updated ${ids.length} ${values.thread ? "thread" : "message"}${ids.length === 1 ? "" : "s"}: ${changes}`);
}

// --- compose: draft and send -------------------------------------------------

const MIME_TYPES: Record<string, string> = {
	".pdf": "application/pdf",
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".gif": "image/gif",
	".txt": "text/plain",
	".csv": "text/csv",
	".html": "text/html",
	".ics": "text/calendar",
	".zip": "application/zip",
	".doc": "application/msword",
	".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
	".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

const clean = (value: string) => value.replace(/[\r\n]+/g, " ").trim();
const encodeWord = (value: string) => (/^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${Buffer.from(value).toString("base64")}?=`);

export function splitAddresses(list: string): string[] {
	return (list.match(/(?:"[^"]*"|[^,])+/g) ?? []).map((a) => a.trim()).filter(Boolean);
}

export function emailOf(address: string): string {
	return (/<([^>]+)>/.exec(address)?.[1] ?? address).trim().toLowerCase();
}

function encodeAddresses(list: string): string {
	return splitAddresses(clean(list))
		.map((address) => {
			const m = /^"?([^"<]*?)"?\s*<([^>]+)>$/.exec(address);
			if (!m?.[1]) return address;
			const name = /^[\x20-\x7e]*$/.test(m[1]) ? `"${m[1].replace(/"/g, "")}"` : encodeWord(m[1]);
			return `${name} <${m[2]}>`;
		})
		.join(", ");
}

const base64Lines = (data: Buffer) => (data.toString("base64").match(/.{1,76}/g) ?? []).join("\r\n");

export interface Draft {
	to: string;
	cc?: string;
	bcc?: string;
	subject: string;
	body: string;
	inReplyTo?: string;
	references?: string;
	files?: { name: string; mimeType: string; data: Buffer }[];
}

/** RFC 5322 message with UTF-8 headers and body, base64url-encoded for the Gmail API. */
export function buildRaw(d: Draft): string {
	const headers = [
		`To: ${encodeAddresses(d.to)}`,
		d.cc ? `Cc: ${encodeAddresses(d.cc)}` : "",
		d.bcc ? `Bcc: ${encodeAddresses(d.bcc)}` : "",
		`Subject: ${encodeWord(clean(d.subject))}`,
		d.inReplyTo ? `In-Reply-To: ${clean(d.inReplyTo)}` : "",
		d.references ? `References: ${clean(d.references)}` : "",
		"MIME-Version: 1.0",
	].filter(Boolean);
	const text = ["Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: base64", "", base64Lines(Buffer.from(d.body))];
	let lines: string[];
	if (!d.files?.length) {
		lines = [...headers, ...text];
	} else {
		const boundary = `nano-${randomBytes(12).toString("hex")}`;
		lines = [...headers, `Content-Type: multipart/mixed; boundary="${boundary}"`, "", `--${boundary}`, ...text];
		for (const file of d.files) {
			const name = encodeWord(clean(file.name).replace(/"/g, ""));
			lines.push(
				`--${boundary}`,
				`Content-Type: ${file.mimeType}; name="${name}"`,
				`Content-Disposition: attachment; filename="${name}"`,
				"Content-Transfer-Encoding: base64",
				"",
				base64Lines(file.data),
			);
		}
		lines.push(`--${boundary}--`);
	}
	return Buffer.from(lines.join("\r\n")).toString("base64url");
}

const COMPOSE_OPTIONS = {
	to: { type: "string" },
	cc: { type: "string" },
	bcc: { type: "string" },
	subject: { type: "string" },
	body: { type: "string" },
	"body-file": { type: "string" },
	attach: { type: "string", multiple: true },
	"reply-to": { type: "string" },
	"reply-all": { type: "boolean" },
} as const;

interface ComposeValues {
	to?: string;
	cc?: string;
	bcc?: string;
	subject?: string;
	body?: string;
	"body-file"?: string;
	attach?: string[];
	"reply-to"?: string;
	"reply-all"?: boolean;
}

async function compose(ctx: Ctx, values: ComposeValues): Promise<{ draft: Draft; threadId?: string; replyingTo?: string }> {
	let body = values.body;
	if (values["body-file"]) body = values["body-file"] === "-" ? await ctx.io.stdin() : readFileSync(values["body-file"], "utf8");
	if (body === undefined) throw new CliError("Give the text with --body <text> or --body-file <path|->.", 2);
	const files = (values.attach ?? []).map((path) => {
		if (!existsSync(path)) throw new CliError(`No such file to attach: ${path}`, 2);
		return { name: basename(path), mimeType: MIME_TYPES[extname(path).toLowerCase()] ?? "application/octet-stream", data: readFileSync(path) };
	});
	let draft: Draft = { to: values.to ?? "", cc: values.cc, bcc: values.bcc, subject: values.subject ?? "", body, files };
	let threadId: string | undefined;
	let replyingTo: string | undefined;
	if (values["reply-to"]) {
		const original = await ctx.api.get<Message>(`${GMAIL}/messages/${values["reply-to"]}`, { format: "metadata", metadataHeaders: REPLY_HEADERS });
		const h = (name: string) => header(original.payload, name);
		const messageId = h("Message-ID");
		threadId = original.threadId;
		replyingTo = h("Subject");
		let cc = values.cc;
		const to = values.to ?? (h("Reply-To") || h("From"));
		if (values["reply-all"] && cc === undefined) {
			const me = (await ctx.api.get<{ emailAddress?: string }>(`${GMAIL}/profile`)).emailAddress?.toLowerCase();
			const skip = new Set([me, ...splitAddresses(to).map(emailOf)]);
			cc = splitAddresses(`${h("To")},${h("Cc")}`)
				.filter((a) => !skip.has(emailOf(a)))
				.join(", ") || undefined;
		}
		draft = {
			...draft,
			to,
			cc,
			subject: values.subject ?? (/^re:/i.test(h("Subject")) ? h("Subject") : `Re: ${h("Subject")}`),
			inReplyTo: messageId || undefined,
			references: `${h("References")} ${messageId}`.trim() || undefined,
		};
	}
	if (!draft.to.trim()) throw new CliError("Give a recipient with --to (or --reply-to <message-id>).", 2);
	if (!draft.subject.trim()) throw new CliError("Give a --subject.", 2);
	return { draft, threadId, replyingTo };
}

function preview(d: { to: string; cc?: string; bcc?: string; subject: string; body: string; files?: string[]; replyingTo?: string }): string {
	return [
		`To: ${d.to}`,
		d.cc ? `Cc: ${d.cc}` : "",
		d.bcc ? `Bcc: ${d.bcc}` : "",
		`Subject: ${d.subject}`,
		d.replyingTo !== undefined ? `In reply to: ${d.replyingTo}` : "",
		d.files?.length ? `Attachments: ${d.files.join(", ")}` : "",
		"",
		cut(d.body.trim(), 1500),
	]
		.filter((line, i) => line !== "" || i === 6)
		.join("\n");
}

const draftPreview = (c: Awaited<ReturnType<typeof compose>>) =>
	preview({ ...c.draft, files: c.draft.files?.map((f) => f.name), replyingTo: c.replyingTo });

async function draft(ctx: Ctx, argv: string[]): Promise<void> {
	const { values } = parse(argv, COMPOSE_OPTIONS);
	ctx.auth.require("gmail.compose");
	const composed = await compose(ctx, values);
	const created = await ctx.api.call<{ id: string; message?: { id: string } }>("POST", `${GMAIL}/drafts`, {
		json: { message: { raw: buildRaw(composed.draft), threadId: composed.threadId } },
	});
	ctx.io.out(`Draft saved in Gmail Drafts (draft ${created.id}). Nothing was sent.\n${draftPreview(composed)}`);
	ctx.io.out(`To send it once the owner approves: google gmail send --draft ${created.id} --confirm-send`);
}

async function send(ctx: Ctx, argv: string[]): Promise<void> {
	const { values } = parse(argv, { ...COMPOSE_OPTIONS, draft: { type: "string" }, "confirm-send": { type: "boolean" } });
	ctx.auth.require("gmail.send");
	const notSent = () =>
		new CliError("NOT SENT. Show the owner this preview; after they clearly approve it, run the same command with --confirm-send.", 2);
	if (values.draft) {
		if (!values["confirm-send"]) {
			const d = await ctx.api.get<{ message: Message }>(`${GMAIL}/drafts/${values.draft}`, { format: "full" });
			const p = d.message.payload;
			ctx.io.out(
				preview({
					to: header(p, "To"),
					cc: header(p, "Cc"),
					bcc: header(p, "Bcc"),
					subject: header(p, "Subject"),
					body: bodyText(p),
					files: attachments(p).map((a) => a.filename),
				}),
			);
			throw notSent();
		}
		const sent = await ctx.api.call<{ id: string; threadId: string }>("POST", `${GMAIL}/drafts/send`, { json: { id: values.draft } });
		ctx.io.out(`Sent draft ${values.draft} (message ${sent.id}).`);
		return;
	}
	const composed = await compose(ctx, values);
	if (!values["confirm-send"]) {
		ctx.io.out(draftPreview(composed));
		throw notSent();
	}
	const sent = await ctx.api.call<{ id: string; threadId: string }>("POST", `${GMAIL}/messages/send`, {
		json: { raw: buildRaw(composed.draft), threadId: composed.threadId },
	});
	ctx.io.out(`Sent to ${composed.draft.to} (message ${sent.id}, thread ${sent.threadId}).`);
}

// --- unsubscribe -------------------------------------------------------------

export function unsubscribeTargets(listUnsubscribe: string, listUnsubscribePost: string) {
	const entries = [...listUnsubscribe.matchAll(/<([^>]+)>/g)].map((m) => (m[1] ?? "").trim());
	const web = entries.find((e) => /^https:\/\//i.test(e));
	const mailto = entries.find((e) => /^mailto:/i.test(e));
	return { web, mailto, oneClick: Boolean(web) && /List-Unsubscribe=One-Click/i.test(listUnsubscribePost) };
}

async function unsubscribe(ctx: Ctx, argv: string[]): Promise<void> {
	const { values, positionals } = parse(argv, { "one-click": { type: "boolean" } });
	const ids = await idsFrom(positionals, ctx.io, 100);
	ctx.auth.require("gmail.read");
	const messages = await mapLimit(ids, 8, (id) =>
		ctx.api.get<Message>(`${GMAIL}/messages/${id}`, {
			format: "metadata",
			metadataHeaders: ["From", "Subject", "List-Unsubscribe", "List-Unsubscribe-Post"],
		}),
	);
	const bySender = new Map<string, { message: Message; count: number }>();
	for (const m of messages) {
		const key = emailOf(header(m.payload, "From"));
		const seen = bySender.get(key);
		if (seen) seen.count++;
		else bySender.set(key, { message: m, count: 1 });
	}
	const lines: string[] = [];
	for (const { message: m, count } of bySender.values()) {
		const from = oneLine(header(m.payload, "From"), 60);
		const t = unsubscribeTargets(header(m.payload, "List-Unsubscribe"), header(m.payload, "List-Unsubscribe-Post"));
		if (values["one-click"]) {
			if (!t.oneClick || !t.web) {
				lines.push(`${from}: one-click not offered.${t.web ? ` Web page: ${t.web}` : ""}${t.mailto ? ` Email: ${t.mailto}` : ""}${!t.web && !t.mailto ? " No unsubscribe header; look for a link in the body." : ""}`);
				continue;
			}
			try {
				const response = await ctx.io.fetch(t.web, {
					method: "POST",
					headers: { "content-type": "application/x-www-form-urlencoded" },
					body: "List-Unsubscribe=One-Click",
					redirect: "follow",
					signal: AbortSignal.timeout(20_000),
				});
				lines.push(`${from}: ${response.ok ? "unsubscribed" : "unsubscribe request failed"} (one-click, HTTP ${response.status})`);
			} catch (error) {
				lines.push(`${from}: unsubscribe request failed (${(error as Error).message})`);
			}
			continue;
		}
		lines.push(`${m.id} | ${from} | ${oneLine(header(m.payload, "Subject"), 70)}${count > 1 ? ` | ${count} messages` : ""}`);
		if (t.oneClick) lines.push(`  one-click: yes (google gmail unsubscribe ${m.id} --one-click)`);
		if (t.web) lines.push(`  web: ${t.web}`);
		if (t.mailto) lines.push(`  email: ${t.mailto} (sending it is an email: needs the owner's go-ahead)`);
		if (!t.web && !t.mailto) lines.push("  no List-Unsubscribe header; look for an unsubscribe link in the body");
	}
	ctx.io.out(untrusted("EMAIL", lines.join("\n")));
}

async function profile(ctx: Ctx, argv: string[]): Promise<void> {
	parse(argv, {});
	ctx.auth.require("gmail.read");
	const p = await ctx.api.get<{ emailAddress: string; messagesTotal?: number; threadsTotal?: number }>(`${GMAIL}/profile`);
	ctx.io.out(`${p.emailAddress} | ${p.messagesTotal ?? "?"} messages | ${p.threadsTotal ?? "?"} threads`);
}

export const gmailCommands: Record<string, (ctx: Ctx, argv: string[]) => Promise<void>> = {
	search,
	read,
	attachment,
	labels,
	modify,
	draft,
	send,
	unsubscribe,
	profile,
};

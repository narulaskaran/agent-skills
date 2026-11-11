import { CALENDAR, type Ctx } from "./http.ts";
import {
	choice,
	CliError,
	cut,
	fmtDay,
	fmtTime,
	htmlToText,
	intOpt,
	isDateOnly,
	isoDate,
	mapLimit,
	oneLine,
	parse,
	parseDuration,
	parseWhen,
	startOfDay,
	untrusted,
	zonedToEpoch,
} from "./util.ts";

interface EventTime {
	dateTime?: string;
	date?: string;
	timeZone?: string;
}

interface Attendee {
	email?: string;
	displayName?: string;
	responseStatus?: string;
	self?: boolean;
	organizer?: boolean;
}

export interface CalendarEvent {
	id: string;
	status?: string;
	summary?: string;
	location?: string;
	description?: string;
	start?: EventTime;
	end?: EventTime;
	htmlLink?: string;
	organizer?: { email?: string; displayName?: string };
	attendees?: Attendee[];
	hangoutLink?: string;
	conferenceData?: { entryPoints?: { entryPointType?: string; uri?: string }[] };
	recurrence?: string[];
	recurringEventId?: string;
	calendar?: string;
}

interface CalendarEntry {
	id: string;
	summary?: string;
	summaryOverride?: string;
	accessRole?: string;
	primary?: boolean;
	selected?: boolean;
	hidden?: boolean;
}

const calPath = (id: string) => `${CALENDAR}/calendars/${encodeURIComponent(id)}`;
const sendUpdatesOpt = (value: string | undefined) => choice(value, ["none", "all", "externalOnly"] as const, "none");
const dayLabel = (date: string) => fmtDay(Date.parse(`${date}T12:00:00Z`), "UTC");

export function addDaysToDate(date: string, days: number): string {
	const [y, m, d] = date.split("-").map(Number) as [number, number, number];
	return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

function startMs(e: CalendarEvent, tz: string): number {
	if (e.start?.dateTime) return Date.parse(e.start.dateTime);
	const [y, m, d] = (e.start?.date ?? "1970-01-01").split("-").map(Number) as [number, number, number];
	return zonedToEpoch(y, m, d, 0, 0, 0, tz);
}

export function when(e: CalendarEvent, tz: string): string {
	if (e.start?.date) {
		const last = addDaysToDate(e.end?.date ?? addDaysToDate(e.start.date, 1), -1);
		return last > e.start.date ? `${dayLabel(e.start.date)} – ${dayLabel(last)}, all day` : `${dayLabel(e.start.date)}, all day`;
	}
	const s = Date.parse(e.start?.dateTime ?? "");
	const f = Date.parse(e.end?.dateTime ?? "");
	if (Number.isNaN(f)) return `${fmtDay(s, tz)} ${fmtTime(s, tz)}`;
	return isoDate(s, tz) === isoDate(f, tz)
		? `${fmtDay(s, tz)} ${fmtTime(s, tz)}-${fmtTime(f, tz)}`
		: `${fmtDay(s, tz)} ${fmtTime(s, tz)} – ${fmtDay(f, tz)} ${fmtTime(f, tz)}`;
}

function declined(e: CalendarEvent): boolean {
	return e.attendees?.some((a) => a.self && a.responseStatus === "declined") ?? false;
}

function range(ctx: Ctx, values: { from?: string; to?: string; days?: string }, defaultDays: number): { start: number; end: number } {
	const now = ctx.io.now();
	const start = parseWhen(values.from ?? "today", ctx.tz, now);
	let end: number;
	if (values.to) {
		end = isDateOnly(values.to) ? startOfDay(parseWhen(values.to, ctx.tz, now), ctx.tz, 1) : parseWhen(values.to, ctx.tz, now);
	} else {
		end = startOfDay(start, ctx.tz, intOpt(values.days, defaultDays, 1, 366));
	}
	if (end <= start) throw new CliError("The end of the range is before its start.", 2);
	return { start, end };
}

const rangeLabel = (ctx: Ctx, r: { start: number; end: number }) =>
	`${fmtDay(r.start, ctx.tz)} ${fmtTime(r.start, ctx.tz)} – ${fmtDay(r.end, ctx.tz)} ${fmtTime(r.end, ctx.tz)} (${ctx.tz})`;

async function calendars(ctx: Ctx, argv: string[]): Promise<void> {
	parse(argv, {});
	ctx.auth.require("calendar.read");
	const { items = [] } = await ctx.api.get<{ items?: CalendarEntry[] }>(`${CALENDAR}/users/me/calendarList`, { maxResults: 250 });
	ctx.io.out(
		untrusted(
			"CALENDAR",
			items.map((c) => `${c.primary ? "primary" : c.id} | ${c.summaryOverride ?? c.summary ?? ""} | ${c.accessRole ?? ""}${c.hidden ? " | hidden" : ""}`).join("\n"),
		),
	);
}

async function list(ctx: Ctx, argv: string[]): Promise<void> {
	const { values } = parse(argv, {
		from: { type: "string" },
		to: { type: "string" },
		days: { type: "string" },
		calendar: { type: "string" },
		query: { type: "string" },
		max: { type: "string" },
		page: { type: "string" },
		format: { type: "string" },
	});
	const format = choice(values.format, ["text", "json"] as const, "text");
	const max = intOpt(values.max, 50, 1, 250);
	const r = range(ctx, values, 7);
	ctx.auth.require("calendar.read");
	const query = {
		timeMin: new Date(r.start).toISOString(),
		timeMax: new Date(r.end).toISOString(),
		singleEvents: true,
		orderBy: "startTime",
		timeZone: ctx.tz,
		q: values.query,
		maxResults: max,
	};

	let events: CalendarEvent[] = [];
	let next: string | undefined;
	const all = values.calendar === "all";
	if (all) {
		const { items = [] } = await ctx.api.get<{ items?: CalendarEntry[] }>(`${CALENDAR}/users/me/calendarList`, { maxResults: 250 });
		const chosen = items.filter((c) => c.selected && !c.hidden);
		const perCalendar = await mapLimit(chosen, 6, async (c) => {
			const res = await ctx.api.get<{ items?: CalendarEvent[] }>(`${calPath(c.id)}/events`, query);
			return (res.items ?? []).map((e) => ({ ...e, calendar: c.summaryOverride ?? c.summary ?? c.id }));
		});
		events = perCalendar.flat().sort((a, b) => startMs(a, ctx.tz) - startMs(b, ctx.tz));
		if (events.length > max) events = events.slice(0, max);
	} else {
		const res = await ctx.api.get<{ items?: CalendarEvent[]; nextPageToken?: string }>(`${calPath(values.calendar ?? "primary")}/events`, {
			...query,
			pageToken: values.page,
		});
		events = res.items ?? [];
		next = res.nextPageToken;
	}

	if (format === "json") {
		const rows = events.map((e) => ({
			id: e.id,
			calendar: e.calendar,
			start: e.start?.dateTime ?? e.start?.date,
			end: e.end?.dateTime ?? e.end?.date,
			allDay: Boolean(e.start?.date),
			summary: e.summary ?? "",
			location: e.location ?? "",
			declined: declined(e),
		}));
		ctx.io.out(JSON.stringify({ events: rows, next: next ?? null, untrusted: ["summary", "location"] }));
		return;
	}
	const head = `${events.length} event${events.length === 1 ? "" : "s"}, ${rangeLabel(ctx, r)}${next ? `; more: --page ${next}` : ""}`;
	if (events.length === 0) {
		ctx.io.out(`${head}. Nothing scheduled${values.query ? ` matching "${values.query}"` : ""}.`);
		return;
	}
	ctx.io.out(`${head}. Details: google calendar get <id>${all ? " --calendar <id>" : ""}`);
	const lines = events.map((e) =>
		[when(e, ctx.tz), oneLine(e.summary ?? "(no title)", 80), e.location ? oneLine(e.location, 60) : "", e.calendar ? `[${e.calendar}]` : "", declined(e) ? "declined" : "", `id=${e.id}`]
			.filter(Boolean)
			.join(" | "),
	);
	ctx.io.out(untrusted("CALENDAR", lines.join("\n")));
}

function renderEvent(ctx: Ctx, e: CalendarEvent, calendarId: string): string {
	const video = e.hangoutLink ?? e.conferenceData?.entryPoints?.find((p) => p.entryPointType === "video")?.uri;
	const attendees = e.attendees ?? [];
	const shown = attendees
		.slice(0, 30)
		.map((a) => `${a.displayName ? `${a.displayName} ` : ""}<${a.email ?? "?"}>${a.responseStatus ? ` (${a.responseStatus})` : ""}${a.self ? " [owner]" : ""}`);
	const body = [
		`Title: ${e.summary ?? "(no title)"}`,
		`When: ${when(e, ctx.tz)}`,
		e.location ? `Where: ${e.location}` : "",
		e.organizer ? `Organizer: ${e.organizer.displayName ? `${e.organizer.displayName} ` : ""}<${e.organizer.email ?? "?"}>` : "",
		attendees.length ? `Attendees (${attendees.length}): ${shown.join(", ")}${attendees.length > 30 ? ", …" : ""}` : "",
		video ? `Video: ${video}` : "",
		e.recurrence?.length ? `Repeats: ${e.recurrence.join("; ")}` : "",
		e.status && e.status !== "confirmed" ? `Status: ${e.status}` : "",
		e.description ? `\n${cut(htmlToText(e.description), 4000)}` : "",
	].filter(Boolean);
	return `Event ${e.id} | calendar ${calendarId}${e.recurringEventId ? ` | instance of ${e.recurringEventId}` : ""}${e.htmlLink ? `\n${e.htmlLink}` : ""}\n${untrusted("CALENDAR", body.join("\n"))}`;
}

async function get(ctx: Ctx, argv: string[]): Promise<void> {
	const { values, positionals } = parse(argv, { calendar: { type: "string" }, format: { type: "string" } });
	const format = choice(values.format, ["text", "json"] as const, "text");
	const [id] = positionals;
	if (!id) throw new CliError("Usage: google calendar get <event-id> [--calendar <id>]", 2);
	ctx.auth.require("calendar.read");
	const calendarId = values.calendar ?? "primary";
	const e = await ctx.api.get<CalendarEvent>(`${calPath(calendarId)}/events/${encodeURIComponent(id)}`, { timeZone: ctx.tz });
	ctx.io.out(format === "json" ? JSON.stringify(e) : renderEvent(ctx, e, calendarId));
}

const EVENT_OPTIONS = {
	title: { type: "string" },
	start: { type: "string" },
	end: { type: "string" },
	duration: { type: "string" },
	"all-day": { type: "boolean" },
	location: { type: "string" },
	description: { type: "string" },
	attendee: { type: "string", multiple: true },
	calendar: { type: "string" },
	"send-updates": { type: "string" },
} as const;

interface EventValues {
	start?: string;
	end?: string;
	duration?: string;
	"all-day"?: boolean;
}

/** Start/end fields for the API. All-day `--end` is inclusive; Google's end date is exclusive. */
function times(ctx: Ctx, values: EventValues, keepDurationMs?: number): { start: EventTime; end: EventTime } {
	const startText = values.start as string;
	if (values["all-day"] || (isDateOnly(startText) && (!values.end || isDateOnly(values.end)) && !values.duration)) {
		const startDate = isDateOnly(startText) ? startText : isoDate(parseWhen(startText, ctx.tz, ctx.io.now()), ctx.tz);
		const lastDate = values.end ? (isDateOnly(values.end) ? values.end : isoDate(parseWhen(values.end, ctx.tz, ctx.io.now()), ctx.tz)) : startDate;
		if (lastDate < startDate) throw new CliError("The event ends before it starts.", 2);
		return { start: { date: startDate }, end: { date: addDaysToDate(lastDate, 1) } };
	}
	const s = parseWhen(startText, ctx.tz, ctx.io.now());
	const f = values.end
		? parseWhen(values.end, ctx.tz, ctx.io.now())
		: s + (values.duration ? parseDuration(values.duration) : (keepDurationMs ?? 60 * 60_000));
	if (f <= s) throw new CliError("The event ends before it starts.", 2);
	return { start: { dateTime: new Date(s).toISOString(), timeZone: ctx.tz }, end: { dateTime: new Date(f).toISOString(), timeZone: ctx.tz } };
}

async function create(ctx: Ctx, argv: string[]): Promise<void> {
	const { values } = parse(argv, EVENT_OPTIONS);
	if (!values.title || !values.start) throw new CliError("Usage: google calendar create --title <t> --start <when> [--end <when> | --duration 1h] ...", 2);
	ctx.auth.require("calendar.write");
	const calendarId = values.calendar ?? "primary";
	const body = {
		summary: values.title,
		location: values.location,
		description: values.description,
		...times(ctx, values),
		attendees: values.attendee?.map((email) => ({ email })),
	};
	const e = await ctx.api.call<CalendarEvent>("POST", `${calPath(calendarId)}/events`, {
		query: { sendUpdates: sendUpdatesOpt(values["send-updates"]) },
		json: body,
	});
	ctx.io.out(`Created: ${when(e, ctx.tz)} | ${e.summary ?? values.title} | id=${e.id}${e.htmlLink ? `\n${e.htmlLink}` : ""}`);
}

async function update(ctx: Ctx, argv: string[]): Promise<void> {
	const { values, positionals } = parse(argv, EVENT_OPTIONS);
	const [id] = positionals;
	if (!id) throw new CliError("Usage: google calendar update <event-id> [--title] [--start] [--end] [--duration] [--location] [--description] [--attendee <email>]...", 2);
	ctx.auth.require("calendar.write");
	const calendarId = values.calendar ?? "primary";
	const path = `${calPath(calendarId)}/events/${encodeURIComponent(id)}`;
	const patch: Record<string, unknown> = {};
	if (values.title !== undefined) patch.summary = values.title;
	if (values.location !== undefined) patch.location = values.location;
	if (values.description !== undefined) patch.description = values.description;
	if (values.start || values.end || values.duration || values.attendee?.length) {
		const current = await ctx.api.get<CalendarEvent>(path);
		if (values.start || values.end || values.duration) {
			const startText = values.start ?? current.start?.dateTime ?? current.start?.date ?? "";
			const keep = current.start?.dateTime && current.end?.dateTime ? Date.parse(current.end.dateTime) - Date.parse(current.start.dateTime) : undefined;
			Object.assign(patch, times(ctx, { ...values, start: startText }, keep));
		}
		if (values.attendee?.length) {
			const existing = current.attendees ?? [];
			const known = new Set(existing.map((a) => a.email?.toLowerCase()));
			patch.attendees = [...existing, ...values.attendee.filter((e) => !known.has(e.toLowerCase())).map((email) => ({ email }))];
		}
	}
	if (Object.keys(patch).length === 0) throw new CliError("Nothing to change.", 2);
	const e = await ctx.api.call<CalendarEvent>("PATCH", path, { query: { sendUpdates: sendUpdatesOpt(values["send-updates"]) }, json: patch });
	ctx.io.out(`Updated: ${when(e, ctx.tz)} | ${e.summary ?? ""} | id=${e.id}`);
}

async function remove(ctx: Ctx, argv: string[]): Promise<void> {
	const { values, positionals } = parse(argv, { calendar: { type: "string" }, "send-updates": { type: "string" }, confirm: { type: "boolean" } });
	const [id] = positionals;
	if (!id) throw new CliError("Usage: google calendar delete <event-id> [--calendar <id>] --confirm", 2);
	ctx.auth.require("calendar.write");
	const path = `${calPath(values.calendar ?? "primary")}/events/${encodeURIComponent(id)}`;
	if (!values.confirm) {
		const e = await ctx.api.get<CalendarEvent>(path, { timeZone: ctx.tz });
		ctx.io.out(untrusted("CALENDAR", `${when(e, ctx.tz)} | ${e.summary ?? "(no title)"}${e.attendees?.length ? ` | ${e.attendees.length} attendees` : ""}`));
		throw new CliError("NOT DELETED. Confirm with the owner, then run the same command with --confirm.", 2);
	}
	await ctx.api.call("DELETE", path, { query: { sendUpdates: sendUpdatesOpt(values["send-updates"]) } });
	ctx.io.out(`Deleted event ${id}.`);
}

async function freebusy(ctx: Ctx, argv: string[]): Promise<void> {
	const { values } = parse(argv, { from: { type: "string" }, to: { type: "string" }, days: { type: "string" }, calendar: { type: "string" } });
	const r = range(ctx, values, 1);
	ctx.auth.require("calendar.read");
	const ids = (values.calendar ?? "primary").split(",").map((s) => s.trim()).filter(Boolean);
	const res = await ctx.api.call<{ calendars?: Record<string, { busy?: { start: string; end: string }[]; errors?: { reason?: string }[] }> }>(
		"POST",
		`${CALENDAR}/freeBusy`,
		{ json: { timeMin: new Date(r.start).toISOString(), timeMax: new Date(r.end).toISOString(), timeZone: ctx.tz, items: ids.map((id) => ({ id })) } },
	);
	const lines = [`Busy times, ${rangeLabel(ctx, r)}:`];
	for (const id of ids) {
		const entry = res.calendars?.[id];
		if (ids.length > 1) lines.push(`${id}:`);
		if (entry?.errors?.length) {
			lines.push(`  error: ${entry.errors.map((e) => e.reason).join(", ")}`);
			continue;
		}
		const busy = entry?.busy ?? [];
		if (busy.length === 0) lines.push("  free the whole range");
		for (const b of busy) lines.push(`  ${when({ id: "", start: { dateTime: b.start }, end: { dateTime: b.end } }, ctx.tz)}`);
	}
	ctx.io.out(lines.join("\n"));
}

export const calendarCommands: Record<string, (ctx: Ctx, argv: string[]) => Promise<void>> = {
	calendars,
	list,
	get,
	create,
	update,
	delete: remove,
	freebusy,
};

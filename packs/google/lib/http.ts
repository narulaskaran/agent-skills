import type { Auth } from "./auth.ts";
import { CliError, type Io } from "./util.ts";

export const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";
export const CALENDAR = "https://www.googleapis.com/calendar/v3";

export interface Ctx {
	io: Io;
	auth: Auth;
	api: Api;
	/** Owner's timezone, for reading and printing times. */
	tz: string;
}

type Query = Record<string, string | number | boolean | string[] | undefined>;

interface Options {
	query?: Query;
	json?: unknown;
}

const RETRY_STATUS = new Set([429, 500, 502, 503, 504]);

export class Api {
	private readonly io: Io;
	private readonly auth: Auth;

	constructor(io: Io, auth: Auth) {
		this.io = io;
		this.auth = auth;
	}

	get<T>(url: string, query?: Query): Promise<T> {
		return this.call<T>("GET", url, { query });
	}

	async call<T>(method: string, url: string, options: Options = {}): Promise<T> {
		const target = new URL(url);
		for (const [key, value] of Object.entries(options.query ?? {})) {
			if (value === undefined) continue;
			for (const v of Array.isArray(value) ? value : [value]) target.searchParams.append(key, String(v));
		}
		let refreshed = false;
		for (let attempt = 0; ; attempt++) {
			const token = await this.auth.accessToken(refreshed);
			const response = await this.io.fetch(target, {
				method,
				headers: {
					authorization: `Bearer ${token}`,
					...(options.json === undefined ? {} : { "content-type": "application/json" }),
				},
				body: options.json === undefined ? undefined : JSON.stringify(options.json),
				signal: AbortSignal.timeout(60_000),
			});
			if (response.status === 401 && !refreshed) {
				refreshed = true;
				continue;
			}
			if (RETRY_STATUS.has(response.status) && attempt < 2) {
				await this.io.sleep(1000 * 3 ** attempt);
				continue;
			}
			if (response.status === 204) return undefined as T;
			const text = await response.text();
			if (!response.ok) throw this.error(response.status, text);
			return (text ? JSON.parse(text) : undefined) as T;
		}
	}

	private error(status: number, text: string): CliError {
		let message = text.slice(0, 300);
		let reason = "";
		try {
			const body = JSON.parse(text) as { error?: { message?: string; status?: string; errors?: { reason?: string }[] } };
			message = body.error?.message ?? message;
			reason = body.error?.errors?.[0]?.reason ?? body.error?.status ?? "";
		} catch {}
		if (status === 403 && /insufficient|scope/i.test(`${reason} ${message}`)) {
			return new CliError(this.auth.missingPermission("permission for this request"));
		}
		if (status === 403 && /has not been used|is disabled|accessNotConfigured/i.test(`${reason} ${message}`)) {
			return new CliError(`Google API not enabled for this OAuth project: ${message.slice(0, 200)} Enable the Gmail API and Google Calendar API in the Cloud console.`);
		}
		if (status === 404) return new CliError(`Not found (HTTP 404): ${message}. Check the id.`);
		return new CliError(`Google API error ${status}${reason ? ` ${reason}` : ""}: ${message}`);
	}
}

import { createHash, randomBytes } from "node:crypto";
import { chmodSync, chownSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * T3 Code's `/mcp` endpoint takes OAuth 2.1 bearer tokens from its own authorization server
 * (dynamic client registration, PKCE S256, public clients, no refresh tokens). Approval happens on
 * its `/connect-agent` page, either from a signed-in browser or with a one-time pairing code.
 *
 * A headless client uses the pairing-code path the same way T3 Code links its own environments:
 * register, post the decision with the code, exchange the returned authorization code. The
 * redirect URI is never visited; the decision endpoint returns it as data.
 */

export const DEFAULT_T3CODE_URL = "http://127.0.0.1:4096";
export const ACCESS_LEVELS = ["read-only", "approval-required", "auto-accept-edits", "auto", "full-access"] as const;
export type T3Access = (typeof ACCESS_LEVELS)[number];
export const DEFAULT_ACCESS: T3Access = "approval-required";

/** Tools Nano may reach. Everything else the server offers (project deletion, settings, schedules) stays hidden. */
export const T3_TOOLS = [
	"t3_project_list",
	"t3_project_read",
	"t3_thread_search",
	"t3_thread_list",
	"t3_thread_read",
	"t3_thread_launch",
	"t3_thread_send",
	"t3_thread_interrupt",
] as const;

const CLIENT_NAME = "Nano";
const REDIRECT_URI = "http://127.0.0.1/callback";

export interface T3Credentials {
	/** Origin of the T3 Code server, e.g. http://127.0.0.1:4096. */
	url: string;
	token: string;
	access: T3Access;
	scope: string;
	/** Epoch milliseconds. Tokens cannot be refreshed; pair again after this. */
	expiresAt: number;
	connectedAt: number;
}

export function isAccess(value: string): value is T3Access {
	return (ACCESS_LEVELS as readonly string[]).includes(value);
}

/** Origin to talk to: NANO_T3CODE_URL with any trailing slash or `/mcp` removed. */
export function t3Origin(value: string | undefined = process.env.NANO_T3CODE_URL): string {
	return (value?.trim() || DEFAULT_T3CODE_URL).replace(/\/+$/, "").replace(/\/mcp$/, "");
}

export function credentialsPath(dataDir: string): string {
	return join(dataDir, "t3code", "credentials.json");
}

export function readCredentials(dataDir: string): T3Credentials | undefined {
	const path = credentialsPath(dataDir);
	if (!existsSync(path)) return undefined;
	try {
		const data = JSON.parse(readFileSync(path, "utf8")) as Partial<T3Credentials>;
		return typeof data.token === "string" && typeof data.url === "string" ? (data as T3Credentials) : undefined;
	} catch {
		return undefined;
	}
}

export function writeCredentials(dataDir: string, credentials: T3Credentials): void {
	const dir = join(dataDir, "t3code");
	const path = credentialsPath(dataDir);
	mkdirSync(dir, { recursive: true, mode: 0o700 });
	const tmp = `${path}.tmp`;
	writeFileSync(tmp, JSON.stringify(credentials, null, 2), { mode: 0o600 });
	chmodSync(tmp, 0o600);
	// `docker exec` runs as root; Nano itself runs as the owner of the data directory.
	if (process.getuid?.() === 0) {
		const { uid, gid } = statSync(dataDir);
		chownSync(dir, uid, gid);
		chownSync(tmp, uid, gid);
	}
	renameSync(tmp, path);
}

export function removeCredentials(dataDir: string): boolean {
	const path = credentialsPath(dataDir);
	if (!existsSync(path)) return false;
	rmSync(path);
	return true;
}

export function isExpired(credentials: T3Credentials, now = Date.now()): boolean {
	return credentials.expiresAt <= now;
}

/** One line about the stored connection, without the token. */
export function describeCredentials(credentials: T3Credentials | undefined, now = Date.now()): string {
	if (!credentials) return "Not connected to T3 Code.";
	const until = new Date(credentials.expiresAt).toISOString().slice(0, 10);
	if (isExpired(credentials, now)) return `The T3 Code connection to ${credentials.url} expired on ${until}. Pair again.`;
	const days = Math.floor((credentials.expiresAt - now) / 86_400_000);
	return `Connected to T3 Code at ${credentials.url} with ${credentials.access} access until ${until} (${days} days left).`;
}

const base64url = (bytes: Buffer) => bytes.toString("base64url");

/** POST JSON, or a form when `form` is set (the token endpoint takes only application/x-www-form-urlencoded). */
async function post(url: string, body: Record<string, unknown>, form = false): Promise<{ status: number; data: Record<string, unknown> }> {
	const response = await fetch(url, {
		method: "POST",
		headers: { "content-type": form ? "application/x-www-form-urlencoded" : "application/json", accept: "application/json" },
		body: form ? new URLSearchParams(body as Record<string, string>).toString() : JSON.stringify(body),
		signal: AbortSignal.timeout(20_000),
	});
	const text = await response.text();
	let data: Record<string, unknown> = {};
	try {
		data = text ? (JSON.parse(text) as Record<string, unknown>) : {};
	} catch {
		data = { message: text.slice(0, 200) };
	}
	return { status: response.status, data };
}

function failure(step: string, data: Record<string, unknown>, status: number): Error {
	const reason = data.error_description ?? data.message ?? data.error ?? `HTTP ${status}`;
	return new Error(`${step}: ${String(reason)}`);
}

/** Redeem a one-time T3 Code pairing code for an MCP bearer token. The code is used up either way. */
export async function pairWithCode(options: { url: string; code: string; access: T3Access; now?: number }): Promise<T3Credentials> {
	const origin = t3Origin(options.url);
	const resource = `${origin}/mcp`;

	const registered = await post(`${origin}/oauth/mcp/register`, { client_name: CLIENT_NAME, redirect_uris: [REDIRECT_URI] });
	const clientId = registered.data.client_id;
	if (registered.status >= 300 || typeof clientId !== "string") throw failure("T3 Code refused to register Nano", registered.data, registered.status);

	const verifier = base64url(randomBytes(32));
	const challenge = base64url(createHash("sha256").update(verifier).digest());
	const state = base64url(randomBytes(16));
	const decided = await post(`${origin}/oauth/mcp/decision`, {
		authorization: {
			response_type: "code",
			client_id: clientId,
			redirect_uri: REDIRECT_URI,
			code_challenge: challenge,
			code_challenge_method: "S256",
			state,
			resource,
		},
		decision: { _tag: "pairing-code", access: options.access, code: options.code.trim() },
	});
	if (decided.status >= 300 || typeof decided.data.redirectTo !== "string") throw failure("T3 Code did not approve", decided.data, decided.status);
	const redirect = new URL(decided.data.redirectTo);
	const code = redirect.searchParams.get("code");
	if (!code || redirect.searchParams.get("state") !== state) {
		throw new Error(`T3 Code did not approve: ${redirect.searchParams.get("error_description") ?? redirect.searchParams.get("error") ?? "no code returned"}`);
	}

	const exchanged = await post(
		`${origin}/oauth/mcp/token`,
		{ grant_type: "authorization_code", code, redirect_uri: REDIRECT_URI, client_id: clientId, code_verifier: verifier, resource },
		true,
	);
	const token = exchanged.data.access_token;
	if (exchanged.status >= 300 || typeof token !== "string") throw failure("T3 Code refused the token exchange", exchanged.data, exchanged.status);

	const now = options.now ?? Date.now();
	const expiresIn = Number(exchanged.data.expires_in ?? 0);
	return {
		url: origin,
		token,
		access: options.access,
		scope: String(exchanged.data.scope ?? ""),
		expiresAt: now + (expiresIn > 0 ? expiresIn * 1000 : 30 * 86_400_000),
		connectedAt: now,
	};
}

export type TokenCheck = { ok: true } | { ok: false; reason: "unauthorized" | "unreachable" | "unexpected"; detail: string };

/** Ask `/mcp` to initialize with the token. Reads nothing and changes nothing in T3 Code. */
export async function checkToken(url: string, token: string): Promise<TokenCheck> {
	try {
		const response = await fetch(`${t3Origin(url)}/mcp`, {
			method: "POST",
			headers: {
				authorization: `Bearer ${token}`,
				"content-type": "application/json",
				accept: "application/json, text/event-stream",
			},
			body: JSON.stringify({
				jsonrpc: "2.0",
				id: 1,
				method: "initialize",
				params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "nano-t3code-check", version: "1" } },
			}),
			signal: AbortSignal.timeout(10_000),
		});
		await response.body?.cancel();
		if (response.ok) return { ok: true };
		if (response.status === 401 || response.status === 403) return { ok: false, reason: "unauthorized", detail: `HTTP ${response.status}` };
		return { ok: false, reason: "unexpected", detail: `HTTP ${response.status}` };
	} catch (error) {
		return { ok: false, reason: "unreachable", detail: (error as Error)?.message ?? String(error) };
	}
}

/** The `t3code` MCP server entry: tools are deferred (found with tool_search), and only T3_TOOLS are reachable. */
export function mcpServerConfig(credentials: T3Credentials) {
	return {
		url: `${credentials.url}/mcp`,
		headers: { Authorization: `Bearer ${credentials.token}` },
		exposure: "hidden" as const,
		toolExposure: Object.fromEntries(T3_TOOLS.map((name) => [name, "deferred" as const])),
		description: "T3 Code, the owner's coding-agent app: list projects, start coding threads, check on them and read their results",
	};
}

/** Thread links carry the origin Nano connected to. Point them at the address the owner opens T3 Code at. */
export function rewriteLinks(text: string, from: string, to: string | undefined): string {
	if (!to) return text;
	const target = to.replace(/\/+$/, "");
	return target === from ? text : text.split(`${from}/`).join(`${target}/`);
}

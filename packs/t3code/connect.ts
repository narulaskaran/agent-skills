import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import {
	ACCESS_LEVELS,
	checkToken,
	DEFAULT_ACCESS,
	describeCredentials,
	isAccess,
	isExpired,
	pairWithCode,
	readCredentials,
	removeCredentials,
	t3Origin,
	writeCredentials,
} from "./auth.ts";

const USAGE = `t3code-connect: connect Nano to T3 Code's MCP server.

  t3code-connect status                  show the stored connection and test it
  t3code-connect pair [code] [options]   redeem a one-time pairing code (prompts when no code is given)
      --access <level>   ${ACCESS_LEVELS.join(" | ")} (default ${process.env.NANO_T3CODE_ACCESS || DEFAULT_ACCESS})
      --url <origin>     T3 Code server (default NANO_T3CODE_URL or http://127.0.0.1:4096)
  t3code-connect disconnect              forget the stored token

Create the pairing code on the T3 Code host: t3 pair --scope orchestration:read --scope orchestration:operate --label Nano
(or in T3 Code's Connections settings). Codes are single use and expire after a few minutes.`;

const dataDir = resolve(process.env.NANO_DATA_DIR ?? fileURLToPath(new URL("../../data", import.meta.url)));

function option(args: string[], name: string): string | undefined {
	const index = args.indexOf(name);
	if (index < 0) return undefined;
	const [, value] = args.splice(index, 2);
	if (!value) throw new Error(`${name} needs a value`);
	return value;
}

async function readCode(): Promise<string> {
	const rl = createInterface({ input: process.stdin, output: process.stdin.isTTY ? process.stderr : undefined });
	try {
		return (await rl.question(process.stdin.isTTY ? "Pairing code: " : "")).trim();
	} finally {
		rl.close();
	}
}

async function status(): Promise<number> {
	const credentials = readCredentials(dataDir);
	console.log(describeCredentials(credentials));
	if (!credentials || isExpired(credentials)) return 1;
	const check = await checkToken(credentials.url, credentials.token);
	if (check.ok) {
		console.log("The token works.");
		return 0;
	}
	console.log(
		check.reason === "unauthorized"
			? "T3 Code rejects the token (revoked or expired). Pair again."
			: `Could not check the token: ${check.reason} (${check.detail}).`,
	);
	return 1;
}

async function pair(args: string[]): Promise<number> {
	const access = option(args, "--access") ?? process.env.NANO_T3CODE_ACCESS ?? DEFAULT_ACCESS;
	if (!isAccess(access)) throw new Error(`--access must be one of: ${ACCESS_LEVELS.join(", ")}`);
	const url = t3Origin(option(args, "--url"));
	const code = args[0] ?? (await readCode());
	if (!code) throw new Error("No pairing code given.");
	const credentials = await pairWithCode({ url, code, access });
	writeCredentials(dataDir, credentials);
	console.log(describeCredentials(credentials));
	const check = await checkToken(credentials.url, credentials.token);
	console.log(check.ok ? "The token works. Nano picks it up with the next message." : `Stored, but the check failed: ${check.detail}`);
	return check.ok ? 0 : 1;
}

async function main(): Promise<number> {
	const [command, ...args] = process.argv.slice(2);
	switch (command) {
		case "status":
			return status();
		case "pair":
			return pair(args);
		case "disconnect":
			console.log(
				removeCredentials(dataDir)
					? "Forgot the T3 Code token. To revoke it on the T3 Code side too, remove the Nano connection in T3 Code's Connections settings."
					: "Nothing to forget: not connected.",
			);
			return 0;
		default:
			console.log(USAGE);
			return command === undefined || command === "help" || command === "--help" ? 0 : 2;
	}
}

main().then(
	(code) => process.exit(code),
	(error) => {
		console.error(`t3code-connect: ${(error as Error)?.message ?? error}`);
		process.exit(1);
	},
);

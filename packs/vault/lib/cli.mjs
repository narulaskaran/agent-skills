// `vault` client. It never sees a secret: list, the portal URL, and fetch results
// are produced by the daemon and already redacted.

import http from "node:http";
import { existsSync, statSync } from "node:fs";
import { VAULT_RUN_DIR, VAULT_SOCKET } from "./paths.mjs";

const HELP = `vault: credentials the agent can use and cannot read

  list
  url [--add <site>]                 portal address; --add pre-fills the site field
  fetch <name> [-X METHOD] [-H 'Name: value']... [-d body] <url>
                                     call a URL with a saved API key`;

function vaultReady() {
	try {
		const st = statSync(VAULT_RUN_DIR);
		return st.isDirectory() && st.uid !== process.getuid();
	} catch {
		return false;
	}
}

function call(argv) {
	return new Promise((resolve, reject) => {
		const req = http.request({ socketPath: VAULT_SOCKET, method: "POST", path: "/", timeout: 120_000 }, (res) => {
			let data = "";
			res.setEncoding("utf8");
			res.on("data", (chunk) => (data += chunk));
			res.on("end", () => {
				try {
					resolve(JSON.parse(data));
				} catch {
					reject(new Error("vault returned a response that is not JSON"));
				}
			});
		});
		req.on("timeout", () => req.destroy(new Error("vault did not answer in time")));
		req.on("error", () => reject(new Error("vault is not running")));
		req.end(JSON.stringify({ argv }));
	});
}

const argv = process.argv.slice(2);
const command = argv[0];
if (!command || command === "help" || command === "--help" || command === "-h") {
	console.log(HELP);
	process.exit(0);
}
if (!vaultReady() && !existsSync(VAULT_SOCKET)) {
	console.error("vault: the vault pack is not running");
	process.exit(1);
}
const result = await call(argv);
if (result.text) (result.ok ? process.stdout : process.stderr).write(`${result.text}\n`);
process.exit(result.ok ? 0 : 1);

// Login fixture for the vault browser. One host, several flows:
//   /login        single-step username and password
//   /login-two    username, continue, then password
//   /login-otp    password, then a one-time code
//   /wrong        failed login that echoes the password and keeps it in the field
//   /notes        an ordinary text box on the same host
//   /bounce       a page that tries to navigate to a file: URL
//
//   node fixture-server.mjs [port]

import http from "node:http";
import { totpCode } from "../lib/totp.mjs";

const port = Number(process.argv[2] ?? 8491);
const user = "fixture-user";
const password = "fixture-password-9f3a7c";
const totp = { secret: "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", digits: 6, period: 30, algorithm: "SHA1" };
const fileTarget = process.env.FIXTURE_FILE_URL || "file:///vault/store.json";

function page(title, body) {
	return `<!doctype html><html lang="en"><meta charset="utf-8"><title>${title}</title><body>${body}</body></html>`;
}

function form(action, fields, button) {
	return `<form method="post" action="${action}">${fields}<button type="submit">${button}</button></form>`;
}

const server = http.createServer((req, res) => {
	const url = new URL(req.url || "/", "http://127.0.0.1");
	const chunks = [];
	req.on("data", (chunk) => chunks.push(chunk));
	req.on("end", () => {
		const posted = new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
		const send = (status, html, headers = {}) => {
			res.writeHead(status, { "content-type": "text/html; charset=utf-8", ...headers });
			res.end(html);
		};
		if (url.pathname === "/home") return send(200, page("Home", "<h1>Logged in</h1><p>The fixture session is open.</p>"));
		if (url.pathname === "/notes") return send(200, page("Notes", '<label>Note <input name="note" type="text" value=""></label>'));
		if (url.pathname === "/bounce") {
			return send(200, page("Bounce", `<p>trying a forbidden scheme</p><script>location = ${JSON.stringify(fileTarget)}</script>`));
		}
		if (url.pathname === "/login" && req.method === "GET") {
			return send(200, page("Sign in", form("/login", '<label>Username <input name="username" autocomplete="username"></label><label>Password <input type="password" name="password"></label>', "Sign in")));
		}
		if (url.pathname === "/login" && req.method === "POST") {
			if (posted.get("username") === user && posted.get("password") === password) {
				return send(302, "", { location: "/home", "set-cookie": "fixture=ok; Path=/" });
			}
			return send(200, page("Sign in", "<p>Denied</p>" + form("/login", '<label>Username <input name="username" autocomplete="username"></label><label>Password <input type="password" name="password"></label>', "Sign in")));
		}
		if (url.pathname === "/login-two" && req.method === "GET") {
			return send(200, page("Sign in", form("/login-two", '<label>Username <input name="username" autocomplete="username"></label><input type="hidden" name="step" value="user">', "Continue")));
		}
		if (url.pathname === "/login-two" && req.method === "POST" && posted.get("step") === "user") {
			return send(200, page("Password", form("/login-two", `<input type="hidden" name="username" value="${escapeHtml(posted.get("username") ?? "")}"><label>Password <input type="password" name="password"></label>`, "Sign in")));
		}
		if (url.pathname === "/login-two" && req.method === "POST") {
			if (posted.get("username") === user && posted.get("password") === password) return send(302, "", { location: "/home" });
			return send(200, page("Password", "<p>Denied</p>"));
		}
		if (url.pathname === "/login-otp" && req.method === "GET") {
			return send(200, page("Sign in", form("/login-otp", '<label>Username <input name="username" autocomplete="username"></label><label>Password <input type="password" name="password"></label>', "Sign in")));
		}
		if (url.pathname === "/login-otp" && req.method === "POST" && !posted.get("otp")) {
			if (posted.get("password") !== password) return send(200, page("Sign in", "<p>Denied</p>"));
			return send(200, page("Code", form("/login-otp", `<input type="hidden" name="username" value="${escapeHtml(posted.get("username") ?? "")}"><label>Verification code <input name="otp" autocomplete="one-time-code" inputmode="numeric"></label>`, "Verify")));
		}
		if (url.pathname === "/login-otp" && req.method === "POST") {
			const codes = [-1, 0, 1].map((offset) => totpCode(totp, Date.now() + offset * totp.period * 1000));
			if (codes.includes(posted.get("otp"))) return send(302, "", { location: "/home" });
			return send(200, page("Code", "<p>Code denied</p>"));
		}
		if (url.pathname === "/wrong") {
			const given = posted.get("password") ?? "";
			const value = escapeHtml(given);
			return send(200, page("Denied", `<p>Denied</p><p id="echo">${value}</p>
<form method="post" action="/wrong"><label>Password <input id="pw" type="password" name="password" value="${value}"></label><button type="submit">Sign in</button></form>
<button type="button" id="show">Show password</button><p id="len"></p>
<script>document.getElementById("show").onclick = () => { const f = document.getElementById("pw"); f.type = f.type === "password" ? "text" : "password"; document.getElementById("len").textContent = "length " + f.value.length; };</script>`));
		}
		send(404, page("Missing", "<p>Missing</p>"));
	});
});

function escapeHtml(value) {
	return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

server.listen(port, "0.0.0.0", () => console.log(`fixture http://127.0.0.1:${port}/`));

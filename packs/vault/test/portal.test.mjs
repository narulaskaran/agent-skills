import assert from "node:assert/strict";
import http from "node:http";
import { test } from "node:test";
import { connectionAllowed, ip4 } from "../lib/net.mjs";
import { chooseBinds, createPortal, hostHeaderAllowed, originMatchesHost } from "../lib/portal.mjs";
import { deleteEntry, emptyStore, upsertKey, upsertLogin } from "../lib/store.mjs";
import { parseAllow } from "../lib/net.mjs";

const password = "fixture-password-9f3a";
const seed = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
const key = "vk-test-fixture-key-0001";

function listen(options) {
	const server = createPortal(options);
	return new Promise((resolve, reject) => {
		server.listen(0, "127.0.0.1", () => {
			options.port = server.address().port;
			options.bind = "127.0.0.1";
			resolve(server);
		});
		server.on("error", reject);
	});
}

function request(port, { method = "GET", path = "/", headers = {}, body = "" }) {
	return new Promise((resolve, reject) => {
		const req = http.request({ host: "127.0.0.1", port, path, method, headers }, (res) => {
			const chunks = [];
			res.on("data", (chunk) => chunks.push(chunk));
			res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString("utf8") }));
		});
		req.on("error", reject);
		req.end(body);
	});
}

async function portal(insecureLocal) {
	let data = emptyStore();
	const options = {
		bind: "127.0.0.1",
		port: 0,
		allow: parseAllow(""),
		ownAddresses: new Set(),
		insecureLocal,
		hosts: ["vault.example"],
		read: () => data,
		write(mutator) {
			data = mutator(data);
		},
		saveLogin: (store, form) => upsertLogin(store, { ...form, removeTotp: form.removeTotp === "yes" }),
		saveKey: (store, form) => upsertKey(store, form),
		remove: (store, name) => deleteEntry(store, name),
		log() {},
	};
	const server = await listen(options);
	return { server, port: () => options.port, data: () => data };
}

test("Host and Origin checks", () => {
	assert.equal(hostHeaderAllowed("127.0.0.1:8484", { bind: "127.0.0.1", port: 8484, names: [] }), true);
	assert.equal(hostHeaderAllowed("vault.example:8484", { bind: "127.0.0.1", port: 8484, names: ["vault.example"] }), true);
	assert.equal(hostHeaderAllowed("evil.example:8484", { bind: "127.0.0.1", port: 8484, names: ["vault.example"] }), false);
	assert.equal(hostHeaderAllowed("127.0.0.1:9999", { bind: "127.0.0.1", port: 8484, names: [] }), false);
	assert.equal(originMatchesHost("http://127.0.0.1:8484", "127.0.0.1:8484"), true);
	assert.equal(originMatchesHost("http://evil.example:8484", "127.0.0.1:8484"), false);
	assert.equal(originMatchesHost(undefined, "127.0.0.1:8484"), false);
	assert.equal(originMatchesHost("null", "127.0.0.1:8484"), false);
});

test("loopback is refused unless the test allowance is on, and X-Forwarded-For is ignored", async (t) => {
	const closed = await portal(false);
	t.after(() => closed.server.close());
	const denied = await request(closed.port(), { headers: { host: `127.0.0.1:${closed.port()}`, "x-forwarded-for": ip4(100, 64, 1, 9) } });
	assert.equal(denied.status, 403);
	assert.equal(denied.body, "forbidden");
	assert.equal(denied.body.includes(password), false);
});

test("a saved login is not echoed, and a POST without Origin or CSRF is refused", async (t) => {
	const app = await portal(true);
	t.after(() => app.server.close());
	const port = app.port();
	const host = `127.0.0.1:${port}`;
	const first = await request(port, { headers: { host } });
	assert.equal(first.status, 200);
	assert.match(first.headers["content-security-policy"], /default-src 'none'/);
	assert.equal(first.headers["cache-control"], "no-store");
	// no-referrer makes browser form POSTs send Origin: null, blocking legitimate saves.
	assert.equal(first.headers["referrer-policy"], "same-origin");
	assert.match(first.headers["set-cookie"][0], /HttpOnly/);
	assert.match(first.headers["set-cookie"][0], /SameSite=Strict/);
	const token = /vault_csrf=([a-f0-9]+)/.exec(first.headers["set-cookie"][0])[1];
	const cookie = `vault_csrf=${token}`;
	const noOrigin = await request(port, { method: "POST", path: "/login/new", headers: { host, cookie, "content-type": "application/x-www-form-urlencoded" }, body: "csrf=" + token });
	assert.equal(noOrigin.status, 403);
	const badToken = await request(port, {
		method: "POST",
		path: "/login/new",
		headers: { host, cookie, origin: `http://${host}`, "content-type": "application/x-www-form-urlencoded" },
		body: "csrf=00&name=deepseek",
	});
	assert.equal(badToken.status, 403);
	const evilHost = await request(port, { headers: { host: "evil.example" } });
	assert.equal(evilHost.status, 403);
	const body = new URLSearchParams({ csrf: token, name: "deepseek", site: "platform.example", username: "user@example.com", password, totp: seed }).toString();
	const saved = await request(port, { method: "POST", path: "/login/new", headers: { host, cookie, origin: `http://${host}`, "content-type": "application/x-www-form-urlencoded" }, body });
	assert.equal(saved.status, 200);
	assert.equal(saved.body.includes(password), false);
	assert.equal(saved.body.includes(seed), false);
	assert.match(saved.body, /deepseek/);
	assert.match(saved.body, /2FA saved/);
	const keyBody = new URLSearchParams({ csrf: token, name: "deepseek-api", hosts: "api.example", header: "Authorization", prefix: "Bearer ", key }).toString();
	const keyed = await request(port, { method: "POST", path: "/key/new", headers: { host, cookie, origin: `http://${host}`, "content-type": "application/x-www-form-urlencoded" }, body: keyBody });
	assert.equal(keyed.body.includes(key), false);
	assert.match(keyed.body, /•••• 0001|key •••• 0001/);
	assert.equal(app.data().entries.find((entry) => entry.name === "deepseek").password, password);
});


test("explicit interfaces support LAN and tailnet without enabling wildcard binds", () => {
	const tail = ip4(100, 64, 1, 2);
	const lan = ip4(192, 168, 1, 8);
	assert.deepEqual(chooseBinds(undefined, [lan, tail]), [tail]);
	assert.deepEqual(chooseBinds(`${tail}, ${lan},${tail}`, []), [tail, lan]);
	assert.deepEqual(chooseBinds(undefined, [lan]), []);
	assert.throws(() => chooseBinds(`${tail},0.0.0.0`, []));
	assert.throws(() => chooseBinds(`${tail},`, []));
	const allow = parseAllow(`${ip4(100, 64, 0, 0)}/10,${ip4(192, 168, 1, 0)}/24`);
	const ownAddresses = new Set([tail, lan]);
	const check = (remoteAddress) => connectionAllowed({ remoteAddress, allow, ownAddresses });
	assert.equal(check(ip4(192, 168, 1, 9)), true);
	assert.equal(check(ip4(100, 64, 1, 9)), true);
	assert.equal(check(ip4(192, 168, 2, 9)), false);
	assert.equal(check(lan), false);
	assert.equal(check(tail), false);
});

test("provider forms save keys without echoing them and assign job roles with CSRF protection", async (t) => {
 const app = await portal(true); t.after(() => app.server.close());
 const port = app.port(); const host = `127.0.0.1:${port}`;
 const first = await request(port, { path: '/providers/new?preset=anthropic', headers: { host } });
 assert.match(first.body, /Anthropic Messages/);
 const token = /name="csrf" value="([a-f0-9]+)"/.exec(first.body)[1];
 const headers = {host,cookie:`vault_csrf=${token}`,origin:`http://${host}`,'content-type':'application/x-www-form-urlencoded'};
 const secret = 'fixture-provider-private-key';
 const body = new URLSearchParams({csrf:token,id:'fixture-cloud',name:'Fixture cloud',baseUrl:'https://api.example.com/v1',format:'anthropic',cap_chat:'yes',key:secret});
 const saved = await request(port,{method:'POST',path:'/providers/save',headers,body:body.toString()});
 assert.equal(saved.status,200);assert.match(saved.body,/Connection saved/);assert.ok(!saved.body.includes(secret));
 const edit = await request(port,{path:'/providers/edit?id=fixture-cloud',headers});assert.ok(!edit.body.includes(secret));assert.match(edit.body,/leave blank/);
 const assigned = await request(port,{method:'POST',path:'/models/save',headers,body:new URLSearchParams({csrf:token,main_provider:'fixture-cloud',main_model:'fixture-model'}).toString()});
 assert.match(assigned.body,/Settings saved/);assert.equal(app.data().roles.main.model,'fixture-model');
 const denied = await request(port,{method:'POST',path:'/models/save',headers:{...headers,origin:'http://evil.example'},body:new URLSearchParams({csrf:token}).toString()});
 assert.equal(denied.status,403);assert.equal(app.data().roles.main.model,'fixture-model');
});

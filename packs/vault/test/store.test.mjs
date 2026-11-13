import assert from "node:assert/strict";
import { chmodSync, lstatSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { assertVaultDir, deleteEntry, getEntry, isMountPoint, loadStore, prepareVaultDir, publicEntry, saveStore, storePath, upsertKey, upsertLogin } from "../lib/store.mjs";

function scratch() {
	const dir = mkdtempSync(join(tmpdir(), "nano-vault-"));
	prepareVaultDir(dir);
	return dir;
}

test("a login and an API key round-trip, and the file is mode 0600", () => {
	const dir = scratch();
	let data = loadStore(dir);
	data = upsertLogin(data, { name: "deepseek", site: "https://platform.example/login", username: "user@example.com", password: "fixture-password-9f3a", totp: "otpauth://totp/Example:user@example.com?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&digits=6" });
	data = upsertKey(data, { name: "deepseek-api", hosts: "*.api.example, files.example", header: "X-Api-Key", prefix: "", key: "vk-test-fixture-key-0001" });
	saveStore(dir, data);
	const path = storePath(dir);
	assert.equal(lstatSync(path).mode & 0o777, 0o600);
	assert.equal(lstatSync(dir).mode & 0o777, 0o700);
	assert.equal(loadStore(dir).entries.map((entry) => entry.name).join(","), "deepseek,deepseek-api");
	const login = getEntry(loadStore(dir), "deepseek");
	assert.equal(login.password, "fixture-password-9f3a");
	assert.equal(login.site, "platform.example");
	assert.equal(login.totp.secret, "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
	const pub = publicEntry(login);
	assert.equal(pub.password, undefined);
	assert.equal(pub.totp, true);
	assert.equal(publicEntry(getEntry(loadStore(dir), "deepseek-api")).keyLast4, "0001");
	assert.deepEqual(getEntry(loadStore(dir), "deepseek-api").hosts, ["*.api.example", "files.example"]);
	const kept = upsertLogin(loadStore(dir), { name: "deepseek", site: "platform.example", username: "other@example.com", password: "" });
	assert.equal(getEntry(kept, "deepseek").password, "fixture-password-9f3a");
	assert.equal(getEntry(kept, "deepseek").username, "other@example.com");
	assert.equal(getEntry(deleteEntry(kept, "deepseek-api"), "deepseek-api"), null);
	rmSync(dir, { recursive: true, force: true });
});

test("the directory must be mode 0700 and a symlinked store is refused", () => {
	const dir = scratch();
	chmodSync(dir, 0o755);
	assert.throws(() => assertVaultDir(dir), /0700/);
	chmodSync(dir, 0o700);
	const real = join(dir, "real.json");
	writeFileSync(real, "{}", { mode: 0o600 });
	symlinkSync(real, storePath(dir));
	assert.throws(() => loadStore(dir), /regular file/);
	rmSync(dir, { recursive: true, force: true });
});

test("a fresh subdirectory is not a mount point", () => {
	const dir = scratch();
	assert.equal(isMountPoint(dir), false);
	rmSync(dir, { recursive: true, force: true });
});

test("a saved file contains no half-written temp file", () => {
	const dir = scratch();
	saveStore(dir, upsertLogin(loadStore(dir), { name: "a", site: "example.com", username: "u", password: "long-enough-password" }));
	assert.equal(readFileSync(storePath(dir), "utf8").includes("long-enough-password"), true);
	assert.equal(lstatSync(dir).isDirectory(), true);
	rmSync(dir, { recursive: true, force: true });
});

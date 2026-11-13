import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { loadConfig } from "../src/config.ts";
import { applyProviderSettings, type ProviderSettings } from "../src/provider-settings.ts";
import { resolveModel } from "../src/models.ts";

test("owner settings replace main, local and background independently and restore environment defaults", async () => {
	const dir = mkdtempSync(join(tmpdir(), "nano-role-settings-"));
	try {
		const config = loadConfig({
			NANO_CHANNEL: "stdin",
			NANO_DATA_DIR: dir,
			NANO_MODEL: "deepseek/deepseek-flash",
			NANO_LOCAL_MODEL: "original-local",
			NANO_LOCAL_BASE_URL: "http://127.0.0.1:8090/v1",
		});
		const runtime = await ModelRuntime.create({ authPath: join(dir, "auth.json"), modelsPath: null, refreshOnCreate: false });
		const settings: ProviderSettings = {
			providers: [
				{ id: "hosted", capabilities: ["chat"], local: false },
				{ id: "local", capabilities: ["chat"], local: true },
			],
			roles: {
				main: { provider: "hosted", model: "main-fixture", contextWindow: 65536 },
				local: { provider: "local", model: "local-fixture", contextWindow: 32768 },
				background: { provider: "hosted", model: "task-fixture", contextWindow: 16384 },
			},
		};
		applyProviderSettings(config, runtime, settings);
		assert.equal(config.modelProvider, "nano-vault-main");
		assert.equal(config.modelId, "main-fixture");
		assert.equal(config.background?.modelId, "task-fixture");
		assert.equal(config.local?.vault, true);
		assert.equal(resolveModel(config, runtime, "local", true).model.id, "local-fixture");
		const original = runtime.getModel(config.modelProvider, config.modelId);
		applyProviderSettings(config, runtime, settings);
		assert.deepEqual(runtime.getModel(config.modelProvider, config.modelId), original);
		settings.roles.main!.model = "changed-fixture";
		applyProviderSettings(config, runtime, settings);
		assert.equal(config.modelId, "changed-fixture");
		applyProviderSettings(config, runtime, { providers: [], roles: {} });
		assert.equal(config.modelProvider, "deepseek");
		assert.equal(config.modelId, "deepseek-flash");
		assert.equal(config.local?.modelId, "original-local");
		assert.equal(config.background, undefined);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

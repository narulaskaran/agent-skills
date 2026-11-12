import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fauxAssistantMessage, fauxText } from "@earendil-works/pi-ai";
import { scriptedConversation } from "./helpers/scripted-session.ts";

function seed(lastActivity: number): string {
	const dataDir = mkdtempSync(join(tmpdir(), "nano-test-"));
	mkdirSync(join(dataDir, "log"), { recursive: true });
	const recent = [
		{ role: "owner", text: "what was the hotel called", at: lastActivity - 60_000 },
		{ role: "nano", text: "The Ludlow.", at: lastActivity },
	];
	writeFileSync(join(dataDir, "state.json"), JSON.stringify({ spaces: { stdin: { lastActivity, recent } } }));
	return dataDir;
}

test("an owner message after the idle gap starts a fresh context window carrying the earlier turns", async () => {
	const nano = await scriptedConversation({ packs: "core", dataDir: seed(Date.now() - 5 * 3_600_000) });
	nano.script([
		(context) => {
			const prompt = JSON.stringify(context.messages.at(-1));
			assert.match(prompt, /New context window after a gap/);
			assert.match(prompt, /The Ludlow/);
			// The message that ended the gap is the prompt, not part of the carried-over history.
			assert.equal(prompt.split("good morning").length - 1, 1);
			return fauxAssistantMessage(fauxText("Morning."));
		},
	]);
	nano.say("good morning");
	assert.equal(await nano.next(), "Morning.");
	await nano.conversation.dispose();
});

test("a running conversation rolls over once the owner has been quiet for the idle gap", async () => {
	const nano = await scriptedConversation({ packs: "core" });
	nano.script([() => fauxAssistantMessage(fauxText("Booked for Friday."))]);
	nano.say("book the table");
	assert.equal(await nano.next(), "Booked for Friday.");

	nano.script([
		(context) => {
			const prompt = JSON.stringify(context.messages.at(-1));
			assert.doesNotMatch(prompt, /New context window/);
			return fauxAssistantMessage(fauxText("Sure."));
		},
	]);
	nano.say("and the address?");
	assert.equal(await nano.next(), "Sure.");

	// Five quiet hours pass.
	(nano.conversation as unknown as { state: { lastActivity: number } }).state.lastActivity -= 5 * 3_600_000;
	nano.script([
		(context) => {
			const history = context.messages.filter((m) => (m as { role: string }).role !== "system");
			assert.equal(history.length, 1, "a fresh session holds only the new prompt");
			const prompt = JSON.stringify(history[0]);
			assert.match(prompt, /New context window after a gap/);
			assert.match(prompt, /Booked for Friday/);
			return fauxAssistantMessage(fauxText("Morning."));
		},
	]);
	nano.say("good morning");
	assert.equal(await nano.next(), "Morning.");
	await nano.conversation.dispose();
});

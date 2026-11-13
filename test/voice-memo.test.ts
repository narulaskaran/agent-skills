import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import * as core from "@spectrum-ts/core";
import { audioMimeType, createStdinChannel, sendFileContent } from "../src/channel.ts";
import { scriptedConversation } from "./helpers/scripted-session.ts";
import { fauxAssistantMessage, fauxText, fauxToolCall } from "@earendil-works/pi-ai";

const dir = mkdtempSync(join(tmpdir(), "nano-voice-"));
function file(name: string): string {
	const path = join(dir, name);
	writeFileSync(path, "not really media");
	return path;
}

/** Runs `fn` with console.error muted: the fallback path logs why the voice send failed. */
async function quiet<T>(fn: () => Promise<T>): Promise<T> {
	const original = console.error;
	console.error = () => {};
	try {
		return await fn();
	} finally {
		console.error = original;
	}
}

/** A space that records what was sent, as the content the Photon adapter would receive. */
function recordingSpace(failVoice?: Error) {
	const sent: { type: string; name?: string; mimeType?: string }[] = [];
	return {
		sent,
		async send(builder: { build(): Promise<{ type: string; name?: string; mimeType?: string }> }) {
			const content = await builder.build();
			if (content.type === "voice" && failVoice) throw failVoice;
			sent.push({ type: content.type, name: content.name, mimeType: content.mimeType });
		},
	};
}

test("audio extensions map to audio mime types, other files do not", () => {
	assert.equal(audioMimeType("/w/tts/speech-1.m4a"), "audio/mp4");
	assert.equal(audioMimeType("/w/reply.M4A"), "audio/mp4");
	assert.equal(audioMimeType("a.aac"), "audio/aac");
	assert.equal(audioMimeType("a.mp3"), "audio/mpeg");
	assert.equal(audioMimeType("a.wav"), "audio/wav");
	assert.equal(audioMimeType("a.aiff"), "audio/aiff");
	assert.equal(audioMimeType("a.aif"), "audio/aiff");
	assert.equal(audioMimeType("a.flac"), "audio/flac");
	assert.equal(audioMimeType("a.caf"), "audio/x-caf");
	for (const name of ["photo.png", "doc.pdf", "notes.txt", "m4a", "archive.m4a.zip", "video.mp4"]) {
		assert.equal(audioMimeType(name), undefined, name);
	}
});

test("an audio file is sent as voice content (a voice memo), not an attachment", async () => {
	const space = recordingSpace();
	assert.equal(await sendFileContent(space, core, file("speech.m4a")), "voice");
	assert.deepEqual(space.sent, [{ type: "voice", name: "speech.m4a", mimeType: "audio/mp4" }]);
});

test("a caf file keeps its caf mime type as voice content", async () => {
	const space = recordingSpace();
	await sendFileContent(space, core, file("note.caf"));
	assert.deepEqual(space.sent, [{ type: "voice", name: "note.caf", mimeType: "audio/x-caf" }]);
});

test("a png and a pdf are still plain attachments", async () => {
	const space = recordingSpace();
	assert.equal(await sendFileContent(space, core, file("chart.png")), "attachment");
	assert.equal(await sendFileContent(space, core, file("bill.pdf")), "attachment");
	assert.deepEqual(
		space.sent.map((s) => [s.type, s.name]),
		[
			["attachment", "chart.png"],
			["attachment", "bill.pdf"],
		],
	);
});

test("as_voice false sends audio as a plain attachment", async () => {
	const space = recordingSpace();
	assert.equal(await sendFileContent(space, core, file("song.mp3"), false), "attachment");
	assert.equal(space.sent[0]?.type, "attachment");
});

test("as_voice true on a non-audio file is an error and sends nothing", async () => {
	const space = recordingSpace();
	await assert.rejects(sendFileContent(space, core, file("chart.png"), true), /as_voice needs an audio file/);
	assert.deepEqual(space.sent, []);
});

test("a failed automatic voice send (no ffmpeg for a wav) falls back to the attachment", async () => {
	const space = recordingSpace(new Error("voice content: input is not m4a/aac and ffmpeg is unavailable"));
	assert.equal(await quiet(() => sendFileContent(space, core, file("speech.wav"))), "attachment");
	assert.deepEqual(space.sent, [{ type: "attachment", name: "speech.wav", mimeType: "audio/wav" }]);
});

test("a failed explicit as_voice send reports the error instead of falling back", async () => {
	const space = recordingSpace(new Error("ffmpeg is unavailable"));
	await assert.rejects(sendFileContent(space, core, file("speech.wav"), true), /ffmpeg is unavailable/);
	assert.deepEqual(space.sent, []);
});

test("a missing audio file still fails: the fallback cannot send it either", async () => {
	const space = recordingSpace();
	await quiet(() => assert.rejects(sendFileContent(space, core, join(dir, "gone.m4a")), /ENOENT/));
	assert.deepEqual(space.sent, []);
});

test("send_file passes as_voice to the channel and leaves it unset by default", async () => {
	const nano = await scriptedConversation({ packs: "core" });
	const calls: { path: string; options: unknown }[] = [];
	nano.channel.sendFile = async (_space, path, _caption, options) => void calls.push({ path, options });
	const audio = file("reply.m4a");
	const sendFile = (args: { path: string; as_voice?: boolean }) => () =>
		fauxAssistantMessage(fauxToolCall("send_file", args), { stopReason: "toolUse" });
	nano.script([
		sendFile({ path: audio }),
		sendFile({ path: audio, as_voice: false }),
		sendFile({ path: audio, as_voice: true }),
		() => fauxAssistantMessage(fauxText("done")),
	]);
	nano.say("speak");
	assert.equal(await nano.next(), "done");
	assert.deepEqual(
		calls.map((c) => c.options),
		[{ asVoice: undefined }, { asVoice: false }, { asVoice: true }],
	);
	await nano.conversation.dispose();
});

test("the stdin test channel says when a file would be a voice memo", async () => {
	const channel = createStdinChannel();
	const lines: string[] = [];
	const write = process.stdout.write;
	process.stdout.write = ((chunk: string) => (lines.push(String(chunk)), true)) as typeof process.stdout.write;
	try {
		await channel.sendFile("stdin", "/w/a.m4a");
		await channel.sendFile("stdin", "/w/a.png");
		await channel.sendFile("stdin", "/w/a.m4a", undefined, { asVoice: false });
	} finally {
		process.stdout.write = write;
	}
	assert.match(lines[0] ?? "", /\[voice memo \/w\/a\.m4a\]/);
	assert.match(lines[1] ?? "", /\[file \/w\/a\.png\]/);
	assert.match(lines[2] ?? "", /\[file \/w\/a\.m4a\]/);
});

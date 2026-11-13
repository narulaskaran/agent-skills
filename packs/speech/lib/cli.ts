import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync, readdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { providerFetch } from "../../../src/provider-client.ts";

function ffmpeg(): string {
	if (process.env.NANO_FFMPEG) return process.env.NANO_FFMPEG;
	// Compatibility with existing owner-installed speech scripts.
	const asr = join(process.env.NANO_DATA_DIR || "/data", "workspace", "asr");
	if (existsSync(asr)) {
		const dir = readdirSync(asr).find((name) => name.startsWith("ffmpeg-") && existsSync(join(asr, name, "ffmpeg")));
		if (dir) return join(asr, dir, "ffmpeg");
	}
	return "ffmpeg";
}
async function main(): Promise<void> {
	const [command, input, output] = process.argv.slice(2);
	if (!input || !["stt", "tts"].includes(command || ""))
		throw new Error('usage: nano-speech stt <audio-file> | nano-speech tts "text" [output.m4a]');
	const scratch = mkdtempSync(join(tmpdir(), "nano-speech-"));
	try {
		let payload: object;
		if (command === "stt") {
			const wav = join(scratch, "audio.wav");
			execFileSync(ffmpeg(), ["-y", "-loglevel", "error", "-i", resolve(input), "-ar", "16000", "-ac", "1", wav], { stdio: "pipe" });
			const audio = readFileSync(wav);
			if (audio.length > 24 * 1024 * 1024) throw new Error("Audio is too large (24 MB WAV limit)");
			payload = { audio: audio.toString("base64") };
		} else payload = { text: input === "-" ? readFileSync(0, "utf8") : input };
		const response = await providerFetch(`/providers/run/${command}`, JSON.stringify(payload));
		if (!response.ok) {
			const data = (await response.json()) as { error?: { message?: string } };
			throw new Error(data.error?.message || "Speech request failed");
		}
		if (command === "stt") {
			const result = (await response.json()) as { text?: string };
			if (typeof result.text !== "string") throw new Error("STT returned no transcript");
			process.stdout.write(result.text.trim() + "\n");
		} else {
			const path = resolve(output || join(process.env.NANO_DATA_DIR || "/data", "workspace", "tts", `speech-${Date.now()}.m4a`));
			mkdirSync(dirname(path), { recursive: true });
			const wav = join(scratch, "speech.audio");
			const bytes = Buffer.from(await response.arrayBuffer());
			writeFileSync(wav, bytes);
			if (path.endsWith(".wav")) execFileSync(ffmpeg(), ["-y", "-loglevel", "error", "-i", wav, path], { stdio: "pipe" });
			else execFileSync(ffmpeg(), ["-y", "-loglevel", "error", "-i", wav, "-c:a", "aac", "-b:a", "64k", path], { stdio: "pipe" });
			process.stdout.write(path + "\n");
		}
	} finally {
		rmSync(scratch, { recursive: true, force: true });
	}
}
main().catch((error: Error) => {
	console.error(`nano-speech: ${error.message}`);
	process.exitCode = 1;
});

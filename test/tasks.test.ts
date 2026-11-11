import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { TurnQueue } from "../src/agent.ts";
import { handBackPrompt, type Task, TaskManager, type TaskResult, type TaskRunner, type TaskSpec } from "../src/tasks.ts";

const spec = (title: string, extra: Partial<TaskSpec> = {}): TaskSpec => ({
	title,
	instructions: `do ${title}`,
	role: "main",
	private: false,
	spaceId: "space",
	source: "delegate",
	...extra,
});

const tick = () => new Promise((r) => setTimeout(r, 0));

/** A runner whose tasks finish when the test says so. */
function fakeRunner() {
	const pending = new Map<string, { resolve: (r: TaskResult) => void; reject: (e: Error) => void; signal: AbortSignal }>();
	const started: string[] = [];
	const runner: TaskRunner = (task, signal) =>
		new Promise((resolve, reject) => {
			started.push(task.title);
			pending.set(task.title, { resolve, reject, signal });
		});
	const finish = async (title: string, text = `${title} result`) => {
		pending.get(title)?.resolve({ text, files: [] });
		await tick();
	};
	const fail = async (title: string, message: string) => {
		pending.get(title)?.reject(new Error(message));
		await tick();
	};
	return { runner, started, pending, finish, fail };
}

function setup(options: { maxConcurrent?: number; timeoutMs?: number; path?: string; runner?: TaskRunner } = {}) {
	const fake = fakeRunner();
	const handed: { spaceId: string; prompt: string }[] = [];
	const path = options.path ?? join(mkdtempSync(join(tmpdir(), "nano-tasks-")), "tasks.json");
	const manager = new TaskManager({
		path,
		maxConcurrent: options.maxConcurrent ?? 2,
		timeoutMs: options.timeoutMs ?? 60_000,
		runner: options.runner ?? fake.runner,
		handBack: async (spaceId, prompt) => void handed.push({ spaceId, prompt }),
	});
	return { manager, handed, path, ...fake };
}

test("tasks beyond the cap wait in a queue and start as slots free up", async () => {
	const { manager, started, finish } = setup({ maxConcurrent: 2 });
	const a = manager.start(spec("a"));
	manager.start(spec("b"));
	const c = manager.start(spec("c"));
	await tick();
	assert.deepEqual(started, ["a", "b"]);
	assert.equal(manager.get(c.id)?.status, "queued");
	await finish("a");
	assert.equal(manager.get(a.id)?.status, "done");
	assert.deepEqual(started, ["a", "b", "c"]);
	assert.equal(manager.active().length, 2);
});

test("results are handed back in completion order, with the answer and not the transcript", async () => {
	const { manager, handed, finish } = setup({ maxConcurrent: 3 });
	manager.start(spec("first"));
	manager.start(spec("second"));
	manager.start(spec("third"));
	await tick();
	await finish("second");
	await finish("third");
	await finish("first");
	assert.deepEqual(
		handed.map((h) => /"(\w+)" finished/.exec(h.prompt)?.[1]),
		["second", "third", "first"],
	);
	assert.match(handed[0]?.prompt ?? "", /Result:\nsecond result/);
});

test("a task that runs too long is stopped and reported as a failure", async () => {
	const { manager, handed, pending } = setup({ timeoutMs: 20 });
	const task = manager.start(spec("slow"));
	await new Promise((r) => setTimeout(r, 60));
	assert.equal(manager.get(task.id)?.status, "failed");
	assert.match(manager.get(task.id)?.error ?? "", /timed out/);
	assert.equal(pending.get("slow")?.signal.aborted, true);
	assert.equal(handed.length, 1);
	assert.match(handed[0]?.prompt ?? "", /failed: timed out/);
});

test("a runner error becomes a failure result", async () => {
	const { manager, handed, fail } = setup();
	const task = manager.start(spec("broken"));
	await tick();
	await fail("broken", "no local model configured");
	assert.equal(manager.get(task.id)?.status, "failed");
	assert.match(handed[0]?.prompt ?? "", /failed: no local model configured/);
});

test("cancelling stops running and queued tasks without a hand-back, and frees the slot", async () => {
	const { manager, handed, started, pending } = setup({ maxConcurrent: 1 });
	const running = manager.start(spec("running"));
	const queued = manager.start(spec("queued"));
	const third = manager.start(spec("third"));
	await tick();
	manager.cancel(queued.id);
	assert.equal(manager.get(queued.id)?.status, "cancelled");
	manager.cancel(running.id);
	await tick();
	assert.equal(pending.get("running")?.signal.aborted, true);
	assert.equal(manager.get(running.id)?.status, "cancelled");
	assert.deepEqual(started, ["running", "third"]);
	assert.equal(manager.get(third.id)?.status, "running");
	assert.equal(handed.length, 0);
	assert.equal(manager.cancel("nope"), undefined);
});

test("tasks lost in a restart are reported once", async () => {
	const first = setup({ maxConcurrent: 1 });
	first.manager.start(spec("was running"));
	first.manager.start(spec("was queued", { source: "schedule" }));
	await tick();
	first.manager.stop(); // shutdown leaves them marked as running
	await tick();
	assert.equal(JSON.parse(readFileSync(first.path, "utf8")).tasks[0].status, "running");

	const second = setup({ path: first.path });
	assert.deepEqual(
		second.manager.list().map((t) => t.status),
		["lost", "lost"],
	);
	await second.manager.reportLost();
	assert.equal(second.handed.length, 1);
	assert.match(second.handed[0]?.prompt ?? "", /interrupted by a restart[\s\S]*"was running"[\s\S]*"was queued" \(scheduled job\)/);
	await second.manager.reportLost();
	assert.equal(second.handed.length, 1);

	const third = setup({ path: first.path });
	await third.manager.reportLost();
	assert.equal(third.handed.length, 0);
});

test("a corrupt tasks file starts empty", () => {
	const dir = mkdtempSync(join(tmpdir(), "nano-tasks-"));
	writeFileSync(join(dir, "tasks.json"), "{not json");
	const { manager } = setup({ path: join(dir, "tasks.json") });
	assert.deepEqual(manager.list(), []);
});

test("a [silent] scheduled result reaches no one; a delegated one still does", () => {
	const base: Task = { ...spec("check", { source: "schedule" }), id: "ab12", status: "done", createdAt: 0, result: "[silent]" };
	assert.equal(handBackPrompt(base), undefined);
	assert.match(handBackPrompt({ ...base, result: "Price dropped to $40" }) ?? "", /reply exactly \[silent\]/);
	assert.ok(handBackPrompt({ ...base, source: "delegate" }));
	assert.equal(handBackPrompt({ ...base, status: "cancelled" }), undefined);
});

test("long results are clipped before they reach the main conversation", () => {
	const task: Task = { ...spec("big"), id: "cd34", status: "done", createdAt: 0, result: "x".repeat(10_000) };
	const prompt = handBackPrompt(task) ?? "";
	assert.ok(prompt.length < 5000);
	assert.match(prompt, /cut at 4000/);
});

test("turns run one at a time and never mix owner text with system events", async () => {
	const turns: string[][] = [];
	let release: () => void = () => {};
	const queue = new TurnQueue<{ from: string; text: string }>(async (batch) => {
		turns.push(batch.map((b) => `${b.from}:${b.text}`));
		if (turns.length === 1) await new Promise<void>((r) => (release = r));
	});
	const done = [
		queue.push({ from: "owner", text: "hi" }),
		queue.push({ from: "system", text: "result 1" }),
		queue.push({ from: "system", text: "result 2" }),
		queue.push({ from: "owner", text: "next" }),
	];
	await tick();
	assert.equal(queue.busy, true);
	assert.deepEqual(turns, [["owner:hi"]]);
	release();
	await Promise.all(done);
	assert.deepEqual(turns, [["owner:hi"], ["system:result 1", "system:result 2"], ["owner:next"]]);
	assert.equal(queue.busy, false);
});

test("a failing turn does not block the queue", async () => {
	const seen: string[] = [];
	const queue = new TurnQueue<{ from: string; text: string }>(async (batch) => {
		seen.push(batch[0]?.text ?? "");
		if (batch[0]?.text === "boom") throw new Error("boom");
	});
	const original = console.error;
	console.error = () => {};
	try {
		await queue.push({ from: "system", text: "boom" });
		await queue.push({ from: "owner", text: "after" });
	} finally {
		console.error = original;
	}
	assert.deepEqual(seen, ["boom", "after"]);
});

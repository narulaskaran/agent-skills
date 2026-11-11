import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { Config } from "./config.ts";
import { chooseModel } from "./models.ts";
import { describeTask, type TaskManager } from "./tasks.ts";
import { assertPrivateAllowed, ModelParam, PrivateParam, text } from "./tools.ts";

/** Tools for the main conversation to hand work to background workers. Workers do not get these. */
export function taskTools(config: Config, tasks: TaskManager, spaceId: string): ExtensionFactory {
	return (pi) => {
		pi.registerTool({
			name: "delegate",
			label: "Delegate",
			description: [
				"Start a self-contained task in a separate background session and return at once, so you stay free to keep chatting.",
				"The worker has your tools and skills but none of this conversation: write `instructions` so they stand alone (goal, every detail the owner gave, constraints, what to return).",
				"It cannot text the owner. When it finishes or fails, its final answer arrives here as a message for you to pass on.",
			].join("\n"),
			parameters: Type.Object({
				title: Type.String({ description: "Short label, e.g. 'Compare flights to Lisbon'" }),
				instructions: Type.String({ description: "Complete standalone instructions for the worker" }),
				model: ModelParam,
				private: PrivateParam,
			}),
			async execute(_id, params) {
				assertPrivateAllowed(config, params.private);
				const choice = chooseModel(params.model ?? "main", Boolean(params.private), Boolean(config.local));
				const task = tasks.start({
					title: params.title,
					instructions: params.instructions,
					role: params.model ?? "main",
					private: Boolean(params.private),
					spaceId,
					source: "delegate",
				});
				const waiting = task.status === "queued" ? ` It is queued behind ${config.maxTasks} running task(s).` : "";
				const note = "note" in choice && choice.note ? ` ${choice.note}` : "";
				return text(
					`Started background task ${task.id}.${waiting}${note} The result will arrive here as a message. ` +
						"If you have not yet told the owner you are on it, do so in one short line; otherwise write nothing more now. Do not mention the task id.",
				);
			},
		});

		pi.registerTool({
			name: "tasks_list",
			label: "List tasks",
			description: "List background tasks: running and queued ones, then recent finished ones (id | status | title | model | minutes | outcome).",
			parameters: Type.Object({}),
			async execute() {
				const all = tasks.list();
				if (all.length === 0) return text("No background tasks.");
				const active = all.filter((t) => t.status === "queued" || t.status === "running");
				const recent = all.filter((t) => !active.includes(t)).slice(-5);
				return text([...active, ...recent].map((t) => describeTask(t)).join("\n"));
			},
		});

		pi.registerTool({
			name: "task_check",
			label: "Check task",
			description: "Status of one background task, with its result if it has finished.",
			parameters: Type.Object({ id: Type.String() }),
			async execute(_id, params) {
				const task = tasks.get(params.id);
				if (!task) throw new Error(`No task with id ${params.id}.`);
				const detail = task.status === "done" ? `\n${(task.result ?? "").slice(0, 2000)}` : "";
				return text(`${describeTask(task)}${task.sessionFile ? `\nsession: ${task.sessionFile}` : ""}${detail}`);
			},
		});

		pi.registerTool({
			name: "task_cancel",
			label: "Cancel task",
			description: "Stop a queued or running background task. Its result will not arrive.",
			parameters: Type.Object({ id: Type.String() }),
			async execute(_id, params) {
				const task = tasks.cancel(params.id);
				if (!task) throw new Error(`No task with id ${params.id}.`);
				return text(task.status === "cancelled" || task.status === "running" ? `Cancelled ${task.id} (${task.title}).` : `Task ${task.id} had already ${task.status}.`);
			},
		});
	};
}

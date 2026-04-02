/**
 * Todo Write Tool - Manage structured task lists for planning sessions
 *
 * Tracks task status: pending, in_progress, completed, cancelled
 * Session persistence via pi.appendEntry()
 */

import type { AgentToolResult } from "@mariozechner/pi-agent-core";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";

// Types
export type TodoStatus = "pending" | "in_progress" | "completed" | "cancelled";

export interface TodoTask {
	id: string;
	description: string;
	file?: string;
	status: TodoStatus;
	updatedAt?: number;
}

export interface TodoDetails {
	tasks: TodoTask[];
	pending: number;
	completed: number;
	in_progress: number;
	total: number;
	error?: string;
}

// Schema
const TaskSchema = Type.Object({
	id: Type.String(),
	description: Type.String(),
	file: Type.Optional(Type.String()),
	status: Type.Union([
		Type.Literal("pending"),
		Type.Literal("in_progress"),
		Type.Literal("completed"),
		Type.Literal("cancelled"),
	]),
});

const TodoParams = Type.Object({
	action: Type.Union([Type.Literal("init"), Type.Literal("update"), Type.Literal("get"), Type.Literal("clear")]),

	tasks: Type.Optional(Type.Array(TaskSchema)),

	id: Type.Optional(Type.String()),
	status: Type.Optional(Type.String({ description: "Status: pending, in_progress, completed, cancelled" })),
	description: Type.Optional(Type.String()),
});

export type TodoParams = typeof TodoParams.static;

// In-memory store (keyed by plan name for multi-plan support)
const todoStores = new Map<string, Map<string, TodoTask>>();

// Tool Registration
export function registerTodoWriteTool(pi: ExtensionAPI): void {
	// Restore todos from session on startup
	pi.on("session_start", async (_event, ctx) => {
		const entries = ctx.sessionManager.getEntries();
		for (const entry of entries) {
			if (entry.type === "custom" && entry.customType === "todo_write") {
				const data = entry.data as { tasks: TodoTask[]; planName?: string } | undefined;
				if (data?.tasks) {
					const planName = data.planName || "default";
					const store = new Map<string, TodoTask>();
					for (const task of data.tasks) {
						store.set(task.id, task);
					}
					todoStores.set(planName, store);
				}
			}
		}
	});

	pi.registerTool({
		name: "todo_write",
		label: "Todo Write",
		description:
			"Manage structured task lists for planning sessions. Tracks status: pending, in_progress, completed, cancelled. Use init to start a task list, update to change status, get to see current state.",
		parameters: TodoParams,

		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			// Get or create default store
			const store = todoStores.get("default") || new Map();
			if (!todoStores.has("default")) {
				todoStores.set("default", store);
			}

			switch (params.action) {
				case "init":
					return handleInit(params, store, pi);
				case "update":
					return handleUpdate(params, store, pi);
				case "get":
					return handleGet(store);
				case "clear":
					return handleClear(store, pi);
			}
		},

		renderCall(args, _theme, _context) {
			let text = `todo_write ${args.action}`;
			if (args.id) {
				text += `: ${args.id}`;
				if (args.status) {
					text += ` -> ${args.status}`;
				}
			} else if (args.tasks) {
				text += `: ${args.tasks.length} tasks`;
			}
			return new Text(text, 0, 0);
		},

		renderResult(result, _options, _theme, _context) {
			const details = result.details as TodoDetails;
			const text = result.content[0];

			if (details.error) {
				return new Text(`ERROR: ${details.error}`, 0, 0);
			}

			if (!details || !details.tasks) {
				return new Text(text?.type === "text" ? text.text : "", 0, 0);
			}

			const lines: string[] = [];
			const statusIcons: Record<TodoStatus, string> = {
				pending: "[ ]",
				in_progress: "[~]",
				completed: "[x]",
				cancelled: "[-]",
			};

			lines.push("");
			for (const task of details.tasks) {
				const icon = statusIcons[task.status];
				const desc = task.status === "cancelled" ? `~~${task.description}~~` : task.description;
				const filePart = task.file ? ` (${task.file})` : "";
				lines.push(`${icon} ${task.id}: ${desc}${filePart}`);
			}

			lines.push("");
			lines.push(`Progress: ${details.completed}/${details.total} completed`);
			if (details.in_progress > 0) {
				lines.push(`${details.in_progress} in progress`);
			}

			return new Text(lines.join("\n"), 0, 0);
		},
	});
}

// Helper
function errorResult(error: string): AgentToolResult<TodoDetails> {
	return {
		content: [{ type: "text", text: error }],
		details: { tasks: [], pending: 0, completed: 0, in_progress: 0, total: 0, error },
	};
}

// Actions
function handleInit(
	params: { tasks?: TodoTask[] },
	store: Map<string, TodoTask>,
	pi: ExtensionAPI,
): AgentToolResult<TodoDetails> {
	if (!params.tasks || !Array.isArray(params.tasks)) {
		return errorResult("Error: tasks array required for init");
	}

	// Clear existing and add new
	store.clear();
	for (const task of params.tasks) {
		store.set(task.id, {
			...task,
			status: (task.status as TodoStatus) || "pending",
			updatedAt: Date.now(),
		});
	}

	// Persist
	persistTodos(store, pi);

	const details = buildDetails(store);
	return {
		content: [{ type: "text", text: `Initialized ${details.total} tasks` }],
		details,
	};
}

function handleUpdate(
	params: { id?: string; status?: string; description?: string },
	store: Map<string, TodoTask>,
	pi: ExtensionAPI,
): AgentToolResult<TodoDetails> {
	if (!params.id) {
		return errorResult("Error: task id required");
	}

	const task = store.get(params.id);
	if (!task) {
		return errorResult(`Task not found: ${params.id}`);
	}

	if (params.status) {
		task.status = params.status as TodoStatus;
	}
	if (params.description) {
		task.description = params.description;
	}
	task.updatedAt = Date.now();

	store.set(params.id, task);
	persistTodos(store, pi);

	const details = buildDetails(store);
	return {
		content: [{ type: "text", text: formatTodoList(store) }],
		details,
	};
}

function handleGet(store: Map<string, TodoTask>): AgentToolResult<TodoDetails> {
	const details = buildDetails(store);
	if (details.total === 0) {
		return {
			content: [{ type: "text", text: "No tasks" }],
			details,
		};
	}
	return {
		content: [{ type: "text", text: formatTodoList(store) }],
		details,
	};
}

function handleClear(store: Map<string, TodoTask>, pi: ExtensionAPI): AgentToolResult<TodoDetails> {
	store.clear();
	persistTodos(store, pi);
	return {
		content: [{ type: "text", text: "Todo list cleared" }],
		details: { tasks: [], pending: 0, completed: 0, in_progress: 0, total: 0 },
	};
}

// Helpers
function buildDetails(store: Map<string, TodoTask>): TodoDetails {
	const tasks = Array.from(store.values());
	return {
		tasks,
		pending: tasks.filter((t) => t.status === "pending").length,
		completed: tasks.filter((t) => t.status === "completed").length,
		in_progress: tasks.filter((t) => t.status === "in_progress").length,
		total: tasks.length,
	};
}

function formatTodoList(store: Map<string, TodoTask>): string {
	const tasks = Array.from(store.values());

	if (tasks.length === 0) {
		return "No tasks";
	}

	const lines: string[] = [];

	const statusIcons: Record<TodoStatus, string> = {
		pending: "[ ]",
		in_progress: "[~]",
		completed: "[x]",
		cancelled: "[-]",
	};

	const statusOrder: TodoStatus[] = ["in_progress", "pending", "completed", "cancelled"];
	for (const status of statusOrder) {
		const statusTasks = tasks.filter((t) => t.status === status);
		for (const task of statusTasks) {
			const icon = statusIcons[task.status];
			const file = task.file ? ` (${task.file})` : "";
			const desc = status === "cancelled" ? `~~${task.description}~~` : task.description;
			lines.push(`${icon} ${task.id}: ${desc}${file}`);
		}
	}

	const details = buildDetails(store);
	lines.push("");
	lines.push(`Progress: ${details.completed}/${details.total} completed`);

	return lines.join("\n");
}

function persistTodos(store: Map<string, TodoTask>, pi: ExtensionAPI): void {
	const tasks = Array.from(store.values());
	pi.appendEntry("todo_write", { tasks });
}

// Default export for easy import
export default registerTodoWriteTool;

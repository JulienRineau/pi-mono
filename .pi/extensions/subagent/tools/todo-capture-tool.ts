/**
 * Todo Capture Tool - Capture unrelated observations during nightshift
 *
 * Appends to TODOS.md in the project root.
 * Categories: bug, tech-debt, performance, security, idea
 */

import { existsSync } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { AgentToolResult } from "@mariozechner/pi-agent-core";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";

// Types
export interface TodoCaptureDetails {
	path: string;
	count: number;
	error?: string;
}

// Schema
const TodoCaptureParams = Type.Object({
	action: Type.Union([Type.Literal("append"), Type.Literal("list"), Type.Literal("resolve")]),

	// For append
	category: Type.Optional(
		Type.String({ description: "Category: bug, tech-debt, performance, security, idea" }),
	),
	file: Type.Optional(Type.String({ description: "File path related to the observation" })),
	description: Type.Optional(Type.String({ description: "Description of the observation" })),
	source: Type.Optional(Type.String({ description: "Which spec or task discovered this" })),

	// For resolve
	todo_id: Type.Optional(Type.Integer({ description: "1-based index of the unresolved item to resolve" })),
});

export type TodoCaptureParams = typeof TodoCaptureParams.static;

// Constants
const TODOS_TEMPLATE = `# TODOs

## Unresolved

## Resolved
`;

// Tool Registration
export function registerTodoCaptureTool(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "todo-capture",
		label: "Todo Capture",
		description:
			"Capture unrelated observations during nightshift sessions. Appends to TODOS.md with category, file, description, and source tracking.",
		parameters: TodoCaptureParams,

		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			switch (params.action) {
				case "append":
					return await appendTodo(params, _ctx);
				case "list":
					return await listTodos(params, _ctx);
				case "resolve":
					return await resolveTodo(params, _ctx);
			}
		},

		renderCall(args, _theme, _context) {
			let text = "";
			switch (args.action) {
				case "append":
					text = `todo-capture append: ${args.category || "unknown"} — ${args.description || "..."}`;
					if (text.length > 80) text = `${text.slice(0, 80)}...`;
					break;
				case "list":
					text = "todo-capture list";
					break;
				case "resolve":
					text = `todo-capture resolve: #${args.todo_id || "?"}`;
					break;
			}
			return new Text(text, 0, 0);
		},

		renderResult(result, _options, theme, _context) {
			const details = result.details as TodoCaptureDetails;
			const text = result.content[0];

			if (details.error) {
				return new Text(`${theme.fg("error", "✗")} ${details.error}`, 0, 0);
			}

			if (!details || details.path === undefined) {
				return new Text(text?.type === "text" ? text.text : "", 0, 0);
			}

			const lines: string[] = [];
			lines.push(
				`${theme.fg("success", "✓")} ${theme.fg("accent", `${details.count} unresolved`)}`,
			);

			if (text?.type === "text") {
				lines.push("");
				lines.push(theme.fg("muted", text.text));
			}

			return new Text(lines.join("\n"), 0, 0);
		},
	});
}

// Helper Functions
function errorResult(error: string): AgentToolResult<TodoCaptureDetails> {
	return {
		content: [{ type: "text", text: error }],
		details: { path: "", count: 0, error },
	};
}

function getTodosPath(ctx: ExtensionContext): string {
	return path.join(ctx.cwd, "TODOS.md");
}

async function ensureTodosFile(todosPath: string): Promise<string> {
	if (!existsSync(todosPath)) {
		await fs.writeFile(todosPath, TODOS_TEMPLATE, "utf-8");
		return TODOS_TEMPLATE;
	}
	return await fs.readFile(todosPath, "utf-8");
}

function countUnresolved(content: string): number {
	const unresolvedSection = extractSection(content, "## Unresolved");
	if (!unresolvedSection) return 0;
	const matches = unresolvedSection.match(/^- \[ \] /gm);
	return matches ? matches.length : 0;
}

function extractSection(content: string, heading: string): string | null {
	const headingIndex = content.indexOf(heading);
	if (headingIndex === -1) return null;
	const afterHeading = content.slice(headingIndex + heading.length);
	const nextHeadingMatch = afterHeading.match(/\n## /);
	if (nextHeadingMatch && nextHeadingMatch.index !== undefined) {
		return afterHeading.slice(0, nextHeadingMatch.index);
	}
	return afterHeading;
}

// Actions
async function appendTodo(
	params: { category?: string; file?: string; description?: string; source?: string },
	ctx: ExtensionContext,
): Promise<AgentToolResult<TodoCaptureDetails>> {
	if (!params.description) {
		return errorResult("Error: description is required for append");
	}

	const category = params.category || "idea";
	const todosPath = getTodosPath(ctx);
	let content = await ensureTodosFile(todosPath);

	const date = new Date().toISOString().split("T")[0];
	const filePart = params.file ? ` \`${params.file}\`` : "";
	const sourcePart = params.source ? `from: ${params.source}, ` : "";
	const entry = `- [ ] **${category}**${filePart} — ${params.description} (${sourcePart}${date})`;

	// Insert entry at the end of the Unresolved section
	const unresolvedHeading = "## Unresolved";
	const unresolvedIndex = content.indexOf(unresolvedHeading);

	if (unresolvedIndex === -1) {
		return errorResult("Error: TODOS.md is missing ## Unresolved section");
	}

	const afterUnresolved = content.slice(unresolvedIndex + unresolvedHeading.length);
	const nextHeadingMatch = afterUnresolved.match(/\n## /);

	if (nextHeadingMatch && nextHeadingMatch.index !== undefined) {
		// Insert before the next heading
		const insertPos = unresolvedIndex + unresolvedHeading.length + nextHeadingMatch.index;
		content = `${content.slice(0, insertPos)}\n${entry}\n${content.slice(insertPos)}`;
	} else {
		// Append at end of file
		content = `${content.trimEnd()}\n${entry}\n`;
	}

	await fs.writeFile(todosPath, content, "utf-8");

	const unresolvedCount = countUnresolved(content);

	return {
		content: [{ type: "text", text: `Todo appended: ${category} — ${params.description}` }],
		details: { path: todosPath, count: unresolvedCount },
	};
}

async function listTodos(
	_params: any,
	ctx: ExtensionContext,
): Promise<AgentToolResult<TodoCaptureDetails>> {
	const todosPath = getTodosPath(ctx);

	if (!existsSync(todosPath)) {
		return {
			content: [{ type: "text", text: "No TODOS.md file exists yet." }],
			details: { path: todosPath, count: 0 },
		};
	}

	const content = await fs.readFile(todosPath, "utf-8");
	const unresolvedCount = countUnresolved(content);

	return {
		content: [{ type: "text", text: content }],
		details: { path: todosPath, count: unresolvedCount },
	};
}

async function resolveTodo(
	params: { todo_id?: number },
	ctx: ExtensionContext,
): Promise<AgentToolResult<TodoCaptureDetails>> {
	if (!params.todo_id || params.todo_id < 1) {
		return errorResult("Error: todo_id (1-based) is required for resolve");
	}

	const todosPath = getTodosPath(ctx);

	if (!existsSync(todosPath)) {
		return errorResult("Error: TODOS.md does not exist");
	}

	let content = await fs.readFile(todosPath, "utf-8");

	// Find all unresolved items in the Unresolved section
	const unresolvedHeading = "## Unresolved";
	const resolvedHeading = "## Resolved";
	const unresolvedIndex = content.indexOf(unresolvedHeading);
	const resolvedIndex = content.indexOf(resolvedHeading);

	if (unresolvedIndex === -1) {
		return errorResult("Error: TODOS.md is missing ## Unresolved section");
	}
	if (resolvedIndex === -1) {
		return errorResult("Error: TODOS.md is missing ## Resolved section");
	}

	// Split content into lines and find unresolved items
	const lines = content.split("\n");
	let unresolvedItemIndex = 0;
	let targetLineIndex = -1;
	let targetLine = "";

	// Find the Nth unresolved item within the Unresolved section
	let inUnresolvedSection = false;
	for (let i = 0; i < lines.length; i++) {
		if (lines[i].startsWith("## Unresolved")) {
			inUnresolvedSection = true;
			continue;
		}
		if (lines[i].startsWith("## ") && inUnresolvedSection) {
			break;
		}
		if (inUnresolvedSection && lines[i].match(/^- \[ \] /)) {
			unresolvedItemIndex++;
			if (unresolvedItemIndex === params.todo_id) {
				targetLineIndex = i;
				targetLine = lines[i];
				break;
			}
		}
	}

	if (targetLineIndex === -1) {
		return errorResult(
			`Error: todo_id ${params.todo_id} not found (${unresolvedItemIndex} unresolved items exist)`,
		);
	}

	// Remove from unresolved section
	lines.splice(targetLineIndex, 1);

	// Mark as resolved
	const resolvedLine = targetLine.replace("- [ ] ", "- [x] ");

	// Find the Resolved section and append
	let resolvedLineIndex = -1;
	for (let i = 0; i < lines.length; i++) {
		if (lines[i].startsWith("## Resolved")) {
			resolvedLineIndex = i;
			break;
		}
	}

	if (resolvedLineIndex === -1) {
		return errorResult("Error: TODOS.md is missing ## Resolved section");
	}

	// Insert after the Resolved heading (and any blank line following it)
	let insertAt = resolvedLineIndex + 1;
	while (insertAt < lines.length && lines[insertAt].trim() === "") {
		insertAt++;
	}
	lines.splice(insertAt, 0, resolvedLine);

	content = lines.join("\n");
	await fs.writeFile(todosPath, content, "utf-8");

	const unresolvedCount = countUnresolved(content);

	return {
		content: [{ type: "text", text: `Resolved: ${targetLine.replace("- [ ] ", "")}` }],
		details: { path: todosPath, count: unresolvedCount },
	};
}

// Default export for easy import
export default registerTodoCaptureTool;

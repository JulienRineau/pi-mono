/**
 * Trace Extension — Always-on agent observability
 *
 * Automatically captures all tool calls, turns, and agent lifecycle events
 * within any PI process. Each process traces itself via pi.on() hooks.
 * No env vars, no cross-process config.
 *
 * Parent-child linking: the subagent/nightshift tool emits "trace.child.linked"
 * events via pi.events (EventBus). This extension listens and records them.
 */

import type { AgentToolResult } from "@mariozechner/pi-agent-core";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import {
	addTags,
	buildTree,
	cleanupTraces,
	computeStats,
	listTraces,
	readTrace,
	repairTraces,
	setTitle,
} from "./analyzer.js";
import type { TraceState } from "./types.js";
import {
	appendEvent,
	finalizeTrace,
	getTracesDir,
	initTrace,
	summarizeToolArgs,
	summarizeToolResult,
} from "./writer.js";

export default function (pi: ExtensionAPI): void {
	let state: TraceState | null = null;

	// ── Event Hooks ──────────────────────────────────────────────

	pi.on("session_start", (_event, ctx) => {
		try {
			const sessionId = ctx.sessionManager.getSessionId();
			const model = ctx.model?.name ?? "unknown";
			state = initTrace(sessionId, ctx.cwd, model);
		} catch {
			// If tracing init fails, disable tracing silently
			state = null;
		}
	});

	pi.on("before_agent_start", (event: any) => {
		if (state && event.prompt) {
			state.taskPreview = String(event.prompt).slice(0, 80);
		}
	});

	pi.on("tool_execution_start", (event: any) => {
		if (!state) return;
		state.totalToolCalls++;
		state.toolTimers.set(event.toolCallId, {
			startTime: Date.now(),
			toolName: event.toolName,
			args: event.args,
		});
		appendEvent(state, "tool.start", {
			call_id: event.toolCallId,
			tool: event.toolName,
			args: summarizeToolArgs(event.toolName, event.args ?? {}),
		});
	});

	pi.on("tool_execution_end", (event: any) => {
		if (!state) return;
		const timer = state.toolTimers.get(event.toolCallId);
		const durationMs = timer ? Date.now() - timer.startTime : 0;
		state.toolTimers.delete(event.toolCallId);

		// Track files modified by write/edit tools
		if ((event.toolName === "write" || event.toolName === "edit") && !event.isError) {
			const fp = event.args?.file_path ?? timer?.args?.file_path;
			if (fp) state.filesModified.add(fp);
		}

		const summary = summarizeToolResult(event.toolName, event.result);
		appendEvent(state, "tool.end", {
			call_id: event.toolCallId,
			tool: event.toolName,
			duration_ms: durationMs,
			is_error: event.isError ?? false,
			...summary,
		});
	});

	pi.on("turn_start", () => {
		if (!state) return;
		state.totalTurns++;
		appendEvent(state, "turn.start", {});
	});

	pi.on("turn_end", (event: any) => {
		if (!state) return;
		const msg = event.message;
		const usage = msg?.usage;
		const inputTokens = usage?.input || 0;
		const outputTokens = usage?.output || 0;
		state.tokensIn += inputTokens;
		state.tokensOut += outputTokens;
		appendEvent(state, "turn.end", { input_tokens: inputTokens, output_tokens: outputTokens });
	});

	pi.on("agent_start", () => {
		if (!state) return;
		appendEvent(state, "agent.start", {});
	});

	pi.on("agent_end", () => {
		if (!state) return;
		appendEvent(state, "agent.end", {
			total_turns: state.totalTurns,
			total_tokens: state.tokensIn + state.tokensOut,
		});
	});

	pi.on("session_shutdown", () => {
		if (!state) return;
		try {
			finalizeTrace(state, "success", "interactive");
		} catch {
			// Best-effort finalization
		}
		state = null;
	});

	// ── EventBus: child.linked from subagent/nightshift ──────────

	pi.events.on("trace.child.linked", (data: unknown) => {
		if (!state) return;
		const { child_session, agent, context } = data as {
			child_session: string;
			agent: string;
			context: Record<string, unknown>;
		};
		appendEvent(state, "child.linked", { child_session, agent, context });
	});

	// ── Trace Tool Registration ─────────────────────────────────

	registerTraceTool(pi);
}

// ── Trace Tool ────────────────────────────────────────────────

function textResult(text: string): AgentToolResult<unknown> {
	return { content: [{ type: "text", text }], details: null };
}

function registerTraceTool(pi: ExtensionAPI): void {
	const TraceParams = Type.Object({
		action: Type.Union([
			Type.Literal("list"),
			Type.Literal("read"),
			Type.Literal("tree"),
			Type.Literal("stats"),
			Type.Literal("tag"),
			Type.Literal("title"),
			Type.Literal("cleanup"),
			Type.Literal("repair"),
		]),
		session_id: Type.Optional(Type.String({ description: "Session ID for read/tree/stats/tag/title" })),
		since: Type.Optional(Type.String({ description: "Time filter for list: '2h', '1d', or ISO date" })),
		agent: Type.Optional(Type.String({ description: "Agent name filter for list" })),
		outcome: Type.Optional(Type.String({ description: "Outcome filter for list: success, error, incomplete" })),
		tags: Type.Optional(Type.Array(Type.String(), { description: "Tags to add (tag action) or filter by (list)" })),
		parent: Type.Optional(Type.String({ description: "Parent session filter for list" })),
		project: Type.Optional(Type.String({ description: "Filter by project directory (cwd substring match)" })),
		title: Type.Optional(Type.String({ description: "New title for title action" })),
		keep: Type.Optional(Type.Integer({ description: "Number of sessions to keep for cleanup (default 50)" })),
	});

	pi.registerTool({
		name: "trace",
		label: "Trace",
		description:
			"Query and manage PI execution traces. " +
			"Actions: list (recent traces), read (full event stream), tree (parent→child hierarchy), " +
			"stats (tool call frequency/duration), tag (add tags), title (set title), " +
			"cleanup (retention), repair (fix incomplete traces).",
		parameters: TraceParams,

		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			const tracesDir = getTracesDir();

			switch (params.action) {
				case "list": {
					const entries = listTraces(tracesDir, {
						since: params.since,
						agent: params.agent,
						outcome: params.outcome,
						tags: params.tags,
						parent: params.parent,
						project: params.project,
					});

					if (entries.length === 0) {
						return textResult("No traces found.");
					}

					const lines = entries.map((e) => {
						const dur = e.duration_ms > 0 ? `${Math.round(e.duration_ms / 1000)}s` : "?";
						const tokens = `${formatTokens(e.tokens.in)}↑ ${formatTokens(e.tokens.out)}↓`;
						const tags = e.tags.length > 0 ? ` [${e.tags.join(", ")}]` : "";
						return `- ${e.session_id.slice(0, 8)} | ${e.title} | ${dur} | ${e.tool_calls} tools | ${tokens}${tags}`;
					});

					return textResult(`Traces (${entries.length}):\n\n${lines.join("\n")}`);
				}

				case "read": {
					if (!params.session_id) {
						return textResult("Error: session_id required for read");
					}
					const events = readTrace(tracesDir, params.session_id);
					if (events.length === 0) {
						return textResult(`No trace found for session ${params.session_id}`);
					}
					const text = events.map((e) => JSON.stringify(e)).join("\n");
					return textResult(text);
				}

				case "tree": {
					if (!params.session_id) {
						return textResult("Error: session_id required for tree");
					}
					const tree = buildTree(tracesDir, params.session_id);
					if (!tree) {
						return textResult(`No trace found for session ${params.session_id}`);
					}
					const text = renderTree(tree, 0);
					return textResult(text);
				}

				case "stats": {
					if (!params.session_id) {
						return textResult("Error: session_id required for stats");
					}
					const events = readTrace(tracesDir, params.session_id);
					if (events.length === 0) {
						return textResult(`No trace found for session ${params.session_id}`);
					}
					const stats = computeStats(events);
					const lines: string[] = [];
					lines.push(`Turns: ${stats.turns}`);
					lines.push(`Tokens: ${formatTokens(stats.tokens.in)} in, ${formatTokens(stats.tokens.out)} out`);
					lines.push(
						`Errors: ${stats.error_rate.errors}/${stats.error_rate.total} (${(stats.error_rate.rate * 100).toFixed(1)}%)`,
					);
					lines.push("");
					lines.push("Tool usage:");
					const sortedTools = Object.entries(stats.tool_frequency).sort((a, b) => b[1] - a[1]);
					for (const [tool, count] of sortedTools) {
						const dur = stats.tool_durations[tool];
						const avgMs = dur ? `avg ${dur.avg_ms}ms` : "";
						lines.push(`  ${tool}: ${count} calls ${avgMs}`);
					}
					return textResult(lines.join("\n"));
				}

				case "tag": {
					if (!params.session_id || !params.tags?.length) {
						return textResult("Error: session_id and tags required");
					}
					const ok = addTags(tracesDir, params.session_id, params.tags);
					return textResult(ok ? `Tags added to ${params.session_id}` : `Session not found: ${params.session_id}`);
				}

				case "title": {
					if (!params.session_id || !params.title) {
						return textResult("Error: session_id and title required");
					}
					const ok = setTitle(tracesDir, params.session_id, params.title);
					return textResult(
						ok ? `Title updated for ${params.session_id}` : `Session not found: ${params.session_id}`,
					);
				}

				case "cleanup": {
					const keepCount = params.keep ?? 50;
					const result = cleanupTraces(tracesDir, keepCount);
					return textResult(`Cleanup: removed ${result.removed} traces, kept ${keepCount}`);
				}

				case "repair": {
					const result = repairTraces(tracesDir);
					return textResult(`Repair: fixed ${result.repaired} incomplete traces`);
				}

				default:
					return textResult(`Unknown action: ${params.action}`);
			}
		},

		renderCall(args, _theme, _context) {
			let text = `trace ${args.action || "..."}`;
			if (args.session_id) text += ` ${String(args.session_id).slice(0, 8)}`;
			if (args.since) text += ` since:${args.since}`;
			if (args.agent) text += ` agent:${args.agent}`;
			return new Text(text, 0, 0);
		},

		renderResult(result, _options, theme, _context) {
			const text = result.content[0];
			if (!text || text.type !== "text") return new Text("", 0, 0);

			// Colorize based on content
			if (text.text.startsWith("Error:")) {
				return new Text(theme.fg("error", text.text), 0, 0);
			}
			return new Text(text.text, 0, 0);
		},
	});
}

// ── Formatting Helpers ────────────────────────────────────────

function formatTokens(count: number): string {
	if (count < 1000) return count.toString();
	if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
	if (count < 1000000) return `${Math.round(count / 1000)}k`;
	return `${(count / 1000000).toFixed(1)}M`;
}

function renderTree(node: import("./analyzer.js").TreeNode, depth: number): string {
	const indent = depth === 0 ? "" : `${"  ".repeat(depth - 1)}├── `;
	const dur = node.duration_ms > 0 ? `${Math.round(node.duration_ms / 1000)}s` : "?";
	const ctx = node.context ? ` (${Object.values(node.context).join("/")})` : "";
	let line = `${indent}${node.session_id.slice(0, 8)} — ${node.title || node.agent}${ctx} [${dur}, ${node.tool_calls} tools, ${node.outcome}]`;

	for (const child of node.children) {
		line += `\n${renderTree(child, depth + 1)}`;
	}

	return line;
}

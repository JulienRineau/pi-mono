/**
 * Trace Writer — Write-through JSONL trace file I/O
 *
 * All writes use appendFileSync for crash safety.
 * Every event hits disk the moment it happens — no buffering.
 */

import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import * as path from "node:path";
import type { IndexEntry, TraceEvent, TraceState } from "./types.js";

// ── Directory & Path Helpers ──────────────────────────────────

export function getTracesDir(): string {
	const envDir = process.env.PI_CODING_AGENT_DIR;
	let agentDir: string;
	if (envDir) {
		if (envDir === "~") agentDir = homedir();
		else if (envDir.startsWith("~/")) agentDir = homedir() + envDir.slice(1);
		else agentDir = envDir;
	} else {
		agentDir = path.join(homedir(), ".pi", "agent");
	}
	const dir = path.join(agentDir, "traces");
	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true });
	}
	return dir;
}

export function getTraceFilePath(tracesDir: string, sessionId: string): string {
	return path.join(tracesDir, `${sessionId}.trace.jsonl`);
}

export function getIndexFilePath(tracesDir: string): string {
	return path.join(tracesDir, "index.jsonl");
}

// ── Event Writing ─────────────────────────────────────────────

export function appendEvent(state: TraceState, type: string, data: Record<string, unknown>): void {
	state.seq++;
	const event: TraceEvent = {
		ts: new Date().toISOString(),
		seq: state.seq,
		type,
		data,
	};
	try {
		appendFileSync(state.traceFilePath, `${JSON.stringify(event)}\n`);
	} catch {
		// Silently ignore write errors — tracing should never break the agent
	}
}

export function appendIndexEntry(tracesDir: string, entry: IndexEntry): void {
	try {
		appendFileSync(getIndexFilePath(tracesDir), `${JSON.stringify(entry)}\n`);
	} catch {
		// Silently ignore
	}
}

// ── Trace Lifecycle ───────────────────────────────────────────

export function initTrace(sessionId: string, cwd: string, model: string): TraceState {
	const tracesDir = getTracesDir();
	const traceFilePath = getTraceFilePath(tracesDir, sessionId);

	const state: TraceState = {
		sessionId,
		seq: 0,
		startedAt: Date.now(),
		cwd,
		model,
		pid: process.pid,
		totalTurns: 0,
		totalToolCalls: 0,
		tokensIn: 0,
		tokensOut: 0,
		filesModified: new Set(),
		toolTimers: new Map(),
		traceFilePath,
		tracesDir,
		taskPreview: "",
	};

	// Write header event immediately
	appendEvent(state, "trace.header", {
		version: 1,
		session_id: sessionId,
		started_at: new Date().toISOString(),
		cwd,
		model,
		pid: process.pid,
	});

	// Write initial index entry with "incomplete" status (crash safety)
	appendIndexEntry(tracesDir, {
		session_id: sessionId,
		cwd,
		title: "(running)",
		started_at: new Date().toISOString(),
		ended_at: "",
		duration_ms: 0,
		agent: "interactive",
		model,
		outcome: "incomplete",
		tool_calls: 0,
		tokens: { in: 0, out: 0 },
		parent: null,
		tags: [],
		files_modified: [],
	});

	return state;
}

export function finalizeTrace(state: TraceState, outcome: "success" | "error", agentName: string): void {
	const endedAt = new Date().toISOString();
	const durationMs = Date.now() - state.startedAt;
	const filesModified = Array.from(state.filesModified);
	const title = generateTitle(agentName, state.taskPreview, outcome);

	// Write footer event
	appendEvent(state, "trace.footer", {
		ended_at: endedAt,
		duration_ms: durationMs,
		outcome,
		total_turns: state.totalTurns,
		total_tool_calls: state.totalToolCalls,
		tokens: { in: state.tokensIn, out: state.tokensOut },
		files_modified: filesModified,
		title,
	});

	// Append final index entry (readers use the last entry for a given session_id)
	appendIndexEntry(state.tracesDir, {
		session_id: state.sessionId,
		cwd: state.cwd,
		title,
		started_at: new Date(state.startedAt).toISOString(),
		ended_at: endedAt,
		duration_ms: durationMs,
		agent: agentName,
		model: state.model,
		outcome,
		tool_calls: state.totalToolCalls,
		tokens: { in: state.tokensIn, out: state.tokensOut },
		parent: null,
		tags: [],
		files_modified: filesModified,
	});
}

// ── Summarization ─────────────────────────────────────────────

export function summarizeToolArgs(toolName: string, args: Record<string, unknown>): Record<string, unknown> {
	if (!args || typeof args !== "object") return {};

	switch (toolName) {
		case "edit":
			// Keep old_string/new_string verbatim — critical for understanding changes
			return {
				file_path: args.file_path,
				old_string: args.old_string,
				new_string: args.new_string,
				replace_all: args.replace_all,
			};

		case "bash":
			// Keep command verbatim — commands are usually short
			return { command: args.command, timeout: args.timeout };

		case "write": {
			// Store content size + preview, not full content
			const content = typeof args.content === "string" ? args.content : "";
			return {
				file_path: args.file_path,
				content_size: content.length,
				content_preview: content.slice(0, 200),
			};
		}

		case "read":
			return { file_path: args.file_path, offset: args.offset, limit: args.limit };

		case "grep":
			return { pattern: args.pattern, path: args.path, glob: args.glob, type: args.type };

		case "find":
		case "glob":
			return { pattern: args.pattern, path: args.path };

		default: {
			// Generic: stringify and truncate if large
			const serialized = JSON.stringify(args);
			if (serialized.length > 500) {
				return { _truncated: true, _size: serialized.length, _preview: serialized.slice(0, 500) };
			}
			return args;
		}
	}
}

export function summarizeToolResult(
	_toolName: string,
	result: unknown,
): { result_size: number; result_preview: string } {
	if (result === null || result === undefined) {
		return { result_size: 0, result_preview: "" };
	}

	let text: string;
	if (typeof result === "string") {
		text = result;
	} else if (typeof result === "object") {
		// Tool results often have a content array with text items
		const r = result as Record<string, unknown>;
		if (Array.isArray(r.content)) {
			text = r.content
				.filter((c: any) => c?.type === "text")
				.map((c: any) => c.text)
				.join("\n");
		} else {
			text = JSON.stringify(result);
		}
	} else {
		text = String(result);
	}

	return {
		result_size: text.length,
		result_preview: text.slice(0, 200),
	};
}

// ── Title Generation ──────────────────────────────────────────

export function generateTitle(agentName: string, taskPreview: string, outcome: string): string {
	const task = taskPreview.replace(/\s+/g, " ").trim();
	const preview = task.length > 50 ? `${task.slice(0, 50)}...` : task;
	if (preview) {
		return `${agentName}: ${preview} (${outcome})`;
	}
	return `${agentName} (${outcome})`;
}

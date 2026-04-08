/**
 * Trace Writer — Directory-per-session, file-per-run storage
 *
 * Layout:
 *   traces/index.jsonl
 *   traces/{session-id}/meta.json
 *   traces/{session-id}/run-001.jsonl
 *
 * All writes use appendFileSync/writeFileSync for crash safety.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import * as path from "node:path";
import type { IndexEntry, SessionMeta, TraceEvent, TraceState } from "./types.js";

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

export function getSessionDir(tracesDir: string, sessionId: string): string {
	return path.join(tracesDir, sessionId);
}

export function getMetaPath(sessionDir: string): string {
	return path.join(sessionDir, "meta.json");
}

export function getRunFilePath(sessionDir: string, runNumber: number): string {
	const padded = String(runNumber).padStart(3, "0");
	return path.join(sessionDir, `run-${padded}.jsonl`);
}

export function getIndexFilePath(tracesDir: string): string {
	return path.join(tracesDir, "index.jsonl");
}

// ── Legacy path (for migration/compat) ──────────────────────

export function getLegacyTraceFilePath(tracesDir: string, sessionId: string): string {
	return path.join(tracesDir, `${sessionId}.trace.jsonl`);
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
		appendFileSync(state.runFilePath, `${JSON.stringify(event)}\n`);
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

// ── Meta.json ─────────────────────────────────────────────────

function writeMetaJson(sessionDir: string, meta: SessionMeta): void {
	try {
		writeFileSync(getMetaPath(sessionDir), JSON.stringify(meta, null, 2) + "\n");
	} catch {
		// Silently ignore
	}
}

export function readMetaJson(sessionDir: string): SessionMeta | null {
	const metaPath = getMetaPath(sessionDir);
	if (!existsSync(metaPath)) return null;
	try {
		return JSON.parse(readFileSync(metaPath, "utf-8"));
	} catch {
		return null;
	}
}

// ── Trace Lifecycle ───────────────────────────────────────────

/**
 * Initialize a trace session. Creates the session directory and meta.json.
 * Called once per session (not per run).
 */
export function initTrace(sessionId: string, cwd: string, model: string): TraceState {
	const tracesDir = getTracesDir();
	const sessionDir = getSessionDir(tracesDir, sessionId);

	// Create session directory
	if (!existsSync(sessionDir)) {
		mkdirSync(sessionDir, { recursive: true });
	}

	// Detect existing runs (for --continue sessions)
	let existingRuns = 0;
	let existingSeq = 0;
	let existingTurns = 0;
	let existingToolCalls = 0;
	let existingTokensIn = 0;
	let existingTokensOut = 0;
	const existingFiles = new Set<string>();

	const meta = readMetaJson(sessionDir);
	if (meta) {
		existingRuns = meta.total_runs;
		existingTurns = meta.total_turns;
		existingToolCalls = meta.total_tool_calls;
		existingTokensIn = meta.tokens.in;
		existingTokensOut = meta.tokens.out;
		for (const f of meta.files_modified) existingFiles.add(f);

		// Find the highest seq from the last run file
		const lastRunPath = getRunFilePath(sessionDir, existingRuns);
		if (existsSync(lastRunPath)) {
			try {
				const content = readFileSync(lastRunPath, "utf-8");
				const lines = content.trim().split("\n").filter(Boolean);
				if (lines.length > 0) {
					const lastEvent = JSON.parse(lines[lines.length - 1]) as TraceEvent;
					existingSeq = lastEvent.seq;
				}
			} catch {
				// Ignore
			}
		}
	}

	const state: TraceState = {
		sessionId,
		seq: existingSeq,
		sessionStartedAt: meta ? new Date(meta.created_at).getTime() : Date.now(),
		cwd,
		model,
		pid: process.pid,

		totalRuns: existingRuns,
		totalTurns: existingTurns,
		totalToolCalls: existingToolCalls,
		tokensIn: existingTokensIn,
		tokensOut: existingTokensOut,
		filesModified: existingFiles,

		currentRun: 0,
		runStartedAt: 0,
		runTurns: 0,
		runToolCalls: 0,
		runTokensIn: 0,
		runTokensOut: 0,
		runFilesModified: new Set(),
		runFilePath: "",

		toolTimers: new Map(),
		sessionDir,
		tracesDir,
		taskPreview: "",
	};

	// Write/update meta.json with "incomplete" status
	const now = new Date().toISOString();
	writeMetaJson(sessionDir, {
		session_id: sessionId,
		cwd,
		model,
		pid: process.pid,
		created_at: meta?.created_at ?? now,
		updated_at: now,
		total_runs: existingRuns,
		total_turns: existingTurns,
		total_tool_calls: existingToolCalls,
		tokens: { in: existingTokensIn, out: existingTokensOut },
		outcome: "incomplete",
		title: meta?.title ?? "(running)",
		tags: meta?.tags ?? [],
		files_modified: Array.from(existingFiles),
	});

	// Write initial index entry
	appendIndexEntry(tracesDir, {
		session_id: sessionId,
		cwd,
		title: meta?.title ?? "(running)",
		started_at: meta?.created_at ?? now,
		ended_at: "",
		duration_ms: 0,
		agent: "interactive",
		model,
		outcome: "incomplete",
		tool_calls: existingToolCalls,
		tokens: { in: existingTokensIn, out: existingTokensOut },
		parent: null,
		tags: meta?.tags ?? [],
		files_modified: Array.from(existingFiles),
		total_runs: existingRuns,
	});

	return state;
}

/**
 * Start a new run within the session. Called on each agent_start.
 */
export function startRun(state: TraceState): void {
	state.totalRuns++;
	state.currentRun = state.totalRuns;
	state.runStartedAt = Date.now();
	state.runTurns = 0;
	state.runToolCalls = 0;
	state.runTokensIn = 0;
	state.runTokensOut = 0;
	state.runFilesModified = new Set();
	state.runFilePath = getRunFilePath(state.sessionDir, state.currentRun);

	appendEvent(state, "run.start", {
		run: state.currentRun,
		session_id: state.sessionId,
	});
}

/**
 * End the current run. Called on each agent_end.
 */
export function endRun(state: TraceState): void {
	appendEvent(state, "run.end", {
		run: state.currentRun,
		turns: state.runTurns,
		tool_calls: state.runToolCalls,
		tokens: { in: state.runTokensIn, out: state.runTokensOut },
		files_modified: Array.from(state.runFilesModified),
		duration_ms: Date.now() - state.runStartedAt,
	});

	// Update meta.json after each run
	writeMetaJson(state.sessionDir, {
		session_id: state.sessionId,
		cwd: state.cwd,
		model: state.model,
		pid: state.pid,
		created_at: new Date(state.sessionStartedAt).toISOString(),
		updated_at: new Date().toISOString(),
		total_runs: state.totalRuns,
		total_turns: state.totalTurns,
		total_tool_calls: state.totalToolCalls,
		tokens: { in: state.tokensIn, out: state.tokensOut },
		outcome: "incomplete",
		title: generateTitle("interactive", state.taskPreview, "incomplete"),
		tags: [],
		files_modified: Array.from(state.filesModified),
	});
}

/**
 * Finalize the trace session. Called on session_shutdown.
 */
export function finalizeTrace(state: TraceState, outcome: "success" | "error", agentName: string): void {
	const endedAt = new Date().toISOString();
	const durationMs = Date.now() - state.sessionStartedAt;
	const filesModified = Array.from(state.filesModified);
	const title = generateTitle(agentName, state.taskPreview, outcome);

	// Update meta.json with final state
	writeMetaJson(state.sessionDir, {
		session_id: state.sessionId,
		cwd: state.cwd,
		model: state.model,
		pid: state.pid,
		created_at: new Date(state.sessionStartedAt).toISOString(),
		updated_at: endedAt,
		total_runs: state.totalRuns,
		total_turns: state.totalTurns,
		total_tool_calls: state.totalToolCalls,
		tokens: { in: state.tokensIn, out: state.tokensOut },
		outcome,
		title,
		tags: [],
		files_modified: filesModified,
	});

	// Append final index entry (readers use the last entry for a given session_id)
	appendIndexEntry(state.tracesDir, {
		session_id: state.sessionId,
		cwd: state.cwd,
		title,
		started_at: new Date(state.sessionStartedAt).toISOString(),
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
		total_runs: state.totalRuns,
	});
}

// ── Summarization ─────────────────────────────────────────────

export function summarizeToolArgs(toolName: string, args: Record<string, unknown>): Record<string, unknown> {
	if (!args || typeof args !== "object") return {};

	switch (toolName) {
		case "edit":
			return {
				file_path: args.file_path,
				old_string: args.old_string,
				new_string: args.new_string,
				replace_all: args.replace_all,
			};

		case "bash":
			return { command: args.command, timeout: args.timeout };

		case "write": {
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

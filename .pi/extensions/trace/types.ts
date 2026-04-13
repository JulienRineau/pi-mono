/**
 * Trace Extension — Type Definitions
 *
 * Directory-per-session, file-per-run storage model.
 *
 * Layout:
 *   traces/
 *     index.jsonl                  # Cross-session lookup
 *     {session-id}/
 *       meta.json                  # Session-level metadata
 *       run-001.jsonl              # First agent run
 *       run-002.jsonl              # Second agent run (continue)
 */

/** A single event in a run-NNN.jsonl file */
export interface TraceEvent {
	ts: string;
	seq: number;
	type: string;
	data: Record<string, unknown>;
}

/** Session-level metadata stored in meta.json */
export interface SessionMeta {
	session_id: string;
	cwd: string;
	model: string;
	pid: number;
	created_at: string;
	updated_at: string;
	total_runs: number;
	total_turns: number;
	total_tool_calls: number;
	tokens: { in: number; out: number };
	outcome: "success" | "error" | "incomplete";
	title: string;
	tags: string[];
	files_modified: string[];
}

/** A single line in index.jsonl — summary of one session */
export interface IndexEntry {
	session_id: string;
	cwd: string;
	title: string;
	started_at: string;
	ended_at: string;
	duration_ms: number;
	agent: string;
	model: string;
	outcome: "success" | "error" | "incomplete";
	tool_calls: number;
	tokens: { in: number; out: number };
	parent: string | null;
	tags: string[];
	files_modified: string[];
	total_runs: number;
}

/** Mutable runtime state for the current trace session */
export interface TraceState {
	sessionId: string;
	seq: number;
	sessionStartedAt: number;
	cwd: string;
	model: string;
	pid: number;

	// Session-level accumulators (across all runs)
	totalRuns: number;
	totalTurns: number;
	totalToolCalls: number;
	tokensIn: number;
	tokensOut: number;
	filesModified: Set<string>;

	// Current run
	currentRun: number;
	runStartedAt: number;
	runTurns: number;
	runToolCalls: number;
	runTokensIn: number;
	runTokensOut: number;
	runFilesModified: Set<string>;
	runFilePath: string;

	// Tool call timing
	toolTimers: Map<string, { startTime: number; toolName: string; args: any }>;

	// Paths
	sessionDir: string;
	tracesDir: string;

	// Task preview for title generation
	taskPreview: string;
}

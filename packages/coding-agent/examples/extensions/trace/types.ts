/**
 * Trace Extension — Type Definitions
 *
 * Core data structures for the always-on agent tracing system.
 */

/** A single event in a .trace.jsonl file */
export interface TraceEvent {
	ts: string;
	seq: number;
	type: string;
	data: Record<string, unknown>;
}

/** A single line in index.jsonl — summary of one trace */
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
}

/** Mutable runtime state for the current trace session */
export interface TraceState {
	sessionId: string;
	seq: number;
	startedAt: number;
	cwd: string;
	model: string;
	pid: number;
	totalTurns: number;
	totalToolCalls: number;
	tokensIn: number;
	tokensOut: number;
	filesModified: Set<string>;
	toolTimers: Map<string, { startTime: number; toolName: string; args: any }>;
	traceFilePath: string;
	tracesDir: string;
	taskPreview: string;
}

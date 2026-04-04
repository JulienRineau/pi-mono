/**
 * Trace Analyzer — Read-side query and analysis functions
 *
 * Used by the trace tool to list, read, query, and manage traces.
 */

import { existsSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import * as path from "node:path";
import type { IndexEntry, TraceEvent } from "./types.js";
import { getIndexFilePath, getTraceFilePath } from "./writer.js";

// ── Index Reading ─────────────────────────────────────────────

function readIndex(tracesDir: string): IndexEntry[] {
	const indexPath = getIndexFilePath(tracesDir);
	if (!existsSync(indexPath)) return [];

	const content = readFileSync(indexPath, "utf-8");
	const entries: IndexEntry[] = [];

	for (const line of content.split("\n")) {
		if (!line.trim()) continue;
		try {
			entries.push(JSON.parse(line) as IndexEntry);
		} catch {
			// Skip malformed lines
		}
	}

	return entries;
}

/**
 * For a given session_id, the index may have multiple entries (initial "incomplete" + final).
 * Return only the latest entry per session_id.
 */
function deduplicateIndex(entries: IndexEntry[]): IndexEntry[] {
	const byId = new Map<string, IndexEntry>();
	for (const entry of entries) {
		byId.set(entry.session_id, entry); // last one wins
	}
	return Array.from(byId.values());
}

function rewriteIndex(tracesDir: string, entries: IndexEntry[]): void {
	const indexPath = getIndexFilePath(tracesDir);
	const content = entries.map((e) => JSON.stringify(e)).join("\n") + (entries.length > 0 ? "\n" : "");
	writeFileSync(indexPath, content);
}

// ── Time Parsing ──────────────────────────────────────────────

function parseSince(since: string): Date {
	// Support relative: "2h", "1d", "30m"
	const match = since.match(/^(\d+)([mhd])$/);
	if (match) {
		const amount = Number.parseInt(match[1], 10);
		const unit = match[2];
		const now = Date.now();
		const ms = unit === "m" ? amount * 60000 : unit === "h" ? amount * 3600000 : amount * 86400000;
		return new Date(now - ms);
	}
	// Otherwise treat as ISO date
	return new Date(since);
}

// ── Public API ────────────────────────────────────────────────

export interface ListFilters {
	since?: string;
	agent?: string;
	outcome?: string;
	tags?: string[];
	parent?: string;
}

export function listTraces(tracesDir: string, filters?: ListFilters): IndexEntry[] {
	let entries = deduplicateIndex(readIndex(tracesDir));

	if (filters) {
		if (filters.since) {
			const sinceDate = parseSince(filters.since);
			entries = entries.filter((e) => new Date(e.started_at) >= sinceDate);
		}
		if (filters.agent) {
			entries = entries.filter((e) => e.agent === filters.agent);
		}
		if (filters.outcome) {
			entries = entries.filter((e) => e.outcome === filters.outcome);
		}
		if (filters.tags && filters.tags.length > 0) {
			const requiredTags = new Set(filters.tags);
			entries = entries.filter((e) => e.tags.some((t) => requiredTags.has(t)));
		}
		if (filters.parent) {
			entries = entries.filter((e) => e.parent === filters.parent);
		}
	}

	// Sort by started_at descending (most recent first)
	entries.sort((a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime());

	return entries;
}

export function readTrace(tracesDir: string, sessionId: string): TraceEvent[] {
	const filePath = getTraceFilePath(tracesDir, sessionId);
	if (!existsSync(filePath)) return [];

	const content = readFileSync(filePath, "utf-8");
	const events: TraceEvent[] = [];

	for (const line of content.split("\n")) {
		if (!line.trim()) continue;
		try {
			events.push(JSON.parse(line) as TraceEvent);
		} catch {
			// Skip malformed lines
		}
	}

	return events;
}

export interface TreeNode {
	session_id: string;
	title: string;
	agent: string;
	outcome: string;
	duration_ms: number;
	tool_calls: number;
	context?: Record<string, unknown>;
	children: TreeNode[];
}

export function buildTree(tracesDir: string, rootSessionId: string): TreeNode | null {
	const entries = deduplicateIndex(readIndex(tracesDir));
	const entryMap = new Map(entries.map((e) => [e.session_id, e]));

	const rootEntry = entryMap.get(rootSessionId);
	if (!rootEntry) return null;

	// Read root trace to find child.linked events
	const rootEvents = readTrace(tracesDir, rootSessionId);
	const childLinks = rootEvents.filter((e) => e.type === "child.linked");

	const children: TreeNode[] = [];
	for (const link of childLinks) {
		const childId = link.data.child_session as string;
		const childEntry = entryMap.get(childId);

		if (childEntry) {
			// Recursively build subtree
			const subtree = buildTree(tracesDir, childId);
			children.push(
				subtree ?? {
					session_id: childId,
					title: childEntry.title,
					agent: childEntry.agent,
					outcome: childEntry.outcome,
					duration_ms: childEntry.duration_ms,
					tool_calls: childEntry.tool_calls,
					context: link.data.context as Record<string, unknown>,
					children: [],
				},
			);
		} else {
			// Child trace exists but no index entry (shouldn't happen normally)
			children.push({
				session_id: childId,
				title: "(unknown)",
				agent: (link.data.agent as string) || "unknown",
				outcome: "unknown",
				duration_ms: 0,
				tool_calls: 0,
				context: link.data.context as Record<string, unknown>,
				children: [],
			});
		}
	}

	return {
		session_id: rootSessionId,
		title: rootEntry.title,
		agent: rootEntry.agent,
		outcome: rootEntry.outcome,
		duration_ms: rootEntry.duration_ms,
		tool_calls: rootEntry.tool_calls,
		children,
	};
}

export interface TraceStats {
	tool_frequency: Record<string, number>;
	tool_durations: Record<string, { count: number; total_ms: number; avg_ms: number }>;
	error_rate: { total: number; errors: number; rate: number };
	turns: number;
	tokens: { in: number; out: number };
}

export function computeStats(events: TraceEvent[]): TraceStats {
	const toolFreq: Record<string, number> = {};
	const toolDurations: Record<string, { count: number; total_ms: number }> = {};
	let totalTools = 0;
	let errorCount = 0;
	let turns = 0;
	let tokensIn = 0;
	let tokensOut = 0;

	for (const event of events) {
		switch (event.type) {
			case "tool.start":
				totalTools++;
				toolFreq[event.data.tool as string] = (toolFreq[event.data.tool as string] || 0) + 1;
				break;

			case "tool.end": {
				const tool = event.data.tool as string;
				const dur = (event.data.duration_ms as number) || 0;
				if (!toolDurations[tool]) toolDurations[tool] = { count: 0, total_ms: 0 };
				toolDurations[tool].count++;
				toolDurations[tool].total_ms += dur;
				if (event.data.is_error) errorCount++;
				break;
			}

			case "turn.end":
				turns++;
				tokensIn += (event.data.input_tokens as number) || 0;
				tokensOut += (event.data.output_tokens as number) || 0;
				break;
		}
	}

	const toolDurationsWithAvg: Record<string, { count: number; total_ms: number; avg_ms: number }> = {};
	for (const [tool, stats] of Object.entries(toolDurations)) {
		toolDurationsWithAvg[tool] = {
			...stats,
			avg_ms: stats.count > 0 ? Math.round(stats.total_ms / stats.count) : 0,
		};
	}

	return {
		tool_frequency: toolFreq,
		tool_durations: toolDurationsWithAvg,
		error_rate: {
			total: totalTools,
			errors: errorCount,
			rate: totalTools > 0 ? errorCount / totalTools : 0,
		},
		turns,
		tokens: { in: tokensIn, out: tokensOut },
	};
}

export function addTags(tracesDir: string, sessionId: string, tags: string[]): boolean {
	const entries = readIndex(tracesDir);
	const deduped = deduplicateIndex(entries);
	const entry = deduped.find((e) => e.session_id === sessionId);
	if (!entry) return false;

	const tagSet = new Set([...entry.tags, ...tags]);
	entry.tags = Array.from(tagSet);
	rewriteIndex(tracesDir, deduped);
	return true;
}

export function setTitle(tracesDir: string, sessionId: string, title: string): boolean {
	const entries = readIndex(tracesDir);
	const deduped = deduplicateIndex(entries);
	const entry = deduped.find((e) => e.session_id === sessionId);
	if (!entry) return false;

	entry.title = title;
	rewriteIndex(tracesDir, deduped);
	return true;
}

export function cleanupTraces(tracesDir: string, keepCount: number): { removed: number } {
	const entries = deduplicateIndex(readIndex(tracesDir));
	entries.sort((a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime());

	const toKeep = entries.slice(0, keepCount);
	const toRemove = entries.slice(keepCount);

	// Delete trace files for removed entries
	for (const entry of toRemove) {
		const filePath = getTraceFilePath(tracesDir, entry.session_id);
		try {
			if (existsSync(filePath)) unlinkSync(filePath);
		} catch {
			// Ignore cleanup errors
		}
	}

	rewriteIndex(tracesDir, toKeep);
	return { removed: toRemove.length };
}

export function repairTraces(tracesDir: string): { repaired: number } {
	if (!existsSync(tracesDir)) return { repaired: 0 };

	const files = readdirSync(tracesDir).filter((f) => f.endsWith(".trace.jsonl"));
	const entries = deduplicateIndex(readIndex(tracesDir));
	const indexedIds = new Set(entries.map((e) => e.session_id));
	let repaired = 0;

	for (const file of files) {
		const sessionId = file.replace(".trace.jsonl", "");
		const filePath = path.join(tracesDir, file);

		const content = readFileSync(filePath, "utf-8");
		const lines = content.split("\n").filter((l) => l.trim());

		if (lines.length === 0) continue;

		// Check if last event is a footer
		let hasFooter = false;
		try {
			const lastEvent = JSON.parse(lines[lines.length - 1]) as TraceEvent;
			hasFooter = lastEvent.type === "trace.footer";
		} catch {
			// Malformed last line
		}

		if (!hasFooter) {
			// Mark as incomplete in index if not already there with correct status
			const existing = entries.find((e) => e.session_id === sessionId);
			if (existing && existing.outcome !== "incomplete") {
				existing.outcome = "incomplete";
				repaired++;
			} else if (!indexedIds.has(sessionId)) {
				// Parse header for metadata
				let header: Record<string, unknown> = {};
				try {
					const firstEvent = JSON.parse(lines[0]) as TraceEvent;
					if (firstEvent.type === "trace.header") header = firstEvent.data;
				} catch {
					// Use defaults
				}
				entries.push({
					session_id: sessionId,
					title: "(incomplete — recovered)",
					started_at: (header.started_at as string) || "",
					ended_at: "",
					duration_ms: 0,
					agent: "unknown",
					model: (header.model as string) || "unknown",
					outcome: "incomplete",
					tool_calls: 0,
					tokens: { in: 0, out: 0 },
					parent: null,
					tags: [],
					files_modified: [],
				});
				repaired++;
			}
		}
	}

	if (repaired > 0) {
		rewriteIndex(tracesDir, entries);
	}

	return { repaired };
}

/**
 * Trace Analyzer — Read-side query and analysis functions
 *
 * Reads the directory-per-session / file-per-run storage layout.
 * Also supports reading legacy single-file traces for backward compatibility.
 */

import { existsSync, readFileSync, readdirSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import * as path from "node:path";
import type { IndexEntry, SessionMeta, TraceEvent } from "./types.js";
import { getIndexFilePath, getLegacyTraceFilePath, getMetaPath, getRunFilePath, getSessionDir, readMetaJson } from "./writer.js";

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
	const match = since.match(/^(\d+)([mhd])$/);
	if (match) {
		const amount = Number.parseInt(match[1], 10);
		const unit = match[2];
		const now = Date.now();
		const ms = unit === "m" ? amount * 60000 : unit === "h" ? amount * 3600000 : amount * 86400000;
		return new Date(now - ms);
	}
	return new Date(since);
}

// ── Run File Discovery ────────────────────────────────────────

function discoverRunFiles(sessionDir: string): string[] {
	if (!existsSync(sessionDir)) return [];
	return readdirSync(sessionDir)
		.filter((f) => /^run-\d+\.jsonl$/.test(f))
		.sort();
}

function readRunFile(filePath: string): TraceEvent[] {
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

// ── Public API ────────────────────────────────────────────────

export interface ListFilters {
	since?: string;
	agent?: string;
	outcome?: string;
	tags?: string[];
	parent?: string;
	project?: string;
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
			entries = entries.filter((e) => e.tags?.some((t) => requiredTags.has(t)));
		}
		if (filters.parent) {
			entries = entries.filter((e) => e.parent === filters.parent);
		}
		if (filters.project) {
			entries = entries.filter((e) => e.cwd?.includes(filters.project!));
		}
	}

	// Sort by started_at descending (most recent first)
	entries.sort((a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime());

	return entries;
}

/**
 * Read trace events. Supports:
 * - New layout: session directory with run files
 * - Legacy layout: single {session-id}.trace.jsonl file
 * - Optional run filter to read a specific run
 */
export function readTrace(tracesDir: string, sessionId: string, run?: number): TraceEvent[] {
	const sessionDir = getSessionDir(tracesDir, sessionId);

	// New layout: directory with run files
	if (existsSync(sessionDir) && existsSync(getMetaPath(sessionDir))) {
		if (run !== undefined) {
			const runPath = getRunFilePath(sessionDir, run);
			return readRunFile(runPath);
		}
		// Read all runs in order
		const runFiles = discoverRunFiles(sessionDir);
		const events: TraceEvent[] = [];
		for (const file of runFiles) {
			events.push(...readRunFile(path.join(sessionDir, file)));
		}
		return events;
	}

	// Legacy layout: single file
	const legacyPath = getLegacyTraceFilePath(tracesDir, sessionId);
	if (existsSync(legacyPath)) {
		return readRunFile(legacyPath);
	}

	return [];
}

/**
 * Get session metadata. Reads meta.json for new layout, or parses
 * header/footer from legacy trace file.
 */
export function getSessionMeta(tracesDir: string, sessionId: string): SessionMeta | null {
	const sessionDir = getSessionDir(tracesDir, sessionId);
	return readMetaJson(sessionDir);
}

/**
 * List individual runs for a session.
 */
export function listRuns(tracesDir: string, sessionId: string): { run: number; events: number; has_error: boolean }[] {
	const sessionDir = getSessionDir(tracesDir, sessionId);
	const runFiles = discoverRunFiles(sessionDir);
	const runs: { run: number; events: number; has_error: boolean }[] = [];

	for (const file of runFiles) {
		const match = file.match(/^run-(\d+)\.jsonl$/);
		if (!match) continue;
		const runNumber = parseInt(match[1], 10);
		const events = readRunFile(path.join(sessionDir, file));
		const hasError = events.some((e) => e.data?.is_error === true);
		runs.push({ run: runNumber, events: events.length, has_error: hasError });
	}

	return runs;
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
	runs: number;
}

export function computeStats(events: TraceEvent[]): TraceStats {
	const toolFreq: Record<string, number> = {};
	const toolDurations: Record<string, { count: number; total_ms: number }> = {};
	let totalTools = 0;
	let errorCount = 0;
	let turns = 0;
	let tokensIn = 0;
	let tokensOut = 0;
	let runs = 0;

	for (const event of events) {
		switch (event.type) {
			case "run.start":
				runs++;
				break;

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
		runs,
	};
}

// ── Metadata Mutations ──────────────────────────────────────

export function addTags(tracesDir: string, sessionId: string, tags: string[]): boolean {
	// Update meta.json
	const sessionDir = getSessionDir(tracesDir, sessionId);
	const meta = readMetaJson(sessionDir);
	if (meta) {
		const tagSet = new Set([...meta.tags, ...tags]);
		meta.tags = Array.from(tagSet);
		try {
			writeFileSync(getMetaPath(sessionDir), JSON.stringify(meta, null, 2) + "\n");
		} catch {
			// Ignore
		}
	}

	// Update index
	const entries = readIndex(tracesDir);
	const deduped = deduplicateIndex(entries);
	const entry = deduped.find((e) => e.session_id === sessionId);
	if (!entry) return false;

	const tagSet = new Set([...(entry.tags || []), ...tags]);
	entry.tags = Array.from(tagSet);
	rewriteIndex(tracesDir, deduped);
	return true;
}

export function setTitle(tracesDir: string, sessionId: string, title: string): boolean {
	// Update meta.json
	const sessionDir = getSessionDir(tracesDir, sessionId);
	const meta = readMetaJson(sessionDir);
	if (meta) {
		meta.title = title;
		try {
			writeFileSync(getMetaPath(sessionDir), JSON.stringify(meta, null, 2) + "\n");
		} catch {
			// Ignore
		}
	}

	// Update index
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

	for (const entry of toRemove) {
		// Remove session directory (new layout)
		const sessionDir = getSessionDir(tracesDir, entry.session_id);
		try {
			if (existsSync(sessionDir)) rmSync(sessionDir, { recursive: true });
		} catch {
			// Ignore
		}

		// Remove legacy single file
		const legacyPath = getLegacyTraceFilePath(tracesDir, entry.session_id);
		try {
			if (existsSync(legacyPath)) unlinkSync(legacyPath);
		} catch {
			// Ignore
		}
	}

	rewriteIndex(tracesDir, toKeep);
	return { removed: toRemove.length };
}

export function repairTraces(tracesDir: string): { repaired: number } {
	if (!existsSync(tracesDir)) return { repaired: 0 };

	const entries = deduplicateIndex(readIndex(tracesDir));
	const indexedIds = new Set(entries.map((e) => e.session_id));
	let repaired = 0;

	// Check session directories
	const items = readdirSync(tracesDir, { withFileTypes: true });
	for (const item of items) {
		if (!item.isDirectory()) continue;
		if (item.name === "." || item.name === "..") continue;

		const sessionId = item.name;
		const sessionDir = path.join(tracesDir, sessionId);
		const meta = readMetaJson(sessionDir);

		if (meta && meta.outcome === "incomplete") {
			// Check if there's a valid last run
			const runFiles = discoverRunFiles(sessionDir);
			if (runFiles.length > 0) {
				const lastRunPath = path.join(sessionDir, runFiles[runFiles.length - 1]);
				const events = readRunFile(lastRunPath);
				const hasRunEnd = events.some((e) => e.type === "run.end");

				if (hasRunEnd && !indexedIds.has(sessionId)) {
					entries.push({
						session_id: sessionId,
						cwd: meta.cwd,
						title: meta.title || "(recovered)",
						started_at: meta.created_at,
						ended_at: meta.updated_at,
						duration_ms: new Date(meta.updated_at).getTime() - new Date(meta.created_at).getTime(),
						agent: "interactive",
						model: meta.model,
						outcome: "incomplete",
						tool_calls: meta.total_tool_calls,
						tokens: meta.tokens,
						parent: null,
						tags: meta.tags,
						files_modified: meta.files_modified,
						total_runs: meta.total_runs,
					});
					repaired++;
				}
			}
		}
	}

	// Also check legacy single-file traces
	const legacyFiles = items.filter((i) => !i.isDirectory() && i.name.endsWith(".trace.jsonl"));
	for (const file of legacyFiles) {
		const sessionId = file.name.replace(".trace.jsonl", "");
		if (indexedIds.has(sessionId)) continue;

		const filePath = path.join(tracesDir, file.name);
		const content = readFileSync(filePath, "utf-8");
		const lines = content.split("\n").filter((l) => l.trim());
		if (lines.length === 0) continue;

		let header: Record<string, unknown> = {};
		try {
			const firstEvent = JSON.parse(lines[0]) as TraceEvent;
			if (firstEvent.type === "trace.header") header = firstEvent.data;
		} catch {
			// Use defaults
		}

		entries.push({
			session_id: sessionId,
			cwd: (header.cwd as string) || "",
			title: "(legacy — recovered)",
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
			total_runs: 0,
		});
		repaired++;
	}

	if (repaired > 0) {
		rewriteIndex(tracesDir, entries);
	}

	return { repaired };
}

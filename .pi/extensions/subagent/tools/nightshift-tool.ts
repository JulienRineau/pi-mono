/**
 * Nightshift Tool - Autonomous spec processing loop
 *
 * A TypeScript state machine that processes specs without human intervention.
 * Intelligence lives in the subagents; orchestration is deterministic code.
 *
 * Actions:
 *   - start: Begin the autonomous loop
 *   - status: Check current progress
 *   - stop: Gracefully stop after current spec
 */

import { exec } from "node:child_process";
import { existsSync } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { promisify } from "node:util";

const execAsync = promisify(exec);
import type { AgentToolResult } from "@mariozechner/pi-agent-core";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import { discoverAgents } from "../agents.js";
import {
	getFinalOutput,
	mapWithConcurrencyLimit,
	type OnUpdateCallback,
	runSingleAgent,
	type SingleResult,
	type SubagentDetails,
} from "../runtime.js";
import { saveReport } from "./report-tool.js";
import { aggregateReviews } from "./review-tool.js";
import { pickNextSpec, readSpec, updateSpecStatus } from "./spec-tool.js";
import { runAllTests, runPlanTests } from "./test-tool.js";

// ── Types ──────────────────────────────────────────────────────────

type NightshiftState =
	| "idle"
	| "prep"
	| "branch"
	| "pick-spec"
	| "scout"
	| "plan"
	| "review-plan"
	| "write-tests"
	| "implement"
	| "quality-gates"
	| "review-impl"
	| "changelog"
	| "commit"
	| "finalize"
	| "done"
	| "error";

interface NightshiftCheckpoint {
	state: NightshiftState;
	branch: string;
	completed: string[];
	failed: string[];
	startedAt: string;
	currentSpec?: string;
	runDir?: string;
	traceSessionId?: string;
}

interface ReviewVerdict {
	reviewer: string;
	verdict: string;
}

interface TaskStatus {
	id: string;
	description: string;
	status: "pending" | "in_progress" | "completed" | "cancelled";
}

interface TimelineEntry {
	phase: NightshiftState;
	label: string;
	status: "done" | "running" | "failed";
	startedAt: number;
	endedAt?: number;
	durationMs?: number;
	reviewVerdicts?: ReviewVerdict[];
	tasks?: TaskStatus[];
	message?: string;
}

interface NightshiftDetails {
	state: NightshiftState;
	completed: number;
	failed: number;
	maxSpecs: number;
	currentSpec?: string;
	elapsed?: string;
	error?: string;
	message?: string;
	timeline?: TimelineEntry[];
	planVersion?: number;
}

// ── Module State ───────────────────────────────────────────────────

let stopRequested = false;

// ── Constants ─────────────────────────────────────────────────────

const STATE_LABELS: Record<string, string> = {
	prep: "Prep checks",
	branch: "Branch",
	"pick-spec": "Pick spec",
	scout: "Scout",
	"write-tests": "Write tests (TDD)",
	plan: "Plan",
	"review-plan": "Review plan",
	implement: "Implement",
	"quality-gates": "Quality gates",
	"review-impl": "Review implementation",
	changelog: "Changelog",
	commit: "Commit",
	finalize: "Finalize",
	error: "Error",
};

function formatDuration(entry: { startedAt: number; durationMs?: number }): string {
	const ms = entry.durationMs || (Date.now() - entry.startedAt);
	const totalSec = Math.floor(ms / 1000);
	const min = Math.floor(totalSec / 60);
	const sec = totalSec % 60;
	return `${min}:${sec.toString().padStart(2, "0")}`;
}

// ── Constants ──────────────────────────────────────────────────────

const REVIEWER_AGENTS = [
	"reviewer-architect",
	"reviewer-security",
	"reviewer-performance",
	"reviewer-domain",
	"reviewer-code",
	"reviewer-ux",
];

const MAX_CONCURRENCY = 4;

// ── Schema ─────────────────────────────────────────────────────────

const NightshiftParams = Type.Object({
	action: Type.Union([Type.Literal("start"), Type.Literal("status"), Type.Literal("stop")]),
	max_specs: Type.Optional(Type.Integer({ description: "Max specs to process (default 10)", default: 10 })),
	branch: Type.Optional(Type.String({ description: "Git branch name (default nightshift/{date})" })),
	skip_prep: Type.Optional(Type.Boolean({ description: "Skip prep phase (default false)", default: false })),
	max_review_iterations: Type.Optional(
		Type.Integer({ description: "Max review loop cycles (default 3)", default: 3 }),
	),
});

type NightshiftParams = typeof NightshiftParams.static;

// ── Helpers ────────────────────────────────────────────────────────

function errorResult(error: string): AgentToolResult<NightshiftDetails> {
	return {
		content: [{ type: "text", text: error }],
		details: { state: "error", completed: 0, failed: 0, maxSpecs: 0, error },
	};
}

function makeDetails(results: SingleResult[]): SubagentDetails {
	return {
		mode: "single",
		agentScope: "project",
		projectAgentsDir: null,
		results,
	};
}

/**
 * Clear all review files for a target and normalize filenames after each reviewer.
 * Fixes: reviewers using inconsistent `reviewer` names across rounds, causing
 * stale verdicts to persist and poison aggregation.
 */
async function clearReviewsForTarget(cwd: string, targetSlug: string): Promise<void> {
	const reviewsDir = path.join(cwd, "reviews", targetSlug);
	if (!existsSync(reviewsDir)) return;
	const files = await fs.readdir(reviewsDir);
	for (const file of files) {
		if (file.endsWith(".md")) {
			await fs.unlink(path.join(reviewsDir, file));
		}
	}
}

/**
 * After ALL reviewers in a cycle finish, rename every file to match its agent name.
 * Reads the `reviewer:` frontmatter field to identify which agent wrote which file,
 * then renames to {agent-name}.md. Handles reversed names (architect-reviewer → reviewer-architect).
 */
/**
 * After all reviewers finish, ensure each file is named {agent-name}.md.
 * Reads frontmatter to match files to agents. Falls back to token matching.
 * Since clearReviewsForTarget runs before each cycle, all files are from this cycle.
 */
async function normalizeAllReviewFilenames(
	cwd: string,
	targetSlug: string,
	agentNames: string[],
): Promise<void> {
	const reviewsDir = path.join(cwd, "reviews", targetSlug);
	if (!existsSync(reviewsDir)) return;

	const files = (await fs.readdir(reviewsDir)).filter((f) => f.endsWith(".md"));
	const canonicalSet = new Set(agentNames.map((a) => `${a}.md`));
	const needsRename = files.filter((f) => !canonicalSet.has(f));
	if (needsRename.length === 0) return;

	// Build agent lookup: sorted tokens → agent name
	const agentByTokens = new Map<string, string>();
	for (const agent of agentNames) {
		const tokens = agent.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/).sort().join(",");
		agentByTokens.set(tokens, agent);
	}

	// Track which agents already have canonical files
	const claimed = new Set(files.filter((f) => canonicalSet.has(f)).map((f) => f.replace(".md", "")));

	for (const file of needsRename) {
		const filePath = path.join(reviewsDir, file);

		// Try frontmatter match first
		let matched: string | undefined;
		try {
			const content = await fs.readFile(filePath, "utf-8");
			const reviewerMatch = content.match(/^reviewer:\s*(.+)$/m);
			if (reviewerMatch) {
				const reviewerName = reviewerMatch[1].trim();
				// Direct match against agent names
				for (const agent of agentNames) {
					if (claimed.has(agent)) continue;
					const agentLower = agent.toLowerCase();
					const reviewerLower = reviewerName.toLowerCase();
					// Match if one contains the other, or tokens overlap
					if (agentLower === reviewerLower || agentLower.includes(reviewerLower) || reviewerLower.includes(agentLower)) {
						matched = agent;
						break;
					}
				}
				// Token match fallback
				if (!matched) {
					const fileTokens = reviewerName.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/).sort().join(",");
					const tokenMatch = agentByTokens.get(fileTokens);
					if (tokenMatch && !claimed.has(tokenMatch)) {
						matched = tokenMatch;
					}
				}
			}
		} catch {
			/* ignore read errors */
		}

		// Filename token match as last resort
		if (!matched) {
			const fileTokens = file.replace(".md", "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/).sort().join(",");
			const tokenMatch = agentByTokens.get(fileTokens);
			if (tokenMatch && !claimed.has(tokenMatch)) {
				matched = tokenMatch;
			}
		}

		if (matched) {
			const canonical = `${matched}.md`;
			try {
				const canonicalPath = path.join(reviewsDir, canonical);
				if (existsSync(canonicalPath)) await fs.unlink(canonicalPath);
				await fs.rename(filePath, canonicalPath);
				claimed.add(matched);
			} catch {
				/* ignore */
			}
		}
	}
}

/**
 * Find which reviewers didn't produce a review file. Returns agent names missing files.
 */
async function findMissingReviewers(runDir: string, targetSlug: string, agentNames: string[]): Promise<string[]> {
	const reviewsDir = path.join(runDir, "reviews", targetSlug);
	if (!existsSync(reviewsDir)) return [...agentNames];
	const files = new Set((await fs.readdir(reviewsDir)).filter((f) => f.endsWith(".md")).map((f) => f.replace(".md", "")));
	return agentNames.filter((a) => !files.has(a));
}

/**
 * Detect which workspace packages have changes vs main branch.
 * Used by quality gates to only test modified packages.
 */
async function getChangedPackages(projectRoot: string): Promise<string[]> {
	try {
		const { stdout } = await execAsync(
			"git diff --name-only HEAD $(git merge-base HEAD main 2>/dev/null || echo HEAD~1)",
			{ cwd: projectRoot, encoding: "utf-8" },
		);
		const packages = new Set<string>();
		for (const file of stdout.trim().split("\n")) {
			const match = file.match(/^packages\/([^/]+)\//);
			if (match) packages.add(match[1]);
		}
		return Array.from(packages);
	} catch {
		return []; // Can't detect — return empty (will skip scoped tests)
	}
}

async function saveCheckpoint(runDir: string, checkpoint: NightshiftCheckpoint): Promise<void> {
	const filepath = path.join(runDir, "state.json");
	await fs.writeFile(filepath, JSON.stringify(checkpoint, null, 2), "utf-8");
}

async function readCheckpoint(runDir: string): Promise<NightshiftCheckpoint | null> {
	const filepath = path.join(runDir, "state.json");
	if (!existsSync(filepath)) return null;
	try {
		const content = await fs.readFile(filepath, "utf-8");
		return JSON.parse(content);
	} catch {
		return null;
	}
}

function slugifySpec(specFilename: string): string {
	return specFilename
		.replace(/\.md$/, "")
		.replace(/^\d{4}-\d{2}-\d{2}-/, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
}

async function createRunDir(projectRoot: string, specSlug: string): Promise<string> {
	const timestamp = new Date().toISOString().replace(/:/g, "-").replace(/\.\d+Z$/, "");
	const dirName = `${timestamp}-${specSlug}`;
	const runDir = path.join(projectRoot, ".pi", "nightshift", dirName);
	await fs.mkdir(runDir, { recursive: true });
	return runDir;
}

async function writeActiveRun(projectRoot: string, runDir: string): Promise<void> {
	const filepath = path.join(projectRoot, ".pi", "nightshift", "active-run.json");
	await fs.mkdir(path.join(projectRoot, ".pi", "nightshift"), { recursive: true });
	await fs.writeFile(filepath, JSON.stringify({ runDir }, null, 2), "utf-8");
}

async function readActiveRun(projectRoot: string): Promise<string | null> {
	const filepath = path.join(projectRoot, ".pi", "nightshift", "active-run.json");
	if (!existsSync(filepath)) return null;
	try {
		const content = await fs.readFile(filepath, "utf-8");
		const data = JSON.parse(content);
		return data.runDir || null;
	} catch {
		return null;
	}
}

async function clearActiveRun(projectRoot: string): Promise<void> {
	const filepath = path.join(projectRoot, ".pi", "nightshift", "active-run.json");
	try {
		await fs.unlink(filepath);
	} catch {
		/* ignore */
	}
}

function extractPlanPath(output: string, cwd: string): string | null {
	// Try regex patterns first
	const patterns = [/plans\/[\w-]+-v\d+\.md/, /Plan saved to:\s*(.+\.md)/, /plan[_ ]?path[: ]+(.+\.md)/i];
	for (const pattern of patterns) {
		const match = output.match(pattern);
		if (match) return match[0].startsWith("plans/") ? match[0] : match[1];
	}

	// Fallback: find the most recently modified plan file
	const plansDir = path.join(cwd, "plans");
	if (existsSync(plansDir)) {
		try {
			const fsSync = require("node:fs");
			const files = (fsSync.readdirSync(plansDir) as string[])
				.filter((f: string) => f.endsWith(".md"))
				.map((f: string) => ({
					name: f,
					mtime: fsSync.statSync(path.join(plansDir, f)).mtimeMs as number,
				}))
				.sort((a: { mtime: number }, b: { mtime: number }) => b.mtime - a.mtime);
			if (files.length > 0) return `plans/${files[0].name}`;
		} catch {
			/* ignore */
		}
	}

	return null;
}

function planSlug(planPath: string): string {
	const base = path.basename(planPath, ".md");
	return base.replace(/-v\d+$/, "");
}

// ── Core Loop ──────────────────────────────────────────────────────

function emitChildLinked(pi: ExtensionAPI, result: SingleResult, spec: string | undefined, phase: string) {
	if (result.sessionId) {
		pi.events.emit("trace.child.linked", {
			child_session: result.sessionId,
			agent: result.agent,
			context: { spec, phase },
		});
	}
}

async function startNightshift(
	pi: ExtensionAPI,
	params: NightshiftParams,
	signal: AbortSignal | undefined,
	onUpdate: ((partial: AgentToolResult<NightshiftDetails>) => void) | undefined,
	ctx: ExtensionContext,
): Promise<AgentToolResult<NightshiftDetails>> {
	const projectRoot = ctx.cwd;
	const maxSpecs = params.max_specs ?? 10;
	const maxReviewIterations = Math.max(3, params.max_review_iterations ?? 3);
	const startedAt = new Date().toISOString();
	const date = startedAt.split("T")[0];
	const branchName = params.branch ?? `nightshift/${date}`;

	const completed: string[] = [];
	const failed: string[] = [];
	let currentState: NightshiftState = "prep";
	let currentSpec: string | undefined;
	let runDir: string = ""; // Set per-spec inside the loop

	stopRequested = false;

	const agents = discoverAgents(projectRoot, "project").agents;

	const timeline: TimelineEntry[] = [];
	let planVersion = 0;
	let currentReviewCycle = 0;
	let currentReviewVerdicts: ReviewVerdict[] = [];

	const startPhase = (state: NightshiftState, label: string) => {
		const now = Date.now();
		const running = timeline.find((e) => e.status === "running");
		if (running) {
			running.status = "done";
			running.endedAt = now;
			running.durationMs = now - running.startedAt;
		}
		currentState = state;
		timeline.push({ phase: state, label, status: "running", startedAt: now });
		emit();
	};

	const updatePhase = (message: string | null, extra?: Partial<TimelineEntry>) => {
		const current = timeline.find((e) => e.status === "running");
		if (current) {
			if (message) current.message = message;
			if (extra) Object.assign(current, extra);
		}
		emit();
	};

	const failPhase = (message: string) => {
		const current = timeline.find((e) => e.status === "running");
		if (current) {
			current.status = "failed";
			current.endedAt = Date.now();
			current.durationMs = Date.now() - current.startedAt;
			current.message = message;
		}
		emit();
	};

	const emit = () => {
		if (!onUpdate) return;
		onUpdate({
			content: [{ type: "text", text: `[${currentState}] ${timeline.at(-1)?.message || timeline.at(-1)?.label || ""}` }],
			details: {
				state: currentState,
				completed: completed.length,
				failed: failed.length,
				maxSpecs,
				currentSpec,
				elapsed: `${Math.round((Date.now() - new Date(startedAt).getTime()) / 60000)}min`,
				message: timeline.at(-1)?.message || timeline.at(-1)?.label,
				timeline: [...timeline],
				planVersion: planVersion || undefined,
			},
		});
	};

	const checkpoint = async () => {
		if (!runDir) return;
		await saveCheckpoint(runDir, {
			state: currentState,
			branch: branchName,
			completed,
			failed,
			startedAt,
			currentSpec,
			runDir,
		});
	};

	// ─── PREP ────────────────────────────────────────────────────
	if (!params.skip_prep) {
		startPhase("prep", "Prep checks");
		const prepScript = path.join(projectRoot, ".pi/extensions/subagent/scripts/prep.sh");
		if (existsSync(prepScript)) {
			try {
				const { stdout } = await execAsync(`bash "${prepScript}"`, {
					cwd: projectRoot,
					encoding: "utf-8",
					timeout: 300000, // 5 min
				});
				updatePhase(`Done: ${stdout.trim().split("\n").pop()}`);
			} catch (err: any) {
				const output = (err.stdout || err.stderr || "").toString();
				return errorResult(`Prep failed:\n${output}`);
			}
		} else {
			updatePhase("No prep script found, skipping");
		}
	}

	// ─── BRANCH ──────────────────────────────────────────────────
	startPhase("branch", `Branch: ${branchName}`);
	try {
		await execAsync(`git checkout -b "${branchName}"`, { cwd: projectRoot, encoding: "utf-8" });
	} catch {
		// Branch may already exist — try switching to it
		try {
			await execAsync(`git checkout "${branchName}"`, { cwd: projectRoot, encoding: "utf-8" });
		} catch (err: any) {
			return errorResult(`Failed to create/switch to branch ${branchName}: ${err.message}`);
		}
	}

	// ─── MAIN LOOP ───────────────────────────────────────────────
	while (completed.length + failed.length < maxSpecs) {
		if (stopRequested) {
			startPhase("finalize", "Stop requested");
			break;
		}

		if (signal?.aborted) {
			startPhase("finalize", "Aborted");
			break;
		}

		// Reset timeline for each spec
		timeline.length = 0;
		planVersion = 0;
		currentReviewCycle = 0;
		currentReviewVerdicts = [];

		// ── PICK SPEC ────────────────────────────────────────────
		startPhase("pick-spec", "Pick spec");
		const specResult = await pickNextSpec({}, ctx);
		const specDetails = specResult.details;

		if (!specDetails?.path || specDetails.error) {
			startPhase("finalize", "Spec queue empty");
			break;
		}

		currentSpec = specDetails.filename || path.basename(specDetails.path);
		updatePhase(`Selected: ${currentSpec}`);

		// Read full spec content
		const specRead = await readSpec({ spec_path: specDetails.path }, ctx);
		const specContent = specRead.content[0]?.type === "text" ? specRead.content[0].text : "";
		const specTitle = specDetails.title || currentSpec;

		// Create isolated run directory for this spec
		const specSlug = slugifySpec(currentSpec);
		runDir = await createRunDir(projectRoot, specSlug);
		await writeActiveRun(projectRoot, runDir);
		await fs.writeFile(path.join(runDir, "spec.md"), specContent, "utf-8");

		// Mark as in-progress
		await updateSpecStatus({ spec_path: specDetails.path, status: "in-progress" }, ctx);
		await checkpoint();

		let specFailed = false;

		try {
			// ── SCOUT ────────────────────────────────────────────
			startPhase("scout", "Scout");
			const scoutResult = await runSingleAgent(
				projectRoot,
				agents,
				"scout",
				`Investigate the codebase for this task:\n\n${specContent}`,
				undefined,
				undefined,
				signal,
				undefined,
				makeDetails,
			);
			emitChildLinked(pi, scoutResult, currentSpec, "scout");
			const scoutContext = getFinalOutput(scoutResult.messages);

			if (scoutResult.exitCode !== 0) {
				failPhase(`Scout failed: ${scoutResult.stderr || scoutResult.errorMessage}`);
				specFailed = true;
				throw new Error("Scout failed");
			}

			// ── WRITE TESTS (TDD) ────────────────────────────────
			startPhase("write-tests", "Write tests (TDD)");
			const testerResult = await runSingleAgent(
				projectRoot,
				agents,
				"tester",
				`Write tests for this spec BEFORE implementation (TDD). Tests define what "done" looks like.\n\n## Spec\n${specContent}\n\n## Codebase Context (from scout)\n${scoutContext}`,
				undefined,
				undefined,
				signal,
				undefined,
				makeDetails,
			);
			emitChildLinked(pi, testerResult, currentSpec, "write-tests");

			let testerContext = "";
			if (testerResult.exitCode !== 0) {
				updatePhase(`Tester failed: ${testerResult.stderr || testerResult.errorMessage}`);
				// Non-fatal — continue without TDD tests
			} else {
				testerContext = getFinalOutput(testerResult.messages);
				updatePhase("Tests written");
			}

			// ── PLAN ─────────────────────────────────────────────
			const plannerTaskParts = [
				`Create an execution plan for this spec.`,
				``,
				`## Spec`,
				specContent,
				``,
				`## Codebase Context (from scout)`,
				scoutContext,
			];

			if (testerContext) {
				plannerTaskParts.push(
					``,
					`## Tests Already Written (TDD)`,
					`Tests have been written BEFORE this plan. Your plan must make these tests pass.`,
					testerContext,
				);
			}

			const plannerTask = plannerTaskParts.join("\n");
			const runEnv = { PI_NIGHTSHIFT_RUN_DIR: runDir };

			// Retry planner up to 3 times if it fails to produce a plan file
			let planPath: string | null = null;
			let planOutput = "";
			const MAX_PLAN_ATTEMPTS = 3;
			for (let planAttempt = 0; planAttempt < MAX_PLAN_ATTEMPTS; planAttempt++) {
				planVersion++;
				startPhase("plan", planAttempt === 0 ? `Plan v${planVersion}` : `Plan v${planVersion} (retry ${planAttempt})`);

				const planResult = await runSingleAgent(
					projectRoot,
					agents,
					"planner",
					plannerTask,
					undefined,
					undefined,
					signal,
					undefined,
					makeDetails,
					runEnv,
				);
				emitChildLinked(pi, planResult, currentSpec, "plan");
				planOutput = getFinalOutput(planResult.messages);

				if (planResult.exitCode !== 0) {
					failPhase(`Planner failed: ${planResult.stderr || planResult.errorMessage}`);
					break; // Don't retry on hard failure
				}

				planPath = extractPlanPath(planOutput, runDir);
				if (planPath) break; // Success

				updatePhase(`No plan file produced (attempt ${planAttempt + 1}/${MAX_PLAN_ATTEMPTS})`);
			}

			if (!planPath) {
				failPhase("Planner failed to produce a plan file after retries");
				specFailed = true;
				throw new Error("No plan path found");
			}

			const slug = planSlug(planPath);

			// ── REVIEW PLAN ──────────────────────────────────────
			// Approval logic:
			//   - All pass → approved immediately
			//   - Any conditional, no fail → revise once more, then approve
			//   - Any fail → full retry cycle
			let planApproved = false;
			let conditionalAccepted = false; // true after a conditional-only round was revised

			for (let reviewIter = 0; reviewIter < maxReviewIterations; reviewIter++) {
				startPhase("review-plan", `Review plan (cycle ${reviewIter + 1}/${maxReviewIterations})`);

				// Clear stale reviews from previous cycle
				await clearReviewsForTarget(runDir, slug);

				// Read the LATEST plan content
				let planContent: string;
				try {
					planContent = await fs.readFile(path.join(runDir, planPath), "utf-8");
				} catch {
					planContent = planOutput;
				}

				// Run all reviewers in parallel
				const reviewTasks = REVIEWER_AGENTS.map((reviewer) => ({
					agent: reviewer,
					task: [
						`Review the plan below, then save your review using the review tool.`,
						``,
						`IMPORTANT: Your task is NOT complete until you call the review tool exactly like this:`,
						`review({ action: "save", target: "${slug}", scope: "plan", reviewer: "${reviewer}", verdict: "pass|conditional|fail", content: "## Critical\\n...\\n## Warnings\\n..." })`,
						``,
						`- Use verdict "pass" if no blocking issues`,
						`- Use verdict "conditional" if there are suggestions but nothing blocking`,
						`- Use verdict "fail" only for critical security or correctness issues`,
						`- Use reviewer: "${reviewer}" exactly as shown`,
						``,
						`## Spec`,
						specContent,
						``,
						`## Plan`,
						planContent,
					].join("\n"),
				}));

				await mapWithConcurrencyLimit(reviewTasks, MAX_CONCURRENCY, async (task) => {
					const result = await runSingleAgent(
						projectRoot,
						agents,
						task.agent,
						task.task,
						undefined,
						undefined,
						signal,
						undefined,
						makeDetails,
						runEnv,
					);
					emitChildLinked(pi, result, currentSpec, "review-plan");
					return result;
				});
				await normalizeAllReviewFilenames(runDir, slug, REVIEWER_AGENTS);

				// Retry reviewers that didn't produce a file (max 2 retries)
				for (let retryRound = 0; retryRound < 2; retryRound++) {
					const missing = await findMissingReviewers(runDir, slug, REVIEWER_AGENTS);
					if (missing.length === 0) break;
					updatePhase(`Retrying ${missing.length} reviewer(s): ${missing.join(", ")}`);
					const retryTasks = missing.map((reviewer) => reviewTasks.find((t) => t.agent === reviewer)!).filter(Boolean);
					await mapWithConcurrencyLimit(retryTasks, MAX_CONCURRENCY, async (task) => {
						const result = await runSingleAgent(
							projectRoot, agents, task.agent, task.task,
							undefined, undefined, signal, undefined, makeDetails, runEnv,
						);
						emitChildLinked(pi, result, currentSpec, "review-plan");
						return result;
					});
					await normalizeAllReviewFilenames(runDir, slug, REVIEWER_AGENTS);
				}

				// Aggregate reviews
				const aggregate = await aggregateReviews({ target: slug }, ctx, runDir);
				const aggDetails = aggregate.details as any;

				// Track review verdicts for live display
				currentReviewCycle = reviewIter + 1;
				currentReviewVerdicts = (aggDetails?.verdicts as ReviewVerdict[]) || [];

				const failCount = currentReviewVerdicts.filter((v) => v.verdict === "fail").length;
				const condCount = currentReviewVerdicts.filter((v) => v.verdict === "conditional").length;
				const passCount = currentReviewVerdicts.filter((v) => v.verdict === "pass").length;
				updatePhase(`${passCount} pass, ${condCount} conditional, ${failCount} fail`, {
					reviewVerdicts: [...currentReviewVerdicts],
				});

				// All pass → approved
				if (failCount === 0 && condCount === 0) {
					planApproved = true;
					updatePhase("All reviewers passed", { reviewVerdicts: [...currentReviewVerdicts] });
					break;
				}

				// Conditional only (no fail) after a previous conditional round → accept
				if (failCount === 0 && conditionalAccepted) {
					planApproved = true;
					updatePhase("Conditionals accepted (suggestions incorporated)", {
						reviewVerdicts: [...currentReviewVerdicts],
					});
					break;
				}

				// Conditional only (no fail), first time → revise once and mark for acceptance
				if (failCount === 0 && !conditionalAccepted) {
					conditionalAccepted = true;
				} else {
					// Has fail → reset conditional acceptance (need a clean round)
					conditionalAccepted = false;
				}

				if (reviewIter < maxReviewIterations - 1) {
					// Revise plan with feedback
					const feedbackText = aggregate.content[0]?.type === "text" ? aggregate.content[0].text : "";
					planVersion++;
					startPhase("plan", `Plan v${planVersion} (revision)`);
					const revisionTaskParts = [
						`Revise the plan at ${planPath} based on review feedback.`,
						``,
						`## Review Feedback`,
						feedbackText,
						``,
						`## Original Spec`,
						specContent,
						``,
						`## Codebase Context (from scout)`,
						scoutContext,
					];
					if (testerContext) {
						revisionTaskParts.push(
							``,
							`## Tests Already Written (TDD)`,
							`Your revised plan must make these tests pass.`,
							testerContext,
						);
					}
					const revisionResult = await runSingleAgent(
						projectRoot,
						agents,
						"planner",
						revisionTaskParts.join("\n"),
						undefined,
						undefined,
						signal,
						undefined,
						makeDetails,
						runEnv,
					);
					emitChildLinked(pi, revisionResult, currentSpec, "plan-revision");

					// FIX #1: Update planPath to point to the new revision
					const revisionOutput = getFinalOutput(revisionResult.messages);
					const newPlanPath = extractPlanPath(revisionOutput, runDir);
					if (newPlanPath) {
						planPath = newPlanPath;
					}
				}
			}

			if (!planApproved) {
				failPhase("Plan not approved after max iterations");
				specFailed = true;
				throw new Error("Plan review failed");
			}

			// ── IMPLEMENT ────────────────────────────────────────
			startPhase("implement", "Implement");
			const absPlanPath = path.join(runDir, planPath);
			const workerTaskMap = new Map<string, TaskStatus>();

			const workerOnUpdate: OnUpdateCallback = (partial) => {
				// Extract todo_write tool calls from streamed messages
				const results = partial.details?.results;
				if (!results || results.length === 0) return;
				const messages = results[0].messages;
				for (const msg of messages) {
					if (msg.role !== "assistant") continue;
					for (const part of msg.content) {
						if (part.type === "toolCall" && part.name === "todo_write") {
							const args = part.arguments as Record<string, unknown>;
							if (args.action === "init" && Array.isArray(args.tasks)) {
								// Add/update but never remove — preserves tasks across milestone re-inits
								for (const t of args.tasks as Array<{ id?: string; description?: string; status?: string }>) {
									const id = t.id || "";
									workerTaskMap.set(id, {
										id,
										description: t.description || "",
										status: (t.status as TaskStatus["status"]) || "pending",
									});
								}
							} else if (args.action === "update" && args.id) {
								const task = workerTaskMap.get(args.id as string);
								if (task) {
									if (args.status) task.status = args.status as TaskStatus["status"];
									if (args.description) task.description = args.description as string;
								}
							}
						}
					}
				}
				updatePhase(null, { tasks: Array.from(workerTaskMap.values()) });
			};

			const workerResult = await runSingleAgent(
				projectRoot,
				agents,
				"worker",
				`Execute the plan at ${absPlanPath}.\n\nSpec: ${specTitle}`,
				undefined,
				undefined,
				signal,
				workerOnUpdate,
				makeDetails,
			);
			emitChildLinked(pi, workerResult, currentSpec, "implement");

			if (workerResult.exitCode !== 0) {
				failPhase(`Worker failed: ${workerResult.stderr || workerResult.errorMessage}`);
				specFailed = true;
				throw new Error("Worker failed");
			}

			// ── QUALITY GATES ────────────────────────────────────
			startPhase("quality-gates", "Quality gates");
			let qualityPassed = true;

			// Step 1: Run plan-specific tests first (fast feedback)
			const planTestResult = await runPlanTests({ plan: planPath }, ctx);
			const planTestDetails = planTestResult.details as any;
			if (planTestDetails?.passed === false) {
				updatePhase("Plan tests failed — fixing...");
				qualityPassed = false;

				// One fix attempt
				const planTestOutput = planTestResult.content[0]?.type === "text" ? planTestResult.content[0].text : "";
				const fixResult = await runSingleAgent(
					projectRoot,
					agents,
					"worker",
					`Tests for this spec are failing. Fix the test failures.\n\nTest output:\n${planTestOutput}`,
					undefined,
					undefined,
					signal,
					undefined,
					makeDetails,
				);
				emitChildLinked(pi, fixResult, currentSpec, "quality-fix");

				const retryResult = await runPlanTests({ plan: planPath }, ctx);
				const retryDetails = retryResult.details as any;
				if (retryDetails?.passed) {
					qualityPassed = true;
					updatePhase("Plan tests passed after fix");
				} else {
					updatePhase("Plan tests still failing");
				}
			} else {
				updatePhase("Plan tests passed");
			}

			// Step 2: Run tests only for changed packages (not full suite — avoids pre-existing failures)
			if (qualityPassed) {
				const changedPkgs = await getChangedPackages(projectRoot);
				if (changedPkgs.length > 0) {
					updatePhase(`Testing changed packages: ${changedPkgs.join(", ")}`);
					for (const pkg of changedPkgs) {
						try {
							await execAsync(`npm test --workspace=packages/${pkg} --if-present`, {
								cwd: projectRoot,
								encoding: "utf-8",
								timeout: 600000,
							});
						} catch (err: any) {
							const output = (err.stdout || err.stderr || "").toString().slice(-500);
							updatePhase(`Tests failed in packages/${pkg}`);
							qualityPassed = false;

							// One fix attempt
							const fixResult = await runSingleAgent(
								projectRoot,
								agents,
								"worker",
								`Tests are failing in packages/${pkg}. Fix the failures without breaking other tests.\n\nTest output:\n${output}`,
								undefined,
								undefined,
								signal,
								undefined,
								makeDetails,
							);
							emitChildLinked(pi, fixResult, currentSpec, "regression-fix");

							try {
								await execAsync(`npm test --workspace=packages/${pkg} --if-present`, {
									cwd: projectRoot,
									encoding: "utf-8",
									timeout: 600000,
								});
								qualityPassed = true;
								updatePhase(`packages/${pkg} tests passed after fix`);
							} catch {
								updatePhase(`packages/${pkg} tests still failing`);
							}
							if (!qualityPassed) break;
						}
					}
					if (qualityPassed) updatePhase("Changed package tests passed");
				} else {
					updatePhase("No changed packages detected, skipping regression tests");
				}
			}

			// Step 3: TypeScript check
			if (existsSync(path.join(projectRoot, "tsconfig.json"))) {
				try {
					await execAsync("npx tsc --noEmit", { cwd: projectRoot, encoding: "utf-8", timeout: 120000 });
				} catch {
					updatePhase("TypeScript errors detected");
					qualityPassed = false;
				}
			}

			if (!qualityPassed) {
				failPhase("Quality gates failed");
				specFailed = true;
				throw new Error("Quality gates failed");
			}

			// ── REVIEW IMPLEMENTATION ────────────────────────────
			let implApproved = false;
			for (let reviewIter = 0; reviewIter < maxReviewIterations; reviewIter++) {
				startPhase("review-impl", `Review impl (cycle ${reviewIter + 1}/${maxReviewIterations})`);

				// Clear stale reviews from previous cycle
				await clearReviewsForTarget(runDir, slug);

				const reviewTasks = REVIEWER_AGENTS.map((reviewer) => ({
					agent: reviewer,
					task: [
						`Review the implementation by running git diff, then save your review using the review tool.`,
						``,
						`IMPORTANT: Your task is NOT complete until you call the review tool exactly like this:`,
						`review({ action: "save", target: "${slug}", scope: "implementation", reviewer: "${reviewer}", verdict: "pass|conditional|fail", content: "## Critical\\n...\\n## Warnings\\n..." })`,
						``,
						`- Use verdict "pass" if no blocking issues`,
						`- Use verdict "conditional" if there are suggestions but nothing blocking`,
						`- Use verdict "fail" only for critical security or correctness issues`,
						`- Use reviewer: "${reviewer}" exactly as shown`,
						``,
						`Run git diff to see what changed.`,
						``,
						`## Spec`,
						specContent,
					].join("\n"),
				}));

				await mapWithConcurrencyLimit(reviewTasks, MAX_CONCURRENCY, async (task) => {
					const result = await runSingleAgent(
						projectRoot,
						agents,
						task.agent,
						task.task,
						undefined,
						undefined,
						signal,
						undefined,
						makeDetails,
						runEnv,
					);
					emitChildLinked(pi, result, currentSpec, "review-impl");
					return result;
				});
				await normalizeAllReviewFilenames(runDir, slug, REVIEWER_AGENTS);

				// Retry reviewers that didn't produce a file (max 2 retries)
				for (let retryRound = 0; retryRound < 2; retryRound++) {
					const missing = await findMissingReviewers(runDir, slug, REVIEWER_AGENTS);
					if (missing.length === 0) break;
					updatePhase(`Retrying ${missing.length} reviewer(s): ${missing.join(", ")}`);
					const retryTasks = missing.map((reviewer) => reviewTasks.find((t) => t.agent === reviewer)!).filter(Boolean);
					await mapWithConcurrencyLimit(retryTasks, MAX_CONCURRENCY, async (task) => {
						const result = await runSingleAgent(
							projectRoot, agents, task.agent, task.task,
							undefined, undefined, signal, undefined, makeDetails, runEnv,
						);
						emitChildLinked(pi, result, currentSpec, "review-impl");
						return result;
					});
					await normalizeAllReviewFilenames(runDir, slug, REVIEWER_AGENTS);
				}

				const aggregate = await aggregateReviews({ target: slug }, ctx, runDir);
				const aggDetails = aggregate.details as any;

				// Track review verdicts for live display
				currentReviewCycle = reviewIter + 1;
				currentReviewVerdicts = (aggDetails?.verdicts as ReviewVerdict[]) || [];

				if (aggDetails?.all_passed) {
					implApproved = true;
					updatePhase("All reviewers passed", { reviewVerdicts: [...currentReviewVerdicts] });
					break;
				}

				const failCount = currentReviewVerdicts.filter((v) => v.verdict === "fail").length;
				const condCount = currentReviewVerdicts.filter((v) => v.verdict === "conditional").length;
				const passCount = currentReviewVerdicts.filter((v) => v.verdict === "pass").length;
				updatePhase(`${passCount} pass, ${condCount} conditional, ${failCount} fail`, {
					reviewVerdicts: [...currentReviewVerdicts],
				});

				if (reviewIter < maxReviewIterations - 1) {
					const feedbackText = aggregate.content[0]?.type === "text" ? aggregate.content[0].text : "";
					startPhase("implement", "Worker addressing review feedback");
					const reviewFixResult = await runSingleAgent(
						projectRoot,
						agents,
						"worker",
						`Address review feedback for the implementation:\n\n${feedbackText}`,
						undefined,
						undefined,
						signal,
						undefined,
						makeDetails,
					);
					emitChildLinked(pi, reviewFixResult, currentSpec, "review-impl-fix");

					// Re-run plan tests after fixes
					const rerunResult = await runPlanTests({ plan: planPath }, ctx);
					if ((rerunResult.details as any)?.passed === false) {
						updatePhase("Plan tests failed after review fixes");
					}
				}
			}

			// ── HARNESS CHANGELOG ────────────────────────────────
			startPhase("changelog", "Harness changelog");
			const changelogPath = path.join(projectRoot, ".pi", "HARNESS_CHANGELOG.md");
			let changelogContent = "";
			try {
				changelogContent = await fs.readFile(changelogPath, "utf-8");
			} catch {
				/* new file */
			}

			const changelogEntry = [
				`## ${new Date().toISOString().split("T")[0]} — ${specTitle}`,
				``,
				`- Spec: ${currentSpec}`,
				`- Branch: ${branchName}`,
				`- Run: ${path.basename(runDir)}`,
				`- Plan: ${planPath}`,
				`- Review: ${implApproved ? "approved" : "conditional"}`,
				``,
			].join("\n");

			if (changelogContent.startsWith("# Harness Changelog")) {
				const headerEnd = changelogContent.indexOf("\n\n") + 2;
				changelogContent = changelogContent.slice(0, headerEnd) + changelogEntry + changelogContent.slice(headerEnd);
			} else {
				changelogContent = `# Harness Changelog\n\n${changelogEntry}${changelogContent}`;
			}

			await fs.writeFile(changelogPath, changelogContent, "utf-8");
			updatePhase("Updated .pi/HARNESS_CHANGELOG.md");

			// ── COMMIT ───────────────────────────────────────────
			startPhase("commit", "Commit");

			// Ask worker to generate a detailed commit message
			const commitMsgResult = await runSingleAgent(
				projectRoot,
				agents,
				"worker",
				[
					`Generate a detailed git commit message for the work just completed.`,
					`Write ONLY the commit message, nothing else.`,
					``,
					`Spec: ${specTitle}`,
					`Plan: ${absPlanPath}`,
					`Review status: ${implApproved ? "approved" : "conditional (warnings remain)"}`,
					``,
					`The commit message must follow this format:`,
					`Line 1: Short summary (max 72 chars)`,
					`Line 2: blank`,
					`Lines 3+: Body explaining:`,
					`- What changed from the user's perspective`,
					`- Key technical decisions made`,
					`- Files added or significantly modified`,
					`- Any remaining work or known limitations`,
					``,
					`Run git diff --cached or git diff to see what changed.`,
					`Do NOT run git commit — just output the message text.`,
				].join("\n"),
				undefined,
				undefined,
				signal,
				undefined,
				makeDetails,
			);
			emitChildLinked(pi, commitMsgResult, currentSpec, "commit-message");

			const detailedMsg = getFinalOutput(commitMsgResult.messages) || `nightshift: ${specTitle}`;

			try {
				await execAsync("git add -A", { cwd: projectRoot, encoding: "utf-8" });
				// Use a temp file for the commit message to handle multiline + special chars
				const msgFile = path.join(projectRoot, ".nightshift-commit-msg.tmp");
				await fs.writeFile(msgFile, detailedMsg, "utf-8");
				await execAsync(`git commit -F "${msgFile}" --allow-empty`, { cwd: projectRoot, encoding: "utf-8" });
				try {
					await fs.unlink(msgFile);
				} catch {
					/* ignore */
				}
			} catch {
				// May already be committed by worker
				updatePhase("No new changes (worker may have committed)");
			}

			// Mark spec as done
			await updateSpecStatus({ spec_path: specDetails.path, status: "done" }, ctx);
			completed.push(currentSpec!);
		} catch (err: any) {
			if (!specFailed) specFailed = true;
			failed.push(currentSpec!);
			// Mark spec as blocked — prevents re-picking in this session
			// Human reviews the report, investigates, and sets back to "ready" after fixing
			try {
				await updateSpecStatus({ spec_path: specDetails.path, status: "blocked" }, ctx);
			} catch {
				/* ignore */
			}
			failPhase(`Spec blocked: ${err.message}`);
		}

		await checkpoint();
	}

	// ─── FINALIZE ────────────────────────────────────────────────
	startPhase("finalize", "Finalize");
	const completedAt = new Date().toISOString();

	// Count commits
	let commitCount = 0;
	try {
		const { stdout: logOutput } = await execAsync(`git log --oneline ${branchName} --not main 2>/dev/null || git log --oneline -20`, {
			cwd: projectRoot,
			encoding: "utf-8",
		});
		commitCount = logOutput.trim().split("\n").filter(Boolean).length;
	} catch {
		/* ignore */
	}

	const reportContent = [
		"---",
		`session: ${date}`,
		`started-at: ${startedAt}`,
		`completed-at: ${completedAt}`,
		`specs-completed: ${completed.length}`,
		`specs-failed: ${failed.length}`,
		`total-commits: ${commitCount}`,
		"---",
		"",
		"## Completed",
		...completed.map((s) => `- [x] ${s}`),
		...(completed.length === 0 ? ["- (none)"] : []),
		"",
		"## Failed / Blocked",
		...failed.map((s) => `- [ ] ${s}`),
		...(failed.length === 0 ? ["- (none)"] : []),
		"",
		"## Key Decisions",
		"- See individual plan decision logs for details",
		"",
		"## Summary",
		`Processed ${completed.length + failed.length} specs: ${completed.length} completed, ${failed.length} failed.`,
		`Branch: ${branchName}`,
		`Duration: ${Math.round((new Date(completedAt).getTime() - new Date(startedAt).getTime()) / 60000)} minutes`,
	].join("\n");

	await saveReport({ content: reportContent }, ctx, runDir || undefined);

	currentState = "done";
	if (runDir) {
		await saveCheckpoint(runDir, {
			state: "done",
			branch: branchName,
			completed,
			failed,
			startedAt,
			runDir,
		});
	}
	await clearActiveRun(projectRoot);

	const resultLines = [
		`Night shift complete.`,
		`Specs completed: ${completed.length}/${completed.length + failed.length}`,
		`Specs failed: ${failed.length}`,
		`Branch: ${branchName}`,
		`Commits: ${commitCount}`,
		`Duration: ${Math.round((new Date(completedAt).getTime() - new Date(startedAt).getTime()) / 60000)} minutes`,
	];

	if (completed.length > 0) {
		resultLines.push(
			``,
			`Completed specs:`,
			...completed.map((s) => `  ✓ ${s}`),
			``,
			`Run directory: .pi/nightshift/${runDir ? path.basename(runDir) : "unknown"}`,
			`Harness changelog updated: .pi/HARNESS_CHANGELOG.md`,
		);
	}

	if (failed.length > 0) {
		resultLines.push(
			``,
			`IMPORTANT: Do NOT attempt to implement, fix, edit specs, or re-run nightshift.`,
			`Report this failure summary to the user and WAIT for their instructions.`,
			``,
			`Failed specs are marked as "blocked".`,
			`Run directory: .pi/nightshift/${runDir ? path.basename(runDir) : "unknown"}`,
		);
	}

	return {
		content: [{ type: "text", text: resultLines.join("\n") }],
		details: {
			state: "done",
			completed: completed.length,
			failed: failed.length,
			maxSpecs,
		},
	};
}

// ── Tool Registration ──────────────────────────────────────────────

export function registerNightshiftTool(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "nightshift",
		label: "Night Shift",
		description:
			"Autonomous spec processing loop. Picks specs from the queue, plans, reviews, implements, and commits — without human intervention. Actions: start, status, stop.",
		parameters: NightshiftParams,

		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			switch (params.action) {
				case "start":
					return await startNightshift(pi, params, signal, onUpdate, ctx);

				case "status": {
					// Find current or most recent run directory
					let activeRunDir = await readActiveRun(ctx.cwd);
					if (!activeRunDir) {
						// Scan for most recent run directory
						const nightshiftDir = path.join(ctx.cwd, ".pi", "nightshift");
						if (existsSync(nightshiftDir)) {
							try {
								const dirs = (await fs.readdir(nightshiftDir, { withFileTypes: true }))
									.filter((d) => d.isDirectory())
									.map((d) => d.name)
									.sort()
									.reverse();
								if (dirs.length > 0) {
									activeRunDir = path.join(nightshiftDir, dirs[0]);
								}
							} catch {
								/* ignore */
							}
						}
					}
					if (!activeRunDir) {
						return {
							content: [{ type: "text", text: "No nightshift runs found." }],
							details: { state: "idle" as NightshiftState, completed: 0, failed: 0, maxSpecs: 0 },
						};
					}
					const checkpoint = await readCheckpoint(activeRunDir);
					if (!checkpoint) {
						return {
							content: [{ type: "text", text: `Run directory found but no state: ${activeRunDir}` }],
							details: { state: "idle" as NightshiftState, completed: 0, failed: 0, maxSpecs: 0 },
						};
					}
					return {
						content: [
							{
								type: "text",
								text: [
									`State: ${checkpoint.state}`,
									`Branch: ${checkpoint.branch}`,
									`Run: ${path.basename(activeRunDir)}`,
									`Completed: ${checkpoint.completed.length}`,
									`Failed: ${checkpoint.failed.length}`,
									`Current: ${checkpoint.currentSpec || "(none)"}`,
									`Started: ${checkpoint.startedAt}`,
								].join("\n"),
							},
						],
						details: {
							state: checkpoint.state,
							completed: checkpoint.completed.length,
							failed: checkpoint.failed.length,
							maxSpecs: 0,
							currentSpec: checkpoint.currentSpec,
						},
					};
				}

				case "stop":
					stopRequested = true;
					return {
						content: [{ type: "text", text: "Stop requested. Will finish current spec and stop." }],
						details: { state: "idle" as NightshiftState, completed: 0, failed: 0, maxSpecs: 0 },
					};
			}
		},

		renderCall(args, _theme, _context) {
			let text = `nightshift ${args.action}`;
			if (args.action === "start") {
				const parts: string[] = [];
				if (args.max_specs) parts.push(`max: ${args.max_specs}`);
				if (args.branch) parts.push(`branch: ${args.branch}`);
				if (parts.length > 0) text += ` (${parts.join(", ")})`;
			}
			return new Text(text, 0, 0);
		},

		renderResult(result, _options, theme, _context) {
			const details = result.details as NightshiftDetails;

			if (details?.error) {
				return new Text(`${theme.fg("error", "✗")} ${details.error}`, 0, 0);
			}

			// Live timeline dashboard (both running and done states)
			if (details?.timeline && details.timeline.length > 0) {
				const lines: string[] = [];

				// Header
				const isDone = details.state === "done";
				const spec = details.currentSpec ? theme.fg("accent", details.currentSpec) : "";
				const elapsed = details.elapsed ? theme.fg("muted", ` (${details.elapsed})`) : "";
				if (isDone) {
					const doneIcon = details.failed > 0 ? theme.fg("warning", "◐") : theme.fg("success", "✓");
					const summary = details.failed > 0
						? `${details.completed} completed, ${details.failed} failed`
						: `${details.completed} completed`;
					lines.push(`${doneIcon} Night shift: ${summary}${elapsed}`);
				} else {
					lines.push(`${theme.fg("warning", "⏳")} ${spec}${elapsed}`);
				}

				for (const entry of details.timeline) {
					const icon =
						entry.status === "done"
							? theme.fg("success", "✓")
							: entry.status === "failed"
								? theme.fg("error", "✗")
								: theme.fg("warning", "⠹");
					const dur =
						entry.status === "running"
							? theme.fg("muted", `(${formatDuration(entry)})`)
							: entry.durationMs
								? theme.fg("dim", formatDuration(entry))
								: "";
					lines.push(`  ${icon} ${entry.label}  ${dur}`);

					// Review sub-items
					if (entry.reviewVerdicts && entry.reviewVerdicts.length > 0) {
						for (const v of entry.reviewVerdicts) {
							const vi =
								v.verdict === "pass"
									? theme.fg("success", "✓")
									: v.verdict === "fail"
										? theme.fg("error", "✗")
										: theme.fg("warning", "◐");
							lines.push(`    ${vi} ${v.reviewer}: ${v.verdict}`);
						}
					}

					// Task sub-items (from worker todo_write)
					if (entry.tasks && entry.tasks.length > 0) {
						for (const t of entry.tasks) {
							const ti =
								t.status === "completed"
									? theme.fg("success", "✓")
									: t.status === "in_progress"
										? theme.fg("warning", "⠹")
										: t.status === "cancelled"
											? theme.fg("muted", "—")
											: theme.fg("dim", "○");
							const desc = t.description.length > 50 ? `${t.description.slice(0, 47)}...` : t.description;
							lines.push(`    ${ti} ${t.id} ${desc}`);
						}
					}
				}

				if (details.completed > 0 || details.failed > 0) {
					lines.push(theme.fg("muted", `  Progress: ${details.completed}/${details.maxSpecs} specs`));
				}

				return new Text(lines.join("\n"), 0, 0);
			}

			// Fallback for non-timeline states
			if (details?.state && details.state !== "idle") {
				const label = STATE_LABELS[details.state] || details.state;
				const msg = details.message ? theme.fg("dim", ` — ${details.message}`) : "";
				return new Text(`${theme.fg("warning", "⏳")} ${label}${msg}`, 0, 0);
			}

			const text = result.content[0];
			return new Text(text?.type === "text" ? text.text : "", 0, 0);
		},
	});
}

export default registerNightshiftTool;

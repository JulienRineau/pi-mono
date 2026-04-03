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

import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { AgentToolResult } from "@mariozechner/pi-agent-core";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import { discoverAgents } from "../agents.js";
import {
	getFinalOutput,
	mapWithConcurrencyLimit,
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
}

interface NightshiftDetails {
	state: NightshiftState;
	completed: number;
	failed: number;
	maxSpecs: number;
	currentSpec?: string;
	elapsed?: string;
	error?: string;
}

// ── Module State ───────────────────────────────────────────────────

let stopRequested = false;

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

async function saveCheckpoint(cwd: string, checkpoint: NightshiftCheckpoint): Promise<void> {
	const filepath = path.join(cwd, "nightshift-state.json");
	await fs.writeFile(filepath, JSON.stringify(checkpoint, null, 2), "utf-8");
}

async function readCheckpoint(cwd: string): Promise<NightshiftCheckpoint | null> {
	const filepath = path.join(cwd, "nightshift-state.json");
	if (!existsSync(filepath)) return null;
	try {
		const content = await fs.readFile(filepath, "utf-8");
		return JSON.parse(content);
	} catch {
		return null;
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

async function startNightshift(
	params: NightshiftParams,
	signal: AbortSignal | undefined,
	onUpdate: ((partial: AgentToolResult<NightshiftDetails>) => void) | undefined,
	ctx: ExtensionContext,
): Promise<AgentToolResult<NightshiftDetails>> {
	const maxSpecs = params.max_specs ?? 10;
	const maxReviewIterations = params.max_review_iterations ?? 3;
	const startedAt = new Date().toISOString();
	const date = startedAt.split("T")[0];
	const branchName = params.branch ?? `nightshift/${date}`;

	const completed: string[] = [];
	const failed: string[] = [];
	let currentState: NightshiftState = "prep";
	let currentSpec: string | undefined;

	stopRequested = false;

	const agents = discoverAgents(ctx.cwd, "project").agents;

	const emitProgress = (state: NightshiftState, message: string) => {
		currentState = state;
		if (onUpdate) {
			onUpdate({
				content: [{ type: "text", text: `[${state}] ${message}` }],
				details: {
					state,
					completed: completed.length,
					failed: failed.length,
					maxSpecs,
					currentSpec,
					elapsed: `${Math.round((Date.now() - new Date(startedAt).getTime()) / 60000)}min`,
				},
			});
		}
	};

	const checkpoint = async () => {
		await saveCheckpoint(ctx.cwd, {
			state: currentState,
			branch: branchName,
			completed,
			failed,
			startedAt,
			currentSpec,
		});
	};

	// ─── PREP ────────────────────────────────────────────────────
	if (!params.skip_prep) {
		emitProgress("prep", "Running prep checks...");
		const prepScript = path.join(ctx.cwd, ".pi/extensions/subagent/scripts/prep.sh");
		if (existsSync(prepScript)) {
			try {
				const output = execSync(`bash "${prepScript}"`, {
					cwd: ctx.cwd,
					encoding: "utf-8",
					timeout: 300000, // 5 min
				});
				emitProgress("prep", `Prep complete: ${output.trim().split("\n").pop()}`);
			} catch (err: any) {
				const output = (err.stdout || err.stderr || "").toString();
				return errorResult(`Prep failed:\n${output}`);
			}
		} else {
			emitProgress("prep", "No prep script found, skipping");
		}
	}

	// ─── BRANCH ──────────────────────────────────────────────────
	emitProgress("branch", `Creating branch: ${branchName}`);
	try {
		execSync(`git checkout -b "${branchName}"`, { cwd: ctx.cwd, encoding: "utf-8" });
	} catch {
		// Branch may already exist — try switching to it
		try {
			execSync(`git checkout "${branchName}"`, { cwd: ctx.cwd, encoding: "utf-8" });
		} catch (err: any) {
			return errorResult(`Failed to create/switch to branch ${branchName}: ${err.message}`);
		}
	}

	// ─── MAIN LOOP ───────────────────────────────────────────────
	while (completed.length + failed.length < maxSpecs) {
		if (stopRequested) {
			emitProgress("finalize", "Stop requested — finishing up");
			break;
		}

		if (signal?.aborted) {
			emitProgress("finalize", "Aborted — finishing up");
			break;
		}

		// ── PICK SPEC ────────────────────────────────────────────
		emitProgress("pick-spec", "Selecting next spec...");
		const specResult = await pickNextSpec({}, ctx);
		const specDetails = specResult.details;

		if (!specDetails?.path || specDetails.error) {
			emitProgress("finalize", "Spec queue empty");
			break;
		}

		currentSpec = specDetails.filename || path.basename(specDetails.path);
		emitProgress("pick-spec", `Selected: ${currentSpec}`);

		// Read full spec content
		const specRead = await readSpec({ spec_path: specDetails.path }, ctx);
		const specContent = specRead.content[0]?.type === "text" ? specRead.content[0].text : "";
		const specTitle = specDetails.title || currentSpec;

		// Mark as in-progress
		await updateSpecStatus({ spec_path: specDetails.path, status: "in-progress" }, ctx);
		await checkpoint();

		let specFailed = false;

		try {
			// ── SCOUT ────────────────────────────────────────────
			emitProgress("scout", `Scouting for: ${specTitle}`);
			const scoutResult = await runSingleAgent(
				ctx.cwd,
				agents,
				"scout",
				`Investigate the codebase for this task:\n\n${specContent}`,
				undefined,
				undefined,
				signal,
				undefined,
				makeDetails,
			);
			const scoutContext = getFinalOutput(scoutResult.messages);

			if (scoutResult.exitCode !== 0) {
				emitProgress("scout", `Scout failed: ${scoutResult.stderr || scoutResult.errorMessage}`);
				specFailed = true;
				throw new Error("Scout failed");
			}

			// ── WRITE TESTS (TDD) ────────────────────────────────
			emitProgress("write-tests", `Writing tests for: ${specTitle}`);
			const testerResult = await runSingleAgent(
				ctx.cwd,
				agents,
				"tester",
				`Write tests for this spec BEFORE implementation (TDD). Tests define what "done" looks like.\n\n## Spec\n${specContent}\n\n## Codebase Context (from scout)\n${scoutContext}`,
				undefined,
				undefined,
				signal,
				undefined,
				makeDetails,
			);

			let testerContext = "";
			if (testerResult.exitCode !== 0) {
				emitProgress("write-tests", `Tester failed: ${testerResult.stderr || testerResult.errorMessage}`);
				// Non-fatal — continue without TDD tests
			} else {
				testerContext = getFinalOutput(testerResult.messages);
				emitProgress("write-tests", "Tests written (all failing as expected)");
			}

			// ── PLAN ─────────────────────────────────────────────
			emitProgress("plan", `Planning: ${specTitle}`);
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

			const planResult = await runSingleAgent(
				ctx.cwd,
				agents,
				"planner",
				plannerTask,
				undefined,
				undefined,
				signal,
				undefined,
				makeDetails,
			);
			const planOutput = getFinalOutput(planResult.messages);

			if (planResult.exitCode !== 0) {
				emitProgress("plan", `Planner failed: ${planResult.stderr || planResult.errorMessage}`);
				specFailed = true;
				throw new Error("Planner failed");
			}

			const planPath = extractPlanPath(planOutput, ctx.cwd);
			if (!planPath) {
				emitProgress("plan", "Could not extract plan path from planner output");
				specFailed = true;
				throw new Error("No plan path found");
			}

			const slug = planSlug(planPath);

			// ── REVIEW PLAN ──────────────────────────────────────
			let planApproved = false;
			for (let reviewIter = 0; reviewIter < maxReviewIterations; reviewIter++) {
				emitProgress("review-plan", `Review cycle ${reviewIter + 1}/${maxReviewIterations} for plan`);

				// Read current plan content
				let planContent: string;
				try {
					planContent = await fs.readFile(path.join(ctx.cwd, planPath), "utf-8");
				} catch {
					planContent = planOutput;
				}

				// Run all reviewers in parallel
				const reviewTasks = REVIEWER_AGENTS.map((reviewer) => ({
					agent: reviewer,
					task: [
						`---`,
						`review-target: ${slug}`,
						`review-scope: plan`,
						`---`,
						``,
						`Review the plan below. Use the metadata above for the review tool:`,
						`review({ action: "save", target: "${slug}", scope: "plan", reviewer: "your-name", verdict: "...", content: "..." })`,
						``,
						`## Spec`,
						specContent,
						``,
						`## Plan`,
						planContent,
					].join("\n"),
				}));

				await mapWithConcurrencyLimit(reviewTasks, MAX_CONCURRENCY, async (task) => {
					return runSingleAgent(
						ctx.cwd,
						agents,
						task.agent,
						task.task,
						undefined,
						undefined,
						signal,
						undefined,
						makeDetails,
					);
				});

				// Aggregate reviews
				const aggregate = await aggregateReviews({ target: slug }, ctx);
				const aggDetails = aggregate.details as any;

				if (aggDetails?.all_passed) {
					planApproved = true;
					emitProgress("review-plan", "Plan approved by all reviewers");
					break;
				}

				if (reviewIter < maxReviewIterations - 1) {
					// Feed feedback to planner for revision
					const feedbackText = aggregate.content[0]?.type === "text" ? aggregate.content[0].text : "";
					emitProgress("review-plan", "Revising plan based on review feedback...");
					await runSingleAgent(
						ctx.cwd,
						agents,
						"planner",
						`Revise the plan at ${planPath} based on review feedback:\n\n${feedbackText}\n\nOriginal spec:\n${specContent}`,
						undefined,
						undefined,
						signal,
						undefined,
						makeDetails,
					);
				}
			}

			if (!planApproved) {
				emitProgress("review-plan", "Plan not approved after max iterations — skipping spec");
				specFailed = true;
				throw new Error("Plan review failed");
			}

			// ── IMPLEMENT ────────────────────────────────────────
			emitProgress("implement", `Implementing: ${specTitle}`);
			const workerResult = await runSingleAgent(
				ctx.cwd,
				agents,
				"worker",
				`Execute the plan at ${planPath}.\n\nSpec: ${specTitle}`,
				undefined,
				undefined,
				signal,
				undefined,
				makeDetails,
			);

			if (workerResult.exitCode !== 0) {
				emitProgress("implement", `Worker failed: ${workerResult.stderr || workerResult.errorMessage}`);
				specFailed = true;
				throw new Error("Worker failed");
			}

			// ── QUALITY GATES ────────────────────────────────────
			emitProgress("quality-gates", "Running quality gates...");
			let qualityPassed = true;

			// Step 1: Run plan-specific tests first (fast feedback)
			const planTestResult = await runPlanTests({ plan: planPath }, ctx);
			const planTestDetails = planTestResult.details as any;
			if (planTestDetails?.passed === false) {
				emitProgress("quality-gates", "Plan tests failed — asking worker to fix...");
				qualityPassed = false;

				// One fix attempt
				const planTestOutput = planTestResult.content[0]?.type === "text" ? planTestResult.content[0].text : "";
				await runSingleAgent(
					ctx.cwd,
					agents,
					"worker",
					`Tests for this spec are failing. Fix the test failures.\n\nTest output:\n${planTestOutput}`,
					undefined,
					undefined,
					signal,
					undefined,
					makeDetails,
				);

				const retryResult = await runPlanTests({ plan: planPath }, ctx);
				const retryDetails = retryResult.details as any;
				if (retryDetails?.passed) {
					qualityPassed = true;
					emitProgress("quality-gates", "Plan tests passed after fix");
				} else {
					emitProgress("quality-gates", "Plan tests still failing after fix attempt");
				}
			} else {
				emitProgress("quality-gates", "Plan tests passed");
			}

			// Step 2: Run full test suite (catch regressions)
			if (qualityPassed) {
				const fullResult = await runAllTests({}, ctx);
				const fullDetails = fullResult.details as any;
				if (fullDetails?.passed === false) {
					emitProgress("quality-gates", "Full test suite has failures — asking worker to fix...");
					qualityPassed = false;

					await runSingleAgent(
						ctx.cwd,
						agents,
						"worker",
						`The full test suite is failing (regressions). Fix the failures without breaking the plan tests.`,
						undefined,
						undefined,
						signal,
						undefined,
						makeDetails,
					);

					const fullRetry = await runAllTests({}, ctx);
					const fullRetryDetails = fullRetry.details as any;
					if (fullRetryDetails?.passed) {
						qualityPassed = true;
						emitProgress("quality-gates", "Full test suite passed after fix");
					} else {
						emitProgress("quality-gates", "Full test suite still failing");
					}
				} else {
					emitProgress("quality-gates", "Full test suite passed");
				}
			}

			// Step 3: TypeScript check
			if (existsSync(path.join(ctx.cwd, "tsconfig.json"))) {
				try {
					execSync("npx tsc --noEmit", { cwd: ctx.cwd, encoding: "utf-8", timeout: 120000 });
				} catch {
					emitProgress("quality-gates", "TypeScript errors detected");
					qualityPassed = false;
				}
			}

			if (!qualityPassed) {
				emitProgress("quality-gates", "Quality gates failed — marking spec as failed");
				specFailed = true;
				throw new Error("Quality gates failed");
			}

			// ── REVIEW IMPLEMENTATION ────────────────────────────
			let implApproved = false;
			for (let reviewIter = 0; reviewIter < maxReviewIterations; reviewIter++) {
				emitProgress("review-impl", `Review cycle ${reviewIter + 1}/${maxReviewIterations} for implementation`);

				const reviewTasks = REVIEWER_AGENTS.map((reviewer) => ({
					agent: reviewer,
					task: [
						`---`,
						`review-target: ${slug}`,
						`review-scope: implementation`,
						`---`,
						``,
						`Review the implementation. Use the metadata above for the review tool:`,
						`review({ action: "save", target: "${slug}", scope: "implementation", reviewer: "your-name", verdict: "...", content: "..." })`,
						``,
						`Run git diff to see what changed.`,
						``,
						`## Spec`,
						specContent,
					].join("\n"),
				}));

				await mapWithConcurrencyLimit(reviewTasks, MAX_CONCURRENCY, async (task) => {
					return runSingleAgent(
						ctx.cwd,
						agents,
						task.agent,
						task.task,
						undefined,
						undefined,
						signal,
						undefined,
						makeDetails,
					);
				});

				const aggregate = await aggregateReviews({ target: slug }, ctx);
				const aggDetails = aggregate.details as any;

				if (aggDetails?.all_passed) {
					implApproved = true;
					emitProgress("review-impl", "Implementation approved by all reviewers");
					break;
				}

				if (reviewIter < maxReviewIterations - 1) {
					const feedbackText = aggregate.content[0]?.type === "text" ? aggregate.content[0].text : "";
					emitProgress("review-impl", "Worker addressing review feedback...");
					await runSingleAgent(
						ctx.cwd,
						agents,
						"worker",
						`Address review feedback for the implementation:\n\n${feedbackText}`,
						undefined,
						undefined,
						signal,
						undefined,
						makeDetails,
					);

					// Re-run plan tests after fixes
					const rerunResult = await runPlanTests({ plan: planPath }, ctx);
					if ((rerunResult.details as any)?.passed === false) {
						emitProgress("review-impl", "Plan tests failed after review fixes");
					}
				}
			}

			// ── CHANGELOG ────────────────────────────────────────
			if (existsSync(path.join(ctx.cwd, "CHANGELOG.md"))) {
				emitProgress("changelog", `Writing CHANGELOG entry for: ${specTitle}`);
				await runSingleAgent(
					ctx.cwd,
					agents,
					"worker",
					[
						`Add a CHANGELOG.md entry for this completed work.`,
						`Read the existing CHANGELOG.md to understand the format.`,
						`Add an entry under the [Unreleased] section (or the topmost section).`,
						``,
						`Spec: ${specTitle}`,
						`Spec type: ${(specDetails as any).type || "feature"}`,
						`Plan: ${planPath}`,
						``,
						`Keep the entry concise — one line per notable change.`,
						`Follow the existing CHANGELOG format exactly.`,
					].join("\n"),
					undefined,
					undefined,
					signal,
					undefined,
					makeDetails,
				);
			}

			// ── COMMIT ───────────────────────────────────────────
			emitProgress("commit", `Committing: ${specTitle}`);

			// Ask worker to generate a detailed commit message
			const commitMsgResult = await runSingleAgent(
				ctx.cwd,
				agents,
				"worker",
				[
					`Generate a detailed git commit message for the work just completed.`,
					`Write ONLY the commit message, nothing else.`,
					``,
					`Spec: ${specTitle}`,
					`Plan: ${planPath}`,
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

			const detailedMsg = getFinalOutput(commitMsgResult.messages) || `nightshift: ${specTitle}`;

			try {
				execSync("git add -A", { cwd: ctx.cwd, encoding: "utf-8" });
				// Use a temp file for the commit message to handle multiline + special chars
				const msgFile = path.join(ctx.cwd, ".nightshift-commit-msg.tmp");
				await fs.writeFile(msgFile, detailedMsg, "utf-8");
				execSync(`git commit -F "${msgFile}" --allow-empty`, { cwd: ctx.cwd, encoding: "utf-8" });
				try {
					await fs.unlink(msgFile);
				} catch {
					/* ignore */
				}
			} catch {
				// May already be committed by worker
				emitProgress("commit", "No new changes to commit (worker may have committed)");
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
			emitProgress("error", `Spec blocked: ${currentSpec} — ${err.message}`);
		}

		await checkpoint();
	}

	// ─── FINALIZE ────────────────────────────────────────────────
	emitProgress("finalize", "Generating report...");
	const completedAt = new Date().toISOString();

	// Count commits
	let commitCount = 0;
	try {
		const logOutput = execSync(`git log --oneline ${branchName} --not main 2>/dev/null || git log --oneline -20`, {
			cwd: ctx.cwd,
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

	await saveReport({ content: reportContent }, ctx);

	currentState = "done";
	await saveCheckpoint(ctx.cwd, {
		state: "done",
		branch: branchName,
		completed,
		failed,
		startedAt,
	});

	return {
		content: [
			{
				type: "text",
				text: [
					`Night shift complete.`,
					`Specs completed: ${completed.length}/${completed.length + failed.length}`,
					`Specs failed: ${failed.length}`,
					`Branch: ${branchName}`,
					`Commits: ${commitCount}`,
					`Duration: ${Math.round((new Date(completedAt).getTime() - new Date(startedAt).getTime()) / 60000)} minutes`,
				].join("\n"),
			},
		],
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
					return await startNightshift(params, signal, onUpdate, ctx);

				case "status": {
					const checkpoint = await readCheckpoint(ctx.cwd);
					if (!checkpoint) {
						return {
							content: [{ type: "text", text: "No active nightshift session." }],
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
			const text = result.content[0];

			if (details?.error) {
				return new Text(`${theme.fg("error", "✗")} ${details.error}`, 0, 0);
			}

			if (details?.state === "done") {
				return new Text(
					`${theme.fg("success", "✓")} Night shift complete: ${details.completed} completed, ${details.failed} failed`,
					0,
					0,
				);
			}

			return new Text(text?.type === "text" ? text.text : "", 0, 0);
		},
	});
}

export default registerNightshiftTool;

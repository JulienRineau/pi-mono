/**
 * Review Tool - Save, read, list, and aggregate review files
 *
 * File format: reviews/{target-slug}/{reviewer}.md
 * Supports multi-reviewer aggregation with verdict tracking.
 */

import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { AgentToolResult } from "@mariozechner/pi-agent-core";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import { getArtifactBaseDir, paramError } from "./validation.js";

// Types
export type ReviewVerdict = "pass" | "fail" | "conditional";
export type ReviewScope = "plan" | "implementation";

export interface ReviewDetails {
	path: string;
	filename: string;
	reviewer?: string;
	verdict?: ReviewVerdict;
	error?: string;
}

export interface AggregateResult {
	all_passed: boolean;
	verdicts: { reviewer: string; verdict: string }[];
	critical_items: string[];
	warning_items: string[];
	needs_action: string[];
}

// Schema
const ReviewParams = Type.Object({
	action: Type.Union([Type.Literal("save"), Type.Literal("read"), Type.Literal("list"), Type.Literal("aggregate")]),

	// For save
	reviewer: Type.Optional(Type.String({ description: "Reviewer name (e.g., security-reviewer)" })),
	verdict: Type.Optional(Type.String({ description: "Review verdict: pass, fail, or conditional" })),
	target: Type.Optional(Type.String({ description: "Target plan slug (e.g., add-auth)" })),
	scope: Type.Optional(Type.String({ description: "Review scope: plan or implementation" })),
	content: Type.Optional(Type.String({ description: "Review body markdown content" })),

	// For read
	review_path: Type.Optional(Type.String({ description: "Review file path to read" })),
});

export type ReviewParams = typeof ReviewParams.static;

// All known param names (for hint generation across actions)
const ALL_PARAMS = ["reviewer", "verdict", "target", "scope", "content", "review_path"];

// Tool Registration
export function registerReviewTool(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "review",
		label: "Review",
		description:
			"Save, read, list, and aggregate review files. Reviews are saved to reviews/{target-slug}/{reviewer}.md with YAML frontmatter and verdict tracking.",
		parameters: ReviewParams,

		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			switch (params.action) {
				case "save":
					return await saveReview(params, _ctx);
				case "read":
					return await readReview(params, _ctx);
				case "list":
					return await listReviews(params, _ctx);
				case "aggregate":
					return await aggregateReviews(params, _ctx);
			}
		},

		renderCall(args, _theme, _context) {
			let text = "";
			switch (args.action) {
				case "save":
					text = `review save: ${args.reviewer || "unnamed"} → ${args.verdict || "?"}`;
					if (args.target) text += ` (${args.target})`;
					break;
				case "read":
					text = `review read: ${args.review_path || "..."}`;
					break;
				case "list":
					text = `review list: ${args.target || "all"}`;
					break;
				case "aggregate":
					text = `review aggregate: ${args.target || "..."}`;
					break;
			}
			return new Text(text, 0, 0);
		},

		renderResult(result, _options, theme, _context) {
			const details = result.details as ReviewDetails | AggregateResult;
			const text = result.content[0];

			// Handle error case (ReviewDetails with error)
			if (details && "error" in details && details.error) {
				return new Text(`${theme.fg("error", "✗")} ${details.error}`, 0, 0);
			}

			// Handle aggregate result
			if (details && "all_passed" in details) {
				const agg = details as AggregateResult;
				const icon = agg.all_passed ? theme.fg("success", "✓") : theme.fg("warning", "◐");
				const verdictSummary = agg.verdicts.map((v) => `${v.reviewer}: ${v.verdict}`).join(", ");
				const lines: string[] = [];
				lines.push(`${icon} ${verdictSummary}`);
				if (agg.critical_items.length > 0) {
					lines.push(theme.fg("error", `Critical: ${agg.critical_items.length} item(s)`));
				}
				if (agg.warning_items.length > 0) {
					lines.push(theme.fg("warning", `Warnings: ${agg.warning_items.length} item(s)`));
				}
				return new Text(lines.join("\n"), 0, 0);
			}

			// Handle ReviewDetails
			if (details && "path" in details && details.path !== undefined) {
				const rd = details as ReviewDetails;
				const lines: string[] = [];
				lines.push(
					`${theme.fg("success", "✓")} ${theme.fg("accent", rd.filename)}${rd.verdict ? theme.fg("muted", ` [${rd.verdict}]`) : ""}`,
				);
				if (text?.type === "text") {
					lines.push("");
					lines.push(theme.fg("muted", text.text));
				}
				return new Text(lines.join("\n"), 0, 0);
			}

			return new Text(text?.type === "text" ? text.text : "", 0, 0);
		},
	});
}

// Helper Functions
function slugify(text: string): string {
	return text
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
}

function errorResult(error: string): AgentToolResult<ReviewDetails> {
	return {
		content: [{ type: "text", text: error }],
		details: { path: "", filename: "", error },
	};
}

function parseFrontmatter(content: string): Record<string, string> {
	const match = content.match(/^---\n([\s\S]*?)\n---/);
	if (!match) return {};
	const result: Record<string, string> = {};
	for (const line of match[1].split("\n")) {
		const idx = line.indexOf(":");
		if (idx > 0) {
			const key = line.slice(0, idx).trim();
			const value = line.slice(idx + 1).trim();
			result[key] = value;
		}
	}
	return result;
}

function extractSectionItems(content: string, sectionName: string): string[] {
	const regex = new RegExp(`^## ${sectionName}\\b`, "m");
	const match = content.search(regex);
	if (match === -1) return [];

	const afterSection = content.slice(match);
	const lines = afterSection.split("\n");
	const items: string[] = [];
	let started = false;

	for (const line of lines) {
		if (line.startsWith(`## ${sectionName}`)) {
			started = true;
			continue;
		}
		if (started && line.startsWith("## ")) {
			break;
		}
		if (started && line.startsWith("- ")) {
			items.push(line.slice(2).trim());
		}
	}
	return items;
}

// Actions
export async function saveReview(
	params: { reviewer?: string; verdict?: string; target?: string; scope?: string; content?: string },
	ctx: ExtensionContext,
): Promise<AgentToolResult<ReviewDetails>> {
	if (!params.reviewer || !params.verdict || !params.target || !params.scope || !params.content) {
		return errorResult(paramError("review", "save", ["reviewer", "verdict", "target", "scope", "content"], params, ALL_PARAMS));
	}

	const targetSlug = slugify(params.target);
	const reviewsDir = path.join(getArtifactBaseDir(ctx.cwd), "reviews", targetSlug);

	// Ensure reviews directory exists
	await fs.mkdir(reviewsDir, { recursive: true });

	const filename = `${slugify(params.reviewer)}.md`;
	const filepath = path.join(reviewsDir, filename);

	// Build frontmatter
	const frontmatter = [
		"---",
		`reviewer: ${params.reviewer}`,
		`verdict: ${params.verdict}`,
		`target: ${params.target}`,
		`scope: ${params.scope}`,
		`reviewed-at: ${new Date().toISOString()}`,
		"---",
	].join("\n");

	const fullContent = `${frontmatter}\n\n${params.content}`;

	// Run validation script before writing — check both cwd and project root
	let scriptPath = path.join(ctx.cwd, "scripts", "validate-review.sh");
	const piIdx = ctx.cwd.indexOf("/.pi/nightshift/");
	if (!existsSync(scriptPath) && piIdx !== -1) {
		scriptPath = path.join(ctx.cwd.slice(0, piIdx), "scripts", "validate-review.sh");
	}
	if (existsSync(scriptPath)) {
		try {
			execSync(`bash "${scriptPath}" -`, {
				input: fullContent,
				encoding: "utf-8",
				stdio: ["pipe", "pipe", "pipe"],
			});
		} catch (e: any) {
			const stderr = e.stderr || e.message || "Validation failed";
			return errorResult(`Validation failed:\n${stderr}`);
		}
	}

	// Write the file (overwrites if reviewer already reviewed this target)
	await fs.writeFile(filepath, fullContent, "utf-8");

	const reviewDetails: ReviewDetails = {
		path: filepath,
		filename,
		reviewer: params.reviewer,
		verdict: params.verdict as ReviewVerdict,
	};

	return {
		content: [{ type: "text", text: `Review saved to: reviews/${targetSlug}/${filename}` }],
		details: reviewDetails,
	};
}

async function readReview(
	params: { review_path?: string },
	ctx: ExtensionContext,
): Promise<AgentToolResult<ReviewDetails>> {
	if (!params.review_path) {
		return errorResult(paramError("review", "read", ["review_path"], params, ALL_PARAMS));
	}

	const filepath = path.isAbsolute(params.review_path) ? params.review_path : path.join(ctx.cwd, params.review_path);

	if (!existsSync(filepath)) {
		return errorResult(`Review not found: ${params.review_path}`);
	}

	const content = await fs.readFile(filepath, "utf-8");
	const filename = path.basename(filepath);
	const frontmatter = parseFrontmatter(content);

	const reviewDetails: ReviewDetails = {
		path: filepath,
		filename,
		reviewer: frontmatter.reviewer,
		verdict: frontmatter.verdict as ReviewVerdict | undefined,
	};

	return {
		content: [{ type: "text", text: content }],
		details: reviewDetails,
	};
}

async function listReviews(
	params: { target?: string },
	ctx: ExtensionContext,
): Promise<AgentToolResult<ReviewDetails>> {
	if (!params.target) {
		return errorResult(paramError("review", "list", ["target"], params, ALL_PARAMS));
	}

	const targetSlug = slugify(params.target);
	const reviewsDir = path.join(getArtifactBaseDir(ctx.cwd), "reviews", targetSlug);

	if (!existsSync(reviewsDir)) {
		return {
			content: [{ type: "text", text: `No reviews found for target: ${params.target}` }],
			details: { path: reviewsDir, filename: "0 reviews" },
		};
	}

	const files = await fs.readdir(reviewsDir);
	const reviews = files.filter((f) => f.endsWith(".md")).sort();

	if (reviews.length === 0) {
		return {
			content: [{ type: "text", text: `No reviews found for target: ${params.target}` }],
			details: { path: reviewsDir, filename: "0 reviews" },
		};
	}

	const summaries: string[] = [];
	for (const f of reviews) {
		const content = await fs.readFile(path.join(reviewsDir, f), "utf-8");
		const fm = parseFrontmatter(content);
		const reviewer = fm.reviewer || f.replace(/\.md$/, "");
		const verdict = fm.verdict || "unknown";
		summaries.push(`- ${reviewer}: ${verdict}`);
	}

	return {
		content: [{ type: "text", text: `Reviews for ${params.target}:\n\n${summaries.join("\n")}` }],
		details: { path: reviewsDir, filename: `${reviews.length} reviews` },
	};
}

export async function aggregateReviews(
	params: { target?: string },
	ctx: ExtensionContext,
	basePath?: string,
): Promise<AgentToolResult<AggregateResult>> {
	if (!params.target) {
		return {
			content: [{ type: "text", text: paramError("review", "aggregate", ["target"], params as Record<string, unknown>, ALL_PARAMS) }],
			details: {
				all_passed: false,
				verdicts: [],
				critical_items: [],
				warning_items: [],
				needs_action: [],
			},
		};
	}

	const targetSlug = slugify(params.target);
	const reviewsDir = path.join(basePath ?? ctx.cwd, "reviews", targetSlug);

	if (!existsSync(reviewsDir)) {
		return {
			content: [{ type: "text", text: `No reviews found for target: ${params.target}` }],
			details: {
				all_passed: false,
				verdicts: [],
				critical_items: [],
				warning_items: [],
				needs_action: [],
			},
		};
	}

	const files = await fs.readdir(reviewsDir);
	const mdFiles = files.filter((f) => f.endsWith(".md")).sort();

	const verdicts: { reviewer: string; verdict: string }[] = [];
	const critical_items: string[] = [];
	const warning_items: string[] = [];
	const needs_action: string[] = [];

	for (const f of mdFiles) {
		const content = await fs.readFile(path.join(reviewsDir, f), "utf-8");
		const fm = parseFrontmatter(content);
		const reviewer = fm.reviewer || f.replace(/\.md$/, "");
		const verdict = fm.verdict || "unknown";

		verdicts.push({ reviewer, verdict });

		if (verdict !== "pass") {
			needs_action.push(reviewer);
		}

		// Extract items from ## Critical and ## Warnings sections
		const criticals = extractSectionItems(content, "Critical");
		for (const item of criticals) {
			critical_items.push(`[${reviewer}] ${item}`);
		}

		const warnings = extractSectionItems(content, "Warnings");
		for (const item of warnings) {
			warning_items.push(`[${reviewer}] ${item}`);
		}
	}

	const all_passed = verdicts.length > 0 && verdicts.every((v) => v.verdict === "pass");

	const aggregate: AggregateResult = {
		all_passed,
		verdicts,
		critical_items,
		warning_items,
		needs_action,
	};

	const lines: string[] = [];
	lines.push(`Aggregate for ${params.target}:`);
	lines.push(`Overall: ${all_passed ? "PASSED" : "NEEDS ACTION"}`);
	lines.push("");
	lines.push("Verdicts:");
	for (const v of verdicts) {
		lines.push(`  ${v.reviewer}: ${v.verdict}`);
	}
	if (critical_items.length > 0) {
		lines.push("");
		lines.push("Critical items:");
		for (const item of critical_items) {
			lines.push(`  - ${item}`);
		}
	}
	if (warning_items.length > 0) {
		lines.push("");
		lines.push("Warning items:");
		for (const item of warning_items) {
			lines.push(`  - ${item}`);
		}
	}
	if (needs_action.length > 0) {
		lines.push("");
		lines.push(`Needs action from: ${needs_action.join(", ")}`);
	}

	return {
		content: [{ type: "text", text: lines.join("\n") }],
		details: aggregate,
	};
}

// Default export for easy import
export default registerReviewTool;

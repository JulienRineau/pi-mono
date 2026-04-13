/**
 * Plan Tool - Create, read, and update plan files
 *
 * File format: plans/{YYYY-MM-DD}-{task-name}-v{version}.md
 * Protected: Auto-increments version if file exists.
 */

import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { AgentToolResult } from "@mariozechner/pi-agent-core";
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import { getArtifactBaseDir, paramError } from "./validation.js";

// Types
export type PlanStatus = "draft" | "approved" | "in-progress" | "completed" | "abandoned";

export interface PlanDetails {
	path: string;
	filename: string;
	version: number;
	status?: PlanStatus;
	error?: string;
}

// Schema
const PlanParams = Type.Object({
	action: Type.Union([
		Type.Literal("save"),
		Type.Literal("update"),
		Type.Literal("update-status"),
		Type.Literal("read"),
		Type.Literal("list"),
	]),

	// For save
	plan_name: Type.Optional(Type.String({ description: "URL-safe name (e.g., add-auth)" })),
	content: Type.Optional(Type.String({ description: "Plan markdown content" })),
	version: Type.Optional(Type.Integer({ description: "Version number (auto-increments if exists)" })),

	// For update-status
	name: Type.Optional(Type.String({ description: "Plan name (without date/version)" })),
	status: Type.Optional(
		Type.String({ description: "Plan status: draft, approved, in-progress, completed, abandoned" }),
	),

	// For read and update
	plan_path: Type.Optional(Type.String({ description: "Plan file path to read or update" })),
});

export type PlanParams = typeof PlanParams.static;

// All known param names (for hint generation across actions)
const ALL_PARAMS = ["plan_name", "content", "version", "name", "status", "plan_path"];

// Tool Registration
export function registerPlanTool(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "plan",
		label: "Plan",
		description:
			"Create, read, and update plan files. Plans are saved to plans/{YYYY-MM-DD}-{name}-v{n}.md with automatic version increment.",
		parameters: PlanParams,

		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			switch (params.action) {
				case "save":
					return await savePlan(params, _ctx);
				case "update":
					return await updatePlan(params, _ctx);
				case "update-status":
					return await updateStatus(params, _ctx);
				case "read":
					return await readPlan(params, _ctx);
				case "list":
					return await listPlans(params, _ctx);
			}
		},

		renderCall(args, _theme, _context) {
			let text = "";
			switch (args.action) {
				case "save":
					text = `plan save: ${args.plan_name || "unnamed"}`;
					if (args.version) text += ` (v${args.version})`;
					break;
				case "update":
					text = `plan update: ${args.plan_path || "..."}`;
					break;
				case "update-status":
					text = `plan status: ${args.name} → ${args.status}`;
					break;
				case "read":
					text = `plan read: ${args.plan_path || "..."}`;
					break;
				case "list":
					text = "plan list";
					break;
			}
			return new Text(text, 0, 0);
		},

		renderResult(result, _options, theme, _context) {
			const details = result.details as PlanDetails;
			const text = result.content[0];

			if (details.error) {
				return new Text(`${theme.fg("error", "✗")} ${details.error}`, 0, 0);
			}

			if (!details || details.path === undefined) {
				return new Text(text?.type === "text" ? text.text : "", 0, 0);
			}

			const lines: string[] = [];
			lines.push(
				`${theme.fg("success", "✓")} ${theme.fg("accent", details.filename)} ${theme.fg("muted", ` (v${details.version})`)}`,
			);

			if (text?.type === "text") {
				lines.push("");
				lines.push(theme.fg("muted", text.text));
			}

			return new Text(lines.join("\n"), 0, 0);
		},
	});
}

// Helper Functions
function generateFilename(date: string, name: string, version: number): string {
	return `${date}-${name}-v${version}.md`;
}

function slugify(text: string): string {
	return text
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
}

function errorResult(error: string): AgentToolResult<PlanDetails> {
	return {
		content: [{ type: "text", text: error }],
		details: { path: "", filename: "", version: 0, error },
	};
}

function findValidateScript(ctx: ExtensionContext): string | null {
	// Check both ctx.cwd (may be run directory) and project root
	const searchRoots = [ctx.cwd];
	// If cwd is inside .pi/nightshift/, also check the project root
	const piIdx = ctx.cwd.indexOf("/.pi/nightshift/");
	if (piIdx !== -1) searchRoots.push(ctx.cwd.slice(0, piIdx));

	for (const root of searchRoots) {
		const candidates = [
			path.join(root, ".pi/extensions/subagent/scripts/validate-plan.sh"),
			path.join(root, "scripts/validate-plan.sh"),
		];
		for (const c of candidates) {
			if (existsSync(c)) return c;
		}
	}
	return null;
}

function validatePlanContent(content: string, ctx: ExtensionContext): { valid: boolean; output: string } {
	const script = findValidateScript(ctx);
	if (!script) return { valid: true, output: "Validation skipped: script not found" };
	try {
		const output = execSync(`bash "${script}" -`, { input: content, encoding: "utf-8", timeout: 10000 });
		return { valid: true, output: output.trim() };
	} catch (err: any) {
		return { valid: false, output: (err.stderr || err.stdout || err.message || "").toString().trim() };
	}
}

// Actions
async function savePlan(
	params: { plan_name?: string; content?: string; version?: number },
	ctx: ExtensionContext,
): Promise<AgentToolResult<PlanDetails>> {
	if (!params.plan_name || !params.content) {
		return errorResult(paramError("plan", "save", ["plan_name", "content"], params, ALL_PARAMS));
	}

	const plansDir = path.join(getArtifactBaseDir(ctx.cwd), "plans");

	// Ensure plans directory exists
	await fs.mkdir(plansDir, { recursive: true });

	// Generate filename
	const date = new Date().toISOString().split("T")[0];
	const safeName = slugify(params.plan_name);
	let version = params.version ?? 1;

	// Find available version
	let filename = generateFilename(date, safeName, version);
	let filepath = path.join(plansDir, filename);

	while (existsSync(filepath)) {
		version++;
		filename = generateFilename(date, safeName, version);
		filepath = path.join(plansDir, filename);
	}

	// Add metadata to content if not present
	let content = params.content;
	const now = new Date().toISOString().split("T")[0];

	if (!content.includes("**Created:**")) {
		content = content.replace(/^#.*$/m, `# ${params.plan_name}\n\n**Created:** ${now}\n**Status:** draft\n`);
	} else {
		content = content.replace(/\*\*Created:\*\*.*$/m, `**Created:** ${now}`);
	}

	if (!content.includes("**Version:**")) {
		// Insert version after status line
		content = content.replace(/(^\*\*Status:\*\*.*)$/m, `$1\n**Version:** v${version}`);
	} else {
		content = content.replace(/\*\*Version:\*\*.*$/m, `**Version:** v${version}`);
	}

	// Validate plan content
	const validation = validatePlanContent(content, ctx);
	if (!validation.valid) {
		return errorResult(`Validation failed:\n${validation.output}`);
	}

	// Write the file
	await fs.writeFile(filepath, content, "utf-8");

	const planDetails: PlanDetails = {
		path: filepath,
		filename,
		version,
		status: "draft",
	};

	return {
		content: [{ type: "text", text: `Plan saved to: ${filename}` }],
		details: planDetails,
	};
}

async function updatePlan(
	params: { plan_path?: string; content?: string },
	ctx: ExtensionContext,
): Promise<AgentToolResult<PlanDetails>> {
	if (!params.plan_path || !params.content) {
		return errorResult(paramError("plan", "update", ["plan_path", "content"], params, ALL_PARAMS));
	}

	const filepath = path.isAbsolute(params.plan_path) ? params.plan_path : path.join(ctx.cwd, params.plan_path);

	if (!existsSync(filepath)) {
		return errorResult(`Plan not found: ${params.plan_path}`);
	}

	await fs.writeFile(filepath, params.content, "utf-8");

	const filename = path.basename(filepath);
	const versionMatch = filename.match(/-v(\d+)\.md$/);
	const version = versionMatch ? parseInt(versionMatch[1], 10) : 1;
	const statusMatch = params.content.match(/\*\*Status:\*\* ([\w-]+)/);
	const status = statusMatch ? (statusMatch[1] as PlanStatus) : undefined;

	return {
		content: [{ type: "text", text: `Plan updated: ${filename}` }],
		details: { path: filepath, filename, version, status },
	};
}

async function updateStatus(
	params: { name?: string; status?: string },
	ctx: ExtensionContext,
): Promise<AgentToolResult<PlanDetails>> {
	if (!params.name || !params.status) {
		return errorResult(paramError("plan", "update-status", ["name", "status"], params, ALL_PARAMS));
	}

	const plansDir = path.join(getArtifactBaseDir(ctx.cwd), "plans");

	if (!existsSync(plansDir)) {
		return errorResult("No plans directory exists");
	}

	// Find the plan file
	const safeName = slugify(params.name);
	const files = await fs.readdir(plansDir);
	const planFile = files.find((f) => f.includes(`-${safeName}-`) && f.endsWith(".md"));

	if (!planFile) {
		return errorResult(`Plan not found: ${params.name}`);
	}

	const filepath = path.join(plansDir, planFile);
	let content = await fs.readFile(filepath, "utf-8");

	// Update status line
	content = content.replace(/\*\*Status:\*\*.*$/m, `**Status:** ${params.status}`);

	await fs.writeFile(filepath, content, "utf-8");

	// Parse version from filename
	const versionMatch = planFile.match(/-v(\d+)\.md$/);
	const version = versionMatch ? parseInt(versionMatch[1], 10) : 1;

	const planDetails: PlanDetails = {
		path: filepath,
		filename: planFile,
		version,
		status: params.status as PlanStatus,
	};

	return {
		content: [{ type: "text", text: `Status updated to: ${params.status}` }],
		details: planDetails,
	};
}

async function readPlan(params: { plan_path?: string }, ctx: ExtensionContext): Promise<AgentToolResult<PlanDetails>> {
	if (!params.plan_path) {
		return errorResult(paramError("plan", "read", ["plan_path"], params, ALL_PARAMS));
	}

	const filepath = path.isAbsolute(params.plan_path) ? params.plan_path : path.join(ctx.cwd, params.plan_path);

	if (!existsSync(filepath)) {
		return errorResult(`Plan not found: ${params.plan_path}`);
	}

	const content = await fs.readFile(filepath, "utf-8");
	const filename = path.basename(filepath);
	const versionMatch = filename.match(/-v(\d+)\.md$/);
	const version = versionMatch ? parseInt(versionMatch[1], 10) : 1;

	// Extract status
	const statusMatch = content.match(/\*\*Status:\*\* (\w+)/);
	const status = statusMatch ? (statusMatch[1] as PlanStatus) : undefined;

	const planDetails: PlanDetails = {
		path: filepath,
		filename,
		version,
		status,
	};

	return {
		content: [{ type: "text", text: content }],
		details: planDetails,
	};
}

async function listPlans(_params: any, ctx: ExtensionContext): Promise<AgentToolResult<PlanDetails>> {
	const plansDir = path.join(getArtifactBaseDir(ctx.cwd), "plans");

	if (!existsSync(plansDir)) {
		return {
			content: [{ type: "text", text: "No plans directory exists yet." }],
			details: { path: plansDir, filename: "0 plans", version: 0 },
		};
	}

	const files = await fs.readdir(plansDir);
	const plans = files
		.filter((f) => f.endsWith(".md"))
		.sort()
		.reverse();

	if (plans.length === 0) {
		return {
			content: [{ type: "text", text: "No plans found." }],
			details: { path: plansDir, filename: "0 plans", version: 0 },
		};
	}

	const list = plans
		.map((f) => {
			// Extract info from filename
			const match = f.match(/^(\d{4}-\d{2}-\d{2})-(.+)-v(\d+)\.md$/);
			if (match) {
				const [, date, name, version] = match;
				return `- ${date} ${name} (v${version})`;
			}
			return `- ${f}`;
		})
		.join("\n");

	return {
		content: [{ type: "text", text: `Available plans:\n\n${list}` }],
		details: { path: plansDir, filename: `${plans.length} plans`, version: 0 },
	};
}

// Import ExtensionAPI for tool registration
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

// Default export for easy import
export default registerPlanTool;

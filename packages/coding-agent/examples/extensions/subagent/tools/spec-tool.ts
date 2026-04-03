/**
 * Spec Tool - Create, read, list, and manage specification files
 *
 * File format: specs/{YYYY-MM-DD}-{slug}.md
 * Specs use YAML frontmatter for metadata (title, type, priority, status, created).
 */

import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { AgentToolResult } from "@mariozechner/pi-agent-core";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { parseFrontmatter } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";

// Types
export type SpecType = "bug" | "feature" | "refactor";
export type SpecPriority = "critical" | "high" | "medium" | "low";
export type SpecStatus = "draft" | "ready" | "in-progress" | "done" | "archived";

export interface SpecFrontmatter {
	[key: string]: unknown;
	title: string;
	type: SpecType;
	priority: SpecPriority;
	status: SpecStatus;
	created: string;
}

export interface SpecDetails {
	path: string;
	filename: string;
	title?: string;
	type?: SpecType;
	priority?: SpecPriority;
	status?: SpecStatus;
	error?: string;
}

// Schema
const SpecParams = Type.Object({
	action: Type.Union([
		Type.Literal("save"),
		Type.Literal("read"),
		Type.Literal("list"),
		Type.Literal("update-status"),
		Type.Literal("pick-next"),
	]),

	// For save
	spec_name: Type.Optional(Type.String({ description: "URL-safe spec name (e.g., fix-auth-race)" })),
	content: Type.Optional(Type.String({ description: "Spec markdown content with YAML frontmatter" })),

	// For update-status
	status: Type.Optional(Type.String({ description: "Spec status: draft, ready, in-progress, done, archived" })),

	// For read, update-status
	spec_path: Type.Optional(Type.String({ description: "Spec file path to read or update" })),

	// For list
	filter_status: Type.Optional(Type.String({ description: "Filter specs by status" })),
});

export type SpecParams = typeof SpecParams.static;

// Priority sort order (lower index = higher priority)
const PRIORITY_ORDER: Record<string, number> = {
	critical: 0,
	high: 1,
	medium: 2,
	low: 3,
};

// Valid status transitions
const VALID_TRANSITIONS: Record<string, string[]> = {
	draft: ["ready"],
	ready: ["in-progress"],
	"in-progress": ["done", "blocked"],
	blocked: ["ready"],
	done: ["archived"],
};

// Tool Registration
export function registerSpecTool(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "spec",
		label: "Spec",
		description:
			"Create, read, list, and manage specification files. Specs are saved to specs/{YYYY-MM-DD}-{slug}.md with YAML frontmatter.",
		parameters: SpecParams,

		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			switch (params.action) {
				case "save":
					return await saveSpec(params, _ctx);
				case "read":
					return await readSpec(params, _ctx);
				case "list":
					return await listSpecs(params, _ctx);
				case "update-status":
					return await updateSpecStatus(params, _ctx);
				case "pick-next":
					return await pickNextSpec(params, _ctx);
			}
		},

		renderCall(args, _theme, _context) {
			let text = "";
			switch (args.action) {
				case "save":
					text = `spec save: ${args.spec_name || "unnamed"}`;
					break;
				case "read":
					text = `spec read: ${args.spec_path || "..."}`;
					break;
				case "list":
					text = args.filter_status ? `spec list (status: ${args.filter_status})` : "spec list";
					break;
				case "update-status":
					text = `spec status: ${args.spec_path || "..."} → ${args.status}`;
					break;
				case "pick-next":
					text = "spec pick-next";
					break;
			}
			return new Text(text, 0, 0);
		},

		renderResult(result, _options, theme, _context) {
			const details = result.details as SpecDetails;
			const text = result.content[0];

			if (details?.error) {
				return new Text(`${theme.fg("error", "✗")} ${details.error}`, 0, 0);
			}

			if (!details || details.path === undefined) {
				return new Text(text?.type === "text" ? text.text : "", 0, 0);
			}

			const lines: string[] = [];
			const meta: string[] = [];
			if (details.type) meta.push(details.type);
			if (details.priority) meta.push(details.priority);
			if (details.status) meta.push(details.status);
			const metaStr = meta.length > 0 ? ` (${meta.join(", ")})` : "";

			lines.push(`${theme.fg("success", "✓")} ${theme.fg("accent", details.filename)}${theme.fg("muted", metaStr)}`);

			if (text?.type === "text") {
				lines.push("");
				lines.push(theme.fg("muted", text.text));
			}

			return new Text(lines.join("\n"), 0, 0);
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

function errorResult(error: string): AgentToolResult<SpecDetails> {
	return {
		content: [{ type: "text", text: error }],
		details: { path: "", filename: "", error },
	};
}

function findValidateScript(cwd: string): string | null {
	const candidates = [
		path.join(cwd, ".pi", "extensions", "subagent", "scripts", "validate-spec.sh"),
		path.join(cwd, "scripts", "validate-spec.sh"),
	];
	for (const candidate of candidates) {
		if (existsSync(candidate)) {
			return candidate;
		}
	}
	return null;
}

function parseSpecFrontmatter(content: string): Partial<SpecFrontmatter> {
	const { frontmatter } = parseFrontmatter<SpecFrontmatter>(content);
	return frontmatter;
}

// Actions
export async function saveSpec(
	params: { spec_name?: string; content?: string },
	ctx: ExtensionContext,
): Promise<AgentToolResult<SpecDetails>> {
	if (!params.spec_name || !params.content) {
		return errorResult("Error: spec_name and content are required for save");
	}

	const specsDir = path.join(ctx.cwd, "specs");

	// Run validation gate before writing
	const validateScript = findValidateScript(ctx.cwd);
	if (validateScript) {
		try {
			execSync(`bash "${validateScript}" -`, {
				input: params.content,
				encoding: "utf-8",
				stdio: ["pipe", "pipe", "pipe"],
			});
		} catch (err: any) {
			const stderr = err.stderr || "";
			const stdout = err.stdout || "";
			const output = [stderr.trim(), stdout.trim()].filter(Boolean).join("\n");
			return errorResult(`Validation failed:\n${output}`);
		}
	}

	// Ensure specs directory exists
	await fs.mkdir(specsDir, { recursive: true });

	// Generate filename
	const date = new Date().toISOString().split("T")[0];
	const safeName = slugify(params.spec_name);
	const filename = `${date}-${safeName}.md`;
	const filepath = path.join(specsDir, filename);

	// Write the file
	await fs.writeFile(filepath, params.content, "utf-8");

	// Parse frontmatter for details
	const fm = parseSpecFrontmatter(params.content);

	const specDetails: SpecDetails = {
		path: filepath,
		filename,
		title: fm.title,
		type: fm.type,
		priority: fm.priority,
		status: fm.status,
	};

	return {
		content: [{ type: "text", text: `Spec saved to: ${filename}` }],
		details: specDetails,
	};
}

export async function readSpec(
	params: { spec_path?: string },
	ctx: ExtensionContext,
): Promise<AgentToolResult<SpecDetails>> {
	if (!params.spec_path) {
		return errorResult("Error: spec_path is required");
	}

	const filepath = path.isAbsolute(params.spec_path) ? params.spec_path : path.join(ctx.cwd, params.spec_path);

	if (!existsSync(filepath)) {
		return errorResult(`Spec not found: ${params.spec_path}`);
	}

	const content = await fs.readFile(filepath, "utf-8");
	const filename = path.basename(filepath);
	const fm = parseSpecFrontmatter(content);

	const specDetails: SpecDetails = {
		path: filepath,
		filename,
		title: fm.title,
		type: fm.type,
		priority: fm.priority,
		status: fm.status,
	};

	return {
		content: [{ type: "text", text: content }],
		details: specDetails,
	};
}

export async function listSpecs(
	params: { filter_status?: string },
	ctx: ExtensionContext,
): Promise<AgentToolResult<SpecDetails>> {
	const specsDir = path.join(ctx.cwd, "specs");

	if (!existsSync(specsDir)) {
		return {
			content: [{ type: "text", text: "No specs directory exists yet." }],
			details: { path: specsDir, filename: "0 specs" },
		};
	}

	const files = await fs.readdir(specsDir);
	const mdFiles = files.filter((f) => f.endsWith(".md")).sort();

	if (mdFiles.length === 0) {
		return {
			content: [{ type: "text", text: "No specs found." }],
			details: { path: specsDir, filename: "0 specs" },
		};
	}

	// Parse all specs
	const specs: Array<{ filename: string; fm: Partial<SpecFrontmatter> }> = [];
	for (const file of mdFiles) {
		try {
			const content = await fs.readFile(path.join(specsDir, file), "utf-8");
			const fm = parseSpecFrontmatter(content);
			specs.push({ filename: file, fm });
		} catch {
			specs.push({ filename: file, fm: {} });
		}
	}

	// Filter by status if requested
	const filtered = params.filter_status ? specs.filter((s) => s.fm.status === params.filter_status) : specs;

	// Sort: bugs first, then by priority
	filtered.sort((a, b) => {
		// Bugs first
		const aIsBug = a.fm.type === "bug" ? 0 : 1;
		const bIsBug = b.fm.type === "bug" ? 0 : 1;
		if (aIsBug !== bIsBug) return aIsBug - bIsBug;

		// Then by priority
		const aPri = PRIORITY_ORDER[a.fm.priority || "low"] ?? 3;
		const bPri = PRIORITY_ORDER[b.fm.priority || "low"] ?? 3;
		return aPri - bPri;
	});

	const list = filtered
		.map((s) => {
			const parts: string[] = [`- ${s.filename}`];
			if (s.fm.title) parts.push(`"${s.fm.title}"`);
			const meta: string[] = [];
			if (s.fm.type) meta.push(s.fm.type);
			if (s.fm.priority) meta.push(s.fm.priority);
			if (s.fm.status) meta.push(s.fm.status);
			if (meta.length > 0) parts.push(`[${meta.join(", ")}]`);
			return parts.join(" ");
		})
		.join("\n");

	return {
		content: [{ type: "text", text: `Specs (${filtered.length}):\n\n${list}` }],
		details: { path: specsDir, filename: `${filtered.length} specs` },
	};
}

export async function updateSpecStatus(
	params: { spec_path?: string; status?: string },
	ctx: ExtensionContext,
): Promise<AgentToolResult<SpecDetails>> {
	if (!params.spec_path || !params.status) {
		return errorResult("Error: spec_path and status are required");
	}

	const filepath = path.isAbsolute(params.spec_path) ? params.spec_path : path.join(ctx.cwd, params.spec_path);

	if (!existsSync(filepath)) {
		return errorResult(`Spec not found: ${params.spec_path}`);
	}

	let content = await fs.readFile(filepath, "utf-8");
	const fm = parseSpecFrontmatter(content);
	const currentStatus = fm.status;

	// Validate transition
	if (currentStatus) {
		const allowed = VALID_TRANSITIONS[currentStatus];
		if (allowed && !allowed.includes(params.status)) {
			return errorResult(
				`Invalid status transition: ${currentStatus} → ${params.status}. Allowed: ${allowed.join(", ")}`,
			);
		}
	}

	// Update the status line in frontmatter
	content = content.replace(/^(status:\s*).+$/m, `$1${params.status}`);

	await fs.writeFile(filepath, content, "utf-8");

	const filename = path.basename(filepath);
	const updatedFm = parseSpecFrontmatter(content);

	const specDetails: SpecDetails = {
		path: filepath,
		filename,
		title: updatedFm.title,
		type: updatedFm.type,
		priority: updatedFm.priority,
		status: updatedFm.status,
	};

	return {
		content: [{ type: "text", text: `Status updated: ${currentStatus || "unknown"} → ${params.status}` }],
		details: specDetails,
	};
}

export async function pickNextSpec(
	_params: Record<string, unknown>,
	ctx: ExtensionContext,
): Promise<AgentToolResult<SpecDetails>> {
	const specsDir = path.join(ctx.cwd, "specs");

	if (!existsSync(specsDir)) {
		return {
			content: [{ type: "text", text: "No specs directory exists. Queue is empty." }],
			details: { path: specsDir, filename: "" },
		};
	}

	const files = await fs.readdir(specsDir);
	const mdFiles = files.filter((f) => f.endsWith(".md"));

	// Parse and filter for status: ready
	const readySpecs: Array<{ filename: string; filepath: string; fm: Partial<SpecFrontmatter> }> = [];
	for (const file of mdFiles) {
		try {
			const filepath = path.join(specsDir, file);
			const content = await fs.readFile(filepath, "utf-8");
			const fm = parseSpecFrontmatter(content);
			if (fm.status === "ready") {
				readySpecs.push({ filename: file, filepath, fm });
			}
		} catch {
			// Skip unreadable files
		}
	}

	if (readySpecs.length === 0) {
		return {
			content: [{ type: "text", text: "No specs with status 'ready'. Queue is empty." }],
			details: { path: specsDir, filename: "" },
		};
	}

	// Sort: bugs first, then by priority
	readySpecs.sort((a, b) => {
		const aIsBug = a.fm.type === "bug" ? 0 : 1;
		const bIsBug = b.fm.type === "bug" ? 0 : 1;
		if (aIsBug !== bIsBug) return aIsBug - bIsBug;

		const aPri = PRIORITY_ORDER[a.fm.priority || "low"] ?? 3;
		const bPri = PRIORITY_ORDER[b.fm.priority || "low"] ?? 3;
		return aPri - bPri;
	});

	const picked = readySpecs[0];

	const specDetails: SpecDetails = {
		path: picked.filepath,
		filename: picked.filename,
		title: picked.fm.title,
		type: picked.fm.type,
		priority: picked.fm.priority,
		status: picked.fm.status,
	};

	return {
		content: [{ type: "text", text: `Next spec: ${picked.filename} (${picked.fm.type}, ${picked.fm.priority})` }],
		details: specDetails,
	};
}

// Default export for easy import
export default registerSpecTool;

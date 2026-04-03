/**
 * Report Tool - Create, read, and list nightshift session reports
 *
 * File format: reports/{YYYY-MM-DD}-nightshift.md
 * Validates content with validate-report.sh before writing.
 */

import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { AgentToolResult } from "@mariozechner/pi-agent-core";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";

// Types
export interface ReportDetails {
	path: string;
	filename: string;
	session?: string;
	error?: string;
}

// Schema
const ReportParams = Type.Object({
	action: Type.Union([Type.Literal("save"), Type.Literal("read"), Type.Literal("list")]),

	// For save
	content: Type.Optional(Type.String({ description: "Report markdown content with YAML frontmatter" })),

	// For read
	report_path: Type.Optional(Type.String({ description: "Report file path to read" })),
});

export type ReportParams = typeof ReportParams.static;

// Tool Registration
export function registerReportTool(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "report",
		label: "Report",
		description:
			"Create, read, and list nightshift session reports. Reports are saved to reports/{YYYY-MM-DD}-nightshift.md with YAML frontmatter validation.",
		parameters: ReportParams,

		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			switch (params.action) {
				case "save":
					return await saveReport(params, _ctx);
				case "read":
					return await readReport(params, _ctx);
				case "list":
					return await listReports(params, _ctx);
			}
		},

		renderCall(args, _theme, _context) {
			let text = "";
			switch (args.action) {
				case "save":
					text = "report save";
					break;
				case "read":
					text = `report read: ${args.report_path || "..."}`;
					break;
				case "list":
					text = "report list";
					break;
			}
			return new Text(text, 0, 0);
		},

		renderResult(result, _options, theme, _context) {
			const details = result.details as ReportDetails;
			const text = result.content[0];

			if (details.error) {
				return new Text(`${theme.fg("error", "✗")} ${details.error}`, 0, 0);
			}

			if (!details || details.path === undefined) {
				return new Text(text?.type === "text" ? text.text : "", 0, 0);
			}

			const lines: string[] = [];
			lines.push(`${theme.fg("success", "✓")} ${theme.fg("accent", details.filename)}`);

			if (details.session) {
				lines.push(theme.fg("muted", `session: ${details.session}`));
			}

			if (text?.type === "text") {
				lines.push("");
				lines.push(theme.fg("muted", text.text));
			}

			return new Text(lines.join("\n"), 0, 0);
		},
	});
}

// Helper Functions
function errorResult(error: string): AgentToolResult<ReportDetails> {
	return {
		content: [{ type: "text", text: error }],
		details: { path: "", filename: "", error },
	};
}

function findValidateScript(ctx: ExtensionContext): string | null {
	const candidates = [
		path.join(ctx.cwd, ".pi/extensions/subagent/scripts/validate-report.sh"),
		path.join(ctx.cwd, "scripts/validate-report.sh"),
	];
	for (const c of candidates) {
		if (existsSync(c)) return c;
	}
	return null;
}

function validateReportContent(content: string, ctx: ExtensionContext): { valid: boolean; output: string } {
	const script = findValidateScript(ctx);
	if (!script) return { valid: true, output: "Validation skipped: script not found" };
	try {
		const output = execSync(`bash "${script}" -`, { input: content, encoding: "utf-8", timeout: 10000 });
		return { valid: true, output: output.trim() };
	} catch (err: any) {
		return { valid: false, output: (err.stderr || err.stdout || err.message || "").toString().trim() };
	}
}

function extractFrontmatterField(content: string, field: string): string | undefined {
	const match = content.match(new RegExp(`^${field}:\\s*(.+)$`, "m"));
	return match ? match[1].trim() : undefined;
}

// Actions
export async function saveReport(
	params: { content?: string },
	ctx: ExtensionContext,
): Promise<AgentToolResult<ReportDetails>> {
	if (!params.content) {
		return errorResult("Error: content is required for save");
	}

	const reportsDir = path.join(ctx.cwd, "reports");

	// Ensure reports directory exists
	await fs.mkdir(reportsDir, { recursive: true });

	// Generate filename
	const date = new Date().toISOString().split("T")[0];
	const filename = `${date}-nightshift.md`;
	const filepath = path.join(reportsDir, filename);

	// Validate report content
	const validation = validateReportContent(params.content, ctx);
	if (!validation.valid) {
		return errorResult(`Validation failed:\n${validation.output}`);
	}

	// Write the file
	await fs.writeFile(filepath, params.content, "utf-8");

	const session = extractFrontmatterField(params.content, "session");

	const reportDetails: ReportDetails = {
		path: filepath,
		filename,
		session,
	};

	return {
		content: [{ type: "text", text: `Report saved to: ${filename}` }],
		details: reportDetails,
	};
}

async function readReport(
	params: { report_path?: string },
	ctx: ExtensionContext,
): Promise<AgentToolResult<ReportDetails>> {
	if (!params.report_path) {
		return errorResult("Error: report_path is required");
	}

	const filepath = path.isAbsolute(params.report_path)
		? params.report_path
		: path.join(ctx.cwd, params.report_path);

	if (!existsSync(filepath)) {
		return errorResult(`Report not found: ${params.report_path}`);
	}

	const content = await fs.readFile(filepath, "utf-8");
	const filename = path.basename(filepath);
	const session = extractFrontmatterField(content, "session");

	const reportDetails: ReportDetails = {
		path: filepath,
		filename,
		session,
	};

	return {
		content: [{ type: "text", text: content }],
		details: reportDetails,
	};
}

async function listReports(
	_params: any,
	ctx: ExtensionContext,
): Promise<AgentToolResult<ReportDetails>> {
	const reportsDir = path.join(ctx.cwd, "reports");

	if (!existsSync(reportsDir)) {
		return {
			content: [{ type: "text", text: "No reports directory exists yet." }],
			details: { path: reportsDir, filename: "0 reports" },
		};
	}

	const files = await fs.readdir(reportsDir);
	const reports = files
		.filter((f) => f.endsWith(".md"))
		.sort()
		.reverse();

	if (reports.length === 0) {
		return {
			content: [{ type: "text", text: "No reports found." }],
			details: { path: reportsDir, filename: "0 reports" },
		};
	}

	const list = reports
		.map((f) => {
			const match = f.match(/^(\d{4}-\d{2}-\d{2})-nightshift\.md$/);
			if (match) {
				const [, date] = match;
				return `- ${date} nightshift`;
			}
			return `- ${f}`;
		})
		.join("\n");

	return {
		content: [{ type: "text", text: `Available reports:\n\n${list}` }],
		details: { path: reportsDir, filename: `${reports.length} reports` },
	};
}

// Default export for easy import
export default registerReportTool;

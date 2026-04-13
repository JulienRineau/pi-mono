/**
 * Test Tool - Manage test files linked to plans and run targeted test suites
 *
 * Maintains a manifest (tests/nightshift-manifest.json) that maps plans to test files.
 * Tests themselves live in project-standard locations.
 *
 * Actions:
 *   - register: Record test files written for a plan
 *   - run: Run tests for a specific plan (targeted)
 *   - run-all: Run the full project test suite
 *   - list: Show test files per plan
 *   - status: Aggregate pass/fail view
 */

import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { AgentToolResult } from "@mariozechner/pi-agent-core";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import { paramError } from "./validation.js";

// ── Types ──────────────────────────────────────────────────────────

interface PlanTestEntry {
	spec?: string;
	files: string[];
	created: string;
	count: number;
	lastRun?: {
		passed: boolean;
		timestamp: string;
		summary: string;
	};
}

type TestManifest = Record<string, PlanTestEntry>;

export interface TestDetails {
	plan?: string;
	files?: string[];
	count?: number;
	passed?: boolean;
	summary?: string;
	error?: string;
}

// ── Schema ─────────────────────────────────────────────────────────

const TestParams = Type.Object({
	action: Type.Union([
		Type.Literal("create"),
		Type.Literal("register"),
		Type.Literal("run"),
		Type.Literal("run-all"),
		Type.Literal("cleanup"),
		Type.Literal("list"),
		Type.Literal("status"),
	]),

	// For create
	type: Type.Optional(
		Type.Union([Type.Literal("permanent"), Type.Literal("temporary")], {
			description: "permanent = committed with code, temporary = deleted after nightshift run",
		}),
	),
	package: Type.Optional(Type.String({ description: 'Package name (e.g., "coding-agent", "ai", "agent")' })),
	filename: Type.Optional(Type.String({ description: "Test filename (e.g., web-tools.test.ts)" })),
	content: Type.Optional(Type.String({ description: "Full test file content" })),

	// For register / run
	plan: Type.Optional(Type.String({ description: "Plan file path (e.g., plans/2026-04-02-add-auth-v1.md)" })),
	spec: Type.Optional(Type.String({ description: "Spec file path" })),
	files: Type.Optional(Type.Array(Type.String(), { description: "Test file paths to register" })),
	count: Type.Optional(Type.Integer({ description: "Number of test cases" })),

	// For cleanup
	run_dir: Type.Optional(Type.String({ description: "Nightshift run directory to move temporary tests to" })),
});

export type TestParams = typeof TestParams.static;

// ── Manifest Helpers ───────────────────────────────────────────────

const MANIFEST_PATH = "tests/nightshift-manifest.json";

async function readManifest(ctx: ExtensionContext): Promise<TestManifest> {
	const filepath = path.join(ctx.cwd, MANIFEST_PATH);
	if (!existsSync(filepath)) return {};
	try {
		const content = await fs.readFile(filepath, "utf-8");
		return JSON.parse(content);
	} catch {
		return {};
	}
}

async function writeManifest(ctx: ExtensionContext, manifest: TestManifest): Promise<void> {
	const dir = path.join(ctx.cwd, "tests");
	await fs.mkdir(dir, { recursive: true });
	const filepath = path.join(ctx.cwd, MANIFEST_PATH);
	await fs.writeFile(filepath, JSON.stringify(manifest, null, 2), "utf-8");
}

function errorResult(error: string): AgentToolResult<TestDetails> {
	return {
		content: [{ type: "text", text: error }],
		details: { error },
	};
}

function detectTestCommand(cwd: string): string | null {
	if (process.env.PI_TEST_CMD) return process.env.PI_TEST_CMD;

	const pkgPath = path.join(cwd, "package.json");
	if (existsSync(pkgPath)) {
		try {
			const pkg = JSON.parse(require("node:fs").readFileSync(pkgPath, "utf-8"));
			if (pkg.scripts?.test && !pkg.scripts.test.includes("no test specified")) {
				return "npm test";
			}
		} catch {
			/* ignore */
		}
	}

	return null;
}

function detectTestRunner(cwd: string): "vitest" | "jest" | "mocha" | "unknown" {
	if (existsSync(path.join(cwd, "vitest.config.ts")) || existsSync(path.join(cwd, "vitest.config.js"))) {
		return "vitest";
	}
	if (existsSync(path.join(cwd, "jest.config.ts")) || existsSync(path.join(cwd, "jest.config.js"))) {
		return "jest";
	}
	if (existsSync(path.join(cwd, ".mocharc.yml")) || existsSync(path.join(cwd, ".mocharc.json"))) {
		return "mocha";
	}
	// Check package.json for clues
	const pkgPath = path.join(cwd, "package.json");
	if (existsSync(pkgPath)) {
		try {
			const pkg = JSON.parse(require("node:fs").readFileSync(pkgPath, "utf-8"));
			const deps = { ...pkg.devDependencies, ...pkg.dependencies };
			if (deps.vitest) return "vitest";
			if (deps.jest) return "jest";
			if (deps.mocha) return "mocha";
		} catch {
			/* ignore */
		}
	}
	return "unknown";
}

function buildFilteredTestCommand(cwd: string, files: string[]): string | null {
	const runner = detectTestRunner(cwd);
	const filePatterns = files.map((f) => path.basename(f)).join("|");

	switch (runner) {
		case "vitest":
			return `npx vitest run --reporter=verbose ${files.map((f) => `"${f}"`).join(" ")}`;
		case "jest":
			return `npx jest --verbose --testPathPattern="${filePatterns}"`;
		case "mocha":
			return `npx mocha ${files.map((f) => `"${f}"`).join(" ")}`;
		default:
			return null;
	}
}

// ── Actions ────────────────────────────────────────────────────────

export async function createTest(
	params: { type?: string; package?: string; filename?: string; content?: string; plan?: string; spec?: string },
	ctx: ExtensionContext,
): Promise<AgentToolResult<TestDetails>> {
	if (!params.type || !params.package || !params.filename || !params.content) {
		return errorResult(
			paramError("test", "create", ["type", "package", "filename", "content"], params as Record<string, unknown>),
		);
	}

	// Validate filename
	if (!/\.(test|spec)\.(ts|js)$/.test(params.filename)) {
		return errorResult(`Invalid test filename: "${params.filename}". Must end with .test.ts, .spec.ts, .test.js, or .spec.js`);
	}

	// Validate package exists
	const pkgDir = path.join(ctx.cwd, "packages", params.package);
	if (!existsSync(pkgDir)) {
		const available = existsSync(path.join(ctx.cwd, "packages"))
			? require("node:fs").readdirSync(path.join(ctx.cwd, "packages")).join(", ")
			: "none";
		return errorResult(`Package "${params.package}" not found. Available: ${available}`);
	}

	// Determine target path
	const testDir =
		params.type === "temporary"
			? path.join(pkgDir, "test", "nightshift")
			: path.join(pkgDir, "test");

	await fs.mkdir(testDir, { recursive: true });
	const filePath = path.join(testDir, params.filename);
	const relativePath = path.relative(ctx.cwd, filePath);

	await fs.writeFile(filePath, params.content, "utf-8");

	// Auto-register in manifest if plan is provided
	if (params.plan) {
		const manifest = await readManifest(ctx);
		const entry = manifest[params.plan] || { files: [], created: new Date().toISOString(), count: 0 };
		if (!entry.files.includes(relativePath)) {
			entry.files.push(relativePath);
		}
		if (params.spec) entry.spec = params.spec;
		manifest[params.plan] = entry;
		await writeManifest(ctx, manifest);
	}

	return {
		content: [
			{
				type: "text",
				text: `Created ${params.type} test: ${relativePath}`,
			},
		],
		details: {
			files: [relativePath],
			summary: `Created ${params.type} test at ${relativePath}`,
		},
	};
}

export async function cleanupTemporaryTests(
	params: { run_dir?: string },
	ctx: ExtensionContext,
): Promise<AgentToolResult<TestDetails>> {
	const packagesDir = path.join(ctx.cwd, "packages");
	if (!existsSync(packagesDir)) {
		return { content: [{ type: "text", text: "No packages directory found" }], details: {} };
	}

	const moved: string[] = [];
	const packages = require("node:fs").readdirSync(packagesDir);

	for (const pkg of packages) {
		const nightshiftTestDir = path.join(packagesDir, pkg, "test", "nightshift");
		if (!existsSync(nightshiftTestDir)) continue;

		const files = await fs.readdir(nightshiftTestDir);
		for (const file of files) {
			const src = path.join(nightshiftTestDir, file);
			const stat = await fs.stat(src);
			if (!stat.isFile()) continue;

			// Move to run directory if provided
			if (params.run_dir) {
				const destDir = path.join(params.run_dir, "tests");
				await fs.mkdir(destDir, { recursive: true });
				await fs.copyFile(src, path.join(destDir, file));
			}

			await fs.unlink(src);
			moved.push(path.relative(ctx.cwd, src));
		}

		// Remove empty nightshift directory
		try {
			await fs.rmdir(nightshiftTestDir);
		} catch {
			/* not empty */
		}
	}

	const summary = moved.length > 0
		? `Cleaned up ${moved.length} temporary test(s):\n${moved.map((f) => `  - ${f}`).join("\n")}`
		: "No temporary tests to clean up";

	return {
		content: [{ type: "text", text: summary }],
		details: { files: moved, count: moved.length },
	};
}

export async function registerTests(
	params: { plan?: string; spec?: string; files?: string[]; count?: number },
	ctx: ExtensionContext,
): Promise<AgentToolResult<TestDetails>> {
	if (!params.plan || !params.files || params.files.length === 0) {
		return errorResult(paramError("test", "register", ["plan", "files"], params as Record<string, unknown>));
	}

	const manifest = await readManifest(ctx);
	manifest[params.plan] = {
		spec: params.spec,
		files: params.files,
		created: new Date().toISOString(),
		count: params.count ?? 0,
	};
	await writeManifest(ctx, manifest);

	return {
		content: [
			{
				type: "text",
				text: `Registered ${params.files.length} test file(s) for plan: ${params.plan}\nFiles:\n${params.files.map((f) => `  - ${f}`).join("\n")}`,
			},
		],
		details: {
			plan: params.plan,
			files: params.files,
			count: params.count ?? 0,
		},
	};
}

export async function runPlanTests(
	params: { plan?: string },
	ctx: ExtensionContext,
): Promise<AgentToolResult<TestDetails>> {
	if (!params.plan) {
		return errorResult(paramError("test", "run", ["plan"], params as Record<string, unknown>));
	}

	const manifest = await readManifest(ctx);
	const entry = manifest[params.plan];

	if (!entry || entry.files.length === 0) {
		return {
			content: [{ type: "text", text: `No tests registered for plan: ${params.plan}` }],
			details: { plan: params.plan, passed: true, summary: "No tests registered" },
		};
	}

	// Verify test files still exist
	const existingFiles = entry.files.filter((f) => existsSync(path.join(ctx.cwd, f)));
	if (existingFiles.length === 0) {
		return {
			content: [{ type: "text", text: `Test files no longer exist for plan: ${params.plan}` }],
			details: { plan: params.plan, passed: false, summary: "Test files missing" },
		};
	}

	const filteredCmd = buildFilteredTestCommand(ctx.cwd, existingFiles);
	if (!filteredCmd) {
		// Fall back to full test suite if we can't filter
		const fullCmd = detectTestCommand(ctx.cwd);
		if (!fullCmd) {
			return errorResult("No test command detected. Set PI_TEST_CMD or add scripts.test to package.json.");
		}
		try {
			const output = execSync(fullCmd, { cwd: ctx.cwd, encoding: "utf-8", timeout: 600000 });
			manifest[params.plan].lastRun = {
				passed: true,
				timestamp: new Date().toISOString(),
				summary: "Full suite passed",
			};
			await writeManifest(ctx, manifest);
			return {
				content: [
					{ type: "text", text: `Tests passed (full suite — could not filter by plan)\n${output.slice(-500)}` },
				],
				details: { plan: params.plan, files: existingFiles, passed: true, summary: "Full suite passed" },
			};
		} catch (err: any) {
			const output = (err.stdout || err.stderr || "").toString().slice(-500);
			manifest[params.plan].lastRun = {
				passed: false,
				timestamp: new Date().toISOString(),
				summary: "Tests failed",
			};
			await writeManifest(ctx, manifest);
			return {
				content: [{ type: "text", text: `Tests FAILED (full suite)\n${output}` }],
				details: { plan: params.plan, files: existingFiles, passed: false, summary: "Tests failed" },
			};
		}
	}

	try {
		const output = execSync(filteredCmd, { cwd: ctx.cwd, encoding: "utf-8", timeout: 600000 });
		manifest[params.plan].lastRun = {
			passed: true,
			timestamp: new Date().toISOString(),
			summary: "All plan tests passed",
		};
		await writeManifest(ctx, manifest);
		return {
			content: [{ type: "text", text: `Plan tests passed (${existingFiles.length} files)\n${output.slice(-500)}` }],
			details: { plan: params.plan, files: existingFiles, passed: true, summary: "All plan tests passed" },
		};
	} catch (err: any) {
		const output = (err.stdout || err.stderr || "").toString().slice(-500);
		manifest[params.plan].lastRun = { passed: false, timestamp: new Date().toISOString(), summary: "Tests failed" };
		await writeManifest(ctx, manifest);
		return {
			content: [{ type: "text", text: `Plan tests FAILED\n${output}` }],
			details: { plan: params.plan, files: existingFiles, passed: false, summary: "Tests failed" },
		};
	}
}

export async function runAllTests(_params: any, ctx: ExtensionContext): Promise<AgentToolResult<TestDetails>> {
	const testCmd = detectTestCommand(ctx.cwd);
	if (!testCmd) {
		return errorResult("No test command detected. Set PI_TEST_CMD or add scripts.test to package.json.");
	}

	try {
		const output = execSync(testCmd, { cwd: ctx.cwd, encoding: "utf-8", timeout: 600000 });
		return {
			content: [{ type: "text", text: `Full test suite passed\n${output.slice(-500)}` }],
			details: { passed: true, summary: "Full suite passed" },
		};
	} catch (err: any) {
		const output = (err.stdout || err.stderr || "").toString().slice(-500);
		return {
			content: [{ type: "text", text: `Full test suite FAILED\n${output}` }],
			details: { passed: false, summary: "Full suite failed" },
		};
	}
}

async function listTests(params: { plan?: string }, ctx: ExtensionContext): Promise<AgentToolResult<TestDetails>> {
	const manifest = await readManifest(ctx);

	if (params.plan) {
		const entry = manifest[params.plan];
		if (!entry) {
			return {
				content: [{ type: "text", text: `No tests registered for plan: ${params.plan}` }],
				details: { plan: params.plan },
			};
		}
		const lines = [
			`Plan: ${params.plan}`,
			`Spec: ${entry.spec || "(none)"}`,
			`Tests: ${entry.count} cases in ${entry.files.length} files`,
			`Created: ${entry.created}`,
			``,
			`Files:`,
			...entry.files.map((f) => `  - ${f}${existsSync(path.join(ctx.cwd, f)) ? "" : " (MISSING)"}`),
		];
		if (entry.lastRun) {
			lines.push(``, `Last run: ${entry.lastRun.passed ? "PASSED" : "FAILED"} (${entry.lastRun.timestamp})`);
		}
		return {
			content: [{ type: "text", text: lines.join("\n") }],
			details: { plan: params.plan, files: entry.files, count: entry.count },
		};
	}

	// List all
	const plans = Object.keys(manifest);
	if (plans.length === 0) {
		return {
			content: [{ type: "text", text: "No tests registered." }],
			details: {},
		};
	}

	const lines = [`Registered test suites: ${plans.length}`, ``];
	for (const plan of plans) {
		const entry = manifest[plan];
		const status = entry.lastRun ? (entry.lastRun.passed ? "PASS" : "FAIL") : "—";
		lines.push(`[${status}] ${plan}: ${entry.count} tests in ${entry.files.length} files`);
	}

	return {
		content: [{ type: "text", text: lines.join("\n") }],
		details: { count: plans.length },
	};
}

async function testStatus(_params: any, ctx: ExtensionContext): Promise<AgentToolResult<TestDetails>> {
	const manifest = await readManifest(ctx);
	const plans = Object.keys(manifest);

	if (plans.length === 0) {
		return {
			content: [{ type: "text", text: "No tests registered." }],
			details: {},
		};
	}

	let totalFiles = 0;
	let totalTests = 0;
	let passing = 0;
	let failing = 0;
	let untested = 0;

	for (const plan of plans) {
		const entry = manifest[plan];
		totalFiles += entry.files.length;
		totalTests += entry.count;
		if (!entry.lastRun) untested++;
		else if (entry.lastRun.passed) passing++;
		else failing++;
	}

	const lines = [
		`Test suites: ${plans.length}`,
		`Total files: ${totalFiles}`,
		`Total tests: ${totalTests}`,
		``,
		`Passing: ${passing}`,
		`Failing: ${failing}`,
		`Not yet run: ${untested}`,
	];

	return {
		content: [{ type: "text", text: lines.join("\n") }],
		details: { count: totalTests, passed: failing === 0 },
	};
}

// ── Tool Registration ──────────────────────────────────────────────

export function registerTestTool(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "test",
		label: "Test",
		description:
			"Create and manage test files. Use 'create' to write test files (permanent or temporary). " +
			"Use 'run' to run plan-specific tests, 'run-all' for the full suite. " +
			"Use 'cleanup' to move temporary tests to the run directory before committing.",
		parameters: TestParams,

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			switch (params.action) {
				case "create":
					return await createTest(params, ctx);
				case "register":
					return await registerTests(params, ctx);
				case "run":
					return await runPlanTests(params, ctx);
				case "run-all":
					return await runAllTests(params, ctx);
				case "cleanup":
					return await cleanupTemporaryTests(params, ctx);
				case "list":
					return await listTests(params, ctx);
				case "status":
					return await testStatus(params, ctx);
			}
		},

		renderCall(args, _theme, _context) {
			let text = `test ${args.action}`;
			if (args.plan) text += `: ${args.plan}`;
			if (args.files) text += ` (${args.files.length} files)`;
			return new Text(text, 0, 0);
		},

		renderResult(result, _options, theme, _context) {
			const details = result.details as TestDetails;
			const text = result.content[0];

			if (details?.error) {
				return new Text(`${theme.fg("error", "✗")} ${details.error}`, 0, 0);
			}

			if (details?.passed === true) {
				return new Text(`${theme.fg("success", "✓")} ${text?.type === "text" ? text.text : "Tests passed"}`, 0, 0);
			}
			if (details?.passed === false) {
				return new Text(`${theme.fg("error", "✗")} ${text?.type === "text" ? text.text : "Tests failed"}`, 0, 0);
			}

			return new Text(text?.type === "text" ? text.text : "", 0, 0);
		},
	});
}

export default registerTestTool;

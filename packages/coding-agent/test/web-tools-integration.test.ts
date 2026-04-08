/**
 * Integration tests for web tools (web_search + web_fetch)
 *
 * TDD: These tests define expected behavior BEFORE implementation.
 * Tests both tools working together within the agent session context.
 */

import type { AgentTool } from "@mariozechner/pi-agent-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createWebFetchTool } from "../src/core/tools/web-fetch.js";
import { createWebSearchTool } from "../src/core/tools/web-search.js";
import { createHarness } from "./suite/harness.js";

// Helper to extract text from AgentToolResult
function getTextOutput(result: {
	content?: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
}): string {
	return (
		result.content
			?.filter((c) => c.type === "text")
			.map((c) => c.text)
			.join("\n") || ""
	);
}

describe("Web Tools Integration", () => {
	describe("Tool Registration in Tools Index", () => {
		it("should export web_search tool from tools index", async () => {
			const { allTools } = await import("../src/core/tools/index.js");

			expect(allTools).toHaveProperty("web_search");
		});

		it("should export web_fetch tool from tools index", async () => {
			const { allTools } = await import("../src/core/tools/index.js");

			expect(allTools).toHaveProperty("web_fetch");
		});

		it("should export web tools with group identifier", async () => {
			const { webTools } = await import("../src/core/tools/index.js");

			expect(webTools).toBeDefined();
			expect(webTools.group).toBe("web");
			expect(webTools.web_search).toBeDefined();
			expect(webTools.web_fetch).toBeDefined();
		});

		it("should include web tools in codingTools array", async () => {
			const { codingTools } = await import("../src/core/tools/index.js");

			const toolNames = codingTools.map((t) => t.name);
			expect(toolNames).toContain("web_search");
			expect(toolNames).toContain("web_fetch");
		});
	});

	describe("Tool Schema Consistency", () => {
		it("should use TypeBox schema for web_search", () => {
			const tool = createWebSearchTool();
			expect(tool.parameters).toBeDefined();
			expect(tool.parameters.type).toBe("object");
			expect(tool.parameters.properties).toHaveProperty("query");
			expect(tool.parameters.properties).toHaveProperty("max_results");
		});

		it("should use TypeBox schema for web_fetch", () => {
			const tool = createWebFetchTool();
			expect(tool.parameters).toBeDefined();
			expect(tool.parameters.type).toBe("object");
			expect(tool.parameters.properties).toHaveProperty("url");
		});

		it("should include docstrings in tool definitions", () => {
			const searchTool = createWebSearchTool();
			const fetchTool = createWebFetchTool();

			expect(searchTool.description).toContain("Search the web");
			expect(fetchTool.description).toContain("web page");
			expect(fetchTool.description).toMatch(/search results/i); // Restrictive docstring
		});
	});

	describe("Tool Grouping for Unified Activation", () => {
		it("should support parallel activation of both web tools", async () => {
			const tools: AgentTool[] = [
				createWebSearchTool() as unknown as AgentTool,
				createWebFetchTool() as unknown as AgentTool,
			];

			expect(tools).toHaveLength(2);
			expect(tools.map((t) => t.name)).toContain("web_search");
			expect(tools.map((t) => t.name)).toContain("web_fetch");
		});

		it("should export webTools as a group for --tools=web activation", async () => {
			const { webTools } = await import("../src/core/tools/index.js");

			// webTools should be usable as a group
			expect(webTools.group).toBe("web");
			expect(typeof webTools.web_search).toBe("object");
			expect(typeof webTools.web_fetch).toBe("object");
		});
	});

	describe("Error Resilience Pattern", () => {
		afterEach(() => {
			vi.restoreAllMocks();
		});

		it("should allow search tool to return error JSON for retry", async () => {
			vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("", { status: 429 }));

			const tool = createWebSearchTool();
			const result = await tool.execute("test-call-err", { query: "test" });
			const text = getTextOutput(result);
			const parsed = JSON.parse(text);

			expect(parsed).toHaveProperty("error");
			// LLM can parse this and retry
		});

		it("should allow fetch tool to return error string without throwing", async () => {
			vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("Connection refused"));

			const tool = createWebFetchTool();
			const result = await tool.execute("test-call-err", {
				url: "https://example.com/fail",
			});
			const text = getTextOutput(result);

			expect(text).toMatch(/^Error:/);
			// LLM sees error string and can retry
		});

		it("should allow fetch tool to return SSRF block error", async () => {
			const tool = createWebFetchTool();
			const result = await tool.execute("test-call-ssrf", {
				url: "http://localhost/test",
			});
			const text = getTextOutput(result);

			expect(text).toBe("Error: URL not allowed");
			// LLM knows not to try this URL again
		});

		it("should never throw exceptions, only return structured errors", async () => {
			const searchTool = createWebSearchTool();
			const fetchTool = createWebFetchTool();

			// Network errors should be caught and returned as errors
			vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Network unavailable"));

			// Should not throw
			await expect(searchTool.execute("test-no-throw-1", { query: "test" })).resolves.toBeDefined();

			await expect(fetchTool.execute("test-no-throw-2", { url: "https://example.com" })).resolves.toBeDefined();
		});
	});

	describe("Search to Fetch Workflow", () => {
		afterEach(() => {
			vi.restoreAllMocks();
		});

		it("should enable agent to chain search results to fetch URLs", async () => {
			// Mock search returning results

			const duckyHtml = `
				<html><body>
					<a class="result__a" href="https://example.com/1">Test Article</a>
					<a class="result__snippet">First result snippet</a>
					<a class="result__a" href="https://example.com/2">Test Article 2</a>
					<a class="result__snippet">Second result snippet</a>
				</body></html>
			`;

			vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
				new Response(duckyHtml, {
					status: 200,
					headers: { "content-type": "text/html" },
				}),
			);

			const searchTool = createWebSearchTool();
			const searchResult = await searchTool.execute("test-chain-1", { query: "test" });
			const searchText = getTextOutput(searchResult);
			const parsed = JSON.parse(searchText);

			// Extract URLs from search results
			const urls = parsed.results.map((r: { url: string }) => r.url);
			expect(urls).toContain("https://example.com/1");
			expect(urls).toContain("https://example.com/2");

			// Mock fetch response
			vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
				new Response("# Example Article\n\nContent from the first result.", {
					status: 200,
				}),
			);

			const fetchTool = createWebFetchTool();
			const fetchResult = await fetchTool.execute("test-chain-2", { url: urls[0] });
			const fetchText = getTextOutput(fetchResult);

			expect(fetchText).toContain("# Example Article");
		});

		it("should support retry with different URL on failure", async () => {
			// First fetch fails, second succeeds
			vi.spyOn(globalThis, "fetch")
				.mockRejectedValueOnce(new Error("Connection refused"))
				.mockResolvedValueOnce(
					new Response("# Second Attempt\n\nSuccess!", {
						status: 200,
						headers: { "content-type": "text/markdown" },
					}),
				);

			const fetchTool = createWebFetchTool();
			const urls = ["https://example.com/1", "https://example.com/2"];

			// Try first URL - should fail gracefully
			const result1 = await fetchTool.execute("test-retry-1", { url: urls[0] });
			expect(getTextOutput(result1)).toContain("Error:");

			// Retry with second URL - should succeed
			const result2 = await fetchTool.execute("test-retry-2", { url: urls[1] });
			expect(getTextOutput(result2)).toContain("# Second Attempt");
		});

		it("should handle agent choosing different URL after SSRF block", async () => {
			const fetchTool = createWebFetchTool();

			// First attempt with blocked URL
			const blockedResult = await fetchTool.execute("test-ssrf-retry-1", {
				url: "http://localhost/test",
			});
			expect(getTextOutput(blockedResult)).toBe("Error: URL not allowed");

			// Second attempt with valid URL
			vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
				new Response("# Valid Content\n\nSuccess after SSRF retry!", {
					status: 200,
				}),
			);

			const validResult = await fetchTool.execute("test-ssrf-retry-2", {
				url: "https://example.com/valid",
			});
			expect(getTextOutput(validResult)).toContain("Success after SSRF retry");
		});
	});

	describe("Agent Session Integration", () => {
		it("should allow web tools to be activated via setActiveToolsByName", async () => {
			const harness = await createHarness({
				tools: [createWebSearchTool() as unknown as AgentTool, createWebFetchTool() as unknown as AgentTool],
			});

			try {
				// Session should be created with web tools available
				expect(harness.session).toBeDefined();
			} finally {
				harness.cleanup();
			}
		});

		it("should allow 'web' group activation", async () => {
			// Test that the web group can be used to activate both tools
			const { webTools } = await import("../src/core/tools/index.js");

			// This tests that the tools export structure supports group activation
			expect(webTools.web_search).toBeDefined();
			expect(webTools.web_fetch).toBeDefined();
			expect(webTools.group).toBe("web");
		});
	});
});

describe("createAllTools includes web tools", () => {
	it("should create web_search when creating all tools", async () => {
		const { createAllTools } = await import("../src/core/tools/index.js");

		// createAllTools should include web tools
		const tools = createAllTools("/tmp");
		expect(tools.web_search).toBeDefined();
		expect(tools.web_search.name).toBe("web_search");
	});

	it("should create web_fetch when creating all tools", async () => {
		const { createAllTools } = await import("../src/core/tools/index.js");

		const tools = createAllTools("/tmp");
		expect(tools.web_fetch).toBeDefined();
		expect(tools.web_fetch.name).toBe("web_fetch");
	});

	it("should create all tool definitions including web tools", async () => {
		const { createAllToolDefinitions } = await import("../src/core/tools/index.js");

		const definitions = createAllToolDefinitions("/tmp");
		expect(definitions.web_search).toBeDefined();
		expect(definitions.web_fetch).toBeDefined();
	});
});

/**
 * Tests for web_search tool
 *
 * TDD: These tests define expected behavior BEFORE implementation.
 * All tests should fail until web_search is implemented.
 *
 * Tests import from src/core/tools/web-search.ts which must be created.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WebSearchResult } from "../src/core/tools/providers/duckduckgo.js";
// Import the actual implementation (will fail until implemented)
import { createWebSearchTool, createWebSearchToolDefinition } from "../src/core/tools/web-search.js";

// Helper to extract text from AgentToolResult content blocks
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

describe("web_search tool", () => {
	describe("Tool Definition and Schema", () => {
		it("should have correct tool name", () => {
			const definition = createWebSearchToolDefinition();
			expect(definition.name).toBe("web_search");
		});

		it("should have description mentioning web search", () => {
			const definition = createWebSearchToolDefinition();
			expect(definition.description).toMatch(/search/i);
			expect(definition.description).toMatch(/internet/i);
		});

		it("should have schema with query parameter (required)", () => {
			const definition = createWebSearchToolDefinition();
			expect(definition.parameters.properties).toHaveProperty("query");
			expect(definition.parameters.required).toContain("query");
		});

		it("should have schema with optional max_results parameter", () => {
			const definition = createWebSearchToolDefinition();
			expect(definition.parameters.properties).toHaveProperty("max_results");
			expect(definition.parameters.required).not.toContain("max_results");
		});

		it("should use TypeBox for parameter schema", () => {
			const definition = createWebSearchToolDefinition();
			// TypeBox schemas have a $schema or type property
			expect(definition.parameters).toBeDefined();
			expect(definition.parameters.type).toBe("object");
		});

		it("should have docstring matching spec requirement", () => {
			const definition = createWebSearchToolDefinition();
			const docstring = definition.description;
			expect(docstring).toMatch(/Search the web/i);
			expect(docstring).toMatch(/find current information|news|articles|facts/i);
		});
	});

	describe("createWebSearchTool factory", () => {
		it("should create tool with correct name", () => {
			const tool = createWebSearchTool();
			expect(tool.name).toBe("web_search");
		});

		it("should create tool with executable execute function", () => {
			const tool = createWebSearchTool();
			expect(typeof tool.execute).toBe("function");
		});

		it("should create tool with parameters schema", () => {
			const tool = createWebSearchTool();
			expect(tool.parameters).toBeDefined();
		});
	});

	describe("Basic Search Functionality", () => {
		beforeEach(() => {
			vi.spyOn(globalThis, "fetch").mockClear();
		});

		afterEach(() => {
			vi.restoreAllMocks();
		});

		it("should return valid JSON string with results array", async () => {
			// Mock DuckDuckGo HTML response
			const duckyHtml = `
				<html><body>
					<a class="result__a" href="https://example.com/article">Example Title</a>
					<a class="result__snippet">Example snippet text</a>
				</body></html>
			`;

			vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
				new Response(duckyHtml, {
					status: 200,
					headers: { "content-type": "text/html" },
				}),
			);

			const tool = createWebSearchTool();
			const result = await tool.execute("test-call-1", { query: "test query" });

			const output = getTextOutput(result);
			expect(() => JSON.parse(output)).not.toThrow();

			const parsed = JSON.parse(output);
			expect(parsed).toHaveProperty("results");
			expect(Array.isArray(parsed.results)).toBe(true);
		});

		it("should return results with title, url, and snippet fields", async () => {
			const duckyHtml = `
				<html><body>
					<a class="result__a" href="https://example.com/page">Test Page</a>
					<a class="result__snippet">This is test content</a>
				</body></html>
			`;

			vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
				new Response(duckyHtml, {
					status: 200,
					headers: { "content-type": "text/html" },
				}),
			);

			const tool = createWebSearchTool();
			const result = await tool.execute("test-call-2", { query: "test" });

			const output = getTextOutput(result);
			const parsed = JSON.parse(output);

			expect(parsed.results.length).toBeGreaterThan(0);
			for (const item of parsed.results) {
				expect(item).toHaveProperty("title");
				expect(item).toHaveProperty("url");
				expect(item).toHaveProperty("snippet");
				expect(typeof item.title).toBe("string");
				expect(typeof item.url).toBe("string");
				expect(typeof item.snippet).toBe("string");
			}
		});

		it("should respect max_results parameter", async () => {
			const duckyHtml = `
				<html><body>
					<a class="result__a" href="https://example.com/1">Result 1</a>
					<a class="result__snippet">Snippet 1</a>
					<a class="result__a" href="https://example.com/2">Result 2</a>
					<a class="result__snippet">Snippet 2</a>
					<a class="result__a" href="https://example.com/3">Result 3</a>
					<a class="result__snippet">Snippet 3</a>
				</body></html>
			`;

			vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
				new Response(duckyHtml, {
					status: 200,
					headers: { "content-type": "text/html" },
				}),
			);

			const tool = createWebSearchTool();
			const result = await tool.execute("test-call-3", { query: "test", max_results: 2 });

			const output = getTextOutput(result);
			const parsed = JSON.parse(output);

			expect(parsed.results.length).toBeLessThanOrEqual(2);
		});

		it("should use default max_results of 5 when not specified", async () => {
			const duckyHtml = `<html><body></body></html>`;

			vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
				new Response(duckyHtml, {
					status: 200,
					headers: { "content-type": "text/html" },
				}),
			);

			const tool = createWebSearchTool();
			await tool.execute("test-call-4", { query: "test" });

			// Verify fetch was called with expected URL
			expect(globalThis.fetch).toHaveBeenCalled();
		});
	});

	describe("DuckDuckGo HTML Parsing", () => {
		afterEach(() => {
			vi.restoreAllMocks();
		});

		it("should parse DuckDuckGo HTML format result links", async () => {
			const duckyHtml = `
				<html>
				<body>
					<a class="result__a" href="https://example.com/article1">Example Article 1</a>
					<a class="result__snippet">This is the first snippet</a>
					<a class="result__a" href="https://example.com/article2">Example Article 2</a>
					<a class="result__snippet">This is the second snippet</a>
				</body>
				</html>
			`;

			vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
				new Response(duckyHtml, {
					status: 200,
					headers: { "content-type": "text/html" },
				}),
			);

			const tool = createWebSearchTool();
			const result = await tool.execute("test-call-parse-1", { query: "test" });

			const output = getTextOutput(result);
			const parsed = JSON.parse(output);

			expect(parsed.results).toHaveLength(2);
			expect(parsed.results[0]).toMatchObject({
				title: "Example Article 1",
				url: "https://example.com/article1",
				snippet: "This is the first snippet",
			});
		});

		it("should decode HTML entities in titles and snippets", async () => {
			const duckyHtml = `
				<html><body>
					<a class="result__a" href="https://example.com/test">Rock &amp; Roll &lt;Test&gt;</a>
					<a class="result__snippet">Use &quot;quotes&quot; here</a>
				</body></html>
			`;

			vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
				new Response(duckyHtml, {
					status: 200,
					headers: { "content-type": "text/html" },
				}),
			);

			const tool = createWebSearchTool();
			const result = await tool.execute("test-call-parse-2", { query: "test" });

			const output = getTextOutput(result);
			const parsed = JSON.parse(output);

			expect(parsed.results[0].title).toBe("Rock & Roll <Test>");
			expect(parsed.results[0].snippet).toBe('Use "quotes" here');
		});
	});

	describe("URL Construction", () => {
		afterEach(() => {
			vi.restoreAllMocks();
		});

		it("should use DuckDuckGo HTML endpoint", async () => {
			vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("", { status: 200 }));

			const tool = createWebSearchTool();
			await tool.execute("test-call-url-1", { query: "test query" });

			expect(globalThis.fetch).toHaveBeenCalled();
			const callUrl = new URL((globalThis.fetch as any).mock.calls[0][0] as string);
			expect(callUrl.hostname).toBe("html.duckduckgo.com");
		});

		it("should URL-encode the search query", async () => {
			vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("", { status: 200 }));

			const tool = createWebSearchTool();
			await tool.execute("test-call-url-2", { query: "test query with spaces" });

			const callUrl = new URL((globalThis.fetch as any).mock.calls[0][0] as string);
			expect(callUrl.searchParams.get("q")).toBe("test query with spaces");
		});

		it("should handle special characters in query", async () => {
			vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("", { status: 200 }));

			const tool = createWebSearchTool();
			await tool.execute("test-call-url-3", { query: "C++ & JavaScript" });

			expect(globalThis.fetch).toHaveBeenCalled();
			const callUrl = new URL((globalThis.fetch as any).mock.calls[0][0] as string);
			expect(callUrl.searchParams.get("q")).toBeTruthy();
		});
	});

	describe("Error Handling (as JSON, not thrown)", () => {
		afterEach(() => {
			vi.restoreAllMocks();
		});

		it("should return error JSON on empty query", async () => {
			const tool = createWebSearchTool();
			const result = await tool.execute("test-call-err-1", { query: "" });

			const output = getTextOutput(result);
			expect(() => JSON.parse(output)).not.toThrow();

			const parsed = JSON.parse(output);
			expect(parsed).toHaveProperty("error");
		});

		it("should return error JSON on network failure", async () => {
			vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("Network unavailable"));

			const tool = createWebSearchTool();
			const result = await tool.execute("test-call-err-2", { query: "test" });

			const output = getTextOutput(result);
			expect(() => JSON.parse(output)).not.toThrow();

			const parsed = JSON.parse(output);
			expect(parsed).toHaveProperty("error");
		});

		it("should return error JSON on HTTP 429 rate limiting", async () => {
			vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
				new Response("", { status: 429, statusText: "Too Many Requests" }),
			);

			const tool = createWebSearchTool();
			const result = await tool.execute("test-call-err-3", { query: "test" });

			const output = getTextOutput(result);
			expect(() => JSON.parse(output)).not.toThrow();

			const parsed = JSON.parse(output);
			expect(parsed).toHaveProperty("error");
			expect(parsed.error).toMatch(/rate|limit/i);
		});

		it("should return error JSON on parse failure", async () => {
			// Mock non-DuckDuckGo HTML that won't parse correctly
			vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
				new Response("<html><body>Not valid DuckDuckGo format</body></html>", {
					status: 200,
					headers: { "content-type": "text/html" },
				}),
			);

			const tool = createWebSearchTool();
			const result = await tool.execute("test-call-err-4", { query: "test" });

			const output = getTextOutput(result);
			expect(() => JSON.parse(output)).not.toThrow();

			const parsed = JSON.parse(output);
			expect(parsed).toHaveProperty("error");
		});

		it("should NOT throw exceptions on any failure", async () => {
			vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("Total failure"));

			const tool = createWebSearchTool();
			await expect(tool.execute("test-call-err-5", { query: "test" })).resolves.toBeDefined();
		});

		it("should distinguish rate limit errors with retry hint", async () => {
			vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
				new Response("", { status: 429, statusText: "Too Many Requests" }),
			);

			const tool = createWebSearchTool();
			const result = await tool.execute("test-call-err-6", { query: "test" });

			const output = getTextOutput(result);
			const parsed = JSON.parse(output);

			// Should indicate retry is possible
			expect(parsed.retry === true || parsed.error.toLowerCase().includes("retry")).toBeTruthy();
		});
	});
});

describe("WebSearchResult type", () => {
	it("should export WebSearchResult type from duckduckgo provider", () => {
		// This tests that the provider module exists and exports the type
		const result: WebSearchResult = {
			title: "Test",
			url: "https://example.com",
			snippet: "Test snippet",
		};

		expect(result.title).toBe("Test");
		expect(result.url).toBe("https://example.com");
		expect(result.snippet).toBe("Test snippet");
	});
});

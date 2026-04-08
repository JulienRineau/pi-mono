/**
 * Tests for web_fetch tool
 *
 * TDD: These tests define expected behavior BEFORE implementation.
 * All tests should fail until web_fetch is implemented.
 *
 * Tests import from src/core/tools/web-fetch.ts which must be created.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

// Import the actual implementation (will fail until implemented)
import { createWebFetchTool, createWebFetchToolDefinition } from "../src/core/tools/web-fetch.js";

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

describe("web_fetch tool", () => {
	describe("Tool Definition and Schema", () => {
		it("should have correct tool name", () => {
			const definition = createWebFetchToolDefinition();
			expect(definition.name).toBe("web_fetch");
		});

		it("should have restrictive docstring about URLs from search results", () => {
			const definition = createWebFetchToolDefinition();
			const docstring = definition.description;
			// Critical for LLM behavior - should guide to only use search result URLs
			expect(docstring).toMatch(/search results/i);
		});

		it("should have schema with url parameter (required)", () => {
			const definition = createWebFetchToolDefinition();
			expect(definition.parameters.properties).toHaveProperty("url");
			expect(definition.parameters.required).toContain("url");
		});

		it("should use TypeBox for parameter schema", () => {
			const definition = createWebFetchToolDefinition();
			expect(definition.parameters).toBeDefined();
			expect(definition.parameters.type).toBe("object");
		});
	});

	describe("createWebFetchTool factory", () => {
		it("should create tool with correct name", () => {
			const tool = createWebFetchTool();
			expect(tool.name).toBe("web_fetch");
		});

		it("should create tool with executable execute function", () => {
			const tool = createWebFetchTool();
			expect(typeof tool.execute).toBe("function");
		});
	});

	describe("Basic Fetch Functionality", () => {
		afterEach(() => {
			vi.restoreAllMocks();
		});

		it("should return content starting with # title format", async () => {
			// Mock Jina Reader response
			const jinaResponse = `# Test Article Title

This is the first paragraph.
And this is the second paragraph.

## Section 2

More content here.
`;

			vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
				new Response(jinaResponse, {
					status: 200,
					headers: { "content-type": "text/markdown" },
				}),
			);

			const tool = createWebFetchTool();
			const result = await tool.execute("test-call-1", {
				url: "https://example.com/article",
			});

			const output = getTextOutput(result);
			expect(output).toMatch(/^#\s+/);
		});

		it("should extract title from first # heading in markdown", async () => {
			const jinaResponse = `# Extracted Title

Content here.
`;

			vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
				new Response(jinaResponse, {
					status: 200,
					headers: { "content-type": "text/markdown" },
				}),
			);

			const tool = createWebFetchTool();
			const result = await tool.execute("test-call-2", {
				url: "https://example.com/page",
			});

			const output = getTextOutput(result);
			expect(output).toContain("# Extracted Title");
		});

		it("should NOT contain Error: prefix on successful fetch", async () => {
			const jinaResponse = `# Valid Content

Some useful information.
`;

			vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
				new Response(jinaResponse, {
					status: 200,
					headers: { "content-type": "text/markdown" },
				}),
			);

			const tool = createWebFetchTool();
			const result = await tool.execute("test-call-3", {
				url: "https://example.com/valid",
			});

			const output = getTextOutput(result);
			expect(output).not.toMatch(/^Error:/);
		});
	});

	describe("Error Handling (as strings, NOT thrown)", () => {
		afterEach(() => {
			vi.restoreAllMocks();
		});

		it("should return error string on HTTP 429 rate limiting", async () => {
			vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
				new Response("", { status: 429, statusText: "Too Many Requests" }),
			);

			const tool = createWebFetchTool();
			const result = await tool.execute("test-call-err-1", {
				url: "https://example.com/rate-limited",
			});

			const output = getTextOutput(result);
			expect(output).toMatch(/^Error:/);
		});

		it("should return error string on HTTP 500 server error", async () => {
			vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
				new Response("", { status: 500, statusText: "Internal Server Error" }),
			);

			const tool = createWebFetchTool();
			const result = await tool.execute("test-call-err-2", {
				url: "https://example.com/server-error",
			});

			const output = getTextOutput(result);
			expect(output).toMatch(/^Error:/);
		});

		it("should return error string on HTTP 404 not found", async () => {
			vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
				new Response("", { status: 404, statusText: "Not Found" }),
			);

			const tool = createWebFetchTool();
			const result = await tool.execute("test-call-err-3", {
				url: "https://example.com/not-found",
			});

			const output = getTextOutput(result);
			expect(output).toMatch(/^Error:/);
		});

		it("should return 'No content could be extracted' for empty response", async () => {
			vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("", { status: 200 }));

			const tool = createWebFetchTool();
			const result = await tool.execute("test-call-err-4", {
				url: "https://example.com/empty",
			});

			const output = getTextOutput(result);
			expect(output).toContain("No content could be extracted");
		});

		it("should return 'No content could be extracted' for whitespace-only content", async () => {
			vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("   \n\t\n   ", { status: 200 }));

			const tool = createWebFetchTool();
			const result = await tool.execute("test-call-err-5", {
				url: "https://example.com/whitespace",
			});

			const output = getTextOutput(result);
			expect(output).toContain("No content could be extracted");
		});

		it("should return error string on network error", async () => {
			vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("Connection refused"));

			const tool = createWebFetchTool();
			const result = await tool.execute("test-call-err-6", {
				url: "https://example.com/network-error",
			});

			const output = getTextOutput(result);
			expect(output).toMatch(/^Error:/);
		});

		it("should return error string on request timeout", async () => {
			vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("Request timeout"));

			const tool = createWebFetchTool();
			const result = await tool.execute("test-call-err-7", {
				url: "https://example.com/timeout",
			});

			const output = getTextOutput(result);
			expect(output).toMatch(/^Error:/);
			expect(output).toMatch(/timeout/i);
		});

		it("should return error string for invalid URL syntax", async () => {
			const tool = createWebFetchTool();
			const result = await tool.execute("test-call-err-8", {
				url: "not-a-valid-url",
			});

			const output = getTextOutput(result);
			expect(output).toMatch(/^Error:/);
		});

		it("should NOT throw exceptions on any failure", async () => {
			vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("Total failure"));

			const tool = createWebFetchTool();
			await expect(tool.execute("test-call-err-9", { url: "https://example.com/test" })).resolves.toBeDefined();
		});
	});

	describe("Content Truncation", () => {
		afterEach(() => {
			vi.restoreAllMocks();
		});

		it("should truncate large content to 4096 chars", async () => {
			// Create content larger than 4096 characters
			const longTitle = "# Large Article Title";
			const longContent = "x".repeat(5000);
			const jinaResponse = `${longTitle}\n\n${longContent}`;

			vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
				new Response(jinaResponse, {
					status: 200,
					headers: { "content-type": "text/markdown" },
				}),
			);

			const tool = createWebFetchTool();
			const result = await tool.execute("test-call-trunc-1", {
				url: "https://example.com/large",
			});

			const output = getTextOutput(result);
			expect(output.length).toBeLessThanOrEqual(4096 + 50); // Allow buffer for [truncated] marker
		});

		it("should append [truncated] when content exceeds 4096 chars", async () => {
			const longTitle = "# A Very Long Title";
			const longContent = "x".repeat(5000);
			const jinaResponse = `${longTitle}\n\n${longContent}`;

			vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
				new Response(jinaResponse, {
					status: 200,
					headers: { "content-type": "text/markdown" },
				}),
			);

			const tool = createWebFetchTool();
			const result = await tool.execute("test-call-trunc-2", {
				url: "https://example.com/very-large",
			});

			const output = getTextOutput(result);
			// If content was truncated, should include marker
			expect(output).toContain("[truncated]");
		});
	});

	describe("SSRF Protection - Critical Security", () => {
		it("should block localhost URLs", async () => {
			const tool = createWebFetchTool();
			const result = await tool.execute("test-call-ssrf-1", {
				url: "http://localhost/test",
			});

			const output = getTextOutput(result);
			expect(output).toBe("Error: URL not allowed");
		});

		it("should block localhost with different port", async () => {
			const tool = createWebFetchTool();
			const result = await tool.execute("test-call-ssrf-1b", {
				url: "http://localhost:8080/test",
			});

			const output = getTextOutput(result);
			expect(output).toBe("Error: URL not allowed");
		});

		it("should block 127.0.0.1 IP address (loopback)", async () => {
			const tool = createWebFetchTool();
			const result = await tool.execute("test-call-ssrf-2", {
				url: "http://127.0.0.1/test",
			});

			const output = getTextOutput(result);
			expect(output).toBe("Error: URL not allowed");
		});

		it("should block all 127.x.x.x addresses", async () => {
			const tool = createWebFetchTool();

			for (const ip of ["127.0.0.1", "127.0.0.2", "127.255.255.255"]) {
				const result = await tool.execute(`test-call-ssrf-127-${ip}`, {
					url: `http://${ip}/test`,
				});

				const output = getTextOutput(result);
				expect(output).toBe("Error: URL not allowed");
			}
		});

		it("should block IPv6 loopback ::1", async () => {
			const tool = createWebFetchTool();
			const result = await tool.execute("test-call-ssrf-ipv6-1", {
				url: "http://[::1]:8080/test",
			});

			const output = getTextOutput(result);
			expect(output).toBe("Error: URL not allowed");
		});

		it("should block 10.x.x.x private network", async () => {
			const tool = createWebFetchTool();
			const result = await tool.execute("test-call-ssrf-3", {
				url: "http://10.0.0.1/test",
			});

			const output = getTextOutput(result);
			expect(output).toBe("Error: URL not allowed");
		});

		it("should block entire 10.x.x.x range (low boundary)", async () => {
			const tool = createWebFetchTool();
			const result = await tool.execute("test-call-ssrf-3a", {
				url: "http://10.0.0.0/test",
			});

			const output = getTextOutput(result);
			expect(output).toBe("Error: URL not allowed");
		});

		it("should block entire 10.x.x.x range (high boundary)", async () => {
			const tool = createWebFetchTool();
			const result = await tool.execute("test-call-ssrf-3b", {
				url: "http://10.255.255.255/test",
			});

			const output = getTextOutput(result);
			expect(output).toBe("Error: URL not allowed");
		});

		it("should block 172.16-31.x.x private network", async () => {
			const tool = createWebFetchTool();
			const result = await tool.execute("test-call-ssrf-4", {
				url: "http://172.16.0.1/test",
			});

			const output = getTextOutput(result);
			expect(output).toBe("Error: URL not allowed");
		});

		it("should block 172.31.x.x range (high boundary)", async () => {
			const tool = createWebFetchTool();
			const result = await tool.execute("test-call-ssrf-4a", {
				url: "http://172.31.255.255/test",
			});

			const output = getTextOutput(result);
			expect(output).toBe("Error: URL not allowed");
		});

		it("should allow 172.15.x.x (just outside range)", async () => {
			const tool = createWebFetchTool();
			// This should NOT be blocked (172.15 is outside 172.16-31 range)
			// Note: fetch will fail for other reasons, but not SSRF
			vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("Network error"));

			const result = await tool.execute("test-call-ssrf-4b", {
				url: "http://172.15.255.255/test",
			});

			const output = getTextOutput(result);
			// Should get network error, NOT SSRF block
			expect(output).not.toBe("Error: URL not allowed");
		});

		it("should allow 172.32.x.x (just outside range)", async () => {
			const tool = createWebFetchTool();
			vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("Network error"));

			const result = await tool.execute("test-call-ssrf-4c", {
				url: "http://172.32.0.0/test",
			});

			const output = getTextOutput(result);
			expect(output).not.toBe("Error: URL not allowed");
		});

		it("should block 192.168.x.x private network", async () => {
			const tool = createWebFetchTool();
			const result = await tool.execute("test-call-ssrf-5", {
				url: "http://192.168.1.1/test",
			});

			const output = getTextOutput(result);
			expect(output).toBe("Error: URL not allowed");
		});

		it("should block entire 192.168.x.x range", async () => {
			const tool = createWebFetchTool();
			const result = await tool.execute("test-call-ssrf-5a", {
				url: "http://192.168.0.0/test",
			});

			const output = getTextOutput(result);
			expect(output).toBe("Error: URL not allowed");
		});

		it("should block 169.254.x.x link-local addresses (AWS metadata)", async () => {
			const tool = createWebFetchTool();
			const result = await tool.execute("test-call-ssrf-6", {
				url: "http://169.254.169.254/latest/meta-data/",
			});

			const output = getTextOutput(result);
			expect(output).toBe("Error: URL not allowed");
		});

		it("should block various internal IP ranges", async () => {
			const tool = createWebFetchTool();
			const internalIps = [
				"http://10.1.2.3/test",
				"http://10.254.253.254/test",
				"http://172.20.100.50/test",
				"http://172.30.1.1/test",
				"http://192.168.100.1/test",
				"http://192.168.255.254/test",
			];

			for (const ip of internalIps) {
				const result = await tool.execute(`test-call-internal-${ip}`, {
					url: ip,
				});

				const output = getTextOutput(result);
				expect(output).toBe("Error: URL not allowed");
			}
		});

		it("should distinguish 'URL not allowed' from other errors", async () => {
			const tool = createWebFetchTool();

			// SSRF blocked
			const blockedResult = await tool.execute("test-call-dist-1", {
				url: "http://localhost/test",
			});
			const blockedOutput = getTextOutput(blockedResult);
			expect(blockedOutput).toBe("Error: URL not allowed");

			// Network error (different message)
			vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("Connection refused"));
			const networkResult = await tool.execute("test-call-dist-2", {
				url: "https://example.com/network-error",
			});
			const networkOutput = getTextOutput(networkResult);
			expect(networkOutput).not.toBe("Error: URL not allowed");
		});

		it("should block http:// and https:// for internal hosts", async () => {
			const tool = createWebFetchTool();

			// Both protocols should be blocked for localhost
			const httpResult = await tool.execute("test-call-proto-1", {
				url: "http://localhost/test",
			});
			expect(getTextOutput(httpResult)).toBe("Error: URL not allowed");

			const httpsResult = await tool.execute("test-call-proto-2", {
				url: "https://localhost/test",
			});
			expect(getTextOutput(httpsResult)).toBe("Error: URL not allowed");
		});
	});

	describe("Jina Reader Integration", () => {
		afterEach(() => {
			vi.restoreAllMocks();
		});

		it("should use Jina Reader API endpoint", async () => {
			vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
				new Response("# Test", {
					status: 200,
					headers: { "content-type": "text/markdown" },
				}),
			);

			const tool = createWebFetchTool();
			await tool.execute("test-call-jina-1", {
				url: "https://example.com/article",
			});

			expect(globalThis.fetch).toHaveBeenCalled();
			const callUrl = new URL((globalThis.fetch as any).mock.calls[0][0] as string);
			expect(callUrl.hostname).toBe("r.jina.ai");
			expect(callUrl.pathname).toBe("/https://example.com/article");
		});

		it("should strip Jina Reader metadata prefix", async () => {
			// Jina Reader sometimes adds metadata lines
			const jinaResponse = `Title: Example Article
URL: https://example.com/article

# Example Article

This is the actual content.
`;

			vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
				new Response(jinaResponse, {
					status: 200,
					headers: { "content-type": "text/markdown" },
				}),
			);

			const tool = createWebFetchTool();
			const result = await tool.execute("test-call-jina-2", {
				url: "https://example.com/article",
			});

			const output = getTextOutput(result);
			// Output should start with # heading, not metadata
			expect(output).toMatch(/^#\s+/);
			expect(output).not.toContain("Title:");
			expect(output).not.toContain("URL:");
			expect(output).not.toContain("Source:");
		});

		it("should return error for Jina Reader failure", async () => {
			vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
				new Response("", { status: 502, statusText: "Bad Gateway" }),
			);

			const tool = createWebFetchTool();
			const result = await tool.execute("test-call-jina-err-1", {
				url: "https://example.com/fail",
			});

			const output = getTextOutput(result);
			expect(output).toMatch(/^Error:/);
		});
	});

	describe("Title Extraction", () => {
		afterEach(() => {
			vi.restoreAllMocks();
		});

		it("should use first # heading as title", async () => {
			const jinaResponse = `# First Heading

Content before heading.

## Second Heading

More content.
`;

			vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
				new Response(jinaResponse, {
					status: 200,
					headers: { "content-type": "text/markdown" },
				}),
			);

			const tool = createWebFetchTool();
			const result = await tool.execute("test-call-title-1", {
				url: "https://example.com/article",
			});

			const output = getTextOutput(result);
			expect(output).toContain("# First Heading");
		});

		it("should default to 'Untitled' if no heading and no URL path", async () => {
			const jinaResponse = `No headings here, just plain text.
Some more content without any markdown headings.
`;

			vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
				new Response(jinaResponse, {
					status: 200,
					headers: { "content-type": "text/markdown" },
				}),
			);

			const tool = createWebFetchTool();
			// Use root URL with no path
			const result = await tool.execute("test-call-title-2", {
				url: "https://example.com/",
			});

			const output = getTextOutput(result);
			expect(output).toContain("# Untitled");
		});

		it("should derive title from URL path as fallback", async () => {
			const jinaResponse = `Plain text without heading.
`;

			vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
				new Response(jinaResponse, {
					status: 200,
					headers: { "content-type": "text/markdown" },
				}),
			);

			const tool = createWebFetchTool();
			const result = await tool.execute("test-call-title-3", {
				url: "https://example.com/blog/my-interesting-article",
			});

			const output = getTextOutput(result);
			// Should derive from URL path, converting dash/underscore to space
			expect(output).toContain("my interesting article");
		});
	});

	describe("Readability Pipeline", () => {
		afterEach(() => {
			vi.restoreAllMocks();
		});

		it("should handle content that cannot be extracted", async () => {
			vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("", { status: 200 }));

			const tool = createWebFetchTool();
			const result = await tool.execute("test-call-read-1", {
				url: "https://example.com/empty-page",
			});

			const output = getTextOutput(result);
			expect(output).toContain("No content could be extracted");
		});

		it("should handle page with only HTML tags in markdown", async () => {
			vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
				new Response("<html><body><div></div></body></html>", { status: 200 }),
			);

			const tool = createWebFetchTool();
			const result = await tool.execute("test-call-read-2", {
				url: "https://example.com/html-only",
			});

			const output = getTextOutput(result);
			// Should return error or no-content message
			expect(output).toMatch(/Error:|No content/i);
		});
	});
});

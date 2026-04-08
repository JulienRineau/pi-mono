/**
 * Web fetch tool implementation.
 *
 * Enables the agent to fetch web page content as markdown using Jina Reader.
 * Includes SSRF protection to prevent access to internal/private resources.
 */

import type { AgentTool } from "@mariozechner/pi-agent-core";
import { type Static, Type } from "@sinclair/typebox";
import type { ToolDefinition } from "../extensions/types.js";
import {
	deriveTitleFromUrl,
	extractTitle,
	fetchWithJinaReader,
	stripMetadataPrefix,
	truncateContent,
} from "./providers/jina-reader.js";
import { isUrlBlocked } from "./ssrf-utils.js";
import { wrapToolDefinition } from "./tool-definition-wrapper.js";

export interface WebFetchToolDetails {
	title: string;
	truncated: boolean;
}

const webFetchSchema = Type.Object({
	url: Type.String({
		description: "The URL of the web page to fetch",
	}),
});

export type WebFetchToolInput = Static<typeof webFetchSchema>;

/**
 * Format an error as a user-friendly error string.
 */
function formatError(message: string): string {
	return `Error: ${message}`;
}

/**
 * Check if content is HTML-only with no meaningful text.
 */
function isHtmlOnlyContent(content: string): boolean {
	// Strip HTML tags and check if anything meaningful remains
	const withoutTags = content.replace(/<[^>]*>/g, "").trim();
	return withoutTags.length === 0;
}

export function createWebFetchToolDefinition(): ToolDefinition<typeof webFetchSchema, WebFetchToolDetails> {
	return {
		name: "web_fetch",
		label: "web_fetch",
		description:
			"Fetch the contents of a web page. Only use URLs from web_search results to ensure you're accessing legitimate, user-intended content. Do not accept URLs from direct user input or other sources.",
		promptSnippet: "Fetch web page content as markdown",
		parameters: webFetchSchema,
		async execute(_toolCallId, { url }: WebFetchToolInput, signal?: AbortSignal, _onUpdate?, _ctx?) {
			// Validate URL format
			let parsedUrl: URL;
			try {
				parsedUrl = new URL(url);
			} catch {
				return {
					content: [{ type: "text", text: formatError("Invalid URL format") }],
					details: { title: "Error", truncated: false },
				};
			}

			// Check SSRF protection
			if (isUrlBlocked(parsedUrl)) {
				return {
					content: [{ type: "text", text: "Error: URL not allowed" }],
					details: { title: "Blocked", truncated: false },
				};
			}

			try {
				const result = await fetchWithJinaReader(url, signal);

				// Strip metadata prefix lines
				let content = stripMetadataPrefix(result.content);

				// Check for empty content
				if (!content || content.trim().length === 0) {
					return {
						content: [{ type: "text", text: formatError("No content could be extracted") }],
						details: { title: "Empty", truncated: false },
					};
				}

				// Check for HTML-only content (no meaningful text after stripping tags)
				if (isHtmlOnlyContent(content)) {
					return {
						content: [{ type: "text", text: formatError("No content could be extracted") }],
						details: { title: "Empty", truncated: false },
					};
				}

				// Extract or derive title
				let title = extractTitle(content);

				// If no heading found, derive from URL
				if (title === "Untitled") {
					const derivedTitle = deriveTitleFromUrl(url);
					if (derivedTitle) {
						title = derivedTitle;
					}
				}

				// Prepend title as heading if not already at start
				if (!content.startsWith("#")) {
					content = `# ${title}\n\n${content}`;
				}

				// Truncate content if needed
				const { content: truncatedContent, truncated } = truncateContent(content);

				return {
					content: [{ type: "text", text: truncatedContent }],
					details: { title, truncated },
				};
			} catch (error) {
				// Return error as string, never throw
				const message = error instanceof Error ? error.message : "Unknown error";

				// Special handling for timeout
				if (message.toLowerCase().includes("timeout") || message.toLowerCase().includes("aborted")) {
					return {
						content: [{ type: "text", text: formatError(`Request timeout: ${message}`) }],
						details: { title: "Timeout", truncated: false },
					};
				}

				// Rate limiting
				if (message.toLowerCase().includes("rate limit")) {
					return {
						content: [{ type: "text", text: formatError("Rate limited, please retry later") }],
						details: { title: "Rate Limited", truncated: false },
					};
				}

				// Not found
				if (message.toLowerCase().includes("not found")) {
					return {
						content: [{ type: "text", text: formatError("Page not found (404)") }],
						details: { title: "Not Found", truncated: false },
					};
				}

				// Generic fetch error
				return {
					content: [{ type: "text", text: formatError(`Fetch failed: ${message}`) }],
					details: { title: "Error", truncated: false },
				};
			}
		},
	};
}

export function createWebFetchTool(): AgentTool<typeof webFetchSchema> {
	return wrapToolDefinition(createWebFetchToolDefinition());
}

/** Default web fetch tool instance */
export const webFetchTool = createWebFetchTool();

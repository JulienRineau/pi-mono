/**
 * Web search tool implementation.
 *
 * Enables the agent to search the web for information using DuckDuckGo.
 */

import type { AgentTool } from "@mariozechner/pi-agent-core";
import { type Static, Type } from "@sinclair/typebox";
import type { ToolDefinition } from "../extensions/types.js";
import { searchDuckDuckGo, type WebSearchResult } from "./providers/duckduckgo.js";
import { wrapToolDefinition } from "./tool-definition-wrapper.js";

export interface WebSearchToolDetails {
	results: WebSearchResult[];
}

const webSearchSchema = Type.Object({
	query: Type.String({
		description: "The search query to find information on the web",
	}),
	max_results: Type.Optional(
		Type.Number({
			description: "Maximum number of results to return (default: 5)",
			minimum: 1,
			maximum: 20,
		}),
	),
});

export type WebSearchToolInput = Static<typeof webSearchSchema>;

export function createWebSearchToolDefinition(): ToolDefinition<
	typeof webSearchSchema,
	WebSearchToolDetails | undefined
> {
	return {
		name: "web_search",
		label: "web_search",
		description:
			"Search the web for information. Use this tool to find current information, news, articles, and facts from the internet.",
		promptSnippet: "Search the web for information",
		parameters: webSearchSchema,
		async execute(_toolCallId, { query, max_results }: WebSearchToolInput, signal?: AbortSignal, _onUpdate?, _ctx?) {
			// Validate query
			if (!query || query.trim() === "") {
				return {
					content: [{ type: "text", text: JSON.stringify({ error: "Empty query", retry: false }) }],
					details: undefined,
				};
			}

			const effectiveMaxResults = max_results ?? 5;

			try {
				const results = await searchDuckDuckGo(query, effectiveMaxResults, signal);

				// If no results, treat as parse failure
				if (results.length === 0) {
					return {
						content: [
							{
								type: "text",
								text: JSON.stringify({ error: "Search failed", retry: false }),
							},
						],
						details: undefined,
					};
				}

				return {
					content: [{ type: "text", text: JSON.stringify({ results }, null, 2) }],
					details: { results },
				};
			} catch (error) {
				// Return error as JSON, never throw
				const message = error instanceof Error ? error.message : "Unknown error";

				// Check for rate limiting
				const isRateLimit = message.toLowerCase().includes("rate limit");

				return {
					content: [
						{
							type: "text",
							text: JSON.stringify({
								error: isRateLimit ? "Search rate limited" : "Search failed",
								retry: true,
							}),
						},
					],
					details: undefined,
				};
			}
		},
	};
}

export function createWebSearchTool(): AgentTool<typeof webSearchSchema> {
	return wrapToolDefinition(createWebSearchToolDefinition());
}

/** Default web search tool instance */
export const webSearchTool = createWebSearchTool();

export type { WebSearchResult };

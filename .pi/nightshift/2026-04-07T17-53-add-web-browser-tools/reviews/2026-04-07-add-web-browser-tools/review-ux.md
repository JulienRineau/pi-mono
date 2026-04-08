---
reviewer: review-ux
verdict: conditional
target: 2026-04-07-add-web-browser-tools
scope: plan
reviewed-at: 2026-04-07T18:26:58.261Z
---

## Critical
None — no blocking UX issues identified.

## Warnings

- **Plan §web_fetch "Truncate to 4096 chars"**: The plan specifies truncation but omits the notification format. The existing `read.ts` tool establishes a clear pattern with actionable guidance:
  ```
  [Truncated: showing X of Y lines (N line limit)]
  [Showing lines X-Y of Z. Use offset=N to continue.]
  ```
  The web tools plan is silent on this. The LLM and human users need to know how to retrieve the rest of the content. The plan should specify a similar "Use next_results_offset=N" or equivalent for the search pagination.

- **Plan §web_fetch URL validity criteria**: The Edge Cases section lists "Invalid URL" but the plan never defines what makes a URL valid. Test `web-fetch.test.ts:105` uses `new URL(url)` which requires `http://` or `https://` protocols. The plan should explicitly state that only `http://` and `https://` are allowed, matching what `new URL()` accepts.

- **Plan §web_search rate limit format**: The Edge Cases section mentions "retry hint" but does not define the JSON error shape for rate limits. For consistency, the plan should specify something like:
  ```json
  {"error": "rate limited", "retryAfter": 60}
  ```

- **Plan missing TUI rendering functions**: The `read.ts` reference implementation includes `renderCall` and `renderResult` functions that format tool calls/results for the TUI. The web tools plan has no mention of these. Without them, the tools may render awkwardly or incompletely in interactive mode. The plan should include implementation steps for these functions.

## Approved

- **Error-as-string pattern**: Returning errors as strings (not thrown exceptions) follows the DeerFlow pattern. This enables emergent retry behavior without orchestration code — a well-designed choice for autonomous agents.

- **API ergonomics**: `web_search(query, max_results=5)` and `web_fetch(url)` are minimal interfaces with sensible defaults. The 5-result default is reasonable.

- **Factory function pattern**: The plan follows the established `createWebSearchToolDefinition()` / `createWebSearchTool()` pattern from `read.ts`, ensuring consistency.

- **Title extraction fallback**: Defaulting to "Untitled" when no title is present prevents malformed output.

- **Tool naming**: `web_search` / `web_fetch` with `web_` prefix clearly groups related functionality.

- **No new dependencies**: Using DuckDuckGo HTML endpoint and Jina Reader API with no new npm packages is the right constraint for this tool.

- **Restrictive docstring intent**: The plan correctly identifies the restrictive docstring on `web_fetch` as critical for LLM behavior.

## Suggestions

- **Add TUI rendering documentation**: The plan references the `read.ts` pattern but doesn't explicitly require `renderCall`/`renderResult`. Consider adding a checklist item: "Implement `renderCall` and `renderResult` for TUI display, following the pattern in `read.ts` lines 108-120."

- **CLI convenience**: The plan mentions "same group for unified activation" but doesn't specify how. Consider adding: `--tools web` alias that activates both `web_search` and `web_fetch` together.

- **User-facing feedback section**: Add a section describing what users see when the agent uses these tools in TUI mode (tool call rendering, results display, truncation notices).

## Summary

The plan is well-structured and follows established patterns. The error-as-string retry pattern and restrictive docstring design are sound. The Warnings above identify gaps in truncation notification format, URL validity criteria, rate limit error shape, and TUI rendering that should be clarified before implementation. These are consistency and completeness issues, not blocking problems — the plan can proceed once these details are specified.

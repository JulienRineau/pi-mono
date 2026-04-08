---
reviewer: reviewer-ux
verdict: conditional
target: 2026-04-07-add-web-browser-tools
scope: plan
reviewed-at: 2026-04-07T23:59:16.341Z
---

## Critical
- None identified. The plan addresses user-facing aspects adequately.

## Warnings
- **System prompt guidance lacks example content**: The spec requires "Skill or system prompt guidance on when to use fetch vs snippets" but the plan's Constraints section mentions this without specifying what the `promptGuidelines` should actually contain. The implementation currently has:
  - web_search: "Use web_search to find multiple relevant sources", "Review search results and fetch multiple pages in parallel"
  - web_fetch: "Only fetch URLs from web_search results", "Fetch multiple pages in parallel"
  
  This covers the basics but lacks guidance on when to use the snippet vs. doing a full fetch (e.g., "Use snippets for quick overviews; use fetch for detailed information"). Consider adding this nuance to `promptGuidelines` in `web-search.ts` line 37-40 and `web-fetch.ts` line 41-44.

## Approved
- **Error message patterns are clear and actionable**: web_search returns `{"error": "message"}` and web_fetch returns `"Error: ..."` strings. Both patterns are appropriate for LLM consumption and enable natural retry behavior.
- **API ergonomics are minimal and sensible**: web_search takes `{query, max_results?}` and web_fetch takes `{url}` — minimal parameters with sensible defaults.
- **Edge cases are well-documented in the plan**: Empty query, invalid URLs, rate limiting (429), empty responses, timeouts, and non-HTML content all have defined error behaviors.
- **CLI documentation is included**: Milestone 3 step 2 updates help text from "Available: read, bash, edit, write, grep, find, ls" to include web_search and web_fetch.
- **Docstrings include the critical URL restriction**: The web_fetch docstring explicitly states "Only use URLs from web_search results" — this is critical for LLM behavior as mentioned in the spec and DeerFlow background.
- **4096 char truncation is specified**: Both the spec and plan clearly state the truncation limit with truncation notice requirement.
- **Degraded states have appropriate messages**: "Error: Empty response", "Error: 429", "Error: Invalid URL" are all user-facing friendly compared to raw HTTP codes or stack traces.

## Suggestions
- **Consider adding a truncation indicator format**: The spec says "If truncated, append truncation notice" but doesn't specify the format. Consider something like `... [truncated to 4096 chars]` for clarity.
- **No migration path needed**: This is a new feature with no behavior changes to existing functionality. Users discover it when they need research capabilities.
- **No accessibility concerns for non-UI tool**: These are CLI/agent tools without visual interface elements. Tool result formatting is plain text, which is appropriate.

## Summary
The plan demonstrates solid UX considerations for a tool-based feature. Error messages are well-defined and actionable for LLMs, API parameters are minimal and sensible, and edge cases are comprehensively addressed. The main gap is a missing concrete example of the "when to use fetch vs snippets" guidance content. This is a Warning rather than Critical because the existing `promptGuidelines` arrays provide reasonable direction.
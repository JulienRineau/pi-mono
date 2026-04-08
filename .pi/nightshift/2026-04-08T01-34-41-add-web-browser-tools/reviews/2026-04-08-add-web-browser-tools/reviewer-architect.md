---
reviewer: architect-reviewer
verdict: conditional
target: 2026-04-08-add-web-browser-tools
scope: plan
reviewed-at: 2026-04-08T02:08:40.716Z
---

## Critical
- None. No blocking architectural issues found.

## Warnings
- `plan:Milestone 1` — DuckDuckGo HTML parsing is fragile. Parsing HTML with regex to extract search results will break when DuckDuckGo changes their DOM structure. The plan documents this in Risks but proposes no monitoring or resilience strategy beyond "update selector regex." Consider: logging a warning when results are unexpectedly empty, and accepting DuckDuckGo API (paid) or an alternative search provider as a future escape hatch.

- `plan:Milestone 2` — DuckDuckGo rate limiting (500ms delay) is insufficient for agent workloads. A research task with 10-20 search calls in quick succession will hit rate limits. The "LLM retries naturally" mitigation assumes the error message is informative enough for the LLM to back off. This may work but is untested. Consider documenting the expected behavior explicitly in the system prompt guidance.

- `plan:Milestone 3` — DNS rebinding protection via "HTTP hostname verification on redirect" is mentioned in decisions but not detailed in the implementation plan. Without knowing the redirect behavior, it's unclear whether the tool handles:
  1. Initial resolve → validate IP → fetch
  2. Detect redirect to new host → re-resolve → re-validate
  
  The plan should specify this two-step flow explicitly to avoid SSRF gaps.

- `plan:Milestone 3` — Truncation to 4096 chars includes the title prefix and truncation indicator. This means a 4080-char title leaves only 16 chars for content. The title extraction should cap the title length (e.g., 200 chars) to ensure content is always present.

- `plan:Interfaces` — Provider functions (`searchDuckDuckGo`, `fetchWithJina`, `resolveAndValidateIp`) are implementation details but appear in the interface section. These should be marked internal or removed from the Interfaces section.

- `plan:Milestone 4` — CLI help text in `args.ts` lists available tools but the plan's step 5 doesn't specify updating the help text. Users won't know `web_search` and `web_fetch` exist without this.

## Approved
- Milestone decomposition is clear and logical: infrastructure (M1) → web_search (M2) → web_fetch (M3) → docs (M4) → integration tests (M5).
- File structure follows existing patterns: `createXTool()` factory functions, `createXToolDefinition()`, `wrapToolDefinition` for `AgentTool`.
- Interface definitions are well-specified: `WebSearchResult`, `JinaResult`, `ValidationResult`, `IpValidationResult`.
- Error-as-string pattern is correctly implemented: JSON error objects for `web_search`, plain strings for `web_fetch`.
- Settings abstraction via `WebToolsSettings` interface with `DEFAULT_WEB_TOOLS_SETTINGS` allows configuration without touching implementation.
- Provider separation (`duckduckgo.ts`, `jina-reader.ts`) enables swapping implementations later.
- SSRF protection design is sound: validate resolved IP before fetch, block private/reserved ranges.
- Tool registration in `index.ts` follows existing `allTools` / `allToolDefinitions` pattern with `ToolName` type union extension.

## Suggestions
- Add a health check endpoint or error counter to detect DuckDuckGo parsing failures automatically.
- Consider adding a `--tools web` expansion in `parseArgs` that maps to `["web_search", "web_fetch"]` for convenience.
- Add explicit test for title length capping before building the markdown output.
- Document the privacy trade-off (URLs sent to Jina Reader) in the tool docstrings, not just the README.
- Consider making the rate limit delay configurable via settings for users who need different throttling.

## Summary
The plan follows existing architectural patterns consistently and the module structure is sound. The primary concern is DuckDuckGo HTML parsing fragility — an inherent risk of scraping without an API that should be monitored post-implementation. Secondary concerns are around DNS rebinding protection completeness and truncation edge cases with long titles. None of these are blockers for implementation to proceed.

---
reviewer: architect-reviewer
verdict: conditional
target: 2026-04-07-add-web-browser-tools
scope: plan
reviewed-at: 2026-04-07T18:18:46.750Z
---

## Critical
- `Plan:Implementation Approach` vs `Plan:Milestones` mismatch: The implementation approach section shows `packages/coding-agent/src/core/tools/providers/` subdirectory for DuckDuckGo and Jina implementations, but no milestone creates this directory. The milestone files are `web-search.ts` and `web-fetch.ts` directly in `tools/`.

- `Test expectations vs index.ts pattern`: The integration test file (`web-tools-integration.test.ts:47-51`) expects both factory functions AND direct exports (`webSearchTool`, `webFetchTool`) from `tools/index.ts`. However, the current `index.ts` only provides factory functions (no singleton exports). The plan doesn't address this inconsistency.

- **Tool grouping mechanism missing**: The spec states "Both tools in same group ('web') for unified activation" and "Skill or system prompt guidance on when to use fetch vs snippets", and the integration test expects a 'web' shortcut for CLI. However, the plan provides no implementation approach for:
  - How tool groups work in the agent system
  - Whether a "web" tool name enables both search and fetch
  - Where the system prompt guidance/promptGuidelines would be defined

## Warnings
- **Jina Reader API format**: The plan specifies using `https://r.jina.ai/{url}` but Jina Reader returns raw markdown without a title prefix. The output format requires `# {title}\n\n{markdown}` but Jina doesn't provide this structure. The plan notes "Extract title from content" in Milestone 2 Step 4 but provides no implementation approach for this.

- **DuckDuckGo HTML parsing fragile**: The plan relies on scraping DuckDuckGo HTML (`html.duckduckgo.com/html/?q=`) with CSS selectors like `result__a` and `result__snippet`. This is brittle—if DuckDuckGo changes their HTML structure, the tool breaks with no recovery mechanism.

- **Tests mock JSON responses but DuckDuckGo returns HTML**: The test `web-search.test.ts:41-54` mocks `global.fetch` to return JSON, but the actual DuckDuckGo endpoint returns HTML that must be parsed. The tests will pass with mocked JSON but the real implementation needs HTML parsing logic.

- **Inconsistent error return formats**: `web_search` returns `{ content: [{ type: "text", text: JSON.stringify({error: "..."}) }] }` while `web_fetch` returns `{ content: [{ type: "text", text: "Error: ..." }] }`. This asymmetry isn't justified and tests expect different behaviors for each.

- **No URL validation**: The spec mentions "Invalid URL" error for `web_fetch` but the plan doesn't specify where this validation occurs. URL validation should happen before network requests to avoid wasted bandwidth.

- **Settings integration unclear**: The spec mentions "Configurable max_results via settings" and "web search settings" in integration tests, but no milestone addresses how settings are passed to the tools (constructor? execute params?).

## Approved
- **TDD approach with comprehensive tests**: 64 tests (19 web_search + 27 web_fetch + 18 integration) provide excellent coverage before implementation. This is a strong foundation.

- **Clear separation of concerns**: Two dedicated files (`web-search.ts`, `web-fetch.ts`) with single responsibilities. Factory functions provide good abstraction layer.

- **Consistency with existing patterns**: Plan correctly references `read.ts` as the implementation pattern. Uses TypeBox schema, `wrapToolDefinition`, and exports pattern consistent with existing tools.

- **Well-structured milestones**: Four milestones with clear validation criteria (test commands). Each milestone builds on the previous.

- **Error resilience design**: Error-as-strings pattern (never throw) is sound for LLM retry behavior. Edge cases are well-documented.

- **No new dependencies**: Using DuckDuckGo HTML and Jina Reader free tier satisfies the constraint. No npm packages needed.

- **Factory function pattern matches existing code**: `createWebSearchToolDefinition()` and `createWebSearchTool()` match the existing `createReadToolDefinition()` pattern.

- **Proper TypeBox usage**: Schema definition follows existing conventions with proper parameter descriptions.

## Suggestions
- **Clarify tool grouping mechanism**: Add a section explaining how "web" group activation would work—does it add both tools to `activeTools`? Is there a group registry?

- **Document the Jina Reader title extraction approach**: Specify how to extract or generate title when Jina's markdown lacks one. Options: parse first `# heading`, use URL domain as fallback, or request with `/v2` endpoint for structured response.

- **Consider fallback for DuckDuckGo**: Add a note about monitoring for HTML changes or preparing alternative scraping approaches if DuckDuckGo breaks.

- **Add Settings integration to Milestone 3**: Clarify how `tools/web-search.ts` accepts settings (options object) and how those options flow from `createAllTools(cwd, options)`.

- **Consider caching at the architecture level**: While out of scope for MVP, the architecture should note where caching could be added later (tool execute level vs provider level).

- **Add promptGuidelines content**: The spec mentions "system prompt guidance on when to use fetch vs snippets" and "Encourages parallel tool calling". Specify what the `promptGuidelines` array should contain.

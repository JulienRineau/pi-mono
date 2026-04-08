---
reviewer: code-review
verdict: pass
target: 2026-04-07-add-web-browser-tools
scope: plan
reviewed-at: 2026-04-07T18:19:37.215Z
---

## Critical
None.

## Warnings
- **Line 1-50 of Milestone 1-2**: Plan claims "No new npm packages required" but DuckDuckGo HTML scraping requires HTML parsing. Need to verify that DOMParser or regex-based parsing is sufficient. The existing `marked` package could help, but a clear strategy should be documented.

- **Missing Settings milestone**: Tests expect `webSearch.maxResults` and `webFetch.maxChars` settings (web-tools-integration.test.ts:120-131), but no milestone explicitly covers extending `src/core/settings-manager.ts:Settings` interface.

- **Milestone scope**: TDD tests exist (64 total: 19 search + 27 fetch + 18 integration), but milestones don't explicitly include "write tests" since they're already written. Consider adding a "validate tests pass" step to each milestone.

## Approved
- **File structure**: Follows existing conventions (`web-search.ts`, `web-fetch.ts` alongside `read.ts`, `bash.ts`, etc.)
- **Factory pattern**: Correctly uses `createWebSearchToolDefinition()` / `createWebSearchTool()` pattern matching existing tools
- **TypeBox schemas**: Schema design matches `read.ts` patterns (`Type.Object`, `Static<typeof schema>`)
- **Error patterns**: Distinct error formats per spec (JSON for search, plain string for fetch) correctly documented
- **Provider choices**: DuckDuckGo + Jina Reader both have free tiers, no API keys required
- **Tool registration**: Plan correctly shows adding to `allTools`, `allToolDefinitions`, and factory functions in `index.ts`
- **Docstring requirements**: Restrictive docstring for `web_fetch` (URLs from search results only) and descriptive docstring for `web_search` both specified
- **Test coverage**: Comprehensive tests already written covering acceptance criteria, edge cases, error handling, and integration
- **Spec alignment**: All 11 spec acceptance criteria addressed in plan requirements table

## Suggestions
- **Milestone 1**: Add explicit note that DuckDuckGo HTML parsing will use `DOMParser` or regex (no new dependencies)
- **Milestone 2**: Clarify that Jina Reader returns markdown directly, eliminating need for Readability library
- **Settings**: Add explicit milestone step to extend `Settings` interface with `webSearch` and `webFetch` settings
- **CLI integration**: Consider documenting how `web` as a shortcut (enabling both `web_search` and `web_fetch`) works with `--tools` flag

## Summary
Plan is well-structured and follows existing codebase conventions. No critical blockers. The missing Settings milestone and "no new packages" claim should be verified during execution. Test files are already written (64 tests total), making this a straightforward implementation following the established patterns in `read.ts` and other tools.

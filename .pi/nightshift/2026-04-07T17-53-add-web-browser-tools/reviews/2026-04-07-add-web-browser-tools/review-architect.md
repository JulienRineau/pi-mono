---
reviewer: review-architect
verdict: conditional
target: 2026-04-07-add-web-browser-tools
scope: plan
reviewed-at: 2026-04-07T18:27:47.586Z
---

## Critical
- **Test-to-implementation mismatch on tool factory signatures**: Tests expect `createWebSearchTool()` and `createWebFetchTool()` without arguments (see `web-tools-integration.test.ts:81-82`, `web-tools-integration.test.ts:343-344`). However, existing tools like `createReadToolDefinition(cwd: string, options?)` (`read.ts:264`) require a `cwd` argument. The plan's implementation interface section shows signatures without `cwd`, which is correct since web tools are URL-based and need no filesystem context. **The plan should explicitly note this anomaly: web tool factories intentionally skip the `cwd` parameter required by file-system tools.** If the worker follows the existing pattern literally, tests will fail.

## Warnings
- **"web" tool group mention is not implemented in codebase**: The spec states tools should be "in same group ('web') for unified activation" and tests reference this (`web-fetch.test.ts:402`), but the current tool registry (`index.ts`) has no `group` concept. The CLI `--tools` flag validates against `allTools` keys only. Adding a `web` group shortcut would require modifying `cli/args.ts` and `agent-session.ts`. The plan should either scope this as out-of-scope or add a milestone step to implement group shortcuts.

- **DuckDuckGo HTML parsing is fragile**: DuckDuckGo's HTML structure is undocumented and subject to change. The plan mentions HTML parsing in Milestone 1 but provides no fallback strategy beyond test coverage. The Risks section mentions "HTML parsing may break with site updates" but doesn't propose mitigations. Consider adding a note that if HTML structure changes, the implementation may need updating or a fallback to a JSON API.

- **Missing Settings interface integration**: Tests reference `Settings.webSearch.maxResults` and `Settings.webFetch.maxChars` (`web-tools-integration.test.ts:118-128`), but the plan doesn't mention where Settings are defined or how web tools access them. The existing `ToolsOptions` interface in `index.ts` would need web-specific options, or a new `WebToolOptions` interface.

- **Test expectations unclear on DuckDuckGo response format**: Tests mock `global.fetch` expecting JSON responses (`web-search.test.ts:61`), but DuckDuckGo's HTML endpoint returns HTML, not JSON. The tests expect JSON parsing of mock responses. Implementation will need to either mock the parsing layer or tests need adjustment. The plan's step 3 mentions "Parse HTML results" but tests assume JSON input.

## Approved
- **DeerFlow pattern is well-founded**: Using DuckDuckGo HTML + Jina Reader API without API keys is a solid constraint choice. The error-as-string pattern matches the stated goal of enabling natural retry behavior.

- **Test-first approach is appropriate**: Having 64 tests across three files before implementation is good TDD practice. Tests cover schema, return format, error cases, edge cases, and integration scenarios.

- **Milestone decomposition is logical**: Separating web_search (Milestone 1) from web_fetch (Milestone 2) from registration (Milestone 3) from validation (Milestone 4) provides clear checkpoints.

- **Factory function pattern is correct**: The plan's interface section correctly shows `createWebSearchTool()` and `createWebFetchTool()` without `cwd` — appropriate for web tools that don't need filesystem context. The existing `wrapToolDefinition` abstraction (`tool-definition-wrapper.ts:5`) is the right way to bridge `ToolDefinition` to `AgentTool`.

- **Error return formats are well-specified**: Distinction between JSON error for web_search and plain "Error:" string for web_fetch is intentional and documented. Tests verify both patterns.

- **File structure is consistent**: Adding `web-search.ts` and `web-fetch.ts` alongside existing tools follows the established pattern.

## Suggestions
- Add an explicit section on "Tool Group Support" with a decision: whether to implement the `web` group shortcut now (modifying CLI and agent-session) or defer to a future enhancement.

- Consider adding a "Content-Type Detection" subsection to handle edge cases (PDF, images, office documents) beyond the current spec's "Unsupported content type" error.

- Add validation criteria in each milestone that explicitly addresses the test file assertions, e.g., "Milestone 1: Run web-search.test.ts, expect 19 passing."

## Summary
The plan is well-structured and follows existing tool patterns. The primary concern is a mismatch between test expectations (factory functions without `cwd`) and existing tool conventions (factories requiring `cwd`). Web tools are correctly identified as needing no filesystem context, so factory functions should skip `cwd`. The plan should make this explicit. Secondary concerns are the "tool group" concept not being implemented in the codebase and the DuckDuckGo HTML parsing fragility. Overall the design fits the existing architecture — it just needs clarification on factory signatures and the group shortcut scope.

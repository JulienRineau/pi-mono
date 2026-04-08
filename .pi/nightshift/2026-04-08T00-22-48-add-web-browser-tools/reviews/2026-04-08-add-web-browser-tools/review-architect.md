---
reviewer: review-architect
verdict: conditional
target: 2026-04-08-add-web-browser-tools
scope: plan
reviewed-at: 2026-04-08T00:50:06.801Z
---

## Critical
- None identified. The plan follows existing architectural patterns and the skeleton files are properly structured.

## Warnings

- **`packages/coding-agent/src/core/tools/web-search.ts` (Milestone 1)**: The DuckDuckGo HTML parser implementation details are underspecified. The plan says "Use regex or DOM parsing to extract result cards" but doesn't define the exact parsing strategy. DuckDuckGo HTML format is not stable and may break without robust fallback logic.

- **`packages/coding-agent/src/core/tools/web-fetch.ts` (Milestone 2)**: Title extraction strategy is vague. The plan says "Parse title from Jina response (first `# heading` or infer from URL)" but Jina Reader returns pre-formatted markdown — the spec requires `# {title}\n\n{content}` output format which depends on correct title extraction from the first line.

- **Settings integration gap**: The plan states "execute function doesn't receive settings; schema default=5, 4096" but also adds `webSearch` and `webFetch` to the Settings interface. The execute functions cannot access SettingsManager at runtime, so users cannot configure these values. Either this is a planned but unneeded feature, or there's a missing integration point for passing settings to tools.

## Approved

- **File structure**: `web-search.ts` and `web-fetch.ts` follow the established pattern from `bash.ts` with proper TypeBox schemas, `ToolDefinition<T>`, and `wrapToolDefinition()` usage.

- **Error handling pattern**: Error-as-string (never thrown) is correctly implemented in skeletons and matches the spec requirement for emergent retry behavior.

- **Provider choice**: DuckDuckGo HTML + Jina Reader without API keys satisfies the "no new npm packages" constraint.

- **Tool registration**: Exports in `index.ts` are complete and consistent with existing tools.

- **Settings interfaces are additive**: Adding `webSearch` and `webFetch` to `Settings` interface is non-breaking.

- **Milestone decomposition**: Clean 4-milestone structure with clear validation commands.

## Suggestions

- Add a `parseTitleFromMarkdown(markdown: string): string` helper function to web-fetch.ts for extracting title from the first `# heading` line or falling back to URL-derived title.

- Consider documenting the exact DuckDuckGo HTML structure being targeted in a comment block before the parser function.

- Verify test files exist before execution — the plan references `web-search.test.ts`, `web-fetch.test.ts`, `web-tools-integration.test.ts`, and `web-tools-settings.test.ts` but these were not found in the codebase.

- The "web" tool group mentioned in the spec is not addressed in the plan. If group-based activation exists in the codebase, clarify how `web_search` and `web_fetch` should be associated.

## Summary

The plan is well-structured and follows existing coding-agent patterns. The main risks are the underspecified DuckDuckGo HTML parser and ambiguous title extraction for web_fetch output format. Settings integration appears incomplete — if user-configurable max_results/max_chars are required, the execute functions need access to SettingsManager, which is not currently the case. Otherwise, schema defaults (5, 4096) are sufficient for initial implementation.

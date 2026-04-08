---
reviewer: code-quality-reviewer
verdict: conditional
target: 2026-04-07-add-web-browser-tools
scope: plan
reviewed-at: 2026-04-07T18:26:47.135Z
---

## Critical

None — the plan is well-structured and follows existing patterns.

## Warnings

1. **`test/suite/web-tools-integration.test.ts:21-27`** — Tests check for `webSearchTool` and `webFetchTool` as direct exports from `tools/index.ts`, but the plan only exports factory functions `createWebSearchTool()`/`createWebFetchTool()`. The tests should verify the factory functions exist, not direct property access.

2. **`test/suite/web-tools-integration.test.ts:417-418`** (in `web-fetch.test.ts`) — Same issue: checking for `webSearchTool`/`webFetchTool` direct properties which won't be exported.

3. **`packages/coding-agent/src/core/tools/web-search.ts` milestone** — The plan says DuckDuckGo HTML endpoint (`https://html.duckduckgo.com/html/`) but DuckDuckGo CSS selectors (`result__a`, `result__snippet`) are fragile and can change without notice. Should add guidance that tests must cover parsing robustness.

4. **No test coverage for JavaScript-rendered pages** — DuckDuckGo returns HTML; some modern pages require JavaScript. No fallback strategy documented if HTML parsing fails for SPA content.

5. **`Milestone 4` test command** — The validation command tries to run all three test files together. If any test file has import errors (missing modules), it will fail the whole run. The milestone should clarify that each test file should be run independently first.

## Approved

- Plan structure with 4 clear milestones matching TDD workflow
- Reference to `read.ts` as implementation pattern — correct approach
- Error-as-string (fetch) and error-as-JSON (search) patterns aligned with DeerFlow
- `TypeBox` schema usage follows existing conventions
- `createWebSearchTool()`/`createWebFetchTool()` factory functions match `createReadTool()` pattern
- `allTools`/`allToolDefinitions` registration matches existing index.ts structure
- Truncation to 4096 chars documented in spec and implementation steps
- Edge cases comprehensively documented (empty query, rate limiting, invalid URL, etc.)
- Restrictive docstring requirement for `web_fetch` (critical for LLM behavior)
- No new npm packages constraint honored

## Suggestions

1. Add a risk entry for DuckDuckGo HTML parsing fragility and suggest adding integration tests that mock different HTML structures
2. Consider adding a "JavaScript fallback" section to the spec if SPA support is needed later
3. Update integration test assertions to check for factory functions (`createWebSearchTool`) rather than direct exports (`webSearchTool`)
4. Add a "known limitations" section noting that DuckDuckGo may return CAPTCHA for frequent requests

## Summary

The plan is well-designed and follows project conventions. The main concern is test-integration mismatch: integration tests expect direct exports (`webSearchTool`, `webFetchTool`) but the plan only exports factory functions. The worker should fix the test assertions before or during Milestone 1. Implementation approach is sound and aligns with the DeerFlow pattern specified in the spec.

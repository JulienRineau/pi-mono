---
reviewer: review-domain
verdict: conditional
target: 2026-04-08-add-web-browser-tools
scope: plan
reviewed-at: 2026-04-08T00:50:13.712Z
---

## Critical
- None identified. The plan addresses all spec acceptance criteria with implementation steps.

## Warnings

1. **`Settings interface integration is underspecified`** — The plan states "Execute function doesn't receive settings" and "Use schema defaults (5, 4096)" but acceptance criterion #5 requires "Settings interface includes webSearch.maxResults, webFetch.maxChars". These are contradictory. The implementation approach doesn't explain how settings would actually affect tool execution without being passed to `execute()`. The plan should clarify:
   - Whether `SettingsManager` is injected into tool execution context
   - Or whether settings are only for documentation/schema defaults
   - The test file expects `webSearch.maxResults` to be configurable at runtime

2. **`DuckDuckGo HTML parsing strategy is vague`** — Milestone 1 Step 2 says "Add `parseDuckDuckGoHtml(html: string)` function" but provides no implementation approach. The HTML parser could be implemented via:
   - Regex-based extraction (fragile)
   - DOMParser in a sandbox (secure but complex)
   - A third-party HTML parsing library (adds dependency)
   
   The plan's risk section acknowledges "HTML parsing regex is brittle" but doesn't specify which approach to use, leaving ambiguity for implementation.

## Approved

- **Spec coverage**: All acceptance criteria are addressed in the plan
- **Error handling pattern**: Correctly specifies errors-as-strings (never thrown)
- **Docstrings**: Current skeletons match spec requirements (restrictive guidance on web_fetch)
- **Tool registration**: Already done in `index.ts`; web tools included in `createAllTools()`
- **Providers**: DuckDuckGo HTML endpoint and Jina Reader API correctly identified
- **Provider constraints**: No API keys required, no new npm packages — meets spec constraints
- **Milestone structure**: 4 logical milestones with clear validation criteria
- **Edge cases**: All spec edge cases covered (empty query, invalid URL, rate limiting, truncation, timeouts)
- **Integration tests**: 20 tests covering agent workflow, parallel calls, retry behavior
- **TypeBox schemas**: Already implemented in skeletons, verified by tests

## Suggestions

1. **Add DuckDuckGo parsing implementation approach**: Consider documenting the specific regex patterns or DOM query selectors for extracting `<a class="result__a">` and `<a class="result__snippet">` elements. This ensures consistent implementation.

2. **Document title extraction strategy for web_fetch**: The spec mentions "Extracts title, defaults to 'Untitled' if missing" but there's no test or milestone step for this. Consider adding a step in Milestone 2.

3. **Add test for "No content could be extracted" message**: The spec's readability pipeline requirement includes this, but no test explicitly validates it. The current tests only check for "Empty" which is different.

4. **Consider adding a "web" group for unified activation**: The spec mentions "Both tools registered in 'web' group for unified activation" but there's no CLI-level "web" group shortcut in the implementation. The integration test expects `'web': ["web_search", "web_fetch"]` but this isn't wired in the plan.

## Summary

The plan is well-structured and covers all acceptance criteria. The main concern is a specification gap between acceptance criterion #5 (settings configuration) and the plan's stated architecture (execute doesn't receive settings). This should be resolved before implementation to avoid rework. The DuckDuckGo HTML parsing approach also needs clarification to prevent implementation divergence.

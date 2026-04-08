---
reviewer: code-quality-reviewer
verdict: pass
target: 2026-04-08-add-web-browser-tools
scope: plan
reviewed-at: 2026-04-08T02:53:13.321Z
---

## Critical
None. The plan is well-structured and follows existing patterns.

## Warnings

1. **Plan references non-existent test files**: The Constraints section states "165 tests, 154 passing" and validation commands reference `packages/coding-agent/test/web-tools.test.ts` and `packages/coding-agent/test/suite/regressions/web-tools-ssrf-protection.test.ts`. These files do not exist. Either the tests already exist elsewhere, or this section needs correction.

2. **DuckDuckGo HTML parsing fragility**: The plan documents the regex approach targeting DuckDuckGo HTML structure, but the pattern `<a class="result__snippet">` may not match the actual HTML. DuckDuckGo sometimes uses `<a class="result__a">` for both title and URL, with snippets in separate `<p class="result__snippet">` elements (paragraph tags, not anchor tags). The implementation should account for this discrepancy.

3. **Missing CLI `--tools=web` expansion implementation details**: Milestone 3 mentions updating `packages/coding-agent/src/cli/args.ts` for group expansion, but the plan doesn't show the specific code pattern. Consider adding a code stub for how `WEB_TOOL_NAMES` will be used in args.ts.

## Approved

1. **Follows existing tool patterns**: The plan correctly follows `createXxxToolDefinition`, `createXxxTool`, and default exports pattern established in bash.ts.

2. **SSRF protection architecture**: Comprehensive blocklist with IPv4 (loopback, private, link-local, broadcast), IPv6 (loopback, unique local, link-local), and IPv4-mapped IPv6 handling. Normalization before checking prevents bypass attempts.

3. **Extracted SSRF module**: Separating `ssrf-protection.ts` into its own module allows testing in isolation and reuse if other tools need URL fetching.

4. **Error format distinction**: JSON errors for `web_search` (structured, retryable) vs string errors for `web_fetch` follows the DeerFlow pattern and enables LLM retry behavior.

5. **Tool grouping design**: `WEB_TOOL_NAMES = ["web_search", "web_fetch"] as const` constant enables type-safe group expansion.

6. **Comprehensive test matrix**: The test plan covers success cases, error cases, and SSRF variants comprehensively (15+ web_fetch tests, 6+ web_search tests).

7. **Decision log completeness**: All non-obvious decisions are documented with rationale, including SSRF message distinction, IPv6 handling, and hostname normalization timing.

8. **Validation criteria clear**: Each milestone has specific validation commands and expected outcomes.

9. **Constraints realistic**: No new npm packages, no API keys required, existing API compatibility.

10. **Spec-to-plan alignment**: Plan requirements map cleanly to spec acceptance criteria.

## Suggestions

1. **Consider adding DuckDuckGo HTML edge case test**: Add a test case for when search results have no snippets or when HTML structure differs from expected (e.g., news results vs web results).

2. **Consider documenting rate limit behavior**: The spec mentions `{"error": "Rate limited", "retry": true}` for search, but the plan's DuckDuckGo implementation doesn't show how to detect rate limiting. Add a note about retry-after handling.

3. **Consider Jina Reader error handling**: Jina Reader may return non-markdown content (errors, captchas). The plan should document expected behavior for non-200 responses from Jina.

4. **Consider timeout configuration**: DuckDuckGo and Jina Reader fetches should have reasonable timeouts (e.g., 10s) to avoid hanging. Document this in the implementation steps.

## Summary

The plan is well-structured and follows existing code conventions. The architecture is sound with proper separation of concerns (SSRF module, tool modules, index exports). Security considerations are thorough, particularly the comprehensive SSRF blocklist and the timing of validation (before DNS resolution). The main concern is that the test file references in the Constraints section appear inconsistent with actual file existence, which should be verified before execution.

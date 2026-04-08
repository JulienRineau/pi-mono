---
reviewer: review-ux
verdict: conditional
target: 2026-04-07-add-web-browser-tools
scope: plan
date: 2026-04-07
---

## Critical
- None identified. The plan is well-structured with clear acceptance criteria.

## Warnings
- `packages/coding-agent/test/suite/web-fetch.test.ts` - Inconsistent error formats between tools: web_search returns JSON (`{error: "...", code: "..."}`) while web_fetch returns plain strings (`"Error: ..."`). The plan documents this as intentional (DeerFlow pattern), but it creates asymmetric LLM error handling. Consider documenting this contrast explicitly in tool guidelines.

- `packages/coding-agent/test/suite/web-fetch.test.ts:299-303` - "Error: timeout" message lacks specificity. A 30-second timeout is mentioned in the implementation steps, but the error message should convey this: `"Error: Request timed out after 30 seconds"` so the LLM understands the retry window.

- `packages/coding-agent/README.md:290-292` - CLI reference says `Available built-in tools: read, bash, edit, write, grep, find, ls` but plan doesn't mention updating this list to include `web_search` and `web_fetch`.

- `packages/coding-agent/src/core/tools/web-search.ts:36` - Missing `promptSnippet` field in tool definition (unlike `createWebFetchToolDefinition` which has it). This affects system prompt discoverability.

## Approved
- **Error-as-string pattern**: Never throwing exceptions, returning errors as strings/JSON, enables natural LLM retry behavior as specified in the DeerFlow pattern.

- **Sensible API defaults**: `max_results` defaults to 5 with range 1-20, minimal required params for both tools.

- **Truncation strategy**: 4096 char limit with continuation notice, using `Array.from()` for Unicode-safe truncation.

- **URL protocol restriction**: Only http/https allowed, preventing SSRF attacks.

- **TypeBox schema validation**: Consistent with existing tools (read.ts pattern).

- **Docstring guidance**: Critical restriction "Only use URLs from web_search results" guides LLM behavior appropriately.

- **promptGuidelines**: "Fetch multiple pages in parallel" encourages efficient research behavior.

## Suggestions
- Add specific retry-after hints in rate limit errors: `"Error: Rate limited. Retry after 5 seconds."` rather than just code.

- Consider adding a `web` group concept in tool definitions for unified activation (`--tools web` instead of `--tools web_search,web_fetch`).

- The integration tests in `web-tools-integration.test.ts` currently fail due to import resolution issues, not functional tests. These should be fixed or skipped during implementation to avoid confusion.

## Summary
The plan demonstrates solid UX thinking: error-as-strings for retry behavior, sensible defaults, Unicode-safe truncation, and docstrings that guide LLM behavior. Primary concerns are minor: timeout error messaging should mention duration, CLI docs need web tools added, and error format asymmetry should be explicitly documented for LLM guidance.

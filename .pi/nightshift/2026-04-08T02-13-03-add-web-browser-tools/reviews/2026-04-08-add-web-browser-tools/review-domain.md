---
reviewer: review-domain
verdict: conditional
target: 2026-04-08-add-web-browser-tools
scope: plan
reviewed-at: 2026-04-08T02:51:58.144Z
---

## Critical

None — all high-priority acceptance criteria are addressed in the plan.

## Warnings

1. **Empty content handling mismatch** (`web-fetch.ts` milestone): The spec's Readability pipeline criterion states: `Returns "No content could be extracted from this page" for empty content`. The plan's Edge Cases section specifies `"Error: Empty response"` for empty responses. These differ semantically — "No content could be extracted" implies content was found but unreadable, while "Empty response" implies no content was received. The plan should clarify whether Jina Reader returning empty content should produce the spec's exact message or use the planned `"Error: Empty response"` / `"Error: Failed to fetch content"` pattern.

2. **System prompt guidance not planned** (Milestone 3): The spec includes acceptance criterion `[ ] Skill or system prompt guidance on when to use fetch vs snippets`. The plan has no milestone step or decision addressing this. This is marked "medium" priority in requirements, but the plan should explicitly note it as deferred or out-of-scope to avoid confusion.

3. **Non-HTML content type handling not specified** (Edge Cases): The spec lists `Non-HTML content (PDF, image) → return "Error: Unsupported content type"`. The plan's edge cases table is missing this entry. The implementation should handle Content-Type checking and return this specific error message.

## Approved

- **SSRF protection is comprehensive**: IPv4 private ranges (10.x.x.x, 172.16-31.x.x, 192.168.x.x), loopback (127.x.x.x, ::1), link-local (169.254.x.x, fe80::/10), unique local (fc00::/7), broadcast (0.x.x.x), IPv4-mapped IPv6 (::ffff:127.x.x.x), and hostname normalization all addressed.
- **Protocol allowlist**: Only http:// and https:// allowed — defense-in-depth against non-HTTP schemes.
- **DNS rebinding prevention**: SSRF check validates hostname BEFORE any network fetch, as documented in the SSRF Check Flow diagram.
- **Error format consistency**: web_search returns JSON error objects (reparseable), web_fetch returns "Error: ..." strings — matches DeerFlow pattern for emergent retry behavior.
- **Error-as-string pattern**: All errors returned as strings, never thrown — enables LLM retry behavior.
- **4096 char truncation**: Large pages handled with `[truncated]` suffix as specified.
- **DuckDuckGo HTML API**: No API key required, open access as specified.
- **Jina Reader API**: Free tier sufficient for HTML-to-markdown conversion as specified.
- **Tool grouping**: "web" group for unified `--tools=web` activation as specified.
- **TypeBox schemas**: Proper parameter validation with descriptions.
- **DuckDuckGo parse failure handling**: Returns JSON error object as specified.
- **Rate limiting handling**: `{"error": "Rate limited", "retry": true}` JSON format documented.
- **Timeout handling**: `"Error: Request timeout"` documented.
- **Test coverage**: 165 tests specified including 53 SSRF regression tests.
- **Idempotence**: Plan acknowledges all steps are repeatable without side effects.

## Suggestions

1. **DuckDuckGo HTML parsing fragility**: The DuckDuckGo HTML structure is not versioned and may change. Consider adding a version comment in the code documenting the expected HTML structure with a reference to when it was last verified. The "Search failed" error on parse failure is good mitigation.

2. **Jina metadata prefix handling**: The plan documents stripping lines starting with "Title:", "URL:", etc. Consider documenting the exact prefixes to strip in the code comments to prevent future breakage when Jina adds new metadata fields.

3. **Default empty content message alignment**: Align with spec by using `"No content could be extracted from this page"` when Jina returns content but it's empty/whitespace, reserving `"Error: ..."` for actual failures.

## Summary

The plan is well-structured with comprehensive SSRF protection, correct error handling patterns, and thorough test coverage. Two minor discrepancies with the spec should be addressed: empty content message wording and explicit acknowledgment that system prompt guidance is deferred. These are not blocking issues but should be clarified before implementation.

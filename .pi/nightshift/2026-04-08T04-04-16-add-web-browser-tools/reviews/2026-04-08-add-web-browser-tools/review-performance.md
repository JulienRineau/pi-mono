---
reviewer: review-performance
verdict: pass
target: 2026-04-08-add-web-browser-tools
scope: plan
reviewed-at: 2026-04-08T04:20:51.642Z
---

## Critical
None.

## Warnings
- `packages/coding-agent/src/core/tools/web-fetch.ts:83-87` — Truncation `maxBodyLength` can go negative when title is very long. The condition `if (truncatedBody.length > maxBodyLength)` guards against immediate slicing, but the math produces negative limits for titles > ~4086 chars. Low impact since markdown titles are rarely that long.

- `packages/coding-agent/src/core/tools/ssrf-protection.ts:93-97` — `normalizeHostname` creates 3 intermediate strings per call via chained `.replace().replace().toLowerCase()`. Called on every `isUrlBlocked` check (every `web_fetch` call). Micro-optimization: could allocate once or use a single pass. Impact: negligible for a constant-time check, but worth noting.

- `packages/coding-agent/src/core/tools/web-fetch.ts:76` — Reads full response into memory before truncation: `let markdown = await response.text()`. For very large pages this wastes memory. The 4096-char limit mitigates this, but the full content is still loaded. Mitigation in place via truncation.

- `packages/coding-agent/src/core/tools/web-search.ts:67-72` — `decodeHtmlEntities` runs 10 sequential `.replace()` calls on every title and snippet, even when no entities are present. Could short-circuit on non-HTML content. Impact: minor; HTML responses from DuckDuckGo typically contain entities.

## Approved
- **SSRF protection uses constant-time checks**: `BLOCKED_PATTERNS.some()` iterates 12 regex patterns — O(12) = O(1). No unbounded growth regardless of input size.

- **No memory leaks in hot paths**: Arrays are bounded by `maxResults` (default 5) in `parseDuckDuckGoHtml`. No global state, no accumulators.

- **Single network calls per tool invocation**: `web_search` makes one DuckDuckGo request, `web_fetch` makes one Jina Reader request. No cascading network calls.

- **Concurrency-friendly design**: Both functions are `async` with no shared mutable state. LLMs can invoke them in parallel without race conditions.

- **Mock-based tests avoid network I/O in CI**: `web-tools-unit.test.ts` uses `vi.fn()` mocks throughout. No network flakiness, deterministic execution.

- **Plan decision to delete obsolete test file is sound**: `web-tools.test.ts` has 7 failures from real network calls + syntax bugs. `web-tools-unit.test.ts` provides 98 mock-based tests covering the same functionality.

## Suggestions
- Consider short-circuiting `decodeHtmlEntities` when input contains no `&` or `<` characters.
- Consider streaming/chunked truncation for `web_fetch` to avoid reading full large responses into memory.

## Summary
The implementation is performant by design. SSRF checks are O(1), memory usage is bounded by truncation limits, and network I/O is minimal (one call per tool). The plan correctly identifies the obsolete test file as the only remaining issue. No algorithmic complexity concerns, no unbounded collections, no blocking I/O.

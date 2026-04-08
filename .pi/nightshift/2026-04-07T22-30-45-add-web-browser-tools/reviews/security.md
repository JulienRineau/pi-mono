---
review-target: 2026-04-07-add-web-browser-tools
review-scope: plan
verdict: conditional
reviewer: security
---

## Critical

- **DuckDuckGo HTML scraping legal/reliability risk**: The plan specifies scraping DuckDuckGo's HTML endpoint with regex parsing. This approach:
  - Violates most search engines' Terms of Service
  - Is fragile (DuckDuckGo HTML structure changes frequently)
  - Risks IP blocking from search provider
  - Plan documents this risk but mitigation ("regex + tests") is inadequate
  
  **Recommendation**: Consider using an official search API (DuckDuckGo has a free instant answer API at `https://api.duckduckgo.com/?q={query}&format=json`) or document this as an acceptable risk for prototype.

- **Privacy: All web traffic through Jina Reader**: The plan routes all `web_fetch` requests through Jina's servers (`r.jina.ai`). This means:
  - User browsing data passes through a third-party service
  - URLs being accessed are exposed to Jina
  - Not documented as a privacy concern in the plan
  
  **Recommendation**: Document this privacy consideration and consider adding a note in the system prompt or README.

## Warnings

- **Test suite status mismatch**: The plan claims "25 passing / 21 failing" but actual test runs show:
  - `web-search.test.ts`: 11 passing / 8 failing
  - `web-fetch.test.ts`: 14 passing / 13 failing  
  - `web-tools-integration.test.ts`: Entire suite fails with import errors (0 tests run)
  
  The integration test failure is due to missing package entries (`@mariozechner/pi-agent-core`, `@mariozechner/pi-tui`), not the web tools themselves.

- **No client-side rate limiting**: While the plan mentions handling 429 errors, there's no mention of implementing client-side rate limiting to prevent triggering the limit in the first place.

- **URL validation not yet implemented**: The plan mentions SSRF mitigation (http/https only) but the current stub code returns `"Error: Not implemented"` without any validation. This must be implemented before Milestone 2 is considered complete.

- **Missing `AbortSignal` handling**: The plan mentions using `AbortSignal.timeout(30_000)` for timeout but the stub implementations ignore the `signal` parameter entirely. Implementation must respect abort signals.

## Approved

- Error-as-string pattern correctly documented (enables natural retry)
- Restrictive docstring on `web_fetch` guiding LLM to use search results only
- Unicode-safe truncation using `Array.from()` approach
- TypeBox schema validation for parameters
- Tool registration in `allTools` and `allToolDefinitions` verified
- Factory function pattern consistent with existing tools (`read`, `bash`, etc.)
- Content-type validation for unsupported formats (PDF, images)
- `promptSnippet` and `promptGuidelines` fields for system prompt integration

## Suggestions

- Add a comment in code explicitly noting that DuckDuckGo HTML scraping may break and requires monitoring
- Consider adding `max_query_length` schema constraint (currently only mentioned in plan's Risks section)
- Document the privacy implication of Jina Reader in README when adding Milestone 5 documentation
- Add integration test for abort signal handling when tool execution is cancelled

## Summary

The plan is well-structured with clear milestones and acceptance criteria. Security concerns are partially addressed (SSRF mitigation planned, Unicode truncation correct), but three issues need resolution before implementation: (1) DuckDuckGo HTML scraping should use an official API or be explicitly accepted as a risk, (2) Privacy implications of Jina Reader should be documented, and (3) Test suite accuracy should be corrected. Implementation should ensure the `signal` parameter is properly respected throughout.

---
reviewer: security-reviewer
verdict: conditional
target: 2026-04-07-add-web-browser-tools
scope: plan
reviewed-at: 2026-04-07T23:57:45.313Z
---

## Critical
- **SSRF Vulnerability in web_fetch**: The plan specifies "Validate URL format (must be valid http/https URL)" but does NOT include blocking internal/private IP ranges, localhost, or cloud metadata endpoints (169.254.169.254). This allows the LLM to be directed to scan internal infrastructure. Mitigation: Add URL blocklist/blocklist for:
  - `127.0.0.0/8`, `::1`, `localhost`
  - `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`
  - `169.254.0.0/16` (link-local, including AWS metadata)
  - `0.0.0.0`, `::ffff:0:0/96`
  - Consider DNS rebinding attacks

## Warnings
- **No rate limiting on tool usage**: The plan mentions handling 429 errors from external APIs but doesn't include application-level rate limiting to prevent abuse (e.g., a malicious prompt could cause thousands of search/fetch requests).
- **Search query logging risk**: Search queries are sent to DuckDuckGo unencrypted in URL parameters (GET request). While no auth tokens are exposed, search history could leak sensitive research queries if logs are stored.
- **Fetched content in context**: Large amounts of fetched web content are returned as tool results and may be included in subsequent LLM context windows, potentially exposing sensitive data (passwords in URLs, PII, internal docs).

## Approved
- Error-as-string pattern (`"Error: ..."` and `{"error": "..."}`) prevents exception stack traces from leaking internal implementation details.
- The restrictive docstring on `web_fetch` ("Only use URLs from web_search results") guides safe LLM behavior.
- Jina Reader API is a trusted, established service (no new unknown dependencies).
- DuckDuckGo HTML API requires no API keys, avoiding secret management complexity.
- `max_results` parameter provides some protection against excessive result volume.
- 4096 char truncation limits response size and context pollution.
- The plan correctly notes that both tools must be activated together for proper LLM behavior.

## Suggestions
- Add explicit documentation that fetched content is included in LLM context (data handling policy consideration).
- Consider adding a configurable timeout (e.g., 10s) to prevent indefinite hangs on slow endpoints.
- Document that external services (DuckDuckGo, Jina) have their own terms of service and privacy policies.
- Consider adding a "user-agent" header to identify the request source (common courtesy for web scraping).

## Summary
The plan addresses basic error handling and LLM guidance well. However, it has a critical SSRF vulnerability where URL validation is insufficient. The web_fetch tool must explicitly block internal/private IP ranges and cloud metadata endpoints to prevent internal network reconnaissance. These fixes should be added to the acceptance criteria before implementation proceeds.

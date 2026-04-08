---
reviewer: review-security
verdict: fail
target: 2026-04-07-add-web-browser-tools
scope: plan
reviewed-at: 2026-04-07T18:08:30.519Z
---

## Critical

- **`web_fetch` schema allows arbitrary URLs without validation** (`packages/coding-agent/src/core/tools/web-fetch.ts`): The plan defines `webFetchSchema` as `Type.Object({ url: Type.String() })` without any URL validation. This enables Server-Side Request Forgery (SSRF). An attacker or manipulated LLM could fetch:
  - Internal services: `http://localhost:8080/admin`, `http://127.0.0.1:22`
  - Cloud metadata: `http://169.254.169.254/latest/meta-data/` (AWS), `http://metadata.google.internal/` (GCP)
  - Private network ranges: `http://192.168.1.1/`, `http://10.0.0.1/`
  
  **Required fix**: Add URL validation blocking:
  - Non-HTTP(S) schemes
  - Localhost, 127.0.0.1, 0.0.0.0
  - Private IP ranges (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16)
  - Link-local (169.254.0.0/16) except metadata endpoints
  - IPv6 loopback (::1)

- **`web_search` accepts arbitrary query strings without sanitization** (`packages/coding-agent/src/core/tools/web-search.ts`): The plan specifies `query: Type.String()` without length limits or content filtering. While DuckDuckGo HTML endpoint may handle this, unbounded query strings could be used for probing or injection if the parsing logic is flawed.
  
  **Required fix**: Add query length limit (e.g., 500 chars) and validate against null bytes or control characters.

## Warnings

- **No rate limiting on tool execution** (`packages/coding-agent/src/core/tools/`): The plan mentions DuckDuckGo/Jina rate limits as risks but does not implement any rate limiting on the tool level. A malicious or runaway LLM could exhaust external APIs or cause costs.
  
  **Suggested fix**: Add a simple in-memory rate limiter for web tool calls (e.g., max 30 calls/minute per session).

- **Jina Reader API receives full URLs including potentially sensitive ones** (`packages/coding-agent/src/core/tools/web-fetch.ts`): The implementation delegates to `https://r.jina.ai/{encodedUrl}`, which forwards the full URL to Jina's infrastructure. If internal URLs leak to external services, this could expose internal resources.

  **Suggested fix**: Document that SSRF protection (blocklist above) must be applied BEFORE calling Jina API.

- **No content-size limit during fetch** (`packages/coding-agent/src/core/tools/web-fetch.ts`): The plan truncates output to 4096 chars but fetches the full response first. For very large files (PDFs, videos), this wastes memory and bandwidth.

  **Suggested fix**: Check `content-length` header or stream with size limits before reading full body.

## Approved

- Error-as-string pattern is correctly implemented (never throws, returns structured errors)
- TypeBox schema validation is used consistently with existing tools
- Docstring approach for LLM guidance is appropriate (soft control, not security boundary)
- Tool grouping in "web" namespace aligns with existing patterns
- DuckDuckGo HTML endpoint requires no API key (avoids credential management issues)
- Jina Reader free tier has no additional secrets to manage
- Truncation to 4096 chars limits response size
- Integration tests are comprehensive (64 tests)

## Suggestions

- Consider adding a `BlockedURLError` type to the error response format for clearer SSRF detection
- Add security-focused integration tests:
  - Test that `localhost`, `127.0.0.1`, `169.254.169.254` return blocked errors
  - Test that `file://`, `ftp://`, `javascript:` schemes are rejected
  - Test query injection (`<script>alert(1)</script>`)
  - Test rate limiting behavior
- Document the security model: docstrings are LLM guidance only, not enforcement
- Consider a security.md section in the spec documenting the threat model for web tools

## Summary

The plan is well-structured with proper error handling patterns and test coverage, but it lacks critical SSRF protection. The `web_fetch` tool must validate URLs against a blocklist before making requests. Without this, the tool enables internal network access, cloud metadata enumeration, and service enumeration — a severe security risk. These validations are straightforward to implement and should be added to the requirements before implementation proceeds.

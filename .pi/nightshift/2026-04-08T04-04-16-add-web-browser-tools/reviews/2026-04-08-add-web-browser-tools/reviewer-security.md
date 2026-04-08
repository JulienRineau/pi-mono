---
reviewer: security-reviewer
verdict: pass
target: 2026-04-08-add-web-browser-tools
scope: plan
reviewed-at: 2026-04-08T04:21:32.905Z
---

## Critical
None. The SSRF protection is comprehensive and correctly implemented.

## Warnings
None.

## Approved

### SSRF Protection (Comprehensive)
- IPv4 blocklist: loopback (127.x.x.x), private (10.x.x.x, 172.16-31.x.x, 192.168.x.x), link-local (169.254.x.x including AWS metadata), broadcast (0.x.x.x)
- IPv6 blocklist: loopback (::1), IPv4-mapped (::ffff:127.x.x.x), link-local (fe80::/10), unique local (fc00::/7), unspecified (::)
- Hostname alias blocking: localhost (case-insensitive)
- Protocol allowlist: only http:// and https:// allowed
- **Hostname normalization**: lowercase, trailing dot removal, IPv6 bracket stripping prevents bypass attempts
- **SSRF check BEFORE network fetch**: validates hostname before DNS resolution (DNS rebinding protection)

### Error Handling (Secure)
- Errors returned as strings/JSON, never thrown — enables graceful retry without crashes
- Generic error messages don't leak internal details: "Error: URL not allowed", "Error: Invalid URL", "Error: Connection refused"
- Error type distinction: SSRF blocks return `reasonType: "ssrf"`, protocol violations return `reasonType: "protocol"`

### No Secrets Exposure
- No hardcoded API keys or credentials
- DuckDuckGo and Jina Reader free tiers used (no auth required)
- Standard browser User-Agent string used

### DoS Protection
- Content truncation at 4096 chars default
- URL validation before network request (no wasted resources on blocked URLs)

### Test Coverage (98 tests + SSRF regression suite)
- `test/web-tools-unit.test.ts`: 98 mock-based unit tests covering search parsing, fetch, SSRF, tool registration
- `test/suite/regressions/web-tools-ssrf-protection.test.ts`: Dedicated SSRF regression tests
- Tests verify: blocked URLs return quickly (<100ms, no network), case-insensitive blocking, port/path variations, HTTP vs HTTPS handling

## Suggestions

1. **Request Timeouts**: Neither `web_search` nor `web_fetch` configures explicit timeouts. The hosting environment's default timeout applies. Consider adding explicit 30-second timeout for production hardening.

2. **Jina Reader Fallback**: The tool depends on Jina Reader for HTML→markdown. If unavailable, web_fetch fails. Consider documenting this as a known limitation in the spec.

3. **DuckDuckGo Parse Resilience**: The regex parser targets specific HTML classes. If DuckDuckGo changes their HTML format, parsing silently returns empty results. The error JSON is returned, but the underlying HTML→JSON provider change isn't detected.

## Summary

The plan implements web browser tools with security-first design. SSRF protection is comprehensive, covering IPv4/IPv6 private ranges, link-local (including AWS metadata at 169.254.169.254), and protocol allowlisting. The implementation correctly validates URLs before network requests, preventing DNS rebinding attacks. Error resilience pattern (returning strings/JSON instead of throwing) enables LLM retry behavior. No secrets are hardcoded. Test coverage is thorough with mock-based tests avoiding network dependencies.

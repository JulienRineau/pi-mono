---
reviewer: security-reviewer
verdict: conditional
target: 2026-04-08-add-web-browser-tools
scope: plan
reviewed-at: 2026-04-08T02:07:54.706Z
---

## Critical

- **SSRF - Incomplete DNS Rebinding Window Protection**  
  The plan mentions DNS rebinding protection but doesn't address the time-of-check vs time-of-use race. An attacker can: (1) own `attacker.com` pointing to public IP, (2) when tool resolves it, get public IP, (3) quickly change DNS to private IP, (4) HTTP request via resolved IP hits private network. The plan lacks: race condition mitigation between DNS resolution and HTTP request, `Host` header verification on the server response, and short TTL handling. **Recommended fix**: Use a DNS server with built-in rebinding protection (e.g., `dns2tcp --local-default`), or implement "double DNS" pattern where fetch uses originally-resolved IP with original `Host` header.

- **Error Messages Leak Internal Infrastructure**  
  Section "Decisions - Error message safety" explicitly requires exposing HTTP status codes like `"Error: Rate limited (429). Retry after a delay"` and `"Error: Forbidden (403)"`. While helpful for LLM retry behavior, verbose errors reveal internal network structure, security posture, and whether internal services are reachable. Consider offering a "verbose errors" setting (default off) for users who want detailed retry guidance vs those with privacy concerns.

## Warnings

- **No URL Sanitization Before Jina**  
  `web_fetch` passes raw URL to `https://r.jina.ai/{url}`. URLs from search results may contain session tokens, API keys, or PII in query parameters. Document that users should not fetch URLs with sensitive query params, or implement sanitization to strip known-sensitive parameter names.

- **Rate Limiting is Unidirectional**  
  500ms delay only prevents the tool from abusing external services. Doesn't protect against: malicious sites sending large payloads to exhaust resources, slow-loris attacks, or missing response size limits before truncation point.

- **Jina Reader Privacy Not Fully Explored**  
  URLs and full page content are sent to third-party (`r.jina.ai`). The plan documents this but doesn't explore: whether sensitive URL parameters are stripped, what Jina logs/retains, or the trust model users should assume.

## Approved

- Comprehensive SSRF IP range blocking (10.x, 172.16-31.x, 192.168.x, 127.x, ::1, 169.254.x, 224-239.x)
- Explicit 10-15s timeouts prevent indefinite hangs (DoS prevention)
- No new npm dependencies (reduced supply chain risk)
- No API keys required for DuckDuckGo/Jina (no credentials to leak)
- Errors returned as strings, not thrown (avoids exception leakage)
- Content type validation prevents binary data issues
- `--tools web` CLI shorthand is convenience only, no security bypass

## Suggestions

- Add URL sanitization before Jina fetch (strip tokens, IDs from query params)
- Add configurable DNS rebinding protection level for paranoid users
- Document response size limits explicitly in README
- Consider a "privacy mode" that redacts query parameters before sending to Jina

## Summary

The plan has solid foundational security measures (SSRF IP blocking, timeouts, no new dependencies) but has a critical gap in DNS rebinding protection. The race condition between DNS resolution and HTTP request could allow SSRF attacks to bypass IP validation. Additionally, the decision to expose verbose HTTP errors (403, 429) should be a configurable option rather than default behavior for security-conscious deployments. The plan is otherwise well-structured with security considerations documented in the Decision Log.

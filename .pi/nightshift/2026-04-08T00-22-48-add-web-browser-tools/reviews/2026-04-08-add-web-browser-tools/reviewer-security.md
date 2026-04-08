---
reviewer: security-reviewer
verdict: fail
target: 2026-04-08-add-web-browser-tools
scope: plan
reviewed-at: 2026-04-08T00:50:15.518Z
---

## Critical

- **SSRF Vulnerability in web_fetch — Still Unresolved**: The plan specifies "Validate URL" in the implementation but does NOT include blocking internal/private IP ranges, localhost, or cloud metadata endpoints (169.254.169.254). The plan relies on "restrictive docstring" to guide the LLM, but docstrings are guidance, not enforcement. An attacker or adversarial prompt can instruct the agent to fetch arbitrary URLs. Mitigation required:
  - Block `localhost`, `127.0.0.1`, `::1`
  - Block private IP ranges: `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`
  - Block link-local: `169.254.0.0/16` (AWS metadata at `169.254.169.254`)
  - Only allow `http://` and `https://` schemes
  - Return `"Error: URL not allowed"` (not just "Invalid URL") for blocked URLs

- **Edge Cases section** — "Invalid URL in web_fetch → return 'Error: Invalid URL'" is too vague. The implementation must distinguish between syntax errors and SSRF-prohibited URLs, returning appropriate error messages for each.

## Warnings

- **web_search URL encoding**: The plan uses `encodeURIComponent(query)` which is correct. However, DuckDuckGo HTML scraping is inherently fragile — if the HTML structure changes, parsing silently fails. The error-as-JSON pattern mitigates this, but consider adding explicit "parsing failed" detection.

## Approved

- **No API keys required**: DuckDuckGo HTML endpoint and Jina Reader free tier eliminate credential management risk.
- **No new npm packages**: Reduces supply chain attack surface.
- **Error-as-string pattern**: Returns structured error strings rather than throwing exceptions, avoiding stack trace leakage.
- **4096 character limit**: Prevents memory abuse and response amplification.
- **Rate limiting edge case addressed**: HTTP 429 handling is explicitly covered.
- **Content-type validation**: Detecting non-HTML content (PDF/images) and returning error is good security practice.
- **Settings interface design**: WebSearchSettings and WebFetchSettings interfaces are cleanly structured.

## Summary

The plan is well-structured with proper error handling patterns and test coverage, but it contains a critical SSRF vulnerability. The `web_fetch` tool must validate URLs against internal/private network blocklists before making requests. Without this, the tool enables internal network reconnaissance and cloud metadata enumeration — a severe security risk. These validations must be added to the requirements before implementation proceeds.

## Recommendations

Add to Milestone 2, Step 1 (before making fetch request):

```typescript
// SSRF protection - block internal/private URLs
const blockedPatterns = [
  /^localhost$/i,
  /^127\.\d+\.\d+\.\d+$/,
  /^::1$/,
  /^10\.\d+\.\d+\.\d+$/,
  /^172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+$/,
  /^192\.168\.\d+\.\d+$/,
  /^169\.254\.\d+\.\d+$/, // link-local (AWS metadata)
];

const hostname = url.hostname;
if (blockedPatterns.some(pattern => pattern.test(hostname))) {
  return { content: [{ type: "text", text: "Error: URL not allowed" }] };
}
```

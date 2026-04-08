---
reviewer: security-reviewer
verdict: conditional
target: 2026-04-07-add-web-browser-tools
scope: plan
reviewed-at: 2026-04-07T18:25:21.455Z
---

## Critical

- **Milestone 2 / web-fetch.ts** — No SSRF protection specified in implementation steps. The plan relies entirely on a "restrictive docstring" to prevent the LLM from fetching arbitrary URLs (internal services, localhost, private IP ranges). Docstrings are guidance, not enforcement. The implementation MUST include code-level URL validation blocking:
  - `localhost`, `127.0.0.1`, `::1`
  - Private IP ranges (`10.x.x.x`, `172.16-31.x.x`, `192.168.x.x`)
  - Link-local addresses (`169.254.x.x`)
  - Non-HTTP(S) schemes
  - The spec's edge case "Invalid URL in web_fetch → return 'Error: Invalid URL'" is insufficient — it must actively validate against SSRF targets, not just catch malformed URLs.

## Warnings

- **Edge Cases section** — "Invalid URL in web_fetch → return 'Error: Invalid URL'" is vague. The plan should specify what makes a URL "invalid" beyond syntax (e.g., blocked hosts, non-HTTP schemes). Current wording suggests only parseable URLs would be fetched.
- **Milestone 1 / DuckDuckGo HTML parsing** — HTML scraping is inherently fragile. If the HTML structure changes, parsing silently fails or returns malformed results. The error-as-JSON pattern mitigates this, but consider adding a versioned parsing fallback or explicit "parsing failed" error.

## Approved

- **No API keys required** — Using DuckDuckGo HTML endpoint and Jina Reader free tier eliminates credential management risk.
- **No new npm packages** — Reduces dependency attack surface and supply chain risk.
- **Error-as-string pattern** — Returns structured error strings rather than throwing exceptions, avoiding stack trace leakage in agent context.
- **4096 character limit** — Reasonable content truncation prevents memory abuse and large response amplification.
- **Rate limiting edge case addressed** — Plan explicitly covers HTTP 429 handling.
- **Content-type validation for non-HTML** — Detecting PDF/images and returning error is good.

## Suggestions

- Consider logging sanitized fetch requests (URL domain only, not full URL) for debugging without exposing internal network details.
- Add a comment in the code explaining why URL validation is critical (SSRF prevention for autonomous agent).
- Consider timeout configuration for Jina Reader requests to prevent hanging.

## Summary

The plan is well-structured with good error handling patterns, but has one critical security gap: web_fetch lacks explicit SSRF protection in the design. Relying on docstrings to guide LLM behavior is insufficient for a security-sensitive feature. The implementation must include code-level URL validation blocking access to internal networks and non-HTTP resources before the plan can proceed.

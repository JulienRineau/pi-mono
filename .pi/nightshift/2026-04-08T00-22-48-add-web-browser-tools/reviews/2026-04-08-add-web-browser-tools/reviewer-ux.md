---
reviewer: ux-reviewer
verdict: conditional
target: 2026-04-08-add-web-browser-tools
scope: plan
reviewed-at: 2026-04-08T00:50:51.366Z
---

## Critical
None.

## Warnings

- **Milestone 3**: Settings interface additions (`webSearch.maxResults`, `webFetch.maxChars`) lack user-facing documentation. No mention of:
  - Expected settings.json format for these options
  - How users configure them (CLI vs file vs defaults only)
  - That execute functions don't receive settings (schema defaults used instead)
  
  Impact: Users won't know these settings exist or how to configure them.

- **Plan / Edge Cases section**: Error messages like `"Error: 429"`, `"Error: timeout"`, `"Error: Connection refused"` are minimal. Missing:
  - Context about which operation failed
  - Retry guidance for rate limits
  - Human-readable variants vs technical details
  
  Impact: If these errors surface to users (logs, debug output), they're cryptic.

- **Spec / "web_fetch tool" row**: Docstring must restrict URLs to search results is marked critical, but the plan doesn't verify the actual docstring content in `web-search.ts` or `web-fetch.ts` against this requirement.
  
  Impact: Verification step missing from validation criteria.

## Approved

- Error-as-string pattern (never thrown) enables natural retry behavior — good UX for autonomous agent use
- Truncation feedback with `[truncated]` indicator is clear and actionable
- Both tools in "web" group for unified activation — sensible grouping
- DuckDuckGo + Jina Reader work without API keys — no friction for users to enable
- Output formats match spec: JSON for search, `# Title\n\nmarkdown` for fetch

## Suggestions

- Add a "User Documentation" section to Milestone 3 specifying how to document the new settings (e.g., examples in docs/settings.md)
- Consider error message consistency: `"Error: Jina Reader rate limited (HTTP 429)"` vs `"Error: 429"`
- Add a row to Edge Cases documenting what happens when Jina Reader returns a "failed to fetch" style error (currently handled but not explicitly called out)
- Document that tool docstrings guide LLM behavior — this is an important user-facing guarantee worth calling out

## Summary

The plan addresses user-facing UX well: error-as-strings for retry, no API key friction, clear output formats, and tool grouping. The main gaps are user documentation for the new settings interface and explicit verification of the critical docstring restriction on `web_fetch`. Recommend conditional pass — address the documentation gap before implementation is complete.

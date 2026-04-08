---
reviewer: review-ux
verdict: pass
target: 2026-04-08-add-web-browser-tools
scope: plan
reviewed-at: 2026-04-08T04:21:46.800Z
---

# UX Review: Add Web Browser Tools for Autonomous Research

## Critical
None. The plan demonstrates strong UX thinking.

## Warnings
- `packages/coding-agent/src/core/tools/web-search.ts:74` — The error JSON format includes a `retry: true` boolean, but `web_fetch` uses simple `"Error: ..."` strings. If a developer or LLM examines both error patterns, they differ structurally. This is intentional per spec, but may cause confusion during debugging if not documented.

- The plan correctly identifies the obsolete test file for deletion but doesn't explicitly note what test coverage might be lost. The plan states `web-tools-unit.test.ts` has "98 comprehensive tests" but doesn't enumerate what edge cases exist only in the old file that may have been addressed differently. Consider adding a brief coverage comparison.

## Approved
- **Error messages are clear and actionable**: `"Error: Invalid URL"`, `"Error: URL not allowed"`, `"Error: Connection refused"`, `"Error: Page not found (404)"` — users and LLMs can understand failures without stack traces
- **SSRF protection distinguishes error types**: `"URL not allowed"` for SSRF-blocked URLs vs `"Invalid URL"` for syntax errors gives the LLM information to retry appropriately
- **Error-as-string pattern is well-documented**: The spec explicitly states errors returned as strings, never thrown. This enables emergent retry behavior
- **Truncation marker is visible**: `[truncated]` appended to truncated content so consumers know they haven't seen everything
- **CLI discoverability**: `--tools=web` shorthand and the help text clearly show available tools
- **README documentation**: `packages/coding-agent/README.md:530-538` documents both tools with descriptions and SSRF protection notice
- **SSRF distinct error for blocked URLs**: Returns `"Error: URL not allowed"` for internal URLs, clearly distinct from other errors
- **Tool docstrings include usage guidance**: `web_fetch` description mentions "Only use URLs from web_search results" and has `promptGuidelines` array for LLM behavior

## Suggestions
- Consider adding an example in the README showing the LLM chaining `web_search` → `web_fetch` for a research task
- The plan mentions system prompt guidance is "deferred to future iteration" — this is a significant gap since LLM behavior depends heavily on how tools are described. Future iteration should include prompt engineering guidance

## Summary
The plan is well-designed from a UX perspective. Error messages are clear, actionable, and enable the LLM to retry appropriately. SSRF protection is comprehensive and produces distinct error types. CLI integration with `--tools=web` is discoverable and documented. The main concern is the error format inconsistency between `web_search` (JSON with `retry` flag) and `web_fetch` (simple strings), though this is intentional per spec.

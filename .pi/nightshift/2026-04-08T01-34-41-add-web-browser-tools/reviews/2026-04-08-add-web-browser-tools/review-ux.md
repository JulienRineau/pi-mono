---
reviewer: review-ux
verdict: conditional
target: 2026-04-08-add-web-browser-tools
scope: plan
reviewed-at: 2026-04-08T02:09:24.824Z
---

## Critical

- **Tool grouping strategy mismatch**: The spec states "Both tools in same group ('web') for unified activation" but the plan explicitly states "No `group` property exists on `ToolDefinition`". The workaround (CLI alias + system prompt + settings preset) is a reasonable engineering compromise, but there's no explicit requirement that both tools are registered under a single `group` property. This should be clarified: does the user actually need a `group` property, or is the three-pronged approach sufficient?

- **web_fetch URL restriction not validated**: The docstring on `web_fetch` says "IMPORTANT: Only use URLs from web_search results" but there's no enforcement mechanism. If a user bypasses the docstring guidance and passes a direct URL, will it work? If it does, this creates a false sense of restriction. The UX of "docstring guidance" assumes the LLM follows instructions perfectly, but users calling the tool directly may be confused.

## Warnings

- **Truncation boundary ambiguity**: The plan states "Indicator included in 4096 char limit" and "Truncate to 4096 chars". Does this mean the output is guaranteed to be exactly 4096 chars, or up to 4096 chars? If a page yields 4096 chars exactly, where does the truncation indicator fit? This should be clarified with concrete examples.

- **Progress feedback during fetch**: The plan doesn't address what the user sees while `web_fetch` is in progress. A 15-second timeout on a slow site means the user sees nothing until the tool returns. Consider: should there be streaming output or a status indicator for long-running fetches?

- **"--tools web" not explicitly validated**: The plan says "Add `web` as valid tool name that expands to `web_search,web_fetch`" but doesn't include validation. If this shorthand isn't recognized by the CLI, users get a cryptic error. Ensure the CLI help text and error messages clearly document this alias.

- **Jina Reader privacy messaging gap**: The plan mentions "Document that URLs are sent to third-party" but doesn't specify where. Is this only in the README, or should the error message "Error: Fetching via Jina Reader API" appear at some point? Users who disable Jina for privacy won't understand why it was attempted.

## Approved

- **Error messages are actionable for LLM retry**: The Decision Log correctly prioritizes exposing HTTP status codes and rejection reasons to enable intelligent retry behavior. `"Error: Rate limited (429). Retry after a delay"` is far better than a generic "Request failed."

- **Error-as-string pattern is well-reasoned**: The decision to return errors as strings (not exceptions) enables emergent retry behavior. This is the key UX insight from DeerFlow that the plan correctly adopts.

- **Comprehensive edge case coverage**: Empty search query, invalid URLs, rate limiting, large pages, network timeouts, non-HTML content — all addressed with specific error messages.

- **CLI shorthand `--tools web` is user-friendly**: Unifying two related tools under a single alias reduces cognitive load. Users can enable both with one flag.

- **Settings configuration for max_results and timeout**: Sensible defaults (5 results, 15s timeout) with override capability shows good API ergonomics.

- **Documentation milestones are included**: README update and CHANGELOG entries ensure users can discover and understand the new tools.

- **SSRF protection is thoughtfully designed**: Blocking private IPs, localhost, and DNS rebinding protection prevents security issues that would create bad UX (blocked access, security incidents).

## Suggestions

- **Consider adding a "fetch status" indicator**: For transparency, the `web_fetch` output could include metadata like `Fetched via Jina Reader` or `Fetched via direct HTML` so users understand how content was retrieved.

- **Clarify behavior when both fetch stages fail**: The plan says "On both failure, return descriptive error string." Consider: should the error indicate whether Jina failed, HTML fallback failed, or both? This helps users understand if the issue is transient (try again) or permanent (site blocks automated access).

- **Add a milestone for testing the "web" shorthand**: The validation section tests `web_search` and `web_fetch` individually but doesn't explicitly test the `--tools web` alias expansion.

## Summary

The plan demonstrates solid UX thinking: actionable error messages that enable retry, sensible defaults, comprehensive edge case handling, and documentation. The main concerns are: (1) clarifying whether the `group` property on `ToolDefinition` needs to exist vs. the workaround, (2) ensuring the `web` CLI shorthand is explicitly validated, and (3) clarifying truncation behavior. These are resolvable before implementation and don't block work to proceed.

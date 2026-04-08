---
reviewer: review-code
verdict: conditional
target: 2026-04-08-add-web-browser-tools
scope: plan
reviewed-at: 2026-04-08T00:51:00.451Z
---

## Critical

- **DuckDuckGo HTML parsing strategy undefined**: The plan mentions `parseDuckDuckGoHtml(html: string)` but provides no implementation details. Tests mock `global.fetch` and return `JSON.stringify([{title, url, snippet}])` directly, but the actual implementation must parse HTML from `https://html.duckduckgo.com/html/`. No DOM parser library is available (constraints: "No new npm packages"), so the plan must specify the parsing approach (regex patterns, edge cases).

- **Settings integration contradiction**: Milestone 3 adds settings interfaces and getter methods (`getWebSearchMaxResults()`, `getWebFetchMaxChars()`), but the execute functions don't receive settings. The plan acknowledges this: "Execute function doesn't receive settings; schema default=5, 4096". Yet tests in `web-tools-settings.test.ts` expect tools to use settings values. This must be resolved: either settings flow through `ctx`, or the settings interfaces are purely structural/type-only and don't affect runtime behavior.

## Warnings

- **`providers/` directory not in current structure**: Plan shows `packages/coding-agent/src/core/tools/providers/` but current codebase has no such directory. Implementation should create the directory or clarify the structure.

- **Jina Reader fallback undefined**: Plan says "Return error after Jina fails" with no local HTML→markdown fallback. Tests expect proper content extraction. The plan should clarify: does "return error" mean the tool fails completely, or does it attempt direct HTML fetch?

- **web_fetch output format assumes Jina provides markdown with title**: Tests expect `# Title\n\n{content}` but Jina Reader returns content prefixed with metadata lines (`Title: ...`, `URL: ...`). Plan doesn't account for stripping these prefixes.

- **"web" tool group unspecified**: Requirements state both tools should be in same "web" group, but current `allTools` exports them as separate keys (`web_search`, `web_fetch`). Implementation needs explicit grouping mechanism.

## Approved

- **Spec alignment**: Acceptance criteria from spec are properly mapped to milestones
- **Test coverage**: 65+ tests across 4 files provide good coverage for acceptance criteria and edge cases
- **Error handling philosophy**: Error-as-string pattern correctly implemented (no exceptions thrown)
- **Provider choice**: DuckDuckGo HTML + Jina Reader both work without API keys per constraints
- **Decision log**: Key architectural decisions documented with rationale

## Suggestions

- Add example regex patterns for DuckDuckGo HTML parsing in the Implementation Approach section
- Specify how to strip Jina Reader's metadata prefix lines before the `# Title` heading
- Clarify whether `createAllTools()` or the agent system has a "group" concept, or if this needs new infrastructure
- Consider adding a `ProviderResult<T>` wrapper type for consistent error handling across providers

## Summary

The plan provides solid structure and clear milestones, but has two unresolved design contradictions: (1) settings integration with execute functions that don't receive them, and (2) HTML parsing strategy without DOM library dependencies. These should be resolved before implementation begins.

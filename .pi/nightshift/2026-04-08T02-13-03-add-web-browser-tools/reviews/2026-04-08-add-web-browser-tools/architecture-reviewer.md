---
reviewer: architecture-reviewer
verdict: pass
target: 2026-04-08-add-web-browser-tools
scope: plan
reviewed-at: 2026-04-08T02:53:32.170Z
---

## Critical
None.

## Warnings

1. **CLI `--tools` group expansion unspecified**: Milestone 3 requires updating `args.ts` to expand `--tools=web` to individual tool names, but the plan doesn't show the implementation approach. Need to verify this integrates cleanly with existing `--tools` validation.

## Approved

1. **Clean module boundaries**: Splitting into `web-search.ts`, `web-fetch.ts`, and `ssrf-protection.ts` follows single-responsibility principle. SSRF validation is separately testable.

2. **Extensible for providers**: While the initial implementation is inline, the architecture allows extracting `duckduckgo.ts` and `jina-reader.ts` providers later without API changes.

3. **Integration with existing infrastructure**: Tool registration via `index.ts` exports, TypeBox schema validation, and `wrapToolDefinition()` integration are all standard patterns.

4. **Tool group concept**: `WEB_TOOL_NAMES` constant enables type-safe group handling and aligns with the existing tool activation API.

5. **Sequential milestone decomposition**: Each milestone is independently validatable and provides a natural rollback point.

6. **Consistent with ToolDefinition interface**: Plan follows the established pattern of factory functions returning `ToolDefinition` and `AgentTool` with appropriate TypeBox schemas.

7. **Error-as-values pattern**: Returning strings/JSON instead of throwing exceptions is architecturally sound for LLM tool calling - errors become part of the conversation context.

## Suggestions

1. **Consider how tool grouping interacts with `setActiveTools()`**: The plan mentions unified activation via `--tools=web`, but doesn't specify how `setActiveTools(["web"])` would expand to both tools. This should be documented.

2. **Consider the render pipeline**: Unlike bash tool, these tools don't define custom `renderCall` or `renderResult` functions. The default text rendering should suffice for the JSON/string outputs, but this assumption should be verified.

## Summary

The architecture follows established patterns cleanly. The module separation (SSRF protection as its own module) is sound and enables testability. The plan correctly integrates with the existing tool registration system and provides clear milestone boundaries for execution.

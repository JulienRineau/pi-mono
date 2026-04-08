---
reviewer: architect-reviewer
verdict: pass
target: 2026-04-08-add-web-browser-tools
scope: plan
reviewed-at: 2026-04-08T02:52:17.853Z
---

## Critical
None.

## Warnings
None. The plan addresses security concerns (SSRF protection, protocol allowlist) with comprehensive mitigations.

## Approved

### Separation of Concerns
- **Three focused modules**: `web-search.ts`, `web-fetch.ts`, `ssrf-protection.ts` each have single clear responsibilities
- **SSRF protection as standalone module**: Enables independent testing and reuse (lines 98-145 in spec)
- **Provider abstraction**: DuckDuckGo HTML parsing separated from tool definition, allowing provider swaps

### Dependency Direction
- Dependencies flow correctly: `web-fetch.ts` → `ssrf-protection.ts` → standard library
- No circular dependencies visible
- High-level tools depend on low-level utilities and interface abstractions

### Abstraction Quality
- **SSRF check interface** (`isUrlBlocked(url: URL): { blocked: boolean; reason?: string }`): Clean, testable abstraction
- **Factory pattern** matches existing codebase: `createWebXxxToolDefinition(cwd, options?)` + `createWebXxxTool(cwd, options?)`
- **TypeBox schemas** properly defined with descriptions and defaults (web-search lines 170-175, web-fetch lines 182-185)

### API Surface Consistency
- Exports match existing patterns: default instances + factory functions + types
- `WEB_TOOL_NAMES = ["web_search", "web_fetch"] as const` constant for group identification
- Tool schemas use TypeBox with proper descriptions

### Security Architecture
- **SSRF check BEFORE fetch** (Milestone 2 Step 2): Correct timing prevents DNS rebinding attacks
- **Protocol allowlist**: Only `http:` and `https:` allowed (blocks `file://`, `ftp://`, etc.)
- **Hostname normalization**: Lowercase + trailing dot removal prevents case/traversal bypass
- **IPv6 coverage**: Loopback (`::1`), link-local (`fe80::/10`), unique local (`fc00::/7`)
- **IPv4-mapped extraction**: `::ffff:127.0.0.1` pattern + extraction function

### Error Handling Design
- **Error-as-string pattern**: Follows DeerFlow contract for emergent retry behavior
- **Distinct error messages**: `"Error: URL not allowed"` for SSRF vs `"Error: Invalid URL"` for syntax errors
- **JSON vs string error formats**: Appropriate to use case (structured for search reparse, simple for fetch)

### Tool Group Design
- `"web"` group enables `--tools=web` activation pattern
- Both tools registered in `allTools`/`allToolDefinitions` maintaining consistency
- Group expansion in CLI enables ergonomic tool activation

## Suggestions

### 1. CLI Group Expansion Logic
**Location**: `packages/coding-agent/src/cli/args.ts`

The plan defines `WEB_TOOL_NAMES` constant but doesn't specify the CLI validation logic. Recommend adding:

```typescript
// After validating individual tools, check for group names
const toolGroups: Record<string, ToolName[]> = { web: ["web_search", "web_fetch"] };
for (const tool of validTools) {
  if (toolGroups[tool]) {
    validTools.push(...toolGroups[tool]);
  }
}
```

This ensures `--tools=web` expands to both tools.

### 2. Test File Location
**Location**: `packages/coding-agent/test/`

The plan references `test/web-tools.test.ts` and `test/suite/web-tools-integration.test.ts` but these don't exist in the current codebase. Verify test files will be created as part of implementation, or clarify existing test structure to extend.

### 3. Readability/Extraction Fallback
**Location**: `packages/coding-agent/src/core/tools/web-fetch.ts`

The plan mentions "Fallback when Readability unavailable" but doesn't specify the fallback mechanism. Recommend clarifying: if Jina Reader fails, should it attempt direct HTTP fetch with basic HTML→text conversion, or just return the error?

## Summary

The plan demonstrates solid architecture with proper separation of concerns, consistent patterns following the existing codebase, and comprehensive SSRF protection. The four-milestone decomposition is logical and enables incremental validation. No blocking issues identified.

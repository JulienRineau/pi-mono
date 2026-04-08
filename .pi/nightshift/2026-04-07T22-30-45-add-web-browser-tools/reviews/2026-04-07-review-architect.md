# Architectural Review: Add Web Browser Tools

**Reviewer:** architect  
**Date:** 2026-04-07  
**Target:** 2026-04-07-add-web-browser-tools  
**Scope:** plan

---

## Verdict: APPROVED WITH CONCERNS

The plan is well-structured and follows existing patterns, but there are architectural concerns to address before implementation.

---

## Strengths

1. **Correct Tool Pattern**: Follows the established `createToolDefinition` factory pattern from `read.ts`
2. **Proper Error Strategy**: Error-as-strings matches DeerFlow pattern and enables LLM retry behavior
3. **TypeBox Schema**: Uses `@sinclair/typebox` for parameter validation (consistent with existing tools)
4. **Existing Integration**: Tools are already exported in `index.ts` and registered in `allTools`/`allToolDefinitions`
5. **TDD Approach**: 64 tests across 3 files provides good coverage before implementation

---

## Concerns

### 1. DuckDuckGo HTML Scraping is Brittle

**Location**: Milestone 1, Step 1

The plan relies on scraping DuckDuckGo's HTML, which is fragile. The HTML structure can change without notice, breaking the implementation silently.

**Recommendation**: Consider implementing a simple provider abstraction now:

```typescript
// packages/coding-agent/src/core/tools/providers/duckduckgo.ts
export interface SearchResult { title: string; url: string; snippet: string; }
export interface SearchProvider {
  search(query: string, maxResults: number): Promise<SearchResult[]>;
}
```

This adds minimal complexity but enables easy fallback if DuckDuckGo changes their HTML.

### 2. Jina Reader Dependency Risk

**Location**: Milestone 2, Step 1

Jina Reader is a third-party free tier service. Rate limits or service changes could break web_fetch.

**Recommendation**: Document this dependency and consider adding fallback:
- Fallback 1: Direct HTML fetch + client-side markdown conversion (adds complexity but no new packages)
- Fallback 2: Error message suggesting alternative approaches

### 3. Missing Settings Integration Path

**Location**: Milestone 3/Integration tests

The integration test checks for `webSearch.maxResults` in settings, but there's no implementation plan for how settings flow to the tools.

**Question**: How should `maxResults` from settings override the schema default of 5?

**Recommendation**: Add explicit step:
> "Wire up `settings.webSearch.maxResults` to `createWebSearchToolDefinition({ maxResults })`"

### 4. 4096 Character Limit Ambiguity

**Location**: web-fetch.ts stub, spec

The test checks `text.length <= 4096` but doesn't specify:
- Is this before or after title extraction?
- What's the format of the truncation notice?
- How is Unicode handled?

**Current stub** has no truncation logic - needs clear specification.

### 5. Missing `providers/` Directory Structure

**Spec vs Plan**: The original spec mentioned `providers/duckduckgo.ts` and `providers/jina-reader.ts`, but the plan embeds everything in the tool files. This is simpler but less extensible.

**Decision needed**: Accept embedded implementation now, refactor to providers/ if needed?

### 6. Test Fragility

**Location**: web-search.test.ts line ~100

```typescript
expect(fetchCall).toContain("duckduckgo");
```

This test assumes a specific URL format. If DuckDuckGo changes from `html.duckduckgo.com` to something else, the test fails without indicating a real problem.

---

## Minor Issues

1. **Milestone 3 is redundant**: `allTools`/`allToolDefinitions` already include web tools (verified in `index.ts`). The "verification" is already done.

2. **Milestone 5 (README)** doesn't specify what to add. Should document:
   - New `--tools web_search,web_fetch` option
   - Default activation status

3. **The web-fetch.ts test "should return 'Error: Invalid URL'"** tests URL validation in the execute function, but this could be better handled by TypeBox schema validation.

---

## Recommendations

1. **Add provider abstraction** (low effort, high value for future maintenance)
2. **Clarify settings wiring** for maxResults override
3. **Specify truncation format** exactly
4. **Simplify Milestone 3** to just verify existing exports work
5. **Document Jina Reader dependency** in a risks table
6. **Remove redundant test checks** for provider URL (test intent, not implementation)

---

## Summary Table

| Aspect | Status | Notes |
|--------|--------|-------|
| Tool pattern | ✅ Good | Follows existing conventions |
| Error handling | ✅ Good | String returns enable retry |
| TypeBox schema | ✅ Good | Consistent with codebase |
| Test coverage | ✅ Good | 64 tests defined |
| Provider abstraction | ⚠️ Concern | Brittle HTML scraping |
| Settings integration | ⚠️ Missing | Not specified |
| Truncation logic | ⚠️ Unclear | Format not specified |
| README update | ⚠️ Vague | Scope unclear |

---

## Assumptions

- [assumption]: DuckDuckGo HTML endpoint structure will remain stable enough for initial release
- [assumption]: Jina Reader free tier won't hit limits for typical usage
- [assumption]: Settings integration is optional for MVP (tools work with defaults)

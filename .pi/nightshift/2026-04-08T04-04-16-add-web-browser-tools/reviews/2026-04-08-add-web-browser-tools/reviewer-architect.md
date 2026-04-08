---
reviewer: architect-reviewer
verdict: pass
target: 2026-04-08-add-web-browser-tools
scope: plan
reviewed-at: 2026-04-08T04:21:16.655Z
---

## Critical

None. The implementation is complete and architecturally sound.

## Warnings

- **`web-search.ts:51`** — The DuckDuckGo HTML parsing uses regex-based HTML parsing which is fragile. The spec itself notes: "DuckDuckGo HTML format may change; return error JSON on parse failure." This is acknowledged but worth tracking. The error handling is correct (returns error JSON), so degradation is graceful.

## Approved

### Separation of Concerns
- **Modular structure**: `web-search.ts`, `web-fetch.ts`, and `ssrf-protection.ts` each have single, clear responsibilities
- **Provider abstraction**: DuckDuckGo HTML API and Jina Reader API are encapsulated in their respective modules with no cross-dependencies
- **SSRF protection as standalone module**: `ssrf-protection.ts` is a reusable, testable unit with comprehensive pattern coverage

### Dependency Direction
- All dependencies flow from tool modules toward lower-level providers (DuckDuckGo, Jina)
- `ssrf-protection.ts` has no dependencies on tool modules — pure utility

### Coupling
- **Low coupling**: Each tool can be used independently or as a group
- Tool functions (`searchWeb`, `fetchWebPage`) accept optional `fetch` parameter for testing injection
- Tool registration in `index.ts` is declarative, not imperative

### Abstraction Quality
- **Error-as-string pattern** (web_fetch): Returns `"Error: ..."` strings instead of throwing, enabling emergent retry behavior
- **Error-as-JSON pattern** (web_search): Returns `{error, retry}` JSON, consistent within the tool
- Both patterns are explicitly documented and tested

### API Surface
- **`WEB_TOOL_NAMES` constant** (`index.ts:86`): Clean export for tool grouping, used by CLI for `--tools=web` expansion
- **`createWeb*Tool` factory functions**: Follow existing pattern in codebase (bash, read, edit, write)
- **`isUrlBlocked()` function**: Returns `{blocked, reason, reasonType}` — distinguishes "protocol" from "ssrf" errors for caller differentiation
- **Optional `fetch` injection**: Enables testing without network or global state

### Extensibility
- **Provider-swappable**: Can swap DuckDuckGo for another search provider by modifying `web-search.ts`
- **Jina Reader configurable**: Alternative markdown conversion endpoint could replace `r.jina.ai`
- **Tool grouping**: `WEB_TOOL_NAMES` makes adding web_* tools trivial

### Consistency with Existing Architecture
- Follows existing `create*BashTool`, `createEditTool` pattern from codebase
- Uses `wrapToolDefinition()` for consistency with other tools
- TypeBox schemas follow existing pattern for parameter validation
- CLI `--tools=web` expansion mirrors existing comma-separated tool handling

### SSRF Protection Coverage
The `ssrf-protection.ts` module comprehensively covers:
- IPv4: loopback (127.0.0.0/8), private (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16), link-local (169.254.0.0/16), broadcast (0.0.0.0/8)
- IPv6: loopback (::1), link-local (fe80::/10), unique local (fc00::/7), unspecified (::)
- IPv4-mapped IPv6 (::ffff:127.0.0.1)
- Protocol allowlist: only `http:` and `https:` allowed
- Hostname normalization: lowercase, trailing dot removal (prevents case/dot bypass)

### Error Handling Architecture
Both tools handle errors at the appropriate architectural boundary:
- **SSRF check before fetch** (`web-fetch.ts:56-60`): Validates hostname before network request prevents DNS rebinding attacks
- **Graceful degradation**: All failures return strings/JSON, never throw
- **Specific error messages**: Distinct messages for 404, 403, 429, 500, empty response, network errors

### Test Architecture
- **`web-tools-unit.test.ts`**: 98 passing tests using mocks — no network dependencies
- **`web-tools.test.ts`**: 7 failing tests due to real network calls — acknowledged in plan as obsolete
- Test files use dynamic imports for graceful module-not-found handling during TDD

## Suggestions

1. **Consider extracting provider interfaces** — If multiple providers are planned, an interface for search/fetch providers would enable dependency injection testing without mocking fetch globally.

2. **Consider rate limiting integration** — The spec mentions DuckDuckGo rate limiting, but there's no retry logic with backoff. The LLM's retry behavior is emergent rather than programmed.

3. **Consider adding a `--no-web` exclusion** — The CLI has `--tools=web` but no way to disable web tools if they become default. Lower priority since no default currently includes web tools.

## Summary

The web browser tools implementation is architecturally complete and well-designed. Module boundaries are clean with proper separation of concerns. The SSRF protection is comprehensive covering IPv4, IPv6, and protocol allowlist. Error handling follows the error-as-string pattern enabling emergent LLM retry behavior. The plan appropriately identifies the obsolete test file (`web-tools.test.ts`) with network dependencies and correctly proposes deletion in favor of the comprehensive mock-based test suite. The single milestone (delete obsolete test file) is appropriate given the implementation status.

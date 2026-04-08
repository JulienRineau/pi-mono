---
title: Add web browser tools for autonomous web research
type: feature
priority: high
status: ready
created: 2026-04-07
---

## Purpose

Enable the coding agent to autonomously browse the web for research tasks. When given a research query, the agent should be able to search the web, retrieve full page content, and synthesize findings — without manual URL hunting.

## Background

DeerFlow demonstrates that web browsing behavior emerges from the combination of:
- `web_search` returning structured JSON results
- `web_fetch` returning markdown with restrictive docstrings
- Errors returned as strings (not exceptions) enabling natural retry
- Tool grouping so both are always available together

The LLM autonomously chains search→fetch based on the tool contracts, not orchestration code.

## Acceptance Criteria

### web_search tool
- [ ] Accepts `query: string` and optional `max_results: number` (default 5)
- [ ] Returns JSON string with array of `{title, url, snippet}` per result
- [ ] On failure: returns JSON error object, never throws
- [ ] Uses DuckDuckGo as default provider
- [ ] Docstring: "Search the web for information. Use this tool to find current information, news, articles, and facts from the internet."
- [ ] Configurable max_results via settings (schema default used at runtime)

### web_fetch tool
- [ ] Accepts `url: string`
- [ ] Returns `# {title}\n\n{markdown_content}` truncated to 4096 chars
- [ ] On failure: returns `"Error: ..."` string (not thrown)
- [ ] Handles HTTP errors (4xx, 5xx), empty responses, network errors gracefully
- [ ] Docstring restricts URLs to those from search results (critical for LLM behavior)
- [ ] Uses Jina Reader API or equivalent for HTML→markdown conversion
- [ ] **SSRF Protection**: Blocks internal/private URLs (localhost, 10.x.x.x, 172.16-31.x.x, 192.168.x.x, 169.254.x.x)

### Readability pipeline
- [ ] Extracts article content from raw HTML
- [ ] Converts HTML to clean markdown
- [ ] Extracts title, defaults to "Untitled" if missing
- [ ] Returns "No content could be extracted from this page" for empty content
- [ ] Fallback when Readability/unavailable

### Tool registration
- [ ] Both tools registered as built-in tools (like read/write/edit/bash)
- [ ] Tools in same group ("web") for unified activation
- [ ] Tool schemas use TypeBox for parameter validation
- [ ] Docstrings included in tool definitions

### System prompt guidance
- [ ] Skill or system prompt guidance on when to use fetch vs snippets
- [ ] Encourages parallel tool calling

### Error resilience
- [ ] Errors returned as strings, never as thrown exceptions
- [ ] LLM naturally retries with different URLs on failure

## Implementation Approach

### 1. Built-in tool structure
```
packages/coding-agent/src/core/tools/
├── web-search.ts      # web_search tool implementation
├── web-fetch.ts       # web_fetch tool implementation
└── providers/
    ├── duckduckgo.ts  # Search provider
    └── jina-reader.ts # HTML→markdown provider
```

Tools registered in `packages/coding-agent/src/core/tools/index.ts` alongside `read`, `write`, `edit`, `bash`.

### 2. web_search implementation
- Fetch DuckDuckGo HTML from `https://html.duckduckgo.com/html/`
- Parse results using regex targeting DuckDuckGo HTML structure:
  - Titles: `<a class="result__a" href="{url}">{title}</a>`
  - Snippets: `<a class="result__snippet">{snippet}</a>`
- Normalize to `{title, url, snippet}` schema
- Return JSON string (not object)
- Wrap all errors in JSON error object
- **Note**: DuckDuckGo HTML format may change; return error JSON on parse failure

### 3. web_fetch implementation
- **SSRF Protection**: Validate URL against blocklist BEFORE fetching:
  ```typescript
  const BLOCKED_PATTERNS = [
    /^localhost$/i,
    /^127\.\d+\.\d+\.\d+$/,
    /^::1$/,
    /^10\.\d+\.\d+\.\d+$/,
    /^172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+$/,
    /^192\.168\.\d+\.\d+$/,
    /^169\.254\.\d+\.\d+$/, // link-local (AWS metadata)
    /^0\.\d+\.\d+\.\d+$/,  // broadcast
  ];
  
  function isUrlBlocked(url: URL): boolean {
    const hostname = url.hostname;
    return BLOCKED_PATTERNS.some(pattern => pattern.test(hostname));
  }
  ```
- Return `"Error: URL not allowed"` for blocked URLs (distinguish from syntax errors)
- Use Jina Reader API: `https://r.jina.ai/{url}` returns markdown
- Strip Jina Reader metadata prefix (lines starting with `Title:`, `URL:`, etc.)
- Extract title from first `# heading` in markdown or infer from URL
- Truncate to 4096 chars, appending `[truncated]` if cut
- Return `"Error: ..."` on any failure

### 4. Title extraction helper
```typescript
function extractTitle(markdown: string, fallbackUrl: string): string {
  // Match first # heading
  const headingMatch = markdown.match(/^#\s+(.+)$/m);
  if (headingMatch) return headingMatch[1].trim();
  
  // Fallback: derive from URL path
  try {
    const url = new URL(fallbackUrl);
    return url.pathname.split('/').pop()?.replace(/[-_]/g, ' ') || 'Untitled';
  } catch {
    return 'Untitled';
  }
}
```

### 5. Tool registration
```typescript
pi.registerTool({
  name: "web_search",
  description: "Search the web for information...",
  parameters: Type.Object({
    query: Type.String(),
    max_results: Type.Optional(Type.Number({ default: 5 })),
  }),
  execute: async (...) => { ... }
});

pi.registerTool({
  name: "web_fetch", 
  description: "Fetch the contents of a web page. Only use URLs from web_search results...",
  parameters: Type.Object({ url: Type.String() }),
  execute: async (...) => { ... }
});
```

### 6. Tool grouping
Export tools with group identifier for unified activation:
```typescript
export const webTools = {
  web_search: { ... },
  web_fetch: { ... },
  group: "web"  // Enables --tools=web activation
};
```

## Edge Cases

- Empty search query → return `{"error": "Empty query"}` JSON
- Invalid URL syntax → return `"Error: Invalid URL"`
- SSRF-blocked URL → return `"Error: URL not allowed"` (distinct from syntax error)
- Rate limiting from search provider → return `{"error": "Rate limited", "retry": true}` JSON
- Very large pages → truncate to 4096 chars, append `[truncated]`
- Network timeout → return `"Error: Request timeout"` string
- Non-HTML content (PDF, image) → return `"Error: Unsupported content type"`
- DuckDuckGo HTML parse failure → return `{"error": "Search failed"}` JSON
- Jina Reader failure → return `"Error: Failed to fetch content"`

## Constraints

- Must work without API keys (DuckDuckGo, Jina Reader free tier)
- No new npm packages required
- Tools must work with existing `setActiveTools()` API

## Out of Scope

- Multiple search providers beyond DuckDuckGo
- Caching of search/fetch results
- Session persistence of browser state
- Screenshot capability

## Tests to Write

### web_search
1. Mock DuckDuckGo returns 3 results → valid JSON with {title, url, snippet}
2. Mock returns 0 results → error JSON, no crash
3. Mock throws exception → error JSON returned
4. Config max_results overrides default 5
5. Schema consistency across providers
6. Empty query → error JSON

### web_fetch
1. Successful fetch → contains extracted text, no "Error:" prefix
2. HTTP 429 → "Error: Failed to fetch content" string
3. Empty response → "Error: Empty response"
4. Whitespace-only → "Error: Empty response"
5. Network error → "Error: Connection refused"
6. Large page → truncated to 4096 chars, ends with `[truncated]`
7. Output format → starts with `# {title}\n\n`
8. **SSRF: localhost → "Error: URL not allowed"**
9. **SSRF: 127.0.0.1 → "Error: URL not allowed"**
10. **SSRF: 10.0.0.1 → "Error: URL not allowed"**
11. **SSRF: 172.16.0.1 → "Error: URL not allowed"**
12. **SSRF: 192.168.1.1 → "Error: URL not allowed"**
13. **SSRF: 169.254.169.254 → "Error: URL not allowed"** (AWS metadata)
14. **SSRF: Internal IP range → "Error: URL not allowed"**
15. Valid http:// URL blocked, https:// allowed for same host

### Integration
1. Agent with mocked web_search → calls web_fetch on real URL from results
2. Agent with failing fetch → retries with different URL
3. Both tools in "web" group → both present when activated

## Related Requirements

- The restrictive docstring on `web_fetch` is critical — it guides the LLM to only use URLs from search results
- Error-as-string pattern enables emergent retry behavior without explicit orchestration
- SSRF protection is critical — docstrings are guidance, not enforcement; URLs from adversarial prompts must be blocked

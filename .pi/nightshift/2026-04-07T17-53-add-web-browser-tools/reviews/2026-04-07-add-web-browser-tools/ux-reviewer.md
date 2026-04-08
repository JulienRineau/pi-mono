---
reviewer: ux-reviewer
verdict: conditional
target: 2026-04-07-add-web-browser-tools
scope: plan
reviewed-at: 2026-04-07T18:10:57.995Z
---

## Critical

- **`web-fetch.ts` truncation UX incomplete** (`specs/2026-04-07-add-web-browser-tools.md:41`): The spec mentions "Very large pages → truncate to 4096, note truncation" but the plan doesn't detail HOW truncation is communicated to users/agents. The test file (`web-fetch.test.ts:82-94`) expects a truncation indicator like `[truncat|continu|4096`, but the plan's Milestone 2 only mentions truncating to 4096 chars without specifying the notification mechanism. Users and LLMs need to know content was cut.

- **"web" tool group implementation missing** (`specs/2026-04-07-add-web-browser-tools.md:43`): Spec states "Tools in same group ('web') for unified activation" but neither the spec's Implementation Approach nor the plan's Milestones explain HOW tool groups work or how to implement them. Integration tests reference `toolGroups = { web: ["web_search", "web_fetch"] }` but the plan never explains if this is a feature that needs implementation or an existing API. Users won't understand how to enable both tools with a single flag.

- **README.md will show outdated tool list** (`packages/coding-agent/README.md:524`): The CLI reference says "Available built-in tools: `read`, `bash`, `edit`, `write`, `grep`, `find`, `ls`". After implementation, this will be stale. The plan doesn't mention updating user-facing documentation. Users reading the README won't know `web_search` and `web_fetch` exist.

## Warnings

- **Inconsistent error return formats unexplained** (`plans/2026-04-07-add-web-browser-tools-v1.md:50`): web_search returns `{ error: "..." }` JSON while web_fetch returns `"Error: ..."` plain string. The Decisions table references "DeerFlow pattern" but doesn't justify why two different error formats are needed. This asymmetry could cause unexpected LLM behavior or make debugging harder. Document the intentional difference.

- **Empty/degraded state UX vague** (`specs/2026-04-07-add-web-browser-tools.md:45-48`): "Returns 'No content could be extracted from this page' for empty content" and "Fallback when Readability/unavailable" are mentioned but not detailed. What does the user see? Is this an Error string or valid output? Define the exact UX for these degraded states.

- **No CLI integration test** (`plans/2026-04-07-add-web-browser-tools-v1.md:Milestone 3`): The plan validates `--tools web_search,web_fetch` works via unit tests but doesn't test the actual CLI: `pi --tools web_search,web_fetch "search for X"`. Users interact with CLI, not unit tests. Add a manual verification step.

- **DuckDuckGo HTML parsing brittle** (`plans/2026-04-07-add-web-browser-tools-v1.md:Risks`): The plan acknowledges "HTML parsing may break with site updates" but doesn't specify how users will be notified or what degraded behavior they'll see. Document expected error messages when parsing fails.

## Approved

- **Error-as-string pattern** — Enables natural retry behavior without explicit orchestration; solid UX for autonomous agents
- **Sensible defaults** — `max_results: 5` is reasonable for most use cases
- **Comprehensive test coverage** — 64 tests (19 + 27 + 18) is thorough for a new feature
- **TDD approach** — Tests written before implementation ensures requirements are locked
- **No API keys required** — DuckDuckGo + Jina Reader free tier lowers barrier to entry
- **Character limit at 4096** — Prevents token waste while still providing useful content
- **Markdown output with title** — `# {title}\n\n{content}` format is machine-readable and human-friendly

## Suggestions

- Consider adding `--tools web` as shorthand for `--tools web_search,web_fetch` in a future iteration
- Add a section to SPEC.md about "What to do when tools fail" to help users understand retry behavior
- Consider adding a "last resort" test: what happens when BOTH DuckDuckGo AND Jina Reader are down?

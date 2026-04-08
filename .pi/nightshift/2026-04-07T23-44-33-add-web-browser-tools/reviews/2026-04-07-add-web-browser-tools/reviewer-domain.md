---
reviewer: review-domain
verdict: conditional
target: 2026-04-07-add-web-browser-tools
scope: plan
reviewed-at: 2026-04-07T23:57:54.489Z
---

## Critical

- **No milestone step for docstring update**: The spec explicitly states "web_fetch docstring must restrict URLs to search results (critical for LLM behavior)" and provides the exact docstrings. The plan has no step to implement these docstrings in the tool definitions. The interface section documents parameter schemas but not the docstrings that guide LLM behavior.

- **System prompt guidance not addressed**: The spec requires "Skill or system prompt guidance on when to use fetch vs snippets" and "Encourages parallel tool calling" under acceptance criteria. The plan's Constraints section lists this but has no milestone step or implementation approach for it.

- **max_results configurability unclear**: The spec requires "Configurable max_results via settings" as an acceptance criterion. The plan mentions it in interface docs but provides no implementation approach for how settings work or how the tool reads from them.

## Warnings

- **Truncation may split words**: Milestone 2 step 3 says "Truncate content to 4096 chars" but doesn't specify truncation at word boundary. Long content could be cut mid-word, producing awkward output.

- **HTML parsing strategy underspecified**: "Parse HTML to extract search results (title, URL, snippet)" is vague. DuckDuckGo's HTML structure can vary; the plan should specify which HTML parsing approach to use or include a fallback strategy.

- **Requirements table incomplete**: The plan lists 7 requirements, but the spec's acceptance criteria include additional items: "Configurable max_results via settings", "Docstrings included in tool definitions", "Both tools in same group", "System prompt guidance". These are missing.

- **Jina Reader availability risk not addressed**: Risk section only mentions rate limiting, not what happens if Jina Reader becomes unavailable or deprecated.

- **No mention of tool group registration**: Spec requires "Both tools in same group ('web') for unified activation". No milestone step addresses this.

## Approved

- Milestone structure is clear and sequential: search → fetch → integration
- Edge cases in milestones match spec's edge cases list
- Error handling approach (return strings, never throw) is consistent
- Test coverage is comprehensive (65 tests across 3 files)
- Interface signatures are correctly documented with exact types
- DuckDuckGo + Jina Reader provider choices align with spec rationale
- Existing scaffold files and tests are correctly inventoried

## Suggestions

- Add explicit milestone step to verify docstrings match spec text
- Document HTML parsing approach (regex vs DOMParser vs dedicated library)
- Define how "settings" work for configurable max_results
- Add milestone step for tool group registration
- Consider adding acceptance test that verifies LLM sees the correct docstrings

## Summary

The plan covers the core implementation of web_search and web_fetch tools well, with solid test coverage and correct interface documentation. However, three critical items from the spec's acceptance criteria are not addressed in any milestone: the docstrings (especially the restrictive URL constraint for web_fetch), system prompt guidance, and max_results configurability. The plan should be updated to include these before proceeding.
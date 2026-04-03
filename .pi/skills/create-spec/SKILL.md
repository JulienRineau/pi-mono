---
name: create-spec
description: Write structured spec documents for the nightshift queue
---

# Create Spec Skill

Write specification documents that define what needs to be built. Specs are the input to the nightshift autonomous loop — they must be clear, complete, and independently actionable.

## Process

### 1. Understand the Requirement

Extract from the user's request:
- What problem this solves
- Who benefits
- What success looks like

### 2. Write the Spec

Follow this skeleton exactly:

```markdown
---
title: Short descriptive title
type: bug | feature | refactor
priority: critical | high | medium | low
status: draft
created: YYYY-MM-DD
---

## Purpose

What the user gains after this change. Written from the user's perspective.
State what they can do after that they cannot do before.

## Background

Current state of the system. Why this matters now. Any relevant history or context
that a planner agent needs to understand the problem.

## Acceptance Criteria

- [ ] Criterion 1 — specific, testable outcome
- [ ] Criterion 2 — another independently verifiable result
- [ ] Criterion 3 — observable behavior or measurable output

## Edge Cases

- What happens with empty input? → Expected behavior
- What happens at scale? → Expected behavior
- What happens on failure? → Expected behavior

## Constraints

- Must be backward compatible with X
- Must not add new dependencies
- Must complete within N milliseconds

## Out of Scope

- What this spec deliberately does NOT cover
- Related work that belongs in a separate spec
```

### 3. Validate Before Saving

Ensure your spec has:
- [ ] YAML frontmatter with all required fields (title, type, priority, status, created)
- [ ] Purpose section explains user-visible value
- [ ] At least 3 acceptance criteria, each independently testable
- [ ] Edge cases section considers boundary conditions
- [ ] Out of Scope section prevents scope creep
- [ ] No implementation details — that's the planner's job
- [ ] No ambiguous outcomes — "should work well" → specific measurable result

### 4. Save the Spec

Use the `spec` tool to save:

```
spec({
  "action": "save",
  "spec_name": "fix-auth-timeout",
  "content": "..."
})
```

Set status to `ready` if the spec is complete and ready for the nightshift queue.
Set status to `draft` if it needs more discussion or refinement.

## Rules

- **User perspective**: Write for the person who will benefit, not the developer who will implement
- **Independently testable**: Each acceptance criterion can be verified on its own
- **No implementation details**: Don't prescribe how — describe what and why
- **Complete**: A planner should be able to create a full plan from this spec alone
- **Scoped**: One spec = one coherent unit of work. Split large efforts into multiple specs.

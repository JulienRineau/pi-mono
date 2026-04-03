---
name: review-domain
description: Domain review checklist — business logic correctness, edge cases, acceptance criteria
---

# Domain Review Checklist

## Evaluate

- [ ] **Acceptance criteria**: Does the implementation satisfy every acceptance criterion in the spec?
- [ ] **Business logic**: Is the domain logic correct? Does it handle all specified scenarios?
- [ ] **Edge cases**: Are boundary conditions handled? Empty inputs, max values, concurrent access?
- [ ] **Data integrity**: Are invariants maintained? Can the system enter an invalid state?
- [ ] **Error scenarios**: What happens when things go wrong? Are failures handled gracefully?
- [ ] **Naming accuracy**: Do names (variables, functions, types) accurately describe domain concepts?
- [ ] **Domain model**: Does the code model reflect the problem domain accurately?
- [ ] **Completeness**: Is anything from the spec missing or only partially implemented?
- [ ] **Regression risk**: Could these changes break existing functionality?
- [ ] **User-visible behavior**: Does the change produce the expected user-observable outcome?

## Critical Indicators

Flag as Critical:
- Acceptance criterion not met
- Business logic produces incorrect results
- Data integrity violation (invalid state reachable)
- Missing handling for a specified scenario

## When Reviewing Plans

Focus on: whether all spec requirements are addressed in milestones, if edge cases from the spec are planned for, if the plan's purpose matches the spec's purpose.

## When Reviewing Implementation

Focus on: does the code actually do what the spec says, test each acceptance criterion mentally, check edge cases specified in the spec.

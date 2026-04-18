---
name: nightshift
description: Launch and manage the autonomous spec-processing loop for unattended work
---

# Nightshift

Nightshift is an autonomous loop that processes specs without human intervention. It picks specs from the queue, plans, reviews, implements, tests, and commits — one spec at a time, in a fixed deterministic pipeline. Each spec gets its own branch and draft PR.

Use nightshift when the user is stepping away (overnight, lunch, weekend) and has specs ready to be processed.

## Prerequisites

Before launching nightshift:

1. **Specs must exist and be ready.** Use the `spec` tool to check the queue:
   ```
   spec({ action: "list" })
   ```
   At least one spec must have `status: ready`. If none exist, help the user create specs first (read the `create-spec` skill).

2. **Working tree must be clean and on main.** Nightshift creates a branch per spec from main. Uncommitted work will cause problems.

3. **Tests should pass.** Nightshift runs the full test suite as a quality gate. Pre-existing failures will block every spec.

## Launching

```
nightshift({ action: "start" })
```

Optional parameters:
- `max_specs` — how many specs to process (default: 10)
- `branch` — branch name prefix (default: `nightshift/{date}-{spec-slug}`)
- `skip_prep` — skip the prep phase (default: false)
- `max_review_iterations` — how many review-fix cycles before giving up on a spec (default: 3)

## What Happens

For each spec, nightshift runs this fixed pipeline:

1. **Verify** — assert on main, clean tree (runs `verify-spec-boundary.sh`)
2. **Branch** — create `nightshift/{date}-{spec-slug}` from main
3. **Scout** — fast codebase recon for the spec
4. **Write tests** — TDD: tests written before implementation
5. **Plan** — create an execution plan
6. **Review plan** — 6 reviewers critique in parallel, planner revises (up to 3 cycles)
7. **Implement** — worker executes the plan
8. **Quality gates** — plan tests → changed-package tests → typecheck; worker gets one fix attempt per failure
9. **Review implementation** — 6 reviewers critique the diff, worker addresses feedback (up to 3 cycles)
10. **Changelog** — updates `.pi/HARNESS_CHANGELOG.md` for harness changes, per-package `CHANGELOG.md` for product changes
11. **Commit** — detailed commit message, one commit per spec
12. **Push & PR** — pushes branch, creates a draft PR via `gh pr create --draft`
13. **Return to main** — checkout main, ready for the next spec

If any critical step fails, the spec is marked `blocked`, nightshift returns to main, and moves to the next spec.

## Monitoring

While running:
```
nightshift({ action: "status" })
```

To stop gracefully after the current spec finishes:
```
nightshift({ action: "stop" })
```

## After Nightshift Finishes

- A **formatted summary** shows each spec with its full timeline tree (phases, reviewer verdicts, implementation milestones, durations)
- Each completed spec has its own **branch** and **draft PR** — review and merge independently
- Failed specs have their branch pushed (if possible) for inspection
- **Blocked specs** need human attention: investigate, fix the blocker, set status back to `ready`
- Use `trace({ action: "list" })` to inspect what each agent did — phase events include reviewer verdicts and implementation tasks

## Rules

- **Never launch without ready specs** — check the queue first
- **Always confirm with the user** before starting — nightshift runs autonomously and creates commits
- **Must start on main** — nightshift creates per-spec branches from main
- **One nightshift at a time** — don't launch multiple concurrent sessions

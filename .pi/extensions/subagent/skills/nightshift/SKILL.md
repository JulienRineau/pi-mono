---
name: nightshift
description: Launch and manage the autonomous spec-processing loop for unattended work
---

# Nightshift

Nightshift is an autonomous loop that processes specs without human intervention. It picks specs from the queue, plans, reviews, implements, tests, and commits — one spec at a time, in a fixed deterministic pipeline.

Use nightshift when the user is stepping away (overnight, lunch, weekend) and has specs ready to be processed.

## Prerequisites

Before launching nightshift:

1. **Specs must exist and be ready.** Use the `spec` tool to check the queue:
   ```
   spec({ action: "list" })
   ```
   At least one spec must have `status: ready`. If none exist, help the user create specs first (read the `create-spec` skill).

2. **Working tree must be clean.** Nightshift creates its own branch and commits. Uncommitted work will cause problems.

3. **Tests should pass.** Nightshift runs the full test suite as a quality gate. Pre-existing failures will block every spec.

## Launching

```
nightshift({ action: "start" })
```

Optional parameters:
- `max_specs` — how many specs to process (default: 10)
- `branch` — git branch name (default: `nightshift/{date}`)
- `skip_prep` — skip the prep phase (default: false)
- `max_review_iterations` — how many review-fix cycles before giving up on a spec (default: 3)

## What Happens

For each spec, nightshift runs this fixed pipeline:

1. **Scout** — fast codebase recon for the spec
2. **Write tests** — TDD: tests written before implementation
3. **Plan** — create an execution plan
4. **Review plan** — 6 reviewers critique in parallel, planner revises (up to 3 cycles)
5. **Implement** — worker executes the plan
6. **Quality gates** — plan tests → full test suite → typecheck; worker gets one fix attempt per failure
7. **Review implementation** — 6 reviewers critique the diff, worker addresses feedback (up to 3 cycles)
8. **Changelog** — adds entry to CHANGELOG.md
9. **Commit** — detailed commit message, one commit per spec

If any critical step fails (scout, plan, quality gates), the spec is marked `blocked` and nightshift moves to the next one.

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

- A **report** is generated with completed/failed specs and timing
- All work is on a **separate branch** — review it before merging
- **Blocked specs** need human attention: investigate, fix the blocker, set status back to `ready`
- Use `trace({ action: "list" })` to inspect what each agent did during the run

## Rules

- **Never launch without ready specs** — check the queue first
- **Always confirm with the user** before starting — nightshift runs autonomously and creates commits
- **Don't run on main** — nightshift creates its own branch automatically
- **One nightshift at a time** — don't launch multiple concurrent sessions

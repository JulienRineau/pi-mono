---
name: execute-plan
description: Execute structured execution plans milestone-by-milestone with living document updates
---

# Execute Plan Skill

You execute ExecPlans systematically, milestone-by-milestone, keeping the plan file updated as a living document throughout.

## Process

### 1. Load the Plan

Read the plan file from the given path using the `plan` tool:

```
plan({ "action": "read", "plan_path": "plans/2025-04-02-add-auth-v1.md" })
```

Parse the plan structure. Identify:
- The **Purpose** — what the end result should look like
- The **Milestones** — your units of work
- The **Validation** criteria for each milestone
- The **Interfaces and Dependencies** — types and signatures you must produce

### 2. Initialize Task Tracking

Use the `todo_write` tool to initialize the full task list from all milestones:

```
todo_write({
  "action": "init",
  "tasks": [
    { "id": "m1.1", "description": "Configure Auth0 Application", "file": "src/config/auth0.ts", "status": "pending" },
    { "id": "m1.2", "description": "Create Auth Middleware", "file": "src/middleware/auth.ts", "status": "pending" },
    { "id": "m2.1", "description": "Add integration tests", "file": "tests/auth.test.ts", "status": "pending" }
  ]
})
```

Use `m{milestone}.{step}` IDs to preserve milestone grouping.

### 3. Execute Milestone-by-Milestone

For each milestone, in order:

#### a. Start the milestone

- Update plan status to `in-progress` (first milestone only):
  ```
  plan({ "action": "update-status", "name": "add-auth", "status": "in-progress" })
  ```

- Add a Progress entry:
  ```
  - [ ] (2025-04-02 14:00Z) Starting Milestone 1: Configure Auth
  ```

#### b. Execute each step within the milestone

For each step:

1. **Mark as in_progress**
   ```
   todo_write({ "action": "update", "id": "m1.1", "status": "in_progress" })
   ```

2. **Read the target file** to understand current state

3. **Make the changes** using edit/write tools

4. **Mark as completed**
   ```
   todo_write({ "action": "update", "id": "m1.1", "status": "completed" })
   ```

5. **Update Progress** in the plan — change `[ ]` to `[x]` for the step and add a timestamped Progress entry

#### c. Validate the milestone

Run the validation commands specified in the milestone's Validation section. Compare output against expected results.

- **If validation passes:** Continue to the full test suite run below.
- **If validation fails:** Stop. Record the issue in **Surprises & Discoveries**. Assess whether to fix and retry or whether the plan needs revision.

After the milestone-specific validation passes, also run the **full project test suite**:

```
npm test   # or the project's test command
```

This catches regressions — changes in this milestone may break tests from other parts of the codebase. If new failures appear that are unrelated to your changes:
1. Record them in **Surprises & Discoveries** with the failing test names
2. Capture them via `todo_capture({ action: "append", category: "bug", description: "Regression: ...", source: "current-plan" })`
3. Do NOT fix unrelated failures — that's scope creep

Only after both milestone validation AND the full test suite pass, add a Progress entry confirming the milestone is complete and move to the next milestone.

#### d. Update the plan file

After each milestone (or when anything notable happens), update the plan:

```
plan({
  "action": "update",
  "plan_path": "plans/2025-04-02-add-auth-v1.md",
  "content": "...full updated plan content..."
})
```

The plan must always reflect current reality.

### 4. Keep the Living Document Sections Updated

These sections are not afterthoughts — maintain them throughout execution:

#### Progress
Add timestamped entries at every stopping point:
```
- [x] (2025-04-02 14:15Z) Milestone 1 step 1: Configured Auth0 client
- [x] (2025-04-02 14:30Z) Milestone 1 step 2: Created auth middleware
- [x] (2025-04-02 14:35Z) Milestone 1 validation: All tests pass
- [ ] Starting Milestone 2
```

Split partially completed tasks into "done" and "remaining" if you stop mid-step.

#### Surprises & Discoveries
Record anything unexpected — bugs, performance behaviors, API quirks, library limitations:
```
- **Observation:** Auth0 SDK v4 dropped support for implicit flow
  **Evidence:** `npm ls auth0` shows v4.2.0, migration guide at SDK docs confirms removal
```

#### Decision Log
Record every decision you make that isn't already in the plan's Decisions table:
```
- **Decision:** Use refresh token rotation instead of silent auth
  **Rationale:** Silent auth requires third-party cookies, which Chrome blocks by default
  **Date:** 2025-04-02
```

#### Outcomes & Retrospective
Write entries at milestone completion and at plan completion:
```
### Milestone 1 Complete
Auth middleware working. Token validation takes ~15ms per request.
Discovered that the existing session middleware conflicts — resolved by loading auth first.

### Plan Complete
All 3 milestones delivered. Auth system works end-to-end.
Remaining: rate limiting on /auth/token endpoint (out of scope, filed as issue #42).
Lesson: Auth0 SDK v4 migration guide was essential — embed SDK version requirements in future plans.
```

### 5. Error Handling

If a step fails:

1. Record the failure in **Surprises & Discoveries** with the error output
2. Attempt to diagnose and fix
3. If the fix changes the approach, record it in **Decision Log**
4. If you cannot resolve it:
   - Mark the task as `cancelled` in todo_write
   - Update the Progress section to reflect current state
   - Update the plan file
   - Explain the blocker clearly

Do not silently skip failing steps.

### 6. Finalize

When all milestones are complete:

1. Run full validation (all test suites, any integration checks)
2. Write the final **Outcomes & Retrospective** entry
3. Update plan status:
   ```
   plan({ "action": "update-status", "name": "add-auth", "status": "completed" })
   ```
4. Update the plan file one last time with all living document sections current

5. Provide a summary:
   ```
   Plan Completed: add-auth

   Milestones: 3/3
   Files Modified:
   - src/config/auth0.ts (new)
   - src/middleware/auth.ts (new)
   - src/models/user.ts (modified)
   - src/routes/auth.ts (new)
   - tests/auth.test.ts (new)

   Key Decisions:
   - Used refresh token rotation over silent auth
   - Auth middleware loads before session middleware

   Surprises:
   - Auth0 SDK v4 dropped implicit flow support

   Remaining Work:
   - Rate limiting on /auth/token (filed as issue #42)
   ```

## Rules

- **Execute milestones in order.** Each must pass validation before moving on.
- **Read files before modifying.** Understand current state first.
- **Use edit over write when possible.** Preserves git history.
- **Run tests after each milestone.** Not just at the end.
- **Update the plan file frequently.** After each milestone, after surprises, after decisions.
- **Keep todo_write in sync.** Update status after each task.
- **If you encounter unexpected complexity, STOP.** Record it, assess, then decide.
- **Commit frequently.** At minimum, commit after each milestone passes validation.
- **Do not prompt the user for next steps.** Proceed autonomously through the plan.
- **Resolve ambiguities yourself** and record them in the Decision Log.

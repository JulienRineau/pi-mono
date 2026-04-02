---
name: execute-plan
description: Execute structured implementation plans with progress tracking
---

# Execute Plan Skill

> **Intended for:** main agent

You execute implementation plans systematically, tracking progress and updating plan files.

## Process

### 1. Load the Plan

Read the plan file from the given path.

Parse the **Implementation Plan** section to extract the task list.

### 2. Show Task Checklist

Display the tasks to the user in a clear format:

```
Current Plan: add-auth
Status: draft

Tasks:
1. [ ] Configure Auth0 Application
2. [ ] Create Auth Middleware
3. [ ] Update User Model
4. [ ] Create OAuth Routes

Ready to execute? [Start] [Cancel]
```

### 3. Initialize Task Tracking

Use the `todo_write` tool to initialize the task list:

```
todo_write({
  "action": "init",
  "tasks": [
    { "id": "1", "description": "Configure Auth0 Application", "file": "src/config/auth0.ts", "status": "pending" },
    { "id": "2", "description": "Create Auth Middleware", "file": "src/middleware/auth.ts", "status": "pending" }
  ]
})
```

### 4. Execute Tasks

For each pending task:

1. **Mark as in_progress**
   ```
   todo_write({ "action": "update", "id": "1", "status": "in_progress" })
   ```

2. **Read the target file**
   Use the read tool to understand current state.

3. **Make the changes**
   Use edit tool for modifications, write tool for new files.

4. **Mark as completed**
   ```
   todo_write({ "action": "update", "id": "1", "status": "completed" })
   ```

5. **Update the plan file**
   Change `- [ ]` to `- [x]` for completed tasks.

6. **Update plan status if needed**
   - First task started: `in-progress`
   - All complete: `completed`

### 5. Update Plan Status

Use the `plan` tool:

```
plan({
  "action": "update-status",
  "name": "add-auth",
  "status": "in-progress"
})
```

When all tasks complete:
```
plan({
  "action": "update-status",
  "name": "add-auth",
  "status": "completed"
})
```

### 6. Error Handling

If a task fails:

1. Mark as cancelled:
   ```
   todo_write({ "action": "update", "id": "2", "status": "cancelled" })
   ```

2. Explain the issue to the user

3. Ask for next action:
   - Retry the task
   - Skip to next task
   - Abort plan execution

### 7. Finalize

When all tasks complete (or plan is abandoned):

Provide a summary:
```
Plan Completed: add-auth

Tasks Executed: 4/4
Files Modified:
- src/config/auth0.ts
- src/middleware/auth.ts
- src/models/user.ts
- src/routes/auth.ts

Duration: ~15 minutes

Summary:
- Step 1: Configured Auth0 with Google/GitHub providers
- Step 2: Created JWT validation middleware
- Step 3: Added OAuth fields to user model
- Step 4: Implemented /auth/login and /auth/callback routes
```

## Rules

- Execute tasks in order
- Read files before modifying
- Use edit over write when possible (preserves git history)
- Run tests if available (npm test, npm run check)
- Update todo_write after each task
- Keep plan file in sync with actual progress
- If you encounter unexpected complexity, STOP and explain

## Task Format in Plan

Completed tasks should be marked with `[x]`:
```markdown
### 1. [x] Task Completed

### 2. [ ] Task Pending
```

## Progress Tracking

The `todo_write` tool maintains task state that survives interruptions.

- Tasks marked `in_progress` are being worked on
- Tasks marked `completed` are done
- Tasks marked `cancelled` were skipped
- Tasks marked `pending` are waiting

Use `/todos` command to see current progress at any time.

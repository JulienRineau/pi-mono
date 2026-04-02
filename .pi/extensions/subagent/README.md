# Subagent Example

Delegate tasks to specialized subagents with isolated context windows.

## Features

- **Isolated context**: Each subagent runs in a separate `pi` process
- **Streaming output**: See tool calls and progress as they happen
- **Parallel streaming**: All parallel tasks stream updates simultaneously
- **Markdown rendering**: Final output rendered with proper formatting (expanded view)
- **Usage tracking**: Shows turns, tokens, cost, and context usage per agent
- **Abort support**: Ctrl+C propagates to kill subagent processes
- **Plan files**: Save plans to `plans/` directory with versioning
- **Task tracking**: Track task progress with `todo_write` tool

## Structure

```
subagent/
├── README.md             # This file
├── index.ts              # The extension (entry point)
├── agents.ts             # Agent discovery logic
├── agents/               # Sample agent definitions
│   ├── scout.md         # Fast recon, returns compressed context
│   ├── planner.md       # Creates implementation plans
│   ├── reviewer.md       # Code review
│   └── worker.md        # General-purpose (full capabilities)
├── tools/               # Additional tools
│   ├── plan-tool.ts     # Create, read, update plan files
│   └── todo-write-tool.ts # Track task progress
├── skills/              # Agent guidance skills
│   ├── create-plan/     # Guide plan creation
│   └── execute-plan/    # Guide plan execution
├── scripts/             # Helper scripts
│   └── validate-plan.sh # Validate plan format
└── prompts/             # Workflow presets (prompt templates)
    ├── implement.md     # scout -> planner -> worker
    ├── scout-and-plan.md    # scout -> planner (no implementation)
    └── implement-and-review.md  # worker -> reviewer -> worker
```

## Installation

From the repository root, symlink the files:

```bash
# Symlink the extension (must be in a subdirectory with index.ts)
mkdir -p ~/.pi/agent/extensions/subagent
ln -sf "$(pwd)/packages/coding-agent/examples/extensions/subagent/index.ts" ~/.pi/agent/extensions/subagent/
ln -sf "$(pwd)/packages/coding-agent/examples/extensions/subagent/agents.ts" ~/.pi/agent/extensions/subagent/

# Symlink agents
mkdir -p ~/.pi/agent/agents
for f in packages/coding-agent/examples/extensions/subagent/agents/*.md; do
  ln -sf "$(pwd)/$f" ~/.pi/agent/agents/$(basename "$f")
done

# Symlink skills
mkdir -p ~/.pi/agent/skills
ln -sf "$(pwd)/packages/coding-agent/examples/extensions/subagent/skills/*" ~/.pi/agent/skills/

# Symlink validation script
mkdir -p ~/.pi/agent/scripts
ln -sf "$(pwd)/packages/coding-agent/examples/extensions/subagent/scripts/validate-plan.sh ~/.pi/agent/scripts/

# Create plans directory
mkdir -p plans/
```

## Security Model

This tool executes a separate `pi` subprocess with a delegated system prompt and tool/model configuration.

**Project-local agents** (`.pi/agents/*.md`) are repo-controlled prompts that can instruct the model to read files, run bash commands, etc.

**Default behavior:** Only loads **user-level agents** from `~/.pi/agent/agents`.

To enable project-local agents, pass `agentScope: "both"` (or `"project"`). Only do this for repositories you trust.

When running interactively, the tool prompts for confirmation before running project-local agents. Set `confirmProjectAgents: false` to disable.

## Usage

### Single agent
```
Use scout to find all authentication code
```

### Parallel execution
```
Run 2 scouts in parallel: one to find models, one to find providers
```

### Chained workflow
```
Use a chain: first have scout find the read tool, then have planner suggest improvements
```

### Workflow prompts
```
/implement add Redis caching to the session store
/scout-and-plan refactor auth to support OAuth
/implement-and-review add input validation to API endpoints
```

### Plan Management
```
Use plan tool to save plans to files:
plan({ action: "save", plan_name: "add-auth", content: "...", version: 1 })

Use todo_write to track tasks:
todo_write({ action: "init", tasks: [...] })
todo_write({ action: "update", id: "1", status: "completed" })
```

## Tools

### subagent Tool

The main tool for spawning subagent processes.

| Parameter | Description |
|-----------|-------------|
| `agent` | Single agent name |
| `task` | Task description |
| `tasks` | Array for parallel execution |
| `chain` | Array for sequential execution |

### plan Tool

Create and manage plan files.

```typescript
// Save a plan
plan({ action: "save", plan_name: "add-auth", content: "# Plan...", version: 1 })

// Read a plan
plan({ action: "read", plan_path: "plans/2025-03-30-add-auth-v1.md" })

// Update status
plan({ action: "update-status", name: "add-auth", status: "completed" })

// List all plans
plan({ action: "list" })
```

**File format:** `plans/{YYYY-MM-DD}-{task-name}-v{version}.md`

**Features:**
- Auto-increments version if file exists
- Status tracking: draft, approved, in-progress, completed, abandoned

### todo_write Tool

Track task progress for plan execution.

```typescript
// Initialize tasks
todo_write({ action: "init", tasks: [
  { id: "1", description: "Configure Auth0", file: "src/config/auth0.ts", status: "pending" },
  { id: "2", description: "Create middleware", file: "src/middleware/auth.ts", status: "pending" }
]})

// Update a task
todo_write({ action: "update", id: "1", status: "in_progress" })
todo_write({ action: "update", id: "1", status: "completed" })

// Get current state
todo_write({ action: "get" })

// Clear all
todo_write({ action: "clear" })
```

**Status values:** `pending`, `in_progress`, `completed`, `cancelled`

**Display:**
```
☐ 1: Configure Auth0 (src/config/auth0.ts)
~ 2: Create middleware (src/middleware/auth.ts)
☑ 3: Update user model

Progress: 1/3 completed
1 in progress
```

## Agent Definitions

Agents are markdown files with YAML frontmatter:

```markdown
---
name: my-agent
description: What this agent does
tools: read, grep, find, ls
model: claude-haiku-4-5
---

System prompt for the agent goes here.
```

**Locations:**
- `~/.pi/agent/agents/*.md` - User-level (always loaded)
- `.pi/agents/*.md` - Project-level (only with `agentScope: "project"` or `"both"`)

Project agents override user agents with the same name when `agentScope: "both"`.

## Sample Agents

| Agent | Purpose | Model | Tools |
|-------|---------|-------|-------|
| `scout` | Fast codebase recon | Haiku | read, grep, find, ls, bash |
| `planner` | Implementation plans | Sonnet | read, grep, find, ls |
| `reviewer` | Code review | Sonnet | read, grep, find, ls, bash |
| `worker` | General-purpose | Sonnet | (all default) |

## Plan Format

Plans should use this format:

```markdown
# Plan: Add Authentication

**Created:** 2025-03-30
**Version:** v1
**Status:** draft

---

## Task
Add OAuth authentication to the API

## Requirements

| ID | Priority | Description |
|----|----------|-------------|
| 1 | high | OAuth social login |
| 2 | medium | Session management |

## Implementation Plan

### 1. [ ] Configure Auth0 Application

**Description:** Set up OAuth provider
**File:** `src/config/auth0.ts`
**Changes:** Add OAuth configuration

### 2. [ ] Create Auth Middleware

**Description:** JWT validation
**File:** `src/middleware/auth.ts`
**Changes:** Add JWT verification

## Risks
- OAuth callback configuration complexity

## Next Steps
- [ ] Step 1
- [ ] Step 2
```

## Validation

Use `validate-plan.sh` to check plan format:

```bash
./scripts/validate-plan.sh "plan content"
```

Checks:
- Required sections (Task, Analysis, Implementation Plan)
- Checkbox format: `- [ ]` or `- [x]`
- Step fields: Description, File, Changes
- Requirement priorities

## Workflow Prompts

| Prompt | Flow |
|--------|------|
| `/implement <query>` | scout → planner → worker |
| `/scout-and-plan <query>` | scout → planner |
| `/implement-and-review <query>` | worker → reviewer → worker |

## Error Handling

- **Exit code != 0**: Tool returns error with stderr/output
- **stopReason "error"**: LLM error propagated with error message
- **stopReason "aborted"**: User abort (Ctrl+C) kills subprocess, throws error
- **Chain mode**: Stops at first failing step, reports which step failed

## Limitations

- Output truncated to last 10 items in collapsed view (expand to see all)
- Agents discovered fresh on each invocation (allows editing mid-session)
- Parallel mode limited to 8 tasks, 4 concurrent

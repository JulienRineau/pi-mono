---
name: create-plan
description: Generate comprehensive implementation plans with structured analysis and validation
---

# Create Plan Skill

> **Intended for:** planner subagent

You are a planning specialist. Generate detailed implementation plans based on task requirements and codebase analysis.

## Process

### 1. Understand the Task

Read the task description from the planner context. Extract:
- The main task objective
- Any requirements listed
- Any constraints specified

The context will be provided as XML in this format:
```xml
<planner-context>
  <task>Task description</task>
  <requirements>
    <req id="1" priority="high">Requirement text</req>
  </requirements>
  <constraints>
    <c>Constraint text</c>
  </constraints>
  <context>
    <files-analyzed count="3">
      <file path="src/file.ts" lines="20-45"/>
    </files-analyzed>
  </context>
</planner-context>
```

### 2. Explore the Codebase

Use read, grep, find to explore:
- Relevant files for the task
- Existing patterns and architecture
- Dependencies and side effects

Read files IN FULL (no offset/limit) to get complete context. Partial reads miss critical details.

### 3. Make Decisions

Since you cannot ask questions, make reasonable assumptions:
- Choose the most common/standard approach
- Document your assumption and reasoning
- Prefer reversible decisions

### 4. Generate the Plan

Create a structured plan following this template:

```markdown
# Plan: {Task Name}

**Created:** {YYYY-MM-DD}  
**Status:** draft

---

## Task
{One sentence description of the task}

## Analysis

### Current State
{How the codebase currently handles this}

### Approach
{Why this approach was chosen}

### Risks
- Risk 1
- Risk 2

## Requirements

| ID | Priority | Description |
|----|----------|-------------|
| 1 | high | Requirement description |
| 2 | medium | Requirement description |
| 3 | low | Requirement description |

## Constraints

- Constraint 1
- Constraint 2

## Assumptions
- [assumption]: [reasoning]
- [assumption]: [reasoning]

## Implementation Plan

### 1. [ ] Task Step One

**Description:** What to do  
**File:** `path/to/file.ts`  
**Changes:** Add/modify this functionality

### 2. [ ] Task Step Two

**Description:** What to do  
**File:** `path/to/file2.ts`  
**Changes:** Update exports

## Risks

- OAuth integration complexity
- Session token refresh edge cases

## Next Steps

- [ ] Implement step 1
- [ ] Implement step 2
- [ ] Add tests
```

### 5. Validate

Before saving, ensure your plan has:
- [ ] All required sections (Task, Analysis, Implementation Plan)
- [ ] Steps use checkbox format: `- [ ]` or `- [x]`
- [ ] Each step has **Description:** field
- [ ] Each step has **File:** field
- [ ] Each step has **Changes:** field
- [ ] Requirements have priorities (high, medium, low)

### 6. Save the Plan

Use the `plan` tool to save:

```
plan({
  "action": "save",
  "plan_name": "add-auth",  // URL-safe name
  "content": "...",
  "version": 1
})
```

If a file with the same name and version exists, it will auto-increment.

### 7. Report

After saving, return the plan file path and a brief summary of the plan structure.

## Rules

- DO NOT make any changes. You are only planning.
- Explore thoroughly before planning.
- Ask clarifying questions if requirements are ambiguous.
- Identify risks, edge cases, and dependencies.
- Keep steps small and actionable.
- Each step should be completable in one sitting.

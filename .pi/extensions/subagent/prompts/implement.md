---
description: Full implementation workflow - scout gathers context, planner creates plan, worker implements
---
Before invoking the chain, write a **task brief** that captures everything the planner needs to know. The planner has NO access to this conversation — anything not in the brief is lost.

The brief must include:
- **Why this work matters** from the user's perspective
- **What someone can do after** this change that they cannot do before
- **How to see it working** (commands to run, expected output, observable behavior)
- **Key decisions already made** in this conversation
- **Constraints or requirements** the user specified
- **Any context about the broader goal** that shapes implementation choices

Format the brief as a clear document, then pass it as the task to the chain.

Use the subagent tool with the chain parameter:

1. First, use the "scout" agent to find all code relevant to: $@
2. Then, use the "planner" agent to create an execution plan using both the task brief AND the code context from the previous step (use {previous} placeholder). Include the full task brief in the planner's task description — do not rely on {previous} alone for the task context.
3. Finally, use the "worker" agent to implement the plan from the previous step (use {previous} placeholder)

Execute this as a chain, passing output between steps via {previous}.

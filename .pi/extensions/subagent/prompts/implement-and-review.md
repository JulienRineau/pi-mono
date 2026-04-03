---
description: Worker implements, reviewer reviews, worker applies feedback
---
Before invoking the chain, write a **task brief** that captures everything the worker needs to know. The worker has NO access to this conversation — anything not in the brief is lost.

The brief must include:
- **Why this work matters** from the user's perspective
- **What someone can do after** this change that they cannot do before
- **How to see it working** (commands to run, expected output, observable behavior)
- **Key decisions already made** in this conversation
- **Constraints or requirements** the user specified

Use the subagent tool with the chain parameter:

1. First, use the "worker" agent to implement the task brief: $@
2. Then, use the "reviewer" agent to review the implementation from the previous step (use {previous} placeholder)
3. Finally, use the "worker" agent to apply the feedback from the review (use {previous} placeholder)

Execute this as a chain, passing output between steps via {previous}.

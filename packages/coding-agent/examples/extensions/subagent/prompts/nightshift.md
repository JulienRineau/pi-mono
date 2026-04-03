---
description: Start autonomous night shift — processes all ready specs without human intervention
---

Use the nightshift tool to start processing the spec queue autonomously.

```
nightshift({ "action": "start" })
```

The nightshift will:
1. Prep the working tree (stash changes, run tests)
2. Create a branch for the session
3. Loop through all ready specs: scout → plan → review → implement → review → commit
4. Generate a final report when done

Optional parameters:
- `max_specs`: number of specs to process (default 10)
- `branch`: git branch name (default nightshift/{date})
- `skip_prep`: skip the prep phase (default false)
- `max_review_iterations`: max review loop cycles (default 3)

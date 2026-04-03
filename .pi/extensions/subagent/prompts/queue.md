---
description: Show current spec queue and nightshift status
---

Show the current state of the night shift system:

1. List all specs: `spec({ "action": "list" })`
2. List all plans: `plan({ "action": "list" })`
3. Check for nightshift state: read `nightshift-state.json` if it exists

Display specs grouped by status (ready, in-progress, done, draft), sorted by priority within each group. Show counts and any active nightshift session.

#!/bin/bash
# verify-spec-boundary.sh - Assert clean state before starting a new spec
#
# Called at the top of each nightshift loop iteration.
# Ensures the working tree is on main, clean, and ready for a new branch.
#
# Exit codes:
#   0 - Ready for next spec
#   1 - State is wrong (not on main, dirty tree, etc.)

set -e

BRANCH=$(git branch --show-current 2>/dev/null || echo "unknown")

if [ "$BRANCH" != "main" ] && [ "$BRANCH" != "master" ]; then
    echo "ERROR: expected main branch, got '$BRANCH'"
    exit 1
fi

if ! git diff --quiet 2>/dev/null; then
    echo "ERROR: uncommitted changes in working tree"
    exit 1
fi

if ! git diff --cached --quiet 2>/dev/null; then
    echo "ERROR: staged changes present"
    exit 1
fi

echo "VERIFY_OK"

#!/bin/bash
# prep.sh - Prepare the working tree for a nightshift session
#
# Checks: clean working tree, runs test suite, reports state
#
# Exit codes:
#   0 - Ready to work (clean tree, tests pass)
#   1 - Not ready (dirty tree that can't be stashed, or tests fail)

set -e

ERRORS=0

error() {
    echo "ERROR: $1" >&2
    ERRORS=$((ERRORS + 1))
}

info() {
    echo "INFO: $1" >&2
}

# --- Working Tree ---

BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")
COMMIT=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")
info "Branch: $BRANCH"
info "Commit: $COMMIT"

if [ "$BRANCH" = "main" ] || [ "$BRANCH" = "master" ]; then
    echo "WARNING: On $BRANCH branch. Consider creating a feature branch." >&2
fi

# Report working tree state (but don't stash — nightshift needs uncommitted
# config, extensions, and specs to function. It creates its own branch for commits.)
DIRTY=$(git status --porcelain 2>/dev/null)
if [ -n "$DIRTY" ]; then
    DIRTY_COUNT=$(echo "$DIRTY" | wc -l | tr -d ' ')
    info "Working tree has $DIRTY_COUNT uncommitted change(s) (kept for nightshift)"
else
    info "Working tree is clean"
fi

# --- Test Suite ---

# Detect test command
TEST_CMD=""

if [ -n "$PI_TEST_CMD" ]; then
    TEST_CMD="$PI_TEST_CMD"
    info "Test command (from PI_TEST_CMD): $TEST_CMD"
elif [ -f "package.json" ]; then
    # Check for test script in package.json
    HAS_TEST=$(node -e "try{const p=require('./package.json');if(p.scripts&&p.scripts.test&&p.scripts.test!=='echo \"Error: no test specified\" && exit 1')process.stdout.write(p.scripts.test)}catch{}" 2>/dev/null || true)
    if [ -n "$HAS_TEST" ]; then
        TEST_CMD="npm test"
        info "Test command (from package.json): $TEST_CMD"
    fi
elif [ -f "Makefile" ] && grep -q '^test:' Makefile 2>/dev/null; then
    TEST_CMD="make test"
    info "Test command (from Makefile): $TEST_CMD"
fi

if [ -z "$TEST_CMD" ]; then
    echo "WARNING: No test command found. Set PI_TEST_CMD or add scripts.test to package.json." >&2
    echo "TESTS=skipped"
else
    # PI_PREP_TEST_MODE: "strict" = fail on test errors (default), "warn" = report but continue
    PREP_TEST_MODE="${PI_PREP_TEST_MODE:-warn}"
    info "Running tests (mode: $PREP_TEST_MODE)..."
    if eval "$TEST_CMD" 2>&1; then
        info "Tests passed"
        echo "TESTS=passed"
    else
        if [ "$PREP_TEST_MODE" = "strict" ]; then
            error "Tests failed"
            echo "TESTS=failed"
        else
            echo "WARNING: Tests failed (non-blocking in warn mode). Set PI_PREP_TEST_MODE=strict to enforce." >&2
            echo "TESTS=warned"
        fi
    fi
fi

# --- Summary ---

echo ""
if [ $ERRORS -eq 0 ]; then
    echo "PREP_READY"
    exit 0
else
    echo "PREP_FAILED: $ERRORS error(s)"
    exit 1
fi

#!/bin/bash
# validate-plan.sh - Validates plan structure and format
#
# Usage:
#   ./validate-plan.sh "plan content"
#   cat plan.md | ./validate-plan.sh -
#
# Exit codes:
#   0 - Validation passed
#   1 - Validation failed (errors printed to stderr)

set -e

ERRORS=0

# Read plan content from argument or stdin
if [ "$1" = "-" ]; then
    PLAN_CONTENT=$(cat)
elif [ -n "$1" ]; then
    PLAN_CONTENT="$1"
else
    echo "Usage: validate-plan.sh \"plan content\" or cat plan.md | validate-plan.sh -" >&2
    exit 1
fi

# Helper functions
error() {
    echo "ERROR: $1" >&2
    ERRORS=$((ERRORS + 1))
}

warn() {
    echo "WARNING: $1" >&2
}

# Check for required sections
check_section() {
    local section="$1"
    if ! echo "$PLAN_CONTENT" | grep -q "^## $section"; then
        error "Missing section: ## $section"
    fi
}

# Check for required sections
check_section "Task"
check_section "Implementation Plan"

# Check for checkbox format
if ! echo "$PLAN_CONTENT" | grep -qE '^\- \[ \]|\- \[x\]'; then
    error "Plan steps must use checkbox format: - [ ] or - [x]"
fi

# Check step structure
STEP_COUNT=$(echo "$PLAN_CONTENT" | grep -cE '^\- \[ \]|\- \[x\]' || true)
DESC_COUNT=$(echo "$PLAN_CONTENT" | grep -c '^\*\*Description:\*\*' || true)
FILE_COUNT=$(echo "$PLAN_CONTENT" | grep -c '^\*\*File:\*\*' || true)

if [ "$STEP_COUNT" -gt 0 ]; then
    if [ "$STEP_COUNT" -ne "$DESC_COUNT" ]; then
        error "Each step must have **Description:** field (found $DESC_COUNT, expected $STEP_COUNT)"
    fi
    
    if [ "$STEP_COUNT" -ne "$FILE_COUNT" ]; then
        error "Each step must have **File:** field (found $FILE_COUNT, expected $STEP_COUNT)"
    fi
fi

# Check requirements have priorities
if echo "$PLAN_CONTENT" | grep -q '## Requirements'; then
    # Extract requirements section
    REQ_SECTION=$(echo "$PLAN_CONTENT" | sed -n '/## Requirements/,/## [^#]/p' | head -n -1)
    if [ -n "$REQ_SECTION" ]; then
        if ! echo "$REQ_SECTION" | grep -qE 'high|medium|low'; then
            warn "Requirements section found but no priorities specified (expected: high, medium, low)"
        fi
    fi
fi

# Check metadata header
if ! echo "$PLAN_CONTENT" | grep -q '^\*\*Created:\*\*'; then
    warn "Missing **Created:** metadata"
fi

if ! echo "$PLAN_CONTENT" | grep -q '^\*\*Status:\*\*'; then
    warn "Missing **Status:** metadata"
fi

# Summary
echo ""
if [ $ERRORS -eq 0 ]; then
    echo "VALIDATION_PASSED"
    exit 0
else
    echo "VALIDATION_FAILED: $ERRORS error(s)"
    exit 1
fi

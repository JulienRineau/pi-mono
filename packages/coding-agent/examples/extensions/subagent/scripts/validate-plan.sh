#!/bin/bash
# validate-plan.sh - Validates ExecPlan structure and format
#
# Usage:
#   ./validate-plan.sh plan.md
#   cat plan.md | ./validate-plan.sh -
#
# Exit codes:
#   0 - Validation passed
#   1 - Validation failed (errors printed to stderr)

set -e

ERRORS=0
WARNINGS=0

# Read plan content from file or stdin
if [ "$1" = "-" ]; then
    PLAN_CONTENT=$(cat)
elif [ -n "$1" ] && [ -f "$1" ]; then
    PLAN_CONTENT=$(cat "$1")
elif [ -n "$1" ]; then
    PLAN_CONTENT="$1"
else
    echo "Usage: validate-plan.sh plan.md | validate-plan.sh -" >&2
    exit 1
fi

# --- Helpers ---

error() {
    echo "ERROR: $1" >&2
    ERRORS=$((ERRORS + 1))
}

warn() {
    echo "WARNING: $1" >&2
    WARNINGS=$((WARNINGS + 1))
}

check_section() {
    local section="$1"
    local required="$2"
    if ! echo "$PLAN_CONTENT" | grep -q "^## $section"; then
        if [ "$required" = "required" ]; then
            error "Missing required section: ## $section"
        else
            warn "Missing section: ## $section"
        fi
    fi
}

# --- Metadata ---

if ! echo "$PLAN_CONTENT" | grep -q '^\*\*Created:\*\*'; then
    error "Missing **Created:** metadata"
fi

if ! echo "$PLAN_CONTENT" | grep -q '^\*\*Status:\*\*'; then
    error "Missing **Status:** metadata"
fi

if ! echo "$PLAN_CONTENT" | grep -q '^\*\*Version:\*\*'; then
    warn "Missing **Version:** metadata"
fi

# --- Required sections ---

check_section "Purpose" required
check_section "Context and Orientation" required
check_section "Requirements" required
check_section "Milestones" required
check_section "Risks" required
check_section "Progress" required
check_section "Surprises & Discoveries" required
check_section "Decision Log" required
check_section "Outcomes & Retrospective" required

# --- Recommended sections ---

check_section "Constraints" optional
check_section "Decisions" optional
check_section "Interfaces and Dependencies" optional
check_section "Idempotence and Recovery" optional

# --- Milestones structure ---

MILESTONE_COUNT=$(echo "$PLAN_CONTENT" | grep -c '^### Milestone [0-9]' || true)
if [ "$MILESTONE_COUNT" -lt 1 ]; then
    error "Plan must have at least one milestone (### Milestone N: Title)"
fi

# Check each milestone has a Validation subsection
VALIDATION_COUNT=$(echo "$PLAN_CONTENT" | grep -c '^#### Validation' || true)
if [ "$MILESTONE_COUNT" -gt 0 ] && [ "$VALIDATION_COUNT" -lt "$MILESTONE_COUNT" ]; then
    error "Each milestone must have a #### Validation section (found $VALIDATION_COUNT, expected $MILESTONE_COUNT)"
fi

# --- Checkbox format ---

CHECKBOX_COUNT=$(echo "$PLAN_CONTENT" | grep -cE '^\s*[0-9]+\.\s*\[ \]|^\s*[0-9]+\.\s*\[x\]|^\s*- \[ \]|^\s*- \[x\]' || true)
if [ "$CHECKBOX_COUNT" -eq 0 ]; then
    error "Plan must contain checkbox steps (- [ ] or 1. [ ] format)"
fi

# --- Implementation steps structure ---

# Check that steps have File: and Changes: fields
STEP_FILE_COUNT=$(echo "$PLAN_CONTENT" | grep -c '^\s*- \*\*File:\*\*' || true)
STEP_CHANGES_COUNT=$(echo "$PLAN_CONTENT" | grep -c '^\s*- \*\*Changes:\*\*' || true)

if [ "$STEP_FILE_COUNT" -eq 0 ]; then
    error "Implementation steps must have **File:** fields"
fi

if [ "$STEP_CHANGES_COUNT" -eq 0 ]; then
    error "Implementation steps must have **Changes:** fields"
fi

# --- Requirements table ---

if echo "$PLAN_CONTENT" | grep -q '## Requirements'; then
    REQ_SECTION=$(echo "$PLAN_CONTENT" | sed -n '/^## Requirements/,/^## /p' | sed '$d')
    if [ -n "$REQ_SECTION" ]; then
        if ! echo "$REQ_SECTION" | grep -qE 'high|medium|low'; then
            warn "Requirements table has no priorities (expected: high, medium, low)"
        fi
        if ! echo "$REQ_SECTION" | grep -q '|'; then
            warn "Requirements should be in table format (| ID | Priority | Description |)"
        fi
    fi
fi

# --- Content quality ---

# Check Purpose section is not empty
PURPOSE_CONTENT=$(echo "$PLAN_CONTENT" | sed -n '/^## Purpose/,/^## /p' | sed '$d' | tail -n +2 | sed '/^$/d')
if [ -z "$PURPOSE_CONTENT" ]; then
    error "Purpose section is empty"
fi

# Check Context section is not empty
CONTEXT_CONTENT=$(echo "$PLAN_CONTENT" | sed -n '/^## Context and Orientation/,/^## /p' | sed '$d' | tail -n +2 | sed '/^$/d')
if [ -z "$CONTEXT_CONTENT" ]; then
    error "Context and Orientation section is empty"
fi

# Check that file paths look like repo-relative paths (contain /)
if [ "$STEP_FILE_COUNT" -gt 0 ]; then
    PATHS_WITH_SLASH=$(echo "$PLAN_CONTENT" | grep '^\s*- \*\*File:\*\*' | grep -c '/' || true)
    if [ "$PATHS_WITH_SLASH" -eq 0 ]; then
        warn "File paths should be full repo-relative paths (e.g., src/middleware/auth.ts)"
    fi
fi

# --- Summary ---

echo ""
if [ $ERRORS -eq 0 ]; then
    if [ $WARNINGS -gt 0 ]; then
        echo "VALIDATION_PASSED ($WARNINGS warning(s))"
    else
        echo "VALIDATION_PASSED"
    fi
    exit 0
else
    echo "VALIDATION_FAILED: $ERRORS error(s), $WARNINGS warning(s)"
    exit 1
fi

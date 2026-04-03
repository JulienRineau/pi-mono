#!/bin/bash
# validate-review.sh - Validates review structure and format
#
# Usage:
#   ./validate-review.sh review.md
#   cat review.md | ./validate-review.sh -
#
# Exit codes:
#   0 - Validation passed
#   1 - Validation failed (errors printed to stderr)

set -e

ERRORS=0
WARNINGS=0

# Read review content from file or stdin
if [ "$1" = "-" ]; then
    REVIEW_CONTENT=$(cat)
elif [ -n "$1" ] && [ -f "$1" ]; then
    REVIEW_CONTENT=$(cat "$1")
elif [ -n "$1" ]; then
    REVIEW_CONTENT="$1"
else
    echo "Usage: validate-review.sh review.md | validate-review.sh -" >&2
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

# --- YAML Frontmatter ---

# Check frontmatter fences exist
FIRST_LINE=$(echo "$REVIEW_CONTENT" | head -n 1)
if [ "$FIRST_LINE" != "---" ]; then
    error "Missing opening YAML frontmatter fence (---)"
fi

# Find closing fence (second occurrence of ---)
CLOSING_FENCE_LINE=$(echo "$REVIEW_CONTENT" | tail -n +2 | grep -n '^---$' | head -n 1 | cut -d: -f1)
if [ -z "$CLOSING_FENCE_LINE" ]; then
    error "Missing closing YAML frontmatter fence (---)"
fi

# Extract frontmatter content between fences
if [ -n "$CLOSING_FENCE_LINE" ]; then
    FRONTMATTER=$(echo "$REVIEW_CONTENT" | head -n $((CLOSING_FENCE_LINE + 1)) | tail -n +2 | head -n $((CLOSING_FENCE_LINE - 1)))
else
    FRONTMATTER=""
fi

# --- Required Frontmatter Fields ---

check_frontmatter_field() {
    local field="$1"
    if ! echo "$FRONTMATTER" | grep -q "^${field}:"; then
        error "Missing required frontmatter field: ${field}"
    fi
}

check_frontmatter_field "reviewer"
check_frontmatter_field "verdict"
check_frontmatter_field "target"
check_frontmatter_field "scope"
check_frontmatter_field "reviewed-at"

# --- Verdict Validation ---

VERDICT=$(echo "$FRONTMATTER" | grep '^verdict:' | sed 's/^verdict:[[:space:]]*//')
if [ -n "$VERDICT" ]; then
    case "$VERDICT" in
        pass|fail|conditional)
            ;;
        *)
            error "Invalid verdict: '${VERDICT}' (must be: pass, fail, or conditional)"
            ;;
    esac
fi

# --- Scope Validation ---

SCOPE=$(echo "$FRONTMATTER" | grep '^scope:' | sed 's/^scope:[[:space:]]*//')
if [ -n "$SCOPE" ]; then
    case "$SCOPE" in
        plan|implementation)
            ;;
        *)
            error "Invalid scope: '${SCOPE}' (must be: plan or implementation)"
            ;;
    esac
fi

# --- Conditional Section Requirements ---

# Get content after frontmatter
if [ -n "$CLOSING_FENCE_LINE" ]; then
    BODY_CONTENT=$(echo "$REVIEW_CONTENT" | tail -n +$((CLOSING_FENCE_LINE + 2)))
else
    BODY_CONTENT="$REVIEW_CONTENT"
fi

# If verdict=fail, ## Critical section must exist and be non-empty
if [ "$VERDICT" = "fail" ]; then
    if ! echo "$BODY_CONTENT" | grep -q '^## Critical'; then
        error "verdict=fail requires a ## Critical section"
    else
        CRITICAL_CONTENT=$(echo "$BODY_CONTENT" | sed -n '/^## Critical/,/^## /p' | sed '1d;$d' | sed '/^$/d')
        if [ -z "$CRITICAL_CONTENT" ]; then
            error "## Critical section is empty (required for verdict=fail)"
        fi
    fi
fi

# If verdict=conditional, ## Warnings section must exist and be non-empty
if [ "$VERDICT" = "conditional" ]; then
    if ! echo "$BODY_CONTENT" | grep -q '^## Warnings'; then
        error "verdict=conditional requires a ## Warnings section"
    else
        WARNINGS_CONTENT=$(echo "$BODY_CONTENT" | sed -n '/^## Warnings/,/^## /p' | sed '1d;$d' | sed '/^$/d')
        if [ -z "$WARNINGS_CONTENT" ]; then
            error "## Warnings section is empty (required for verdict=conditional)"
        fi
    fi
fi

# --- Summary Section ---

if ! echo "$BODY_CONTENT" | grep -q '^## Summary'; then
    error "Missing required section: ## Summary"
else
    SUMMARY_CONTENT=$(echo "$BODY_CONTENT" | sed -n '/^## Summary/,/^## /p' | sed '1d;$d' | sed '/^$/d')
    if [ -z "$SUMMARY_CONTENT" ]; then
        error "## Summary section is empty"
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

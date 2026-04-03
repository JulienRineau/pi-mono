#!/bin/bash
# validate-report.sh - Validates nightshift session report structure and format
#
# Usage:
#   ./validate-report.sh report.md
#   cat report.md | ./validate-report.sh -
#
# Exit codes:
#   0 - Validation passed
#   1 - Validation failed (errors printed to stderr)

set -e

ERRORS=0
WARNINGS=0

# Read report content from file or stdin
if [ "$1" = "-" ]; then
    REPORT_CONTENT=$(cat)
elif [ -n "$1" ] && [ -f "$1" ]; then
    REPORT_CONTENT=$(cat "$1")
elif [ -n "$1" ]; then
    REPORT_CONTENT="$1"
else
    echo "Usage: validate-report.sh report.md | validate-report.sh -" >&2
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

# Check frontmatter delimiters exist
FRONTMATTER_START=$(echo "$REPORT_CONTENT" | head -1)
if [ "$FRONTMATTER_START" != "---" ]; then
    error "Missing YAML frontmatter (file must start with ---)"
else
    # Check closing delimiter
    CLOSING_COUNT=$(echo "$REPORT_CONTENT" | grep -c '^---$' || true)
    if [ "$CLOSING_COUNT" -lt 2 ]; then
        error "Missing closing YAML frontmatter delimiter (---)"
    fi

    # Extract frontmatter content (between first and second ---)
    FRONTMATTER=$(echo "$REPORT_CONTENT" | sed -n '2,/^---$/p' | sed '$d')

    # Check required frontmatter fields
    if ! echo "$FRONTMATTER" | grep -q '^session:'; then
        error "Missing required frontmatter field: session"
    fi

    if ! echo "$FRONTMATTER" | grep -q '^started-at:'; then
        error "Missing required frontmatter field: started-at"
    fi

    # Check recommended frontmatter fields
    if ! echo "$FRONTMATTER" | grep -q '^completed-at:'; then
        warn "Missing recommended frontmatter field: completed-at"
    fi

    if ! echo "$FRONTMATTER" | grep -q '^specs-completed:'; then
        warn "Missing recommended frontmatter field: specs-completed"
    fi

    if ! echo "$FRONTMATTER" | grep -q '^specs-failed:'; then
        warn "Missing recommended frontmatter field: specs-failed"
    fi
fi

# --- Required sections ---

if ! echo "$REPORT_CONTENT" | grep -q '^## Completed'; then
    error "Missing required section: ## Completed"
else
    # Check that Completed section has at least one item
    COMPLETED_SECTION=$(echo "$REPORT_CONTENT" | sed -n '/^## Completed/,/^## /p' | sed '$d')
    ITEM_COUNT=$(echo "$COMPLETED_SECTION" | grep -c '^- ' || true)
    if [ "$ITEM_COUNT" -lt 1 ]; then
        error "Completed section must have at least one item (line starting with '- ')"
    fi
fi

# --- Recommended sections ---

if ! echo "$REPORT_CONTENT" | grep -q '^## Key Decisions'; then
    warn "Missing recommended section: ## Key Decisions"
fi

if ! echo "$REPORT_CONTENT" | grep -q '^## Needs Human Input'; then
    warn "Missing recommended section: ## Needs Human Input"
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

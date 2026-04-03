#!/bin/bash
# validate-spec.sh - Validates spec structure and YAML frontmatter
#
# Usage:
#   ./validate-spec.sh spec.md
#   cat spec.md | ./validate-spec.sh -
#
# Exit codes:
#   0 - Validation passed
#   1 - Validation failed (errors printed to stderr)

set -e

ERRORS=0
WARNINGS=0

# Read spec content from file or stdin
if [ "$1" = "-" ]; then
    SPEC_CONTENT=$(cat)
elif [ -n "$1" ] && [ -f "$1" ]; then
    SPEC_CONTENT=$(cat "$1")
elif [ -n "$1" ]; then
    SPEC_CONTENT="$1"
else
    echo "Usage: validate-spec.sh spec.md | validate-spec.sh -" >&2
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
    if ! echo "$SPEC_CONTENT" | grep -q "^## $section"; then
        if [ "$required" = "required" ]; then
            error "Missing required section: ## $section"
        else
            warn "Missing recommended section: ## $section"
        fi
    fi
}

# --- YAML Frontmatter ---

# Check that frontmatter fences exist
FIRST_LINE=$(echo "$SPEC_CONTENT" | head -n 1)
if [ "$FIRST_LINE" != "---" ]; then
    error "Missing YAML frontmatter (file must start with ---)"
else
    # Check closing fence exists
    CLOSING_FENCE=$(echo "$SPEC_CONTENT" | tail -n +2 | grep -n '^---$' | head -n 1)
    if [ -z "$CLOSING_FENCE" ]; then
        error "Missing closing --- for YAML frontmatter"
    else
        # Extract frontmatter content between fences
        FENCE_LINE=$(echo "$CLOSING_FENCE" | cut -d: -f1)
        FRONTMATTER=$(echo "$SPEC_CONTENT" | tail -n +2 | head -n "$((FENCE_LINE - 1))")

        # Check required frontmatter fields
        if ! echo "$FRONTMATTER" | grep -q '^title:'; then
            error "Missing required frontmatter field: title"
        fi

        if ! echo "$FRONTMATTER" | grep -q '^type:'; then
            error "Missing required frontmatter field: type"
        else
            TYPE_VALUE=$(echo "$FRONTMATTER" | grep '^type:' | sed 's/^type:[[:space:]]*//' | tr -d '"' | tr -d "'")
            case "$TYPE_VALUE" in
                bug|feature|refactor) ;;
                *) error "Invalid type: '$TYPE_VALUE' (must be: bug, feature, refactor)" ;;
            esac
        fi

        if ! echo "$FRONTMATTER" | grep -q '^priority:'; then
            error "Missing required frontmatter field: priority"
        else
            PRIORITY_VALUE=$(echo "$FRONTMATTER" | grep '^priority:' | sed 's/^priority:[[:space:]]*//' | tr -d '"' | tr -d "'")
            case "$PRIORITY_VALUE" in
                critical|high|medium|low) ;;
                *) error "Invalid priority: '$PRIORITY_VALUE' (must be: critical, high, medium, low)" ;;
            esac
        fi

        if ! echo "$FRONTMATTER" | grep -q '^status:'; then
            error "Missing required frontmatter field: status"
        else
            STATUS_VALUE=$(echo "$FRONTMATTER" | grep '^status:' | sed 's/^status:[[:space:]]*//' | tr -d '"' | tr -d "'")
            case "$STATUS_VALUE" in
                draft|ready|in-progress|done|archived) ;;
                *) error "Invalid status: '$STATUS_VALUE' (must be: draft, ready, in-progress, done, archived)" ;;
            esac
        fi

        if ! echo "$FRONTMATTER" | grep -q '^created:'; then
            error "Missing required frontmatter field: created"
        fi
    fi
fi

# --- Required sections ---

check_section "Purpose" required
check_section "Acceptance Criteria" required

# --- Content quality ---

# Check Purpose section is not empty
PURPOSE_CONTENT=$(echo "$SPEC_CONTENT" | sed -n '/^## Purpose/,/^## /p' | sed '$d' | tail -n +2 | sed '/^$/d')
if [ -z "$PURPOSE_CONTENT" ]; then
    error "Purpose section is empty"
fi

# Check Acceptance Criteria has at least one checkbox
AC_SECTION=$(echo "$SPEC_CONTENT" | sed -n '/^## Acceptance Criteria/,/^## /p' | sed '$d')
if [ -n "$AC_SECTION" ]; then
    CHECKBOX_COUNT=$(echo "$AC_SECTION" | grep -cE '^\s*- \[ \]|^\s*- \[x\]' || true)
    if [ "$CHECKBOX_COUNT" -eq 0 ]; then
        error "Acceptance Criteria must have at least one checkbox (- [ ] or - [x])"
    fi
fi

# --- Recommended sections ---

check_section "Background" optional
check_section "Edge Cases" optional
check_section "Constraints" optional
check_section "Out of Scope" optional

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

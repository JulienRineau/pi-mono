---
name: review-ux
description: UX review checklist — user-facing behavior, error messages, API ergonomics, accessibility
---

# UX / Human Advocate Review Checklist

## Evaluate

- [ ] **Error messages**: Are user-facing errors helpful and actionable? Not cryptic codes or stack traces?
- [ ] **API ergonomics**: Are API interfaces intuitive? Sensible defaults? Minimal required parameters?
- [ ] **Degraded states**: What does the user see when things partially fail? Loading, empty, error states?
- [ ] **Discoverability**: Can users find and understand new functionality without reading source code?
- [ ] **Consistency**: Does the UX match existing patterns in the application?
- [ ] **Accessibility**: Color contrast, keyboard navigation, screen reader support (if UI)?
- [ ] **Documentation**: Are user-facing docs updated? README, CLI help text, API docs?
- [ ] **Migration path**: If behavior changes, is there a clear upgrade/migration path for users?
- [ ] **Feedback**: Does the system provide appropriate feedback for user actions?
- [ ] **Edge case UX**: What happens with empty inputs, very long inputs, special characters?

## Critical Indicators

Flag as Critical:
- User-facing error that exposes internal details or is completely unhelpful
- Breaking change with no migration path or documentation
- Feature completely unusable due to UX issue
- Accessibility regression (removed keyboard support, broken screen reader)

## When Reviewing Plans

Focus on: whether user-facing aspects are considered, if error states are planned, if documentation updates are included.

## When Reviewing Implementation

Focus on: actual error messages, CLI output, API response formats, documentation accuracy.

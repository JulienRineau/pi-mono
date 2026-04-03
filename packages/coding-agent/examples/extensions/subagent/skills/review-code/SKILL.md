---
name: review-code
description: Code quality review checklist — DRY, naming, error handling, test coverage, readability
---

# Code Quality Review Checklist

## Evaluate

- [ ] **Readability**: Can you understand the code without extra context? Clear variable/function names?
- [ ] **DRY**: Is there duplicated logic that should be extracted? But not over-abstracted for one-time use.
- [ ] **Error handling**: Are errors caught at appropriate levels? Meaningful error messages?
- [ ] **Type safety**: Are types used effectively? Any `any` types that should be specific?
- [ ] **Test coverage**: Are new code paths tested? Edge cases covered? Tests meaningful (not just coverage)?
- [ ] **Code organization**: Are files, functions, and classes well-organized and appropriately sized?
- [ ] **Naming conventions**: Consistent with project style? Descriptive without being verbose?
- [ ] **Dead code**: Any unused imports, variables, functions, or commented-out code?
- [ ] **Logging**: Appropriate logging for debugging without noise? No sensitive data in logs?
- [ ] **Documentation**: Complex logic has inline comments? Public APIs have doc comments if needed?

## Critical Indicators

Flag as Critical:
- No tests for new functionality
- Swallowed errors (empty catch blocks with no explanation)
- Obviously incorrect logic (off-by-one, wrong comparison operator)
- Type safety completely bypassed in critical path

## When Reviewing Plans

Focus on: whether the plan follows existing code conventions, if file paths and function names are sensible, if test milestones exist.

## When Reviewing Implementation

Focus on: actual code quality, run the linter mentally, check test quality, verify naming consistency.

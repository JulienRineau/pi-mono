---
name: test-first
description: Write comprehensive tests before implementation following TDD principles
---

# Test-First Skill

Write tests that define the expected behavior BEFORE any implementation exists. The tests serve as an executable specification — the worker agent will implement code to make them pass.

## Process

### 1. Understand Expected Behavior

Read the plan and spec. Extract:
- Acceptance criteria (each becomes at least one test)
- Edge cases (each becomes a test)
- Error scenarios (each becomes a test)
- The interfaces and function signatures from the plan

### 2. Identify Project Test Conventions

Discover how tests are written in this project:

```bash
# Find test configuration
find . -name "jest.config*" -o -name "vitest.config*" -o -name ".mocharc*" -o -name "pytest.ini" -o -name "pyproject.toml" 2>/dev/null | head -5

# Find existing test files
find . -name "*.test.*" -o -name "*.spec.*" -o -name "test_*" 2>/dev/null | head -10
```

Read 2-3 existing test files to learn:
- Import style (what test runner, assertion library)
- File naming convention (`*.test.ts`, `*.spec.ts`, `test_*.py`)
- Directory structure (`__tests__/`, `tests/`, colocated)
- Describe/it structure vs flat test functions
- Setup/teardown patterns
- Mock/fixture patterns

### 3. Write Tests

Write two types of tests using the `test` tool:

**Permanent tests** — committed with the code, run forever via `npm test`:
```
test({
  action: "create",
  type: "permanent",
  package: "coding-agent",
  filename: "web-tools.test.ts",
  content: "import { ... } from '../src/...';\n\ndescribe('web tools', () => { ... });",
  plan: "plans/2026-04-09-move-web-tools-v1.md"
})
```

**Temporary tests** — implementation scaffolding, cleaned up after nightshift:
```
test({
  action: "create",
  type: "temporary",
  package: "coding-agent",
  filename: "web-tools-impl.test.ts",
  content: "import { ... } from '../src/...';\n\ndescribe('web tools implementation', () => { ... });",
  plan: "plans/2026-04-09-move-web-tools-v1.md"
})
```

Use relative imports from the test directory (e.g., `../src/core/tools/web-search.js`). Follow existing test conventions exactly.

**IMPORTANT:** Do NOT use `write` or `edit` to create test files. Always use the `test` tool with `action: "create"`.

### 4. Run Tests

Use the `test` tool to run:
```
test({ action: "run", plan: "plans/2026-04-09-move-web-tools-v1.md" })
```

**Expected result: ALL tests fail.** This is correct — nothing is implemented yet.

- If all fail → good, proceed
- If some pass → investigate: does the feature already exist? Is the test is wrong?
- If tests can't parse/compile → fix imports and types, then re-create via `test` tool

### 5. Report

Provide:
- List of test files created with paths
- Total test count
- Confirmation that all tests are failing
- Mapping of acceptance criteria to test names

## Rules

- **Use the test tool.** Never write test files directly with `write` or `edit`.
- **Follow existing patterns exactly.** Same framework, same directory, same naming, same assertion style.
- **Don't mock unnecessarily.** If the project uses integration tests, write integration tests.
- **Test behavior, not implementation.** Test what the function returns, not how it does it internally.
- **Each acceptance criterion = at least one test.** Edge cases and error cases add more.
- **Tests must be runnable immediately.** Correct imports, proper setup/teardown, no missing dependencies.
- **Don't write implementation code.** You write tests only. The worker will implement.
- **Don't import things that don't exist yet.** If the plan says "create `src/auth.ts` with `validateToken()`", your test should import from that path — it will fail with "module not found" and that's correct.
- **No hacks.** No symlinks, no workarounds. If imports don't resolve, fix the import path.

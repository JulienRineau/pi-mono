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

For each acceptance criterion, write at least one test:

```typescript
// Example structure (adapt to project conventions)
describe("Feature: {spec title}", () => {
  describe("Acceptance Criteria", () => {
    it("should {criterion 1 reworded as test}", () => {
      // Arrange - set up test data
      // Act - call the function/endpoint
      // Assert - verify expected outcome
    });
    
    it("should {criterion 2}", () => { ... });
  });
  
  describe("Edge Cases", () => {
    it("should handle empty input", () => { ... });
    it("should handle maximum values", () => { ... });
  });
  
  describe("Error Cases", () => {
    it("should reject invalid input", () => { ... });
    it("should handle missing dependencies", () => { ... });
  });
});
```

### 4. Run Tests

```bash
npm test -- --filter {test-file-pattern}  # or project-specific command
```

**Expected result: ALL tests fail.** This is correct — nothing is implemented yet.

- If all fail → good, proceed
- If some pass → investigate: does the feature already exist? Is the test checking the wrong thing?
- If tests can't even parse/compile → fix imports and types first

### 5. Register Tests

After writing tests, register them with the `test` tool so the nightshift loop can run them targeted:

```
test({
  "action": "register",
  "plan": "plans/2026-04-02-add-auth-v1.md",
  "spec": "specs/2026-04-02-fix-auth-timeout.md",
  "files": ["src/__tests__/auth.test.ts", "src/__tests__/auth-middleware.test.ts"],
  "count": 12
})
```

This records the mapping in `tests/nightshift-manifest.json`. The test files stay in their project-standard locations.

### 6. Commit

```bash
git add {test files}
git commit -m "test: add tests for {spec title} (all failing — TDD)"
```

### 7. Report

Provide:
- List of test files created with paths
- Total test count
- Confirmation that all tests are failing
- Mapping of acceptance criteria to test names

## Rules

- **Follow existing patterns exactly.** Same framework, same directory structure, same naming, same assertion style.
- **Don't mock unnecessarily.** If the project uses integration tests, write integration tests. If it uses mocks, use the same mock patterns.
- **Test behavior, not implementation.** Test what the function returns or what side effects occur, not how it does it internally.
- **Each acceptance criterion = at least one test.** This is the minimum. Edge cases and error cases add more.
- **Tests must be runnable immediately.** Correct imports, proper setup/teardown, no missing dependencies.
- **Don't write implementation code.** You write tests only. The worker will implement.
- **Don't import things that don't exist yet.** If the plan says "create `src/auth.ts` with `validateToken()`", your test should import from that path — it will fail with "module not found" and that's correct.

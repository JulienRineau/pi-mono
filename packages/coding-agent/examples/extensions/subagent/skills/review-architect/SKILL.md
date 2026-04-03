---
name: review-architect
description: Architecture review checklist — system design, coupling, abstractions, API surface
---

# Architecture Review Checklist

## Evaluate

- [ ] **Separation of concerns**: Are responsibilities clearly divided? Does each module/file have a single clear purpose?
- [ ] **Dependency direction**: Do dependencies flow from high-level to low-level? No circular dependencies?
- [ ] **Coupling**: Are modules loosely coupled? Can components be changed independently?
- [ ] **Abstraction quality**: Are abstractions at the right level? Not too leaky, not over-engineered?
- [ ] **API surface**: Are public interfaces minimal and well-defined? Are internal details properly hidden?
- [ ] **Extensibility**: Can the design accommodate likely future changes without rewrites?
- [ ] **Consistency**: Does the design follow existing patterns in the codebase?
- [ ] **Data flow**: Is data flow clear and predictable? No hidden side effects?
- [ ] **Error boundaries**: Are errors handled at appropriate architectural boundaries?
- [ ] **Scalability**: Will this design work at expected scale? Any obvious bottlenecks?

## Critical Indicators

Flag as Critical:
- Circular dependencies between modules
- Violation of existing architectural patterns without justification
- Public API that exposes internal implementation details
- Missing error handling at system boundaries
- Design that cannot accommodate stated requirements

## When Reviewing Plans

Focus on: milestone decomposition quality, whether the proposed file structure makes sense, if interfaces are well-defined before implementation starts, and if the design fits the existing architecture.

## When Reviewing Implementation

Focus on: actual module boundaries, import graph, public vs private surface, whether abstractions match the plan, and if the code integrates cleanly with existing architecture.

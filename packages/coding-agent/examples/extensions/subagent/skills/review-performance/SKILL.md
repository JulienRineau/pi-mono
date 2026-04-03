---
name: review-performance
description: Performance review checklist — algorithmic complexity, queries, memory, caching
---

# Performance Review Checklist

## Evaluate

- [ ] **Algorithmic complexity**: Are there O(n^2) or worse algorithms where O(n) or O(n log n) would work?
- [ ] **Database queries**: Any N+1 query patterns? Missing indexes for new queries?
- [ ] **Memory usage**: Large allocations in hot paths? Unbounded collections? Memory leaks?
- [ ] **Caching**: Are frequently-accessed, rarely-changed values cached? Cache invalidation correct?
- [ ] **Unnecessary computation**: Work done that's never used? Redundant calculations?
- [ ] **I/O efficiency**: Batch operations where possible? Avoiding unnecessary network/disk calls?
- [ ] **Bundle size**: Do new dependencies significantly increase bundle size? Tree-shakeable?
- [ ] **Concurrency**: Are async operations properly parallelized where independent?
- [ ] **Hot paths**: Are performance-critical paths optimized? No debug logging in production hot paths?
- [ ] **Data structures**: Appropriate data structures for access patterns?

## Critical Indicators

Flag as Critical:
- O(n^2) or worse in a hot path with potentially large n
- N+1 query pattern in a list endpoint
- Unbounded memory growth (missing limits on collections)
- Synchronous I/O blocking the event loop

## When Reviewing Plans

Focus on: whether the planned approach has obvious performance implications, if data access patterns are considered, if milestones include performance validation.

## When Reviewing Implementation

Focus on: actual loop structures, database query patterns, memory allocation in hot paths, unnecessary work.

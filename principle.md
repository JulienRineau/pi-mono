While I'm away, the agent does the following:

1. **Prep**: Cleans the working tree by analyzing any uncommitted work and doing the right thing with it (stash or commit). Also runs the entire current test suite and fixes any failures it encounters.
2. Picks a task from bugs first, or if bugs are complete, a feature that I've completed a spec for
3. Loads up the spec, and then analyzes it
4. Loads relevant docs, then looks at relevant code
5. Develops a testing plan (absolutely critical)
6. Writes extensive tests for this, then runs them, expecting failures
7. Develops an extensive plan of its own (I NEVER read this, I do not care)
8. Runs sub-agents as critical reviewers (review agents) based on 6 personas I've detailed in REVIEW_PERSONAS.md: Designer, Architect, Domain Expert, Code Expert, Performance Expert, Human Advocate. Each of these "owns" a portion of the docs, and reviews against their own documentation, including suggesting where their own docs need to be adapted.
9. Adapts plan based on review agent reviews, and loops to 7 until green light from all review agents
10. Implements the plan, including documentation adjustments (docs live in the same code base under Docs)
11. Runs type checking, linting, compiler, other static analysis tools such as bundle size reporter, as many things as possible, and of course the relevant tests themselves, and verifies that it works, iterating as it goes. Be as strict as possible with your type checking and linting system. I used to be anti strictness, but that was when I was a wetware dev. For agents, I want the most strictness possible.
12. Run the entire test suite to protect against regressions, fix any new issues
13. Runs the review agents again on the implementation diff, and loops back to step 10 until getting a green light from all review agents.
14. Add any encountered unrelated TODOs for human review that they've noticed along the way to the TODO doc
15. **Wrap-up**: write a CHANGELOG entry, commit with a detailed commit message meant for human context when reviewing the code. (More on commits later)
16. Loop back to the beginning (step 1), and select the next task or spec.
17. When completely done, write up a report for human review. Extremely concise. Details live in commit messages.
18. The Night Shift is done. It goes silent and waits for me to wake up.

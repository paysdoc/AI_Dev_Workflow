# Find Issue Dependencies

Analyze the dependencies of GitHub issue #$ARGUMENTS.

## Instructions

1. Fetch the issue body from GitHub using `gh issue view $ARGUMENTS --json body`.
2. Look for a `## Dependencies` section in the issue body.
3. Extract all issue references:
   - Hash references: `#42`, `#10`
   - Full GitHub URLs: `https://github.com/owner/repo/issues/42`
4. For each referenced issue, check its state using `gh issue view <number> --json state`.
5. Return a structured report:

## Output Format

```
## Issue #$ARGUMENTS Dependencies

### All Dependencies
- #<number>: <OPEN|CLOSED>
- ...

### Blocking (Open) Dependencies
- #<number>
- ...

### Summary
- Total dependencies: <count>
- Open (blocking): <count>
- Closed (resolved): <count>
```

If no `## Dependencies` section is found, report: "No dependencies section found in issue #$ARGUMENTS."

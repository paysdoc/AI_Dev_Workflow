# Deterministic Branch-Name Assembly

**ADW ID:** 7dp24s-orchestrator-resilie
**Date:** 2026-04-20
**Specification:** specs/issue-455-adw-7dp24s-orchestrator-resilie-sdlc_planner-deterministic-branch-name-assembly.md

## Overview

Narrows the LLM's responsibility so it only produces a semantic slug (e.g. `json-reporter-findings`), and moves full branch-name assembly (`<prefix>-issue-<N>-<slug>`) into a single pure function in `adws/vcs/branchOperations.ts`. This eliminates the regex drift that produced ghost branches like `feature-issue-8-json-reporter-findings-output`, where the LLM emitted a drifted name that the state reader could not resolve, stranding an orchestrator on a non-existent worktree.

## What Was Built

- `validateSlug()` — pure function that rejects empty, prefixed, uppercase, whitespace-containing, path-separator-containing, and forbidden-character slugs
- Rewritten `generateBranchName()` — pure function producing `<prefix>-issue-<N>-<slug>` (hyphen-separated) from a validated slug
- Removed dead code: `generateFeatureBranchName()` and `createFeatureBranch()` (slash-separated, never wired to production)
- Narrowed `/generate_branch_name` LLM prompt to emit only the slug (no prefix, no issue number)
- Updated `runGenerateBranchNameAgent()` to extract a slug, validate it, and delegate assembly to `generateBranchName()`
- Renamed `extractBranchNameFromOutput` → `extractSlugFromOutput` with a deprecated alias for backwards compatibility
- Unit tests for `generateBranchName`, `validateSlug`, and the narrowed `runGenerateBranchNameAgent` contract
- BDD regression scenarios in `features/deterministic_branch_name_assembly.feature` tagged `@adw-7dp24s-orchestrator-resilie @regression`

## Technical Implementation

### Files Modified

- `adws/vcs/branchOperations.ts`: Added `validateSlug()`, rewrote `generateBranchName()` to use hyphen-separator and call `validateSlug()`, deleted `generateFeatureBranchName()` and `createFeatureBranch()`, updated `inferIssueTypeFromBranch()` to also recognise hyphen-prefixed names
- `adws/agents/gitAgent.ts`: Renamed `extractBranchNameFromOutput` → `extractSlugFromOutput`, replaced `validateBranchName` call with `validateSlug`, added `generateBranchName` call to assemble the final name, removed `issueClass` from `formatBranchNameArgs`
- `.claude/commands/generate_branch_name.md`: Rewrote `## Instructions` to require slug-only output; removed all prefix/issue-number instructions; updated examples to slug-only form
- `adws/vcs/index.ts`: Removed exports of deleted functions
- `adws/index.ts`: Removed top-level re-exports of deleted functions
- `adws/agents/__tests__/gitAgent.test.ts`: Extended with tests for `runGenerateBranchNameAgent` slug-only contract (valid slug, prefixed slug rejection, invalid-character slug rejection)
- `adws/providers/__tests__/boardManager.test.ts`: Minor fix to keep existing tests passing

### New Files

- `adws/vcs/__tests__/branchOperations.test.ts`: Unit tests for `generateBranchName` (all five `IssueClassSlashCommand` prefixes, hyphen separator) and `validateSlug` (exhaustive rejection table: empty, uppercase, spaces, leading/trailing hyphens, double hyphens, >50 chars, each canonical and alias prefix, `issue-<N>` segment, path separators, forbidden git-ref chars)
- `features/deterministic_branch_name_assembly.feature`: Three BDD regression scenarios (branch on disk matches state file, prefixed slug rejected, invalid-character slug rejected)
- `features/step_definitions/deterministicBranchNameAssemblySteps.ts`: Step definitions for the above scenarios

### Key Changes

- The LLM is no longer trusted to compose the prefix or issue number; it owns only the 3–6-word descriptive slug
- `validateSlug()` is the enforcement point — it throws with an operator-legible message on any drift before a branch name is ever assembled
- `generateBranchName()` calls `validateSlug()` internally, so callers cannot bypass validation
- The canonical format is now unambiguous: `<prefix>-issue-<N>-<slug>` with hyphens throughout (the old `generateFeatureBranchName` slash-separated variant is gone)
- `branchPrefixAliases` is preserved (still needed for legacy worktree discovery), but `validateSlug` rejects alias prefixes so agents can never re-introduce drift via them

## How to Use

The public API is unchanged — callers of `runGenerateBranchNameAgent` continue to receive `{ ..., branchName: string }` where `branchName` is the fully-assembled canonical name.

To assemble a branch name from a known slug directly:

```typescript
import { generateBranchName } from 'adws/vcs/branchOperations';

const name = generateBranchName(42, 'add-user-auth', '/feature');
// → "feature-issue-42-add-user-auth"
```

To validate a slug in isolation:

```typescript
import { validateSlug } from 'adws/vcs/branchOperations';

validateSlug('add-user-auth');       // returns "add-user-auth"
validateSlug('feature-add-user-auth'); // throws — already prefixed
validateSlug('Add User Auth');         // throws — uppercase / spaces
```

## Configuration

No new environment variables or configuration required. The narrowed `/generate_branch_name` prompt is deployed automatically as part of the `adw_init` skill copy (it has `target: false` so it is managed in the ADW repo directly).

## Testing

```bash
# Unit tests
bun run test:unit

# BDD regression scenarios for this feature
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-7dp24s-orchestrator-resilie"

# Full regression suite
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"

# Type check
bunx tsc --noEmit
bunx tsc --noEmit -p adws/tsconfig.json
```

## Notes

- `branchPrefixAliases` (`feat`, `bug`, `test`) remain in `adws/types/issueRouting.ts` for backwards compatibility — existing worktrees with drifted prefixes must still be discoverable. Cleanup is out of scope.
- The prior `validateBranchName` function (which stripped and sanitised) has been removed from the agent layer. Validation is now strict rejection, not silent normalisation.
- Issue #30's workaround (bolting aliases onto the reader) and the ghost branch incident that motivated it are the direct predecessors of this change. See `specs/prd/orchestrator-coordination-resilience.md` for the full context.

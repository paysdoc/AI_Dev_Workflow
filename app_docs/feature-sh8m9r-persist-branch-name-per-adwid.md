# Branch-Name Resolution & Deterministic Identity Fallback

## Overview

This module owns the full branch-name resolution cascade for ADW workflows and the deterministic identity-recovery fallback that prevents duplicate branches when the canonical comment-based recovery fails. Once resolved, a branch name is persisted to `agents/{adwId}/state.json` and reused on every subsequent workflow entry — the LLM is invoked at most once per `adwId`. When neither a persisted name nor a recovery comment is available, the module finds an existing branch that belongs to the issue (slug-agnostic) and recovers the original `adwId` from the persisted state store rather than minting a fresh identity that would alias the existing worktree.

## Responsibilities

- **Priority-cascade resolution** (`branchNameResolution.ts` → `resolveWorkflowBranchName`): persisted state → recovery comment → deterministic identity fallback → LLM generation.
- **Persistence** (`readPersistedBranchName`, `persistBranchName`): reads/writes `branchName` in `agents/{adwId}/state.json` via `AgentStateManager` (atomic write).
- **Deterministic branch-identity predicates** (`adws/vcs/branchIdentity.ts`): `deterministicBranchName(classifier, issueNumber)` returns `{prefix}-issue-{N}`; `branchMatchesIssue(branchName, classifier, issueNumber)` returns `true` when a branch belongs to the issue under the given classifier, ignoring the slug tail but exact on prefix and issue-number boundary.
- **Identity-recovery helpers** (`adws/phases/branchIdentityFallback.ts`): `findExistingBranchForIssue` scans local branches and worktrees for a slug-agnostic match; `recoverAdwIdForBranch` reverse-looks-up the owning `adwId` from `agents/<adwId>/state.json` by persisted `branchName`, tie-breaking on most-recently-active.
- **adwId recovery in `workflowInit.ts`**: when `adwId` is absent and `recoveryState.adwId` is `null`, attempts `findExistingBranchForIssue` + `recoverAdwIdForBranch` before falling back to `generateAdwId`.
- **Mismatch abort guard**: after the LLM call, re-reads state; if a concurrent writer persisted a different name, throws rather than forking into an orphan worktree.

## Contracts & Invariants

- The LLM branch-name agent is invoked **at most once per `adwId`**; a persisted name wins unconditionally on re-entry.
- `branchMatchesIssue` is exact on issue-number boundary: `feature-issue-641` matches issue 641 but `feature-issue-64` and `feature-issue-6411` do not.
- A re-classification that changes the prefix (e.g. `/feature` → `/bug`) produces **no match** in `branchMatchesIssue`, causing the fallback to return `null` and resolution to fall through to LLM generation — a new branch is the intended outcome.
- The deterministic-branch fallback is reached **only when both `adwId` and `recoveryState.adwId` are absent** — the normal comment-recovery path is byte-for-byte unchanged.
- When a branch is found by the fallback but no owning `adwId` can be reverse-looked-up, the branch is still reused (criterion 1) while `adwId` falls back to fresh-mint (best-effort).
- `resolveWorkflowBranchName` is the only production entry point; `_resolveWorkflowBranchNameForTest` is `@internal` and injects agent and finder fakes for unit tests.

## Configuration

No new configuration options. Uses `AGENTS_STATE_DIR` (`adws/core/config.ts`), `branchPrefixMap` / `branchPrefixAliases` (`adws/types/issueRouting.ts`), and `AgentStateManager.readTopLevelState` / `writeTopLevelState`.

To inspect the persisted branch name for a workflow:

```sh
cat agents/<adwId>/state.json | jq .branchName
```

## Gotchas

- **The branch name does not embed the `adwId`**: `generateBranchName` produces `{prefix}-issue-{N}-{slug}`; only plan files embed `-adw-{adwId}-`. Consequently "recover the adwId from that worktree" is a **reverse-lookup over `agents/<adwId>/state.json` by persisted `branchName`**, not branch-string parsing.
- **Alias prefixes are accepted**: `branchMatchesIssue` accepts both the canonical prefix and `branchPrefixAliases` entries (e.g. `feat-issue-641-x` matches `/feature`), mirroring `findWorktreeForIssue`.
- **Issue-classification must precede adwId resolution**: `workflowInit.ts` classifies the issue before the adwId block so the deterministic fallback has the `issueType` it needs. This is a departure from the pre-#641 order where classification occurred after the adwId was set.
- **Multiple adwIds owning the same branch**: possible after a state-aliasing incident. `recoverAdwIdForBranch` breaks ties by most-recently-active (`getLastActivityFromState`); `null` activity sorts last.
- **Empty `AGENTS_STATE_DIR` or missing state files**: `recoverAdwIdForBranch` returns `null` gracefully; the fallback continues to fresh `generateAdwId`.
- **`findWorktreeForIssue` gating**: in `workflowInit.ts`, `findWorktreeForIssue` is gated behind "no persisted branch name" — a persisted name is always authoritative over directory-pattern-matched sibling worktrees.

# Feature: upgradeClaim deep module (atomic upgrade-claim primitive)

## Metadata
issueNumber: `539`
adwId: `m45h0x-upgradeclaim-deep-mo`
issueJson: `{"number":539,"title":"upgradeClaim deep module","body":"## Parent PRD\n\n`specs/prd/adw-init-hash-and-label-classification.md`\n\n## What to build\n\nAtomic claim primitive using the GitHub branch namespace. Creates an empty commit on a new branch named `adw-upgrade-{hash}` and pushes. Push success = winner. Push failure (branch exists) = loser path: query for the open issue with `adw:upgrade` label tied to the existing branch (via PR linkage) and return its details.\n\nSee the \"Upgrade claim primitive\" section of the parent PRD.\n\n## Acceptance criteria\n\n- [ ] `claimUpgradeOrFindExisting(hash, repoInfo)` returns `{won: true}` when branch is absent\n- [ ] Returns `{won: false, existingIssueNumber, existingBranch}` when branch already exists\n- [ ] Two concurrent claims against the same hash produce exactly one winner\n- [ ] Loser correctly resolves the existing tracking issue number via PR-branch linkage\n- [ ] Integration tests against a sandbox target repo\n\n## Blocked by\n\nNone - can start immediately\n\n## User stories addressed\n\n- User story 11","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-06-08T11:10:49Z","comments":[],"actionableComment":null}`

## Feature Description

This feature delivers the **upgrade-claim primitive** described in the "Upgrade claim primitive" section of the parent PRD (`specs/prd/adw-init-hash-and-label-classification.md`). It is a single deep module that lets any number of concurrently-running ADW orchestrators, all detecting the same `.adw-version` hash mismatch on the same target repo, agree on **exactly one winner** that will perform the `.adw/` regeneration — with every other orchestrator (the losers) cleanly discovering the existing upgrade work instead of duplicating it.

The atomicity is borrowed from GitHub's branch namespace, which is the only primitive that provides create-if-not-exists semantics across distributed, single-host-uncoordinated orchestrators. The winner creates an **empty claim commit** on a new branch `adw-upgrade-<hash>` and pushes it; the push either succeeds (winner) or is rejected because the branch already exists (loser). The empty commit is load-bearing: it gives the branch a commit ahead of the base branch so the downstream `adwUpgrade.tsx` orchestrator (a separate, future slice) can open a PR against it.

The public surface is a single async function:

```ts
claimUpgradeOrFindExisting(hash: string, repoInfo: RepoInfo, deps?: UpgradeClaimDeps): Promise<UpgradeClaimResult>
```

- **Winner**: returns `{ won: true, branch: "adw-upgrade-<hash>" }`.
- **Loser**: returns `{ won: false, existingIssueNumber, existingBranch: "adw-upgrade-<hash>" }`, where `existingIssueNumber` is resolved from the winner's PR via PR→branch→issue linkage.

The value to users (the framework operator) is that automatic framework propagation never produces duplicate upgrade issues or wasted LLM regeneration work, even when many issues hit the same mismatch at once (PRD user story 11).

## User Story

As the framework operator
I want concurrent upgrade attempts (when multiple issues hit the same hash mismatch simultaneously) to resolve to a single upgrade PR
So that I never see duplicate upgrade issues or wasted LLM regen work

## Problem Statement

When the framework hash advances, every in-flight orchestrator running against a stale target repo independently detects the same mismatch. Without a coordination primitive, each one would try to create its own upgrade branch, tracking issue, PR, and LLM regeneration — producing N duplicate upgrade issues and N wasted regen runs for a single logical upgrade. ADW is explicitly single-host but provides **no cross-trigger / cross-orchestrator distributed lock** strong enough to linearize this (see the project's documented cron+webhook spawn-duplication failure mode). A purely local lock cannot coordinate orchestrators that may be spawned from different triggers, so the claim must be arbitrated by a primitive both sides can observe atomically: the remote git branch namespace.

A second, subtler problem: the loser must not merely "give up" — it must **discover the winner's tracking issue** so the caller can register a dependency on it and park the current issue politely. That discovery must work via the durable PR→branch→issue linkage rather than racy in-memory state.

## Solution Statement

Build a pure-logic-plus-injected-I/O **deep module** `adws/core/upgradeClaim.ts`, following the exact dependency-injection pattern already established by `adws/core/remoteReconcile.ts` (cited in the PRD's testing notes as prior art). The module:

1. Computes the deterministic claim branch name `adw-upgrade-<hash>` from the hash (pure helper).
2. Attempts the claim by creating an **empty commit with a unique nonce in its message** on that branch in an isolated temporary worktree (so the caller's worktree is never mutated — the `commitAndPushKpiFile` temp-worktree pattern) and pushing it **without `--force`**.
   - Push succeeds → **winner**.
   - Push is rejected (non-fast-forward / branch already exists) → **loser**.
   - The nonce guarantees two racing orchestrators produce **distinct commit SHAs**, so the second push is always a genuine non-fast-forward rejection and never a "both branches point at the same SHA → no-op success → two winners" outcome. This is the single most important correctness decision for the "exactly one winner" acceptance criterion.
3. On the loser path, resolves the existing tracking issue by reusing the existing `defaultFindPRByBranch(branch, repoInfo)` + `fetchPRDetails(prNumber).issueNumber` ("Implements #N") helpers from `adws/github/prApi.ts` — the same PR→branch→issue linkage that the rest of ADW already trusts.
4. Returns a discriminated-union `UpgradeClaimResult` so callers branch on `won` with full type-narrowing.

All real I/O (git push of the claim branch, PR lookup, issue-number resolution, logging) is injected via an `UpgradeClaimDeps` interface with a `buildDefaultUpgradeClaimDeps(baseRepoPath)` factory wiring production implementations. This makes the winner/loser decision logic and result-shaping unit-testable with `vi.fn()` doubles (no network), while the push-race atomicity is exercised by an integration test against a **local bare git repo acting as the sandbox remote** — CI-runnable with no GitHub credentials.

The module is deliberately scoped to the claim primitive only. Creating the `adw:upgrade` tracking issue, registering dependencies, returning the issue to the Todo lane, and invoking `adwUpgrade.tsx` are the **caller's** responsibility (a separate PRD slice that wires this into `initializeWorkflow()`), and are out of scope here.

## Relevant Files

Use these files to implement the feature:

- `specs/prd/adw-init-hash-and-label-classification.md` — Parent PRD. The "Upgrade claim primitive" subsection (Implementation Decisions) and the `upgradeClaim` entry under "Testing Decisions → Modules with test coverage" are the authoritative spec for this module's behavior and tests. User story 11 is the target.
- `adws/core/remoteReconcile.ts` — **The pattern to mirror.** Deep module with an injectable `ReconcileDeps` interface, a `buildDefaultReconcileDeps()` factory, extracted pure mappers (`mapArtifactsToStage`), and an optional-`deps` main function. `upgradeClaim.ts` should be structured identically (interface + factory + pure helpers + injected I/O). It also already wraps `git ls-remote --exit-code origin <branch>` for branch-existence detection — reusable shape for any remote read.
- `adws/core/__tests__/remoteReconcile.test.ts` — The unit-test pattern to mirror: `makeDeps(overrides)` factory of `vi.fn()` doubles, pure-mapper tests, and call-count assertions on the injected boundaries.
- `adws/github/prApi.ts` — Provides `defaultFindPRByBranch(branchName, repoInfo): RawPR | null`, the `RawPR` type, and `fetchPRDetails(prNumber, repoInfo): PRDetails` (whose `issueNumber` is parsed from the PR body's `Implements #N` linkage, falling back to `extractIssueNumberFromBranch`). The loser path's issue resolution composes these — do not reimplement PR lookup.
- `adws/github/githubApi.ts` — Defines `RepoInfo { owner; repo }` (the second parameter of the public function) and `getRepoInfo(cwd?)`.
- `adws/github/issueApi.ts` — Reference for the `gh issue list`/label-query idioms (`issueHasLabel`, etc.) in case a label-based fallback resolution is added; the canonical path is PR linkage.
- `adws/vcs/commitOperations.ts` — `commitAndPushKpiFile()` is the **temp detached-worktree** template (`git worktree add --detach <tmp> origin/<defaultBranch>` → commit → push → `git worktree remove --force` in a `finally`). The default `pushClaimBranch` implementation follows this so the caller's active worktree/index/HEAD are never touched. Also exposes `pushBranch`.
- `adws/vcs/branchOperations.ts` — `getDefaultBranch(cwd)` (base ref for the claim worktree), `PROTECTED_BRANCHES`, and `deleteRemoteBranch` (useful for integration-test teardown).
- `adws/core/index.ts` — Barrel for `adws/core`. The remoteReconcile exports here show exactly how to add the new module's public surface (`claimUpgradeOrFindExisting`, `buildDefaultUpgradeClaimDeps`, `buildClaimBranchName`, types).
- `adws/core/utils.ts` — `execWithRetry`, `log`, `LogLevel` (injected logging default).
- `adws/triggers/__tests__/takeoverHandler.integration.test.ts` — The `.integration.test.ts` pattern (real `os.tmpdir()` scratch dir created in `beforeEach`, removed in `afterEach`, real local filesystem/git with network boundaries stubbed). The upgrade-claim integration test mirrors this with a local bare repo.
- `test/mocks/git-remote-mock.ts` — Reference for how the suite already fakes remote git operations; informs the local-bare-repo sandbox approach (the integration test uses a real bare repo rather than this no-op mock, because it must exercise true push rejection).
- `app_docs/feature-djtyv4-remote-reconcile-module.md` — Conditional doc: context for `defaultFindPRByBranch`/`RawPR` shared helpers in `adws/github/prApi.ts` (reused by the loser path) and the remoteReconcile DI module shape.
- `app_docs/feature-hk12ct-kpi-commits-land-on-default-branch.md` — Conditional doc: the temp-worktree "commit to a branch without mutating the active worktree" contract that the winner's push path depends on.
- `app_docs/feature-y000tl-fix-issue-number-res-pr-review-issue-number.md` — Conditional doc: `fetchPRDetails()` issue-number extraction and `extractIssueNumberFromBranch()` behavior, relevant to resolving `existingIssueNumber` on the loser path.

### New Files

- `adws/core/upgradeClaim.ts` — The deep module. Exports `claimUpgradeOrFindExisting`, `buildDefaultUpgradeClaimDeps`, the pure helpers `buildClaimBranchName` and `buildClaimResult`, and the `UpgradeClaimDeps` / `UpgradeClaimResult` types.
- `adws/core/__tests__/upgradeClaim.test.ts` — Unit tests for the winner/loser decision logic and result-shaping with injected `vi.fn()` deps (no network).
- `adws/core/__tests__/upgradeClaim.integration.test.ts` — Integration test exercising the real push-race winner/loser detection against a local bare git repo standing in for the sandbox target remote (PR/issue resolution stubbed, real git push).

## Implementation Plan

### Phase 1: Foundation

Define the module's contract first, mirroring `remoteReconcile.ts`:

- The `RepoInfo` parameter type (import from `adws/github/githubApi`).
- The `UpgradeClaimResult` discriminated union:
  - `{ won: true; branch: string }`
  - `{ won: false; existingIssueNumber: number | null; existingBranch: string }`
  - (`existingIssueNumber` is nullable to honestly represent the race window where the loser observes the claim branch before the winner has opened its PR.)
- The `UpgradeClaimDeps` interface injecting every I/O boundary:
  - `pushClaimBranch(branchName: string, hash: string, repoInfo: RepoInfo): boolean` — returns `true` if this orchestrator created and pushed the branch (winner), `false` if the push was rejected because the branch already exists (loser). Throws on genuine errors (network/auth) so they are never silently misread as "loser".
  - `findPRByBranch(branchName: string, repoInfo: RepoInfo): RawPR | null` — defaults to `defaultFindPRByBranch`.
  - `resolveIssueNumberFromPR(prNumber: number, repoInfo: RepoInfo): number | null` — defaults to reading `fetchPRDetails(prNumber, repoInfo).issueNumber` (returns `null` when not a positive integer).
  - `log(message: string, level?: LogLevel): void` — defaults to the shared `log`.
- The pure helper `buildClaimBranchName(hash: string): string` → `` `adw-upgrade-${hash}` `` (with a guard that `hash` is non-empty).

### Phase 2: Core Implementation

- Implement `buildClaimResult(...)` as a pure function mapping `(pushed, branch, resolvedIssueNumber)` → `UpgradeClaimResult`. This is the unit-test seam for "what shape does the loser/winner return".
- Implement `claimUpgradeOrFindExisting(hash, repoInfo, deps?)`:
  1. `const effectiveDeps = deps ?? buildDefaultUpgradeClaimDeps();`
  2. `const branch = buildClaimBranchName(hash);`
  3. `if (effectiveDeps.pushClaimBranch(branch, hash, repoInfo)) return { won: true, branch };`
  4. Loser path: `const pr = effectiveDeps.findPRByBranch(branch, repoInfo);`
  5. `const existingIssueNumber = pr ? effectiveDeps.resolveIssueNumberFromPR(pr.number, repoInfo) : null;`
  6. `return { won: false, existingIssueNumber, existingBranch: branch };`
  7. Keep the function flat (guard-clause early return on the winner branch) per the coding guidelines' nesting discipline.
- Implement `buildDefaultUpgradeClaimDeps(baseRepoPath: string = process.cwd()): UpgradeClaimDeps`:
  - `pushClaimBranch` default: fetch `origin/<defaultBranch>` in `baseRepoPath`; `git worktree add --detach <tmp> origin/<defaultBranch>`; in `<tmp>` run `git checkout -b adw-upgrade-<hash>`, `git commit --allow-empty -m "ADW upgrade in progress: <hash> [<nonce>]"` (nonce = a short random token so racing SHAs differ), then `git push origin adw-upgrade-<hash>` **without `--force`**. Classify a rejection (`rejected`, `non-fast-forward`, `failed to push some refs`, `already exists`) as `false` (loser); rethrow anything else. Always remove the temp worktree in a `finally` (mirror `cleanupKpiTempWorktree`).
  - `findPRByBranch` default → `defaultFindPRByBranch`.
  - `resolveIssueNumberFromPR` default → `fetchPRDetails(prNumber, repoInfo).issueNumber`, coerced to `null` unless a positive integer.
  - `log` default → shared `log`.
- Export everything from `adws/core/index.ts` alongside the existing `remoteReconcile` exports.

### Phase 3: Integration

- This module is consumed by a **future** PRD slice that inserts the hash check into `initializeWorkflow()` (out of scope for issue #539). To keep that wiring frictionless, ensure:
  - The two-argument call form `claimUpgradeOrFindExisting(hash, repoInfo)` works (defaults `deps` via `buildDefaultUpgradeClaimDeps(process.cwd())`), satisfying the acceptance-criteria signature.
  - The real caller can pass `buildDefaultUpgradeClaimDeps(worktreePath)` so the claim runs against the already-cloned target-repo worktree without touching the issue's feature branch.
  - No import cycles: `upgradeClaim.ts` imports from `../github/prApi` and `../github/githubApi` (types) and `./utils`, exactly as `remoteReconcile.ts` does.

## Step by Step Tasks

Execute every step in order, top to bottom.

### Task 1: Scaffold the deep module with types and pure helpers
- Create `adws/core/upgradeClaim.ts` with a top-of-file doc comment explaining the branch-namespace atomic-claim rationale and the nonce/distinct-SHA guarantee (mirror the explanatory header style of `remoteReconcile.ts`).
- Import `RepoInfo` from `../github/githubApi`, `defaultFindPRByBranch`, `fetchPRDetails`, and `RawPR` from `../github/prApi`, and `execWithRetry`, `log`, `LogLevel` from `./utils`.
- Define and export `UpgradeClaimResult` (discriminated union) and `UpgradeClaimDeps` (interface).
- Implement and export the pure `buildClaimBranchName(hash)` with a non-empty guard.
- Implement and export the pure `buildClaimResult(pushed, branch, resolvedIssueNumber)`.

### Task 2: Implement the orchestration function
- Implement and export `claimUpgradeOrFindExisting(hash, repoInfo, deps?)` per Phase 2, using a guard-clause early return for the winner path and composing the loser path from `findPRByBranch` + `resolveIssueNumberFromPR`.

### Task 3: Implement the default dependency factory
- Implement and export `buildDefaultUpgradeClaimDeps(baseRepoPath = process.cwd())`.
- Implement the default `pushClaimBranch` using the temp detached-worktree pattern from `commitAndPushKpiFile`, with the unique-nonce empty commit, no-force push, rejection-vs-error classification, and guaranteed temp-worktree cleanup in `finally`.
- Wire `findPRByBranch`, `resolveIssueNumberFromPR`, and `log` to their production defaults.

### Task 4: Export from the core barrel
- Add `claimUpgradeOrFindExisting`, `buildDefaultUpgradeClaimDeps`, `buildClaimBranchName`, `buildClaimResult`, and the `UpgradeClaimDeps` / `UpgradeClaimResult` types to `adws/core/index.ts`, in a clearly-labeled `// Upgrade claim` section next to the remote-reconcile exports.

### Task 5: Write unit tests
- Create `adws/core/__tests__/upgradeClaim.test.ts` following `remoteReconcile.test.ts` conventions (a `makeDeps(overrides)` factory of `vi.fn()` doubles, a `REPO_INFO` constant, a `makePR()` helper).
- Cover the cases listed in Testing Strategy → Unit Tests and Edge Cases below.

### Task 6: Write the integration test (sandbox target repo)
- Create `adws/core/__tests__/upgradeClaim.integration.test.ts` following the `.integration.test.ts` pattern.
- In `beforeEach`, build a local sandbox in `os.tmpdir()`: a **bare** repo (`git init --bare remote.git`) seeded with an initial commit on the default branch, plus one or two working clones whose `origin` points at the bare repo.
- Use **partial deps**: the **real** default `pushClaimBranch` (bound to a clone's path) with **stubbed** `findPRByBranch`/`resolveIssueNumberFromPR` (a bare repo has no `gh`/PR layer).
- Assert: first claim wins and the bare repo now contains `adw-upgrade-<hash>` with exactly one empty commit ahead of base; a second claim from a fresh clone loses (`won: false`, `existingBranch` set); running two claims resolves to exactly one winner and one loser.
- In `afterEach`, remove the temp sandbox (`fs.rmSync(..., { recursive: true, force: true })`).

### Task 7: Validate
- Run every command in the Validation Commands section and ensure all pass with zero regressions.

## Testing Strategy

### Unit Tests
`.adw/project.md` declares `## Unit Tests: enabled`, so the module ships with Vitest unit tests in `adws/core/__tests__/upgradeClaim.test.ts`, mirroring `remoteReconcile.test.ts`. They isolate the module by injecting `vi.fn()` doubles for every `UpgradeClaimDeps` boundary and assert on observable outputs and call counts:

- **Winner**: `pushClaimBranch` returns `true` → result is `{ won: true, branch: "adw-upgrade-<hash>" }`; `findPRByBranch` and `resolveIssueNumberFromPR` are **never called** (winner does no lookup).
- **Loser, issue resolvable**: `pushClaimBranch` returns `false`, `findPRByBranch` returns a `RawPR`, `resolveIssueNumberFromPR` returns `N` → `{ won: false, existingIssueNumber: N, existingBranch: "adw-upgrade-<hash>" }`.
- **Loser, PR not yet created** (race window): `pushClaimBranch` false, `findPRByBranch` returns `null` → `{ won: false, existingIssueNumber: null, existingBranch }`; `resolveIssueNumberFromPR` not called.
- **Loser, PR present but no `Implements #N`**: `resolveIssueNumberFromPR` returns `null` → `existingIssueNumber: null`.
- **Exactly one winner (logic level)**: two sequential calls where the injected `pushClaimBranch` returns `true` then `false` → exactly one `{ won: true }` and one `{ won: false }`.
- **Branch-name purity**: `buildClaimBranchName("abc123")` === `"adw-upgrade-abc123"`; empty/whitespace hash throws.
- **Result-shaping purity**: `buildClaimResult` maps each `(pushed, resolvedIssueNumber)` combination to the correct union member.
- **Push error is not a loser**: a `pushClaimBranch` that throws a non-rejection error propagates (the function does not swallow it into `{ won: false }`).
- **Default-deps wiring**: `buildDefaultUpgradeClaimDeps()` returns an object whose `findPRByBranch`/`resolveIssueNumberFromPR` are the production helpers (smoke assertion that defaults are wired, without invoking network).

The integration test (`upgradeClaim.integration.test.ts`) covers the real push-race atomicity against a local bare-repo sandbox, satisfying the "Integration tests against a sandbox target repo" and "two concurrent claims produce exactly one winner" acceptance criteria with no external credentials.

### Edge Cases
- Two racing orchestrators committing within the same wall-clock second — the nonce-bearing empty commits must still produce distinct SHAs so the second push is rejected (guards against the "two winners" failure).
- Loser observes the claim branch before the winner has created the tracking issue/PR (`findPRByBranch` → `null`) → `existingIssueNumber: null`, never a throw.
- PR exists for the branch but its body lacks `Implements #N` and the branch name carries no `issue-<N>` segment → `existingIssueNumber: null`.
- `pushClaimBranch` fails for a non-claim reason (no network, auth failure, missing `origin`) → error propagates; not misclassified as a loser.
- Temp worktree cleanup runs even when the push throws (no leaked `git worktree` entries).
- Empty/whitespace `hash` → `buildClaimBranchName` throws with an operator-legible message.
- The caller's active worktree (index/HEAD/branch) is unchanged after a winning claim (the claim happens in an isolated detached worktree).

## Acceptance Criteria
- `claimUpgradeOrFindExisting(hash, repoInfo)` returns `{ won: true, branch: "adw-upgrade-<hash>" }` when the branch is absent on the remote.
- It returns `{ won: false, existingIssueNumber, existingBranch: "adw-upgrade-<hash>" }` when the branch already exists.
- Two concurrent claims against the same hash produce exactly one `{ won: true }` and one `{ won: false }` (verified by the bare-repo integration test).
- The loser resolves `existingIssueNumber` from the winner's PR via PR→branch→issue (`Implements #N`) linkage, and degrades to `null` (not an error) when the PR/issue is not yet observable.
- A winning claim does not mutate the caller's working tree (isolated temp worktree).
- Unit tests (`adws/core/__tests__/upgradeClaim.test.ts`) and the integration test (`adws/core/__tests__/upgradeClaim.integration.test.ts`) pass.
- `bun run lint`, `bunx tsc --noEmit`, `bunx tsc --noEmit -p adws/tsconfig.json`, `bun run build`, and `bun run test:unit` all pass with zero regressions.

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `bun run lint` — ESLint (`eslint .`) passes with no new errors.
- `bunx tsc --noEmit` — root type-check passes.
- `bunx tsc --noEmit -p adws/tsconfig.json` — `adws/` project type-check passes (strict mode; no `any`, no non-null `!`).
- `bunx vitest run adws/core/__tests__/upgradeClaim.test.ts adws/core/__tests__/upgradeClaim.integration.test.ts` — the new unit and integration tests pass.
- `bun run test:unit` — the full Vitest suite (`vitest run`) passes with zero regressions.
- `bun run build` — `tsc` build succeeds.

## Notes
- **Coding guidelines** (`.adw/coding_guidelines.md`) are in force: keep the file well under 300 lines, prefer pure functions with I/O isolated at the injected boundary, use guard clauses (winner-path early return) to keep nesting ≤ 2, avoid `any` / non-null assertions (use `RawPR | null` narrowing), and treat data as immutable (`readonly` fields on the result union and deps interface).
- **No new dependencies** are required — the module composes existing `gh`/git CLI wrappers. (For reference, the project's library install command per `.adw/commands.md` is `bun add <package>`.)
- **Why an empty commit and not a bare ref at the base SHA**: the downstream `adwUpgrade.tsx` orchestrator must open a PR for `adw-upgrade-<hash>`, which requires the branch to be at least one commit ahead of base. A ref pointing exactly at the base tip is zero commits ahead and cannot back a PR. Hence the `--allow-empty` claim commit.
- **The nonce is correctness, not cosmetics.** Without a unique token in the claim commit, two orchestrators that produce byte-identical empty commits (same tree, parent, author/committer identity, and same-second timestamp) would generate the **same** SHA; the second `git push` would then be an "everything up-to-date" no-op success and both would believe they won. The nonce makes the second push a true non-fast-forward rejection.
- **Alternative atomic primitive (documented, not chosen):** `gh api -X POST repos/{owner}/{repo}/git/refs` returns `422 Reference already exists` on a duplicate, giving server-side atomic create without parsing push stderr. It was not chosen as primary because the PRD specifies the empty-commit-plus-`git push` mechanism and the empty claim commit is needed for the downstream PR; the implementer may still use the Git Data API (`POST /git/commits` for a unique empty commit, then `POST /git/refs`) as an equivalent, arguably cleaner, implementation of the same contract if push-stderr classification proves brittle.
- **Out of scope (separate PRD slices):** creating the `adw:upgrade` tracking issue on win, registering the dependency on it, returning the issue to the Todo lane, invoking `adwUpgrade.tsx`, and inserting the hash check into `initializeWorkflow()`. This issue ships only the claim primitive plus its tests. Sibling PRD modules (`hashComputer`, `adwVersion`, `labelManager`) do not yet exist and are not prerequisites for this slice.
- **True end-to-end atomicity against real GitHub** (the PRD's note that this module "depends on a real GitHub remote for true atomic-race testing") is validated by the committed integration test using a local bare remote, which exercises the identical `git push` rejection path; a manual run against a real sandbox GitHub repo remains available to the operator but is not part of the automated suite (no credentials in CI).

# Feature: `remoteReconcile` deep module — derive WorkflowStage from remote artifacts with re-verification

## Metadata
issueNumber: `458`
adwId: `djtyv4-orchestrator-resilie`
issueJson: `{"number":458,"title":"orchestrator-resilience: remoteReconcile module","body":"## Parent PRD\n\n`specs/prd/orchestrator-coordination-resilience.md`\n\n## What to build\n\nBuild the `remoteReconcile` deep module that derives the current `WorkflowStage` from remote artifacts (branch existence, PR state, merged/closed flags, commits ahead). A mandatory re-verification read immediately before returning guards against read-your-write lag on the GitHub API. The module is standalone in this slice — integration into the `takeoverHandler` happens in slice #11. See \"New modules to build → remoteReconcile\" in the PRD.\n\n## Acceptance criteria\n\n- [ ] `adws/core/remoteReconcile.ts` exports `deriveStageFromRemote(issueNumber, adwId, repoInfo) → WorkflowStage`\n- [ ] Branch-only → pre-PR running stage\n- [ ] Branch + open PR → `awaiting_merge`\n- [ ] Branch + merged PR → `completed`\n- [ ] Branch + closed-unmerged PR → `discarded`\n- [ ] Re-verification read fires immediately before return; on divergence, retry up to a small bounded limit\n- [ ] Post-retry persistent divergence falls back to the state-file value\n- [ ] All GitHub reads injected as dependencies so unit tests use fakes\n- [ ] Unit tests cover every mapping branch AND the re-verification retry paths\n\n## Blocked by\n\nNone - can start immediately.\n\n## User stories addressed\n\n- User story 11\n- User story 22","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-04-20T11:04:24Z","comments":[],"actionableComment":null}`

## Feature Description
Build a new deep module `adws/core/remoteReconcile.ts` that derives the authoritative `WorkflowStage` of an ADW run by reading remote artifacts on GitHub — the existence of the work branch and the state of its pull request — rather than trusting a potentially stale local state file.

The module exports a single pure-ish function `deriveStageFromRemote(issueNumber, adwId, repoInfo) → WorkflowStage`. It reads the state file to discover the branch name (and as a fallback value), then consults two injected GitHub-read dependencies: one that checks whether the branch exists on `origin`, and one that fetches the PR (open, merged, or closed-unmerged) for that branch.

Because the GitHub API exhibits read-your-write lag — a PR that was just merged can briefly still report `OPEN` — the function performs a **mandatory re-verification read immediately before returning**. The derived stage from the second read must match the first; if it does not, the function retries a small bounded number of times (`MAX_RECONCILE_VERIFICATION_RETRIES`). If the reads continue to disagree, the function falls back to the state-file's `workflowStage` value rather than guessing.

All I/O is injected so the module is exhaustively unit-testable without touching real GitHub or the real file system. This slice ships the module standalone; wiring it into `takeoverHandler` happens in the dependent slice per the parent PRD.

## User Story
As an ADW developer (user story 11 + 22)
I want remote-state derivation (branch exists, PR open, PR merged, commits ahead) to be a pure function with mandatory re-verification, exposed as a deep module whose logic is fully covered by unit tests using injected dependencies
So that stage reconciliation is testable, does not flap on API read lag, and future refactors cannot silently break the recovery behavior that `takeoverHandler` will depend on.

## Problem Statement
When an orchestrator crashes between writing the PR-open phase and writing `awaiting_merge`, the top-level state file contains a stale `workflowStage` that disagrees with the true state on GitHub (the PR exists and is open). The cron sweeper currently trusts the state file and can therefore re-spawn a fresh SDLC orchestrator on an issue that actually just needs to be merged. There is no single, testable place in the codebase that asks "given the remote artifacts, what stage is this work actually at?" — the logic is implicit and scattered across `adwMerge`, `cronStageResolver`, and various ad-hoc GitHub reads.

Without a purpose-built remote-state derivation module:

1. Stale local state drives incorrect retry decisions.
2. GitHub's read-your-write lag can briefly report a merged PR as `OPEN` or a just-closed PR as unclosed, producing flapping results if read once.
3. `takeoverHandler` (the deepest coordination module introduced by the parent PRD) has nowhere to ground its "what should we resume?" decision.
4. Every caller that wants to reconcile local state with the remote reinvents the read/map/retry logic ad hoc.

## Solution Statement
Introduce `adws/core/remoteReconcile.ts`, a deep module whose only public interface is:

```ts
export function deriveStageFromRemote(
  issueNumber: number,
  adwId: string,
  repoInfo: RepoInfo,
  deps?: ReconcileDeps,
): WorkflowStage;
```

Internals:

1. Read the top-level state file via `deps.readTopLevelState(adwId)` to discover the `branchName` and keep the state-file `workflowStage` as the fallback value.
2. If the state file is missing or has no `branchName`, return the state-file's `workflowStage` when present, else return `'starting'` (no work exists).
3. Perform a **reconciliation read** pair:
   - Read A: `branchExistsOnRemote(branchName, repoInfo)` + `findPRByBranch(branchName, repoInfo)`; map via `mapArtifactsToStage(...)` → stage S₁.
   - Read B (immediately after): same two reads → stage S₂.
   - If `S₁ === S₂`, return S₂. Two agreeing reads in a row are the stability signal.
   - If they diverge, rotate S₂ into S₁ and do another Read B, up to `MAX_RECONCILE_VERIFICATION_RETRIES` additional attempts.
   - If no two consecutive reads ever agree, return the state-file's `workflowStage` (the documented fallback), or `'starting'` if that is also absent.
4. `mapArtifactsToStage` is a pure, internal helper covering the four documented cases:
   - Branch exists, no PR → `'branch_created'` (the canonical "pre-PR running" stage in the existing `WorkflowStage` union).
   - Branch exists, PR `OPEN` → `'awaiting_merge'`.
   - Branch exists, PR `MERGED` → `'completed'`.
   - Branch exists, PR `CLOSED` and not merged → `'discarded'` (new `WorkflowStage` literal introduced by this slice).
   - No branch on remote → fall through to state-file fallback (treated as "we can't reconcile; trust the file").

The `ReconcileDeps` interface makes every I/O boundary injectable: `readTopLevelState`, `branchExistsOnRemote`, `findPRByBranch`. The exported function accepts an optional `deps` argument; when omitted, a `buildDefaultReconcileDeps()` helper wires the production implementations (`AgentStateManager.readTopLevelState`, a new thin `branchExistsOnRemote` wrapper around `git ls-remote --exit-code origin <branch>`, and the existing `defaultFindPRByBranch` already present in `adwMerge.tsx`, which we lift into `adws/github/prApi.ts` for reuse). This mirrors the DI pattern used by `adwMerge.executeMerge` and its test suite (`adws/__tests__/adwMerge.test.ts`).

Because the parent PRD extends `WorkflowStage` with `'discarded'` in a separate slice, but this slice's acceptance criteria require returning `'discarded'` for the closed-unmerged case, this slice adds the literal `'discarded'` to the `WorkflowStage` union in `adws/types/workflowTypes.ts`. No existing call sites are modified — the union widening is backward-compatible, and call sites that write `discarded` are the concern of the later slices enumerated in the PRD.

## Relevant Files
Use these files to implement the feature:

- `adws/types/workflowTypes.ts` — defines the `WorkflowStage` union; must gain the `'discarded'` literal so the module's return type compiles.
- `adws/core/index.ts` — barrel exports for `adws/core`; must re-export the new `deriveStageFromRemote` and `ReconcileDeps`/`RawPR`-like types so downstream slices can import from `../core`.
- `adws/core/agentState.ts` — provides `AgentStateManager.readTopLevelState` used as the production implementation of the state-file read dependency. Read-only reference for this slice.
- `adws/github/githubApi.ts` — declares `RepoInfo` (the third parameter of `deriveStageFromRemote`). Read-only reference for the type import.
- `adws/github/prApi.ts` — already contains `fetchPRDetails` and related PR helpers; we lift the existing `defaultFindPRByBranch` logic currently duplicated inside `adwMerge.tsx` (line 70) into this module as an exported helper so both `adwMerge` and `remoteReconcile` can share it. Update `adwMerge.tsx` to import from `prApi` instead of defining locally.
- `adws/adwMerge.tsx` — currently defines `defaultFindPRByBranch` at line 70 and the `RawPR` interface at lines 37–42. We move both into `adws/github/prApi.ts` (as `defaultFindPRByBranch` and `RawPR`) and re-import. The `MergeDeps` interface and `executeMerge` behavior are unchanged.
- `adws/__tests__/adwMerge.test.ts` — verifies that moving `defaultFindPRByBranch` does not regress the existing merge orchestrator tests (they already inject a fake `findPRByBranch`, so only the default-deps wiring needs to continue compiling).
- `adws/triggers/__tests__/spawnGate.test.ts` — canonical prior art for DI-based unit tests in this codebase (vitest, `vi.fn()`, fakes over a pure module). The new `remoteReconcile` test file follows this exact style.
- `specs/prd/orchestrator-coordination-resilience.md` — parent PRD; contains the full design rationale and the testing contract this slice must satisfy.
- `guidelines/coding_guidelines.md` — must be followed: TypeScript strict, no `any`, isolate side effects at the edges, pure core with injected I/O, files under 300 lines, `Readonly` on injected-deps shapes.
- `app_docs/feature-dcy9qz-merge-orchestrator-cron-handoff.md` — background on the existing `awaiting_merge` / `adwMerge.tsx` flow; useful to understand how this module's output will be consumed by `takeoverHandler` in the next slice. Read-only reference.
- `app_docs/feature-bpn4sv-orchestrators-awaiting-merge-handoff.md` — background on when orchestrators write `awaiting_merge` to state and exit; explains the exact lag window this module defends against. Read-only reference.

### New Files

- `adws/core/remoteReconcile.ts` — the deep module (target ~150 lines). Exports `deriveStageFromRemote`, `ReconcileDeps`, `mapArtifactsToStage` (for the unit tests and for reuse by the takeover handler in slice #11), and `buildDefaultReconcileDeps`. Internal constants: `MAX_RECONCILE_VERIFICATION_RETRIES = 3`.
- `adws/core/__tests__/remoteReconcile.test.ts` — the unit-test suite (target ~250 lines) using vitest, following the `spawnGate.test.ts` / `adwMerge.test.ts` pattern: construct minimal fakes via `vi.fn()`, assert observable return values and the shape of calls issued to injected readers.

## Implementation Plan

### Phase 1: Foundation
Narrow the surface of `WorkflowStage` and the shared PR-lookup helper so the new module compiles against stable types and does not duplicate the `findPRByBranch` logic.

- Add `'discarded'` to the `WorkflowStage` union in `adws/types/workflowTypes.ts`.
- Lift `RawPR` and `defaultFindPRByBranch` from `adws/adwMerge.tsx` into `adws/github/prApi.ts`, re-export from `adws/github/index.ts`, and rewrite `adws/adwMerge.tsx` to import them. Existing `adwMerge.test.ts` must continue to pass.

### Phase 2: Core Implementation
Author `adws/core/remoteReconcile.ts`:

- Declare `ReconcileDeps` as a `Readonly` interface with three fields: `readTopLevelState`, `branchExistsOnRemote`, `findPRByBranch`.
- Implement `mapArtifactsToStage(branchExists, pr): WorkflowStage | null` as a pure function returning `null` when the remote artifacts are insufficient (e.g. no branch) so the caller can fall back.
- Implement `deriveStageFromRemote(...)` per the Solution Statement, including the two-consecutive-agreeing-reads pattern and the bounded retry.
- Implement `buildDefaultReconcileDeps()` wiring `AgentStateManager.readTopLevelState`, a new thin `branchExistsOnRemote` helper that wraps `git ls-remote --exit-code origin <branch>` using `execWithRetry`, and the shared `defaultFindPRByBranch`.
- Re-export the public surface from `adws/core/index.ts`.

### Phase 3: Integration
This slice is integration-free by design — the PRD explicitly defers wiring into `takeoverHandler` to slice #11. Integration work in this slice is limited to:

- Verifying the barrel export from `adws/core/index.ts` makes `deriveStageFromRemote`, `ReconcileDeps`, and `mapArtifactsToStage` reachable via `import { ... } from '../core'`.
- Verifying `adwMerge.tsx` still compiles and its existing tests still pass after the `defaultFindPRByBranch` lift.

## Step by Step Tasks
Execute every step in order, top to bottom.

### Step 1: Widen `WorkflowStage` to include `'discarded'`
- Edit `adws/types/workflowTypes.ts` and append `| 'discarded'` to the `WorkflowStage` union, placed alongside `'abandoned'` in the "Terminal / handoff stages" section with a short trailing comment marker per existing convention.
- Run `bunx tsc --noEmit -p adws/tsconfig.json` to confirm no existing consumer breaks (the union is only read, never exhaustively switched-on in a way that would require a case to be added).

### Step 2: Lift `RawPR` and `defaultFindPRByBranch` into `adws/github/prApi.ts`
- In `adws/github/prApi.ts`, add an exported `RawPR` interface with the same shape currently in `adws/adwMerge.tsx` (`number`, `state`, `headRefName`, `baseRefName`, all `readonly`) and an exported `defaultFindPRByBranch(branchName: string, repoInfo: RepoInfo): RawPR | null` with the identical implementation (the `gh pr list --head ... --state all` call through `execWithRetry`).
- Re-export both from `adws/github/index.ts`.
- In `adws/adwMerge.tsx`, delete the local `RawPR` declaration and the local `defaultFindPRByBranch` definition; replace with `import { RawPR, defaultFindPRByBranch } from './github'`. Leave `MergeDeps.findPRByBranch` and its wiring unchanged.
- Run `bun run test:unit --run adws/__tests__/adwMerge.test.ts` to confirm the existing merge orchestrator tests still pass unchanged.

### Step 3: Create `adws/core/remoteReconcile.ts`
- Create the new file with a top-of-file docblock matching the style of `adws/core/agentState.ts` (one paragraph describing purpose and the read-your-write-lag rationale).
- Export the constant `MAX_RECONCILE_VERIFICATION_RETRIES = 3`.
- Export `interface ReconcileDeps` with three `readonly` fields:
  - `readTopLevelState: (adwId: string) => AgentState | null`
  - `branchExistsOnRemote: (branchName: string, repoInfo: RepoInfo) => boolean`
  - `findPRByBranch: (branchName: string, repoInfo: RepoInfo) => RawPR | null`
- Export a pure `mapArtifactsToStage(branchExists: boolean, pr: RawPR | null): WorkflowStage | null` implementing:
  - `!branchExists` → `null` (caller falls back to state file)
  - `branchExists && pr === null` → `'branch_created'`
  - `branchExists && pr.state === 'OPEN'` → `'awaiting_merge'`
  - `branchExists && pr.state === 'MERGED'` → `'completed'`
  - `branchExists && pr.state === 'CLOSED'` → `'discarded'`
  - any other `pr.state` → `null` (defensive: unknown PR state delegates to fallback).
- Implement `deriveStageFromRemote(issueNumber, adwId, repoInfo, deps?)` with the following control flow:
  1. Resolve `effectiveDeps = deps ?? buildDefaultReconcileDeps()`.
  2. `const state = effectiveDeps.readTopLevelState(adwId)`.
  3. `const branchName = state?.branchName`. If falsy, return `state?.workflowStage ?? 'starting'`.
  4. `const stateFallback: WorkflowStage = state?.workflowStage ?? 'starting'`.
  5. Perform an initial read → `prev = mapArtifactsToStage(effectiveDeps.branchExistsOnRemote(branchName, repoInfo), effectiveDeps.findPRByBranch(branchName, repoInfo))`.
  6. If `prev === null`, return `stateFallback`.
  7. Loop `MAX_RECONCILE_VERIFICATION_RETRIES + 1` times: re-read and compute `next`. If `next === prev`, return `prev`. Else set `prev = next` and continue. `next === null` also propagates via `prev` so a flip to "no branch" forces fallback.
  8. If the loop exits without two consecutive agreeing reads, return `stateFallback`.
- Implement `buildDefaultReconcileDeps(): ReconcileDeps` wiring:
  - `readTopLevelState: (id) => AgentStateManager.readTopLevelState(id)`
  - `branchExistsOnRemote: defaultBranchExistsOnRemote` — a local helper that calls `execWithRetry(\`git ls-remote --exit-code origin \${branchName}\`)` inside a try/catch; a thrown exit-code-2 means "not found" → return `false`; successful output → `true`; any other error is also mapped to `false` and logged via `log(..., 'warn')`.
  - `findPRByBranch: defaultFindPRByBranch` (the shared helper lifted in step 2).
- Keep the file under 300 lines per the guidelines. If it approaches the limit, extract `defaultBranchExistsOnRemote` into a small sibling file under `adws/core/` only if needed.

### Step 4: Re-export the module from `adws/core/index.ts`
- Append to `adws/core/index.ts`:
  - `export { deriveStageFromRemote, mapArtifactsToStage, MAX_RECONCILE_VERIFICATION_RETRIES, buildDefaultReconcileDeps } from './remoteReconcile';`
  - `export type { ReconcileDeps } from './remoteReconcile';`
- Run `bunx tsc --noEmit -p adws/tsconfig.json` to confirm no type break.

### Step 5: Author unit tests in `adws/core/__tests__/remoteReconcile.test.ts`
- Mirror the vitest style of `adws/triggers/__tests__/spawnGate.test.ts` and `adws/__tests__/adwMerge.test.ts`:
  - Import via `import { describe, it, expect, vi } from 'vitest'`.
  - A `makeDeps(overrides)` helper returning a fully-populated `ReconcileDeps` with `vi.fn()` defaults.
  - A `makeState(overrides)` helper producing a minimal `AgentState` with `branchName`, `adwId`, `issueNumber`, `agentName`, `execution`, and `workflowStage`.
  - A `makePR(overrides)` helper for `RawPR`.
- Cover each mapping branch of `mapArtifactsToStage` directly (pure-function tests) so the mapping contract is locked independently of the retry logic.
- Cover each mapping branch through the full `deriveStageFromRemote` public API with stable (non-flapping) deps, to lock the happy path:
  - branch-only → `'branch_created'`
  - branch + open PR → `'awaiting_merge'`
  - branch + merged PR → `'completed'`
  - branch + closed-unmerged PR → `'discarded'`
- Cover re-verification paths:
  - First read disagrees with second read, third read agrees with second — returns the converged value and issues exactly three read-pair invocations.
  - Reads never stabilize within `MAX_RECONCILE_VERIFICATION_RETRIES + 1` tries — falls back to `state.workflowStage` and does **not** throw.
  - Reads never stabilize and state has no `workflowStage` → returns `'starting'`.
- Cover state-file edge cases:
  - State file missing (`readTopLevelState → null`) → returns `'starting'` without issuing any GitHub reads.
  - State file present but `branchName` missing → returns `state.workflowStage` (or `'starting'`) without issuing any GitHub reads.
  - Branch does not exist on remote at all → falls back to `state.workflowStage`.
- Use `toHaveBeenCalledTimes` assertions to verify the retry loop actually issues the number of reads the contract requires, and that the short-circuit paths issue zero GitHub reads.

### Step 6: Verify `adwMerge.test.ts` still passes after the helper lift
- Run `bun run test:unit --run adws/__tests__/adwMerge.test.ts` and confirm no regressions. Existing tests inject a fake `findPRByBranch`, so they should be insensitive to the module-location change; only `buildDefaultDeps()` must continue to resolve the now-imported `defaultFindPRByBranch`.

### Step 7: Run full validation commands
Run every command listed in the Validation Commands section below and ensure each passes with zero errors.

## Testing Strategy

### Unit Tests
Per `.adw/project.md: ## Unit Tests: enabled`, unit tests are in scope for this slice.

Tests live in `adws/core/__tests__/remoteReconcile.test.ts`. They use vitest (already a dev dependency; `test:unit` script already defined). The suite is organized into four `describe` blocks, mirroring the shape of `adws/triggers/__tests__/spawnGate.test.ts`:

1. `mapArtifactsToStage` — pure mapping tests, one `it` per branch (`null` when no branch, `'branch_created'`, `'awaiting_merge'`, `'completed'`, `'discarded'`, `null` on unknown PR state).
2. `deriveStageFromRemote — happy path mappings` — one `it` per acceptance-criterion mapping using stable (non-flapping) injected deps. Asserts return value and that each read dep is called the expected number of times.
3. `deriveStageFromRemote — re-verification` — flap-then-converge, flap-forever (fall back to state-file), flap-forever-with-no-state-stage (fall back to `'starting'`).
4. `deriveStageFromRemote — state-file edges` — missing state file, state file without `branchName`, state file with `branchName` but remote branch does not exist.

All I/O is faked via `vi.fn()`; no real GitHub calls, no real file system, no `execSync`. The tests observe only the public return value and the count/args of injected dep invocations — no private state inspection, matching the testing-contract prior art in `spawnGate.test.ts` and `adwMerge.test.ts`.

### Edge Cases
- PR object present but with an unexpected `state` (anything other than `OPEN`/`MERGED`/`CLOSED`) — mapping returns `null`, caller falls back to state file.
- `readTopLevelState` returns `null` — module short-circuits to `'starting'` without calling any GitHub read (assert via `toHaveBeenCalledTimes(0)` on `branchExistsOnRemote` and `findPRByBranch`).
- `readTopLevelState` returns a state object whose `branchName` is the empty string — treated identically to missing `branchName`.
- GitHub reads throw inside the injected helper (not the module's concern; the default implementation of `branchExistsOnRemote` swallows and maps to `false`, tested via the default-deps wiring integration check).
- PR `state === 'MERGED'` on the first read but `state === 'OPEN'` on the second (read-your-write lag) — flap path; third read agreeing with the second returns the converged value.
- PR disappears between reads (`findPRByBranch` → `null` on the second read) — also a flap and exercises the `null`-propagation path in the retry loop.
- `MAX_RECONCILE_VERIFICATION_RETRIES` boundary: exactly `N+1` reads must be attempted and then fall back; verify by counting `findPRByBranch` invocations.

## Acceptance Criteria
- `adws/core/remoteReconcile.ts` exports `deriveStageFromRemote(issueNumber, adwId, repoInfo) → WorkflowStage` and is reachable via `import { deriveStageFromRemote } from '../core'`.
- Branch-only returns `'branch_created'` (the canonical pre-PR running stage in the existing `WorkflowStage` union).
- Branch + open PR returns `'awaiting_merge'`.
- Branch + merged PR returns `'completed'`.
- Branch + closed-unmerged PR returns `'discarded'` (the new `WorkflowStage` literal introduced by this slice).
- A re-verification read fires immediately before return; if it diverges from the first read, the function retries up to `MAX_RECONCILE_VERIFICATION_RETRIES` additional times.
- Post-retry persistent divergence returns `state.workflowStage` if present, else `'starting'` — the module never throws on divergence.
- All GitHub and state-file reads are injected through `ReconcileDeps`; the default wiring lives in `buildDefaultReconcileDeps()` and is exercised by the production call site only.
- Unit tests exist in `adws/core/__tests__/remoteReconcile.test.ts` covering every mapping branch, every re-verification path (converge / fall back to state / fall back to `'starting'`), every state-file edge case, and the boundary-condition read count.
- `bun run test:unit` is green with zero regressions in other suites (including `adwMerge.test.ts`).
- `bun run lint`, `bun run build`, and `bunx tsc --noEmit -p adws/tsconfig.json` pass with zero errors and zero warnings.
- The new source file is under 300 lines and follows every rule in `guidelines/coding_guidelines.md` (strict types, no `any`, pure core with injected I/O, declarative mapping, isolated side effects).

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `bun run lint` — ESLint passes on the new and modified files.
- `bunx tsc --noEmit` — root project type-check passes.
- `bunx tsc --noEmit -p adws/tsconfig.json` — ADW project type-check passes.
- `bun run build` — TypeScript build succeeds.
- `bun run test:unit` — full vitest suite is green; `remoteReconcile.test.ts` runs and passes.
- `bun run test:unit -- --run adws/core/__tests__/remoteReconcile.test.ts` — target the new suite explicitly and confirm every describe block is green.
- `bun run test:unit -- --run adws/__tests__/adwMerge.test.ts` — regression guard for the `defaultFindPRByBranch` lift.

## Notes
- **Adhere to `guidelines/coding_guidelines.md`**: strict TypeScript, no `any`, isolate side effects (all I/O behind injected deps), declarative mapping (use a switch-like expression, not nested `if`), `readonly` on the `ReconcileDeps` shape, keep the file under 300 lines.
- The parent PRD says the `WorkflowStage` extension to include `'discarded'` happens in the `agentState` extension slice. This slice adds the literal anyway because the acceptance criteria require the module to return `'discarded'`. Widening the union is backward-compatible; no call sites that switch on `WorkflowStage` exhaustively will break (none do today — grep confirms only creation / equality checks against specific literals).
- The `RawPR` / `defaultFindPRByBranch` lift from `adwMerge.tsx` into `adws/github/prApi.ts` is a pure relocation (no behavior change). It removes a duplication risk and gives `remoteReconcile` and `adwMerge` a single source of truth for "look up the PR for a branch."
- The module intentionally does **not** call out to `git fetch` or mutate the worktree. It is a pure read-derive-verify function; `worktreeReset` is the separate module responsible for local-state alignment (per the PRD).
- The `issueNumber` parameter is retained in the signature per the issue's acceptance criteria even though the current implementation does not use it directly — the parameter reserves the slot for future `commits-ahead-of-base` checks or issue-scoped remote reads described in the PRD (the "most-recent activity markers" and "commits ahead" hints). Keeping it avoids a signature migration when those checks land.
- If `bun install` is needed for any reason during this slice, use the command from `.adw/commands.md`: `bun add <package>`. This slice is expected to introduce zero new dependencies — all needed infrastructure (`vitest`, `execWithRetry`, `AgentStateManager`, `RepoInfo`) is already present.
- Follow-up slice (#11, per PRD): wire `deriveStageFromRemote` into `takeoverHandler`. That slice is out of scope here.

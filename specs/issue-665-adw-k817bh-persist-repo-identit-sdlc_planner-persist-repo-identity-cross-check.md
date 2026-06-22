# Feature: Persist repo identity into workflow state as a launch-boundary cross-check

## Metadata
issueNumber: `665`
adwId: `k817bh-persist-repo-identit`
issueJson: `{"number":665,"title":"Persist repo identity into workflow state as launch-boundary cross-check","body":"## Parent PRD\n\n`specs/prd/git-context-repo-authority.md` (see **Identity persistence** and **Testing Decisions §2**)\n\n## What to build\n\nExtend the top-level workflow state schema (`types/agentTypes.ts` `AgentState`) to carry repo identity (`owner/repo`), written at workflow initialization. The launch boundary remains the source of truth: a resuming process uses its own launch identity and reads persisted identity only as a **cross-check** — a divergence is surfaced as a detectable error, not silently resolved. No backfill migration: processes resuming pre-change workflows use their launch identity, so absence of the field on old state is harmless.\n\n## Acceptance criteria\n\n- [ ] Top-level state schema carries `owner/repo`, written at workflow init (story 13)\n- [ ] Round-trip: identity written at init is read back intact\n- [ ] A resumer prefers its launch identity and treats persisted identity as a cross-check (story 14)\n- [ ] A mismatch between persisted and launch identity is surfaced as an error, not silently resolved\n- [ ] Old state lacking the field still resumes correctly — no backfill required (story 15)\n\n## Blocked by\n\n- Blocked by #660\n\n## User stories addressed\n\n- User story 13\n- User story 14\n- User story 15"}`

## Feature Description
ADW runs against many repositories from one host: its own framework repo (self-hosted) and an arbitrary number of cloned *target* repos. The parent PRD (`specs/prd/git-context-repo-authority.md`) makes the **launch boundary** the single source of truth for "which repo am I operating on": each process constructs exactly one `GitContext` at startup from its already-authoritative launch identity (`--target-repo` args for cron/orchestrators, the local git remote for self-host). Issue #660 (the boundary constructor `buildLaunchGitContext`, now merged) delivered that constructor and threaded the resulting `gitContext` into `WorkflowConfig`.

This feature (PRD stories 13–15, "Identity persistence") closes the loop by **persisting the repo identity (`owner/repo`) into the top-level workflow state** at initialization, then using that persisted value strictly as a **cross-check** when a process resumes a workflow. The launch boundary stays authoritative: a resuming process always operates with its *own* launch identity, and the persisted value exists only to *detect* a divergence — surfacing it as a loud, typed error rather than silently operating on the wrong repo. Because persisted identity is never the source of truth, no backfill migration is needed: workflows started before this change simply have no persisted identity, and a resumer ignores the absence and proceeds on its launch identity.

The value: audits/tooling can see which repo a run belonged to from its state file, and — more importantly — the catastrophic "resumed against the wrong repository" failure mode the PRD was built to kill becomes *detectable at startup* instead of manifesting as silent wrong-repo mutations.

## User Story
As a resuming ADW process (cron takeover, standalone orchestrator, or merge handoff),
I want the repo identity persisted in workflow state to act as a cross-check against my own authoritative launch identity,
So that a divergence is surfaced as a detectable error instead of silently producing wrong-repo results, while pre-change workflows keep resuming correctly without any backfill.

## Problem Statement
Today the top-level workflow state (`agents/{adwId}/state.json`, typed by `AgentState`) records `adwId`, `issueNumber`, `branchName`, `pid`, lifecycle fields, and the `phases` map — but **not which repository the workflow belongs to**. Repo identity is re-derived at every resume from ambient sources. The PRD's central thesis is that re-derivation from ambient state is exactly what produced ~13 wrong-repo incidents. The launch boundary now carries authoritative identity (`gitContext.owner` / `gitContext.repo`), but nothing persists it, so:

- There is no durable record of which repo a run targeted (audits/tooling are blind).
- A resuming process has nothing to **cross-check** its launch identity against, so a launch-vs-prior-run identity divergence (a real split-brain / misrouting signal) cannot be detected — it would silently proceed.

## Solution Statement
1. **Extend the schema (story 13).** Add a `repoIdentity?: { owner; repo }` field to `AgentState`, and write it into the top-level state at workflow initialization, sourced from the **launch boundary** (`gitContext.owner`/`gitContext.repo`, with a graceful fallback to the already-resolved launch repo info when `gitContext` is unavailable in test fixtures). The field is optional so old state files remain valid.

2. **Cross-check on resume, launch wins (story 14).** Introduce a small **pure** module `repoIdentityCrossCheck.ts` exposing `crossCheckRepoIdentity(launch, persisted?)` and a typed `RepoIdentityMismatchError`. In `initializeWorkflow`, just before writing top-level state, read any prior persisted identity for this `adwId` and cross-check it against the launch identity. The write always stamps the **launch** identity (launch is preferred / authoritative); the persisted value is only ever *compared*, never *adopted*.

3. **Surface divergence as a detectable error.** A genuine mismatch (different owner or different repo, case-insensitively) throws `RepoIdentityMismatchError` — a distinct, catchable type whose message names both identities. It propagates out of `initializeWorkflow` as a fatal startup error (fail-closed): crashing before any worktree/`gh` work is strictly safer than operating on the wrong repo.

4. **No backfill (story 15).** When prior persisted identity is absent (`undefined`), the cross-check is a no-op and the resumer proceeds on its launch identity; the write then stamps identity going forward. Old state files (no `repoIdentity`) keep resuming exactly as before.

This mirrors established patterns: the optional `branchName`/`pid`/`pidStartedAt`/`lastSeenAt` additions to `AgentState`, the deep-merge `writeTopLevelState`/`readTopLevelState` round-trip, the pure-function-plus-typed-error idiom used across `core/` (e.g. `resolveVerdict.ts`, `resumePolicy.ts`), and the `RateLimitError`/`AuthRequiredError` typed-error convention.

## Relevant Files
Use these files to implement the feature:

- `adws/types/agentTypes.ts` — **modify.** Home of the `AgentState` interface (the top-level state schema). Add the `RepoIdentity` interface and the `repoIdentity?` field here, alongside the existing optional fields (`branchName`, `pid`, `pidStartedAt`, `lastSeenAt`).
- `adws/phases/workflowInit.ts` — **modify.** `initializeWorkflow()` builds the launch `gitContext` (line ~143), resolves the launch repo info as `resolvedRepoForAuth` (line ~137), and writes the top-level state via `AgentStateManager.writeTopLevelState(...)` (line ~314). This is where the launch identity is derived, the cross-check is invoked, and `repoIdentity` is persisted.
- `adws/core/agentState.ts` — **read-only context.** `AgentStateManager.writeTopLevelState` (shallow-merge top-level fields + atomic write) and `readTopLevelState` (parse, return `null` on missing/corrupt) already carry arbitrary `Partial<AgentState>` fields through unchanged; `repoIdentity` rides them with no code change. Confirms round-trip and merge behavior.
- `adws/core/launchGitContext.ts` — **read-only context.** `buildLaunchGitContext(targetRepo, deps)` constructs the launch `GitContext` from `targetRepo ?? getRepoInfo()`; the persisted identity must equal this boundary's `owner/repo`.
- `adws/gitContext/gitContext.ts` — **read-only context.** `GitContext` exposes `owner` / `repo` getters — the authoritative launch identity source for the persisted value and cross-check.
- `adws/gitContext/types.ts` — **read-only context.** Shows the existing `GitIdentity` (git author/committer) type — note the new `RepoIdentity` (repo `owner/repo`) is a *different* concept; name it to avoid confusion with `GitIdentity` and the provider `RepoIdentifier`.
- `adws/core/index.ts` — **modify.** Barrel that re-exports `agentState` and `launchGitContext` symbols consumed by `workflowInit.ts` via `from '../core'`. Add re-exports for the new `repoIdentityCrossCheck` module so `workflowInit.ts` imports it from `../core` consistently with its other imports.
- `adws/core/__tests__/topLevelState.test.ts` — **modify.** Existing unit suite for `writeTopLevelState`/`readTopLevelState` (round-trip, deep-merge, "reads a pre-461 state file missing fields without error"). Extend with `repoIdentity` round-trip, partial-patch preservation, and old-state-absence cases.
- `specs/prd/git-context-repo-authority.md` — **read-only context.** Parent PRD. "Identity persistence (cross-check, not source of truth)" decision and "Testing Decisions §2" define the exact contract this feature implements.

### Conditional Documentation
Per `.adw/conditional_docs.md`, these entries match this task (launch-boundary `GitContext`, `WorkflowConfig.gitContext`, and the top-level state schema) and must be read before implementing:

- `app_docs/feature-k2tkdn-gitcontext-boundary-constructor.md` — owns `adws/core/launchGitContext.ts`; conditions include "When constructing a `GitContext` at a process launch boundary (… `initializeWorkflow`)" and "When `WorkflowConfig.gitContext` is relevant in `workflowInit.ts`".
- `app_docs/feature-oqb76h-gitcontext-base-path-authority.md` — the `GitContext` deep-module (`owner`/`repo`/`basePath` authority); relevant because the persisted identity and cross-check read `gitContext.owner`/`gitContext.repo`.

### New Files
- `adws/core/repoIdentityCrossCheck.ts` — pure cross-check module. Exports:
  - `RepoIdentityMismatchError extends Error` — carries `launch` and `persisted` identities; `name = 'RepoIdentityMismatchError'`; message names both repos (detectable + diagnosable).
  - `crossCheckRepoIdentity(launch: RepoIdentity, persisted: RepoIdentity | undefined): void` — no-op when `persisted` is `undefined` (story 15); no-op when identities match case-insensitively; throws `RepoIdentityMismatchError` otherwise (story 14). Pure, no I/O.
  - (optional helper) `sameRepoIdentity(a, b): boolean` — case-insensitive `owner`+`repo` equality, used internally and unit-testable on its own.
- `adws/core/__tests__/repoIdentityCrossCheck.test.ts` — unit tests for the pure module.

## Implementation Plan
### Phase 1: Foundation
Extend the state schema and create the pure cross-check primitive — the two pieces with no dependency on the workflow wiring.
- Add `RepoIdentity` interface and `repoIdentity?` field to `AgentState` in `agentTypes.ts`.
- Create `adws/core/repoIdentityCrossCheck.ts` (`RepoIdentityMismatchError`, `crossCheckRepoIdentity`, `sameRepoIdentity`).
- Re-export the new module from `adws/core/index.ts`.

### Phase 2: Core Implementation
Wire persistence + cross-check into workflow initialization.
- In `initializeWorkflow()`, derive the launch identity from `gitContext` (fallback `resolvedRepoForAuth`).
- Read prior persisted top-level state for this `adwId`; cross-check against the launch identity (throws on divergence).
- Persist `repoIdentity` (the launch identity) in the existing `writeTopLevelState(...)` call.

### Phase 3: Integration
Verify the end-to-end contract and zero regressions.
- Unit tests for the pure module and the state round-trip/absence behavior.
- Type-check, lint, full unit suite, and build to confirm no regressions across the many `writeTopLevelState`/`AgentState` consumers.

## Step by Step Tasks
Execute every step in order, top to bottom.

### 1. Extend the `AgentState` schema with repo identity
- In `adws/types/agentTypes.ts`, add an exported interface immediately above `AgentState`:
  ```ts
  /**
   * Repository identity (owner/repo) for a workflow. Persisted into top-level
   * state at initialization as a launch-boundary cross-check — NOT a source of
   * truth. A resuming process always uses its own launch identity; this value
   * exists only to detect (not silently resolve) a divergence. Distinct from
   * GitIdentity (git author/committer) and the provider RepoIdentifier.
   */
  export interface RepoIdentity {
    /** GitHub owner (organisation or user). */
    owner: string;
    /** Repository name (without the owner prefix). */
    repo: string;
  }
  ```
- Add the optional field to `AgentState` (next to `branchName`/`pid`/`lastSeenAt`):
  ```ts
  /**
   * Repo identity (owner/repo) recorded at workflow init from the launch
   * boundary (GitContext). Read on resume as a cross-check only; the launch
   * boundary remains authoritative. Optional so pre-#665 state resumes without
   * backfill (story 15).
   */
  repoIdentity?: RepoIdentity;
  ```
- Keep the field optional — do **not** make it required (would break the no-backfill guarantee and existing `Partial<AgentState>` writers).

### 2. Create the pure cross-check module
- Create `adws/core/repoIdentityCrossCheck.ts`:
  - Import `RepoIdentity` from `../types/agentTypes` (consistent with `agentState.ts` importing types from `../types/agentTypes`).
  - `export class RepoIdentityMismatchError extends Error` with `readonly launch: RepoIdentity`, `readonly persisted: RepoIdentity`, `name = 'RepoIdentityMismatchError'`, and a message like `` `Repo identity mismatch: launch=${launch.owner}/${launch.repo} persisted=${persisted.owner}/${persisted.repo}. Launch boundary is authoritative; refusing to resume against a divergent repo.` `` (mirrors the `RateLimitError`/`AuthRequiredError` typed-error pattern in `agentTypes.ts`).
  - `export function sameRepoIdentity(a: RepoIdentity, b: RepoIdentity): boolean` — compare `owner` and `repo` case-insensitively (`toLowerCase()`), because GitHub repo identities are case-insensitive and a casing-only difference must **not** be treated as a mismatch (avoids stranding a workflow on a false positive).
  - `export function crossCheckRepoIdentity(launch: RepoIdentity, persisted: RepoIdentity | undefined): void`:
    - Guard clause: `if (!persisted) return;` — absent persisted identity is harmless (story 15).
    - `if (sameRepoIdentity(launch, persisted)) return;`
    - `throw new RepoIdentityMismatchError(launch, persisted);`
  - Keep the module pure (no fs, no logging, no `process.env`) so it is trivially unit-testable and reusable.

### 3. Re-export the new module from the core barrel
- In `adws/core/index.ts`, add near the `launchGitContext` re-export (line ~166):
  ```ts
  export { crossCheckRepoIdentity, sameRepoIdentity, RepoIdentityMismatchError } from './repoIdentityCrossCheck';
  ```
- This lets `workflowInit.ts` import the cross-check from `../core`, matching how it already imports `buildLaunchGitContext`, `AgentStateManager`, and `AgentState` from `../core`.

### 4. Persist identity and cross-check at workflow init
- In `adws/phases/workflowInit.ts`:
  - Add `crossCheckRepoIdentity` (and the `RepoIdentity` type) to the existing `from '../core'` import block.
  - Immediately **before** the `AgentStateManager.writeTopLevelState(resolvedAdwId, { ... })` call (currently line ~314), derive the launch identity and run the cross-check:
    ```ts
    // Launch boundary is authoritative for repo identity. Prefer the constructed
    // GitContext; fall back to the already-resolved launch repo info when the
    // context is unavailable (e.g. test fixtures with fake git remotes).
    const launchRepoIdentity: RepoIdentity = gitContext
      ? { owner: gitContext.owner, repo: gitContext.repo }
      : { owner: resolvedRepoForAuth.owner, repo: resolvedRepoForAuth.repo };

    // Cross-check (not source of truth): if a prior run persisted a divergent
    // identity for this adwId, fail closed rather than operate on the wrong repo.
    const priorTopLevel = AgentStateManager.readTopLevelState(resolvedAdwId);
    crossCheckRepoIdentity(launchRepoIdentity, priorTopLevel?.repoIdentity);
    ```
    (`resolvedRepoForAuth` is already in scope from line ~137; `gitContext` from line ~143.)
  - Add `repoIdentity` to the existing top-level write so the **launch** identity is always stamped (launch preferred over persisted):
    ```ts
    AgentStateManager.writeTopLevelState(resolvedAdwId, {
      adwId: resolvedAdwId,
      issueNumber,
      workflowStage: 'starting',
      orchestratorScript: deriveOrchestratorScript(orchestratorName),
      repoIdentity: launchRepoIdentity,
      // Conditionally include branchName so options.cwd path never clobbers a persisted name.
      ...(branchName ? { branchName } : {}),
    });
    ```
  - Do not add a `try/catch` around the cross-check: a `RepoIdentityMismatchError` must propagate. `initializeWorkflow` is awaited in each orchestrator `main()` *before* `runWithOrchestratorLifecycle`, so the throw fails the process loudly at startup with no workflow comment, no worktree mutation, and a distinct error type — exactly "surfaced as a detectable error, not silently resolved."

### 5. Unit tests — pure cross-check module
- Create `adws/core/__tests__/repoIdentityCrossCheck.test.ts` (mirror the `describe`/`it` style of `gitContext.test.ts` and `topLevelState.test.ts`):
  - `crossCheckRepoIdentity` with **equal** identities → does not throw.
  - With `persisted === undefined` → does not throw (story 15, no backfill).
  - With **case-only** difference (`Acme/WebApp` vs `acme/webapp`) → does not throw (case-insensitive).
  - With **different owner** → throws `RepoIdentityMismatchError`.
  - With **different repo** → throws `RepoIdentityMismatchError`.
  - Thrown error `instanceof RepoIdentityMismatchError` and message contains both `owner/repo` strings (detectable + diagnosable); `.launch`/`.persisted` fields populated.
  - `sameRepoIdentity` truth table: equal → `true`; case-only diff → `true`; owner diff → `false`; repo diff → `false`.

### 6. Unit tests — top-level state round-trip and absence
- Extend `adws/core/__tests__/topLevelState.test.ts`:
  - **Round-trip (story 13 + AC):** `writeTopLevelState(adwId, { adwId, issueNumber, repoIdentity: { owner: 'paysdoc', repo: 'AI_Dev_Workflow' } })` → `readTopLevelState(adwId)` returns `repoIdentity` intact (`owner` and `repo` equal).
  - **Partial-patch preservation:** write `repoIdentity`, then a later `writeTopLevelState` patching only `workflowStage` → `repoIdentity` survives unchanged (mirrors the existing "partial-patch write preserves unmodified new-schema fields" test).
  - **Old-state absence (story 15):** hand-write a state.json **without** `repoIdentity`, then `readTopLevelState` → returns non-null with `repoIdentity === undefined` and no error (mirrors the existing "reads a pre-461 state file missing pid/… without error" test).

### 7. Run the validation commands
- Run every command in the `Validation Commands` section below and confirm each exits zero with no new failures.

## Testing Strategy
### Unit Tests
`.adw/project.md` contains `## Unit Tests: enabled`, so unit tests are in scope. Framework: **vitest** (`bun run test:unit`).

- **`repoIdentityCrossCheck.test.ts` (new)** — exhaustively covers the pure decision logic, which is where stories 14 and 15 live: prefer launch identity, treat persisted as cross-check, no-op on absence, throw a typed detectable error on divergence, case-insensitive equality. This is the highest-value test surface (PRD Testing Decisions §2: "a resumer prefers its launch identity and treats persisted identity as a cross-check; a mismatch is surfaced rather than silently resolved").
- **`topLevelState.test.ts` (extended)** — covers the persistence round-trip (story 13 / "read back intact") and the no-backfill absence behavior (story 15) at the `AgentStateManager` boundary, reusing the established round-trip/merge/legacy-absence test patterns already in the file.

No new test for `initializeWorkflow` itself: it is an I/O-heavy boundary (Claude CLI pre-flight, git, GitHub) with no state-manager DI, and the PRD scopes "Identity persistence" testing to the round-trip + cross-check decision — both fully covered by the pure module and the state-manager suite. The end-to-end behavior is additionally validated by the per-issue BDD scenarios generated for `@adw-665` in the scenario phase.

### Edge Cases
- **Pre-#665 state (no `repoIdentity`):** resumes cleanly; cross-check no-ops; field gets stamped going forward (story 15).
- **Case-only identity difference** (`Owner/Repo` vs `owner/repo`): treated as the same repo — must **not** throw (GitHub identities are case-insensitive; a false positive would strand a valid resume).
- **`gitContext` unavailable** (test fixtures with fake remotes; `buildLaunchGitContext` threw and `gitContext` is `undefined`): launch identity falls back to `resolvedRepoForAuth` (`repoInfo ?? getRepoInfo()`), so persistence and cross-check still function.
- **Genuine mismatch** (different owner or repo): throws `RepoIdentityMismatchError` at startup, before any worktree/`gh` mutation (fail-closed).
- **Self-host vs target:** identical handling — self-host persists the framework's `owner/repo`; a mismatch there is equally meaningful.
- **Fresh run (no prior state):** `readTopLevelState` returns `null`, cross-check no-ops, identity is written for the first time.
- **Corrupt prior state.json:** `readTopLevelState` already returns `null` on parse failure → cross-check no-ops (no spurious throw from unrelated corruption).

## Acceptance Criteria
- `AgentState` carries an optional `repoIdentity` (`{ owner, repo }`); `initializeWorkflow` writes it into top-level state at init, sourced from the launch boundary (`gitContext`, fallback `resolvedRepoForAuth`) — story 13.
- Identity written at init is read back intact via `readTopLevelState` (round-trip).
- On resume, the process uses its **launch** identity for all work and only cross-checks the persisted value; the top-level write always stamps the launch identity — story 14.
- A divergence between persisted and launch identity throws the typed, catchable `RepoIdentityMismatchError` (message names both repos) at startup rather than silently resolving.
- A state file lacking `repoIdentity` resumes correctly with no error and no backfill — story 15.
- Case-only identity differences do **not** trigger a mismatch.
- `bun run lint`, `bunx tsc --noEmit -p adws/tsconfig.json`, `bun run test:unit`, and `bun run build` all pass with zero regressions.

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions. Commands are sourced from `.adw/commands.md`.

- `bun run lint` — Lint for code-quality issues across the change.
- `bunx tsc --noEmit -p adws/tsconfig.json` — Type-check the `adws/` project; proves the new `RepoIdentity`/`repoIdentity` types and the `workflowInit.ts` wiring compile and that no `AgentState` consumer regressed.
- `bunx tsc --noEmit` — Root type-check (additional check per `.adw/commands.md`).
- `bun run test:unit` — Full vitest unit suite; must pass including the new `repoIdentityCrossCheck.test.ts` and the extended `topLevelState.test.ts`, with zero regressions in the broader suite.
- `bun run build` — Build to verify no build errors.

Targeted runs while iterating (optional, faster feedback):
- `bunx vitest run adws/core/__tests__/repoIdentityCrossCheck.test.ts`
- `bunx vitest run adws/core/__tests__/topLevelState.test.ts`

## Notes
- **Coding guidelines** (`.adw/coding_guidelines.md`) are honored: the cross-check is a **pure** function with side effects isolated at the `initializeWorkflow` boundary (Purity); a **guard clause** handles the absent-persisted case first (Nesting & Extraction); the new file is well under the 300-line ceiling (Modularity); the field/type are explicit and optional (Type safety); and a typed `RepoIdentityMismatchError` provides a meaningful boundary error (Error handling). No decorators; no new dependencies (`bun add` not needed).
- **Launch wins, always.** The persisted value is *read for comparison only* and never adopted. The `writeTopLevelState` call unconditionally stamps the launch identity, so even a resume that passes the cross-check refreshes state to the launch identity — keeping the launch boundary the single source of truth (PRD: "cross-check, not source of truth").
- **Why fail-closed (throw) rather than warn.** The entire PRD exists to eliminate wrong-repo operation; a launch-vs-persisted divergence is precisely that signal. Throwing before any worktree/`gh` mutation is the safest "surfaced, not silently resolved" behavior. The error is a distinct type so future callers/tooling can catch and classify it.
- **Case-insensitive equality** is a deliberate decision: GitHub owners/repos are case-insensitive, so a casing-only difference is the *same* repository and must not strand a valid resume. Genuine owner/repo differences are still caught.
- **Naming.** `RepoIdentity` (`owner`/`repo`) is intentionally distinct from the existing `GitIdentity` (git author/committer, in `gitContext/types.ts`) and the provider `RepoIdentifier` (`owner`/`repo`/`platform`). Keeping a minimal local `RepoIdentity` in `agentTypes.ts` avoids coupling the state schema to provider types.
- **No new orchestrator wiring required.** Every orchestrator already routes through `initializeWorkflow`, so persistence + cross-check apply uniformly (SDLC, plan/build/test/review combos, chore, merge handoff, PR review) with a single change.
- **Future slices** in the GitContext PRD (per-command auth cutover, routing all worktree/branch/PR ops through the context, the CI guard) are out of scope here; this slice only adds identity persistence and the resume cross-check.

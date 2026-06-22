# Repo Identity Persistence & Launch-Boundary Cross-Check

## Overview

`adws/core/repoIdentityCrossCheck.ts` is a pure module that detects wrong-repo divergence at workflow startup by cross-checking the persisted `owner/repo` identity (written at initialization) against the authoritative launch-boundary identity. The launch boundary — not the persisted value — is always the source of truth; the persisted value exists solely to detect a mismatch rather than silently operating on the wrong repository. The `repoIdentity` field added to `AgentState` provides a durable per-run record of which repository a workflow targeted, enabling audits and enabling the cross-check on resume.

## Responsibilities

- Export `RepoIdentityMismatchError` — a typed, catchable error whose message names both the launch and persisted identities, thrown at startup before any worktree or `gh` mutation
- Export `crossCheckRepoIdentity(launch, persisted?)` — no-op when `persisted` is `undefined` (old state, no backfill needed); no-op when identities match case-insensitively; throws `RepoIdentityMismatchError` on genuine divergence (different owner or repo)
- Export `sameRepoIdentity(a, b)` — case-insensitive equality over `owner` + `repo` (GitHub identities are case-insensitive; casing-only differences must not strand a valid resume)
- Define `RepoIdentity` (`{ owner, repo }`) in `AgentState` as an optional field — keeping old state files valid without backfill
- Wire persistence and cross-check into `initializeWorkflow` in `adws/phases/workflowInit.ts`: read prior top-level state → cross-check → write the launch identity unconditionally into `AgentState.repoIdentity`

## Contracts & Invariants

- **Launch wins, always.** `writeTopLevelState` unconditionally stamps the launch identity; the persisted value is read for comparison only and never adopted as the operative identity
- A genuine mismatch throws `RepoIdentityMismatchError` — a distinct type; its `.launch` and `.persisted` fields are populated; `.name === 'RepoIdentityMismatchError'`
- Absent persisted identity (`undefined` / old state) → cross-check is a no-op; the first-ever write stamps identity going forward (story 15 / no backfill)
- Case-only identity differences (e.g., `Acme/WebApp` vs `acme/webapp`) are treated as equal and do **not** throw
- The cross-check happens inside `initializeWorkflow`, which is awaited in each orchestrator `main()` before `runWithOrchestratorLifecycle` — a throw fails the process at startup with no worktree creation and no GitHub side effects
- `repoIdentityCrossCheck.ts` is pure (no fs, no logging, no `process.env`) — trivially unit-testable and re-importable
- `RepoIdentity` is intentionally distinct from `GitIdentity` (git author/committer, in `gitContext/types.ts`) and from the provider `RepoIdentifier` (`owner/repo/platform`) — the state schema is not coupled to provider types

## Configuration

No configuration. All I/O seams live in the callers:

| Call site | Role |
|---|---|
| `initializeWorkflow` in `adws/phases/workflowInit.ts` | Derives `launchRepoIdentity` from `gitContext` (falls back to `resolvedRepoForAuth`), reads `priorTopLevel.repoIdentity`, calls `crossCheckRepoIdentity`, then writes `repoIdentity` into `writeTopLevelState` |
| `AgentStateManager.readTopLevelState` / `writeTopLevelState` | Round-trips `repoIdentity` unchanged through the deep-merge atomic writer (no code change needed — `Partial<AgentState>` carries it) |

## Gotchas

- **`gitContext` may be `undefined` in test fixtures.** `initializeWorkflow` wraps `buildLaunchGitContext` in a try/catch; when it throws (fake git remote), `gitContext` is `undefined` and the launch identity falls back to `resolvedRepoForAuth`. Persistence and cross-check still function.
- **Fresh run (no prior state).** `readTopLevelState` returns `null` → `priorTopLevel?.repoIdentity` is `undefined` → `crossCheckRepoIdentity` is a no-op → identity is written for the first time.
- **Corrupt prior `state.json`.** `readTopLevelState` returns `null` on parse failure → same no-op path as absent state; no spurious throw from unrelated corruption.
- **Every orchestrator is covered.** All orchestrators route through `initializeWorkflow`, so persistence + cross-check apply uniformly (SDLC, plan/build/test/review combos, chore, merge handoff, PR review) with the single change in `workflowInit.ts`.
- **No new orchestrator wiring required.** The `WorkflowConfig.gitContext` field added in the boundary-constructor slice (feature-k2tkdn) is already present; this slice reads it to derive the launch identity.
- **`RepoIdentityMismatchError` propagates, not caught.** Do not add a `try/catch` around `crossCheckRepoIdentity` in `initializeWorkflow` — fail-closed is the correct behavior; the error type is distinct so future tooling can catch and classify it specifically.

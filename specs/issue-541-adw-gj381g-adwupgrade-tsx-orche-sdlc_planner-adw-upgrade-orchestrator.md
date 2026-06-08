# Feature: `adwUpgrade.tsx` Standalone Upgrade Orchestrator

## Metadata
issueNumber: `541`
adwId: `gj381g-adwupgrade-tsx-orche`
issueJson: `{"number":541,"title":"adwUpgrade.tsx orchestrator","body":"## Parent PRD\n\n`specs/prd/adw-init-hash-and-label-classification.md`\n\n## What to build\n\nStandalone CLI-invocable orchestrator. Joins the `adwMerge.tsx` exception list — does NOT call `initializeWorkflow()`. Does minimal worktree setup, runs ```/adw_init.md``` via Claude CLI against the target worktree, recomputes the framework hash at runtime, commits the regenerated `.adw/` directory, writes the fresh hash to `.adw-version`, opens a PR linking the tracking issue. On LLM failure, posts a non-workflow comment (no ADW marker, not counted by concurrency guard) to the tracking issue and exits.\n\nSee the \"`adwUpgrade.tsx` orchestrator\" section of the parent PRD.\n\n## Acceptance criteria\n\n- [ ] CLI invocation `bunx tsx adws/adwUpgrade.tsx <issueNumber>` runs end-to-end against a target worktree\n- [ ] Recomputes framework hash at runtime (not pinned to a passed-in value)\n- [ ] PR shows two commits on the upgrade branch: the empty claim from `upgradeClaim` + the regen commit from this orchestrator\n- [ ] Writes `.adw-version` with the runtime-computed hash\n- [ ] On LLM failure, posts a non-workflow comment (no ADW marker) to the tracking issue and exits cleanly\n- [ ] Does NOT post a workflow comment on success — the PR opening is the success signal\n\n## Blocked by\n\n- Blocked by #537\n- Blocked by #538\n\n## User stories addressed\n\n- User story 7\n- User story 22","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-06-08T11:11:09Z","comments":[],"actionableComment":null}`

## Feature Description

`adwUpgrade.tsx` is a new, single-purpose ADW orchestrator that performs the actual regeneration half of the parent PRD's **versioned auto-(re)init system**. When any orchestrator detects that a target repo's stored `.adw-version` hash no longer matches the framework's current content hash, the upgrade-claim primitive (`claimUpgradeOrFindExisting`, already merged in `adws/core/upgradeClaim.ts`) atomically claims a dedicated `adw-upgrade-<hash>` branch and a tracking issue carrying the `adw:upgrade` label is created. `adwUpgrade.tsx` is the orchestrator that then checks out that claim branch, regenerates the target repo's `.adw/` directory by running `/adw_init` via the Claude CLI, recomputes the framework hash at runtime, writes that fresh hash to the target repo's `.adw-version`, commits both changes as a single regen commit on top of the empty claim commit, and opens a pull request linking the tracking issue.

Architecturally it is a sibling of `adwMerge.tsx`: it **joins the `adwMerge.tsx` exception list**, meaning it deliberately does *not* call `initializeWorkflow()` and therefore needs no recursive-spawn guard by construction (it can never re-trigger the hash check that would spawn another upgrade). It uses the low-level `runWithRawOrchestratorLifecycle` wrapper (lock → heartbeat → run → cleanup) exactly as `adwMerge.tsx` does, rather than the `WorkflowConfig`-based `runWithOrchestratorLifecycle`.

The value: framework changes to `/adw_init.md` (and its declared `hashInputs:` dependencies) propagate automatically to every target repo at the natural cadence of work, each upgrade landing as its own reviewable PR on its own tracking issue, with failures surfaced as a quiet non-workflow comment that does not pollute the concurrency count or the team's feature-issue noise.

## User Story

**User story 7:** As the framework operator, I want the upgrade work to happen as its own tracking issue with its own PR, so that the upgrade has a normal review lifecycle and shows up in the project board.

**User story 22:** As the framework operator, I want failed-init LLM errors to surface as a non-workflow comment on the upgrade tracking issue, so that the failure is visible without polluting the concurrency-count.

Combined:

As the framework operator,
I want a standalone orchestrator that regenerates a target repo's `.adw/` against the current framework version and opens a PR on a dedicated tracking issue (and quietly reports LLM failures without consuming a concurrency slot),
So that framework changes propagate automatically with a normal review lifecycle and upgrade failures stay visible but isolated from feature-issue noise.

## Problem Statement

The foundational primitives for the versioned auto-(re)init system are in place — `computeFrameworkHash` (#537, `adws/core/hashComputer.ts`), `readAdwVersion`/`writeAdwVersion` (#538, `adws/core/adwVersion.ts`), and `claimUpgradeOrFindExisting`/`buildClaimBranchName` (`adws/core/upgradeClaim.ts`). What is missing is the orchestrator that consumes them: the component that actually checks out the claimed upgrade branch, drives the LLM regeneration of `.adw/`, persists the fresh hash, and opens the upgrade PR. Without it, a winning claim produces an empty branch and a tracking issue that nothing ever advances — the upgrade can be *claimed* but never *performed*.

This orchestrator must also satisfy three subtle constraints that the parent PRD calls out explicitly:

1. **Runtime hash recomputation (PRD Q26).** The hash written to `.adw-version` must be computed fresh at the orchestrator's runtime, not pinned to the (possibly minutes-stale) value embedded in the claim branch name. The branch name is a claim *token* only.
2. **Concurrency-neutral failure (PRD Q22 / "Concurrency interaction").** An LLM regeneration failure must surface as a *non-workflow* comment — one that `isAdwComment()` (`adws/core/workflowCommentParsing.ts`) does **not** match — so that `concurrencyGuard.ts` does not count the failed upgrade as an in-progress issue.
3. **Silent success (acceptance criterion).** Success must produce **no** workflow comment on the tracking issue; the opened PR is the only success signal. The PR body must carry an `Implements #<issueNumber>` linkage so the tracking issue auto-closes on merge and `concurrencyGuard` recognizes the linked PR.

## Solution Statement

Create `adws/adwUpgrade.tsx` modeled directly on `adws/adwMerge.tsx`:

- A thin `main()` that parses CLI arguments (`<issueNumber> [adw-id] [--target-repo owner/repo] [--clone-url <url>]`), resolves `RepoInfo` and the base repo workspace, generates an `adwId` when one is not supplied, and runs the core logic inside `runWithRawOrchestratorLifecycle`.
- An exported, side-effect-injected core function `executeUpgrade(issueNumber, adwId, repoInfo, baseRepoPath, frameworkRepoRoot, deps)` that holds the orchestration decision logic and is unit-testable without network, filesystem, or LLM — mirroring `executeMerge` / `MergeDeps`.
- A `buildDefaultUpgradeDeps()` factory wiring the real implementations (`computeFrameworkHash`, `ensureWorktree`, the `/adw_init` Claude call, `writeAdwVersion`, `commitChanges`, `pushBranch`, provider `createPullRequest`, `commentOnIssue`).
- Two small pure helpers — `buildUpgradePrBody()` and `buildUpgradeFailureComment()` — that are directly unit-testable, with the failure-comment helper asserted to *not* satisfy `isAdwComment()`.

Core flow inside `executeUpgrade`:

1. `hash = deps.computeFrameworkHash(frameworkRepoRoot)` — fresh runtime hash (single source of truth for both branch name and `.adw-version`).
2. `branch = buildClaimBranchName(hash)` → `adw-upgrade-<hash>`.
3. `worktreePath = deps.ensureWorktree(branch, defaultBranch, baseRepoPath)` — checks out the **existing** remote claim branch (carrying A's empty claim commit). `ensureWorktree` → `createWorktree` already fetches and `git worktree add`s an existing remote branch, so the regen commit lands on top of the claim commit, producing the required two-commit PR.
4. Run `/adw_init` via the Claude CLI in `worktreePath`. On non-success → `deps.commentOnIssue(issueNumber, buildUpgradeFailureComment(...), repoInfo)` (non-workflow) and return `{ outcome: 'failed' }` — **no PR, no workflow comment**.
5. `deps.writeAdwVersion(worktreePath, hash)` — persist the runtime hash.
6. `deps.commitChanges('chore: regenerate .adw/ for framework upgrade <shortHash>', worktreePath)` — single regen commit containing regenerated `.adw/` + updated `.adw-version`.
7. `deps.pushBranch(branch, worktreePath)`.
8. `deps.createPullRequest({ title, body: buildUpgradePrBody(issueNumber, hash), sourceBranch: branch, targetBranch: defaultBranch, linkedIssueNumber: issueNumber })`.
9. Return `{ outcome: 'completed', prUrl }` — silent success.

Because `createPullRequest` (`adws/providers/github/githubCodeHost.ts`) writes the body verbatim and does **not** auto-inject issue linkage, `buildUpgradePrBody` must embed `Implements #<issueNumber>` explicitly.

## Relevant Files

Use these files to implement the feature:

- `adws/adwMerge.tsx` — **The canonical template.** Same exception-list orchestrator shape: `runWithRawOrchestratorLifecycle`, no `initializeWorkflow()`, exported `executeMerge` core + injectable `MergeDeps` + `buildDefaultDeps()` + thin `main()`. Mirror this structure exactly for `adwUpgrade.tsx`.
- `adws/adwInit.tsx` — Reference for the `/adw_init` invocation: how `runClaudeAgentWithCommand('/adw_init', [issueNumber, adwId, issueJson, frameworkRepoRoot], 'adw-init', logPath, 'sonnet', …, worktreePath)` is called, and how `frameworkRepoRoot` is resolved via `fileURLToPath(import.meta.url)`. (Note: this legacy orchestrator is slated for deletion by a *separate* PRD slice (#30) — do **not** delete it in this issue.)
- `adws/core/upgradeClaim.ts` — Provides `buildClaimBranchName(hash)` (→ `adw-upgrade-<hash>`). The branch this orchestrator checks out. Already merged.
- `adws/core/hashComputer.ts` — Provides `computeFrameworkHash(frameworkRepoRoot)` for the runtime hash recomputation. Already merged (#537).
- `adws/core/adwVersion.ts` — Provides `writeAdwVersion(worktreePath, hash)` for the `.adw-version` write-back. Already merged (#538).
- `adws/phases/orchestratorLock.ts` — Provides `runWithRawOrchestratorLifecycle(repoInfo, issueNumber, adwId, fn)` — the lock/heartbeat/cleanup wrapper for non-`WorkflowConfig` orchestrators.
- `adws/vcs/worktreeCreation.ts` — Provides `ensureWorktree(branchName, baseBranch, baseRepoPath)`; confirms existing-remote-branch checkout semantics (fetch + `git worktree add <path> <branch>`), which is what guarantees the two-commit PR.
- `adws/vcs/commitOperations.ts` — Provides `commitChanges(message, cwd)` (returns `false` when nothing to commit) and `pushBranch(branchName, cwd)`.
- `adws/providers/github/githubCodeHost.ts` — `createPullRequest(options)` writes `options.body` verbatim and reuses an existing PR for the branch if present; confirms `Implements #N` must be authored into the body.
- `adws/providers/repoContext.ts` — `createRepoContext({ repoId, cwd: worktreePath })` validates the worktree's git remote and yields `codeHost.createPullRequest(...)`; the provider-consistent way to open the PR. (`createGitHubCodeHost(repoId)` is the simpler GitHub-only fallback.)
- `adws/core/workflowCommentParsing.ts` — `isAdwComment()`, `ADW_COMMENT_PATTERN` (`/^## :[a-z_]+: /m`), `ADW_SIGNATURE_PATTERN` (`/<!-- adw-bot -->/`). The failure comment must match **neither**. Import `isAdwComment` in the unit test to assert the failure comment is non-workflow.
- `adws/triggers/concurrencyGuard.ts` — Shows *why* the failure comment must be non-workflow: `getInProgressIssueCount` counts issues whose comments satisfy `isAdwComment` and that lack a linked merged/closed PR (`Implements #N`).
- `adws/github/issueApi.ts` (via `adws/github` barrel) — `commentOnIssue(issueNumber, body, repoInfo)` for posting the failure comment.
- `adws/core/orchestratorCli.ts` — `parseOrchestratorArguments` (returns `adwId: string | null`) and `parseTargetRepoArgs`; `generateAdwId(summary?)` (`adws/core/adwId.ts`) to mint an id when the CLI omits one.
- `adws/core/index.ts`, `adws/vcs/index.ts`, `adws/github/index.ts`, `adws/agents/index.ts`, `adws/providers/index.ts` — Barrels confirming every symbol above is exported (`computeFrameworkHash`, `buildClaimBranchName`, `writeAdwVersion`, `ensureTargetRepoWorkspace`, `buildRepoIdentifier`, `ensureLogsDirectory`, `commitChanges`, `pushBranch`, `commentOnIssue`, etc.).
- `adws/__tests__/adwMerge.test.ts` — The dependency-injection unit-test pattern to mirror for `adwUpgrade`'s tests.
- `specs/prd/adw-init-hash-and-label-classification.md` — Parent PRD; the "`adwUpgrade.tsx` orchestrator", "Upgrade claim primitive", "Concurrency interaction", and "Recursive-churn behavior" sections govern the design decisions above.
- `app_docs/feature-n9880l-adwversion-read-write-module.md` — **Conditional doc (matches: "implementing the … `adwUpgrade.tsx` write-back", "versioned auto-(re)init system").** Documents `.adw-version` read/write semantics and confirms `adwUpgrade.tsx` is its intended write-back consumer.
- `app_docs/feature-6wnymj-shared-orchestrator-lifecycle-wrapper.md` — **Conditional doc (matches: "adding a new orchestrator entrypoint that needs lock, heartbeat, and cleanup wiring").** Explains `runWithRawOrchestratorLifecycle` and why `process.exit` inside `fn` skips the `finally` lock release (relevant to the failure-exit path).
- `app_docs/feature-dcy9qz-merge-orchestrator-cron-handoff.md` — Supporting reference for how an exception-list orchestrator (`adwMerge`) is structured and where `deriveOrchestratorScript()` would later map a new orchestrator (forward-compat note only; out of scope here).

### New Files

- `adws/adwUpgrade.tsx` — The new orchestrator: `main()`, exported `executeUpgrade()`, `UpgradeDeps` interface, `buildDefaultUpgradeDeps()`, and pure helpers `buildUpgradePrBody()` / `buildUpgradeFailureComment()`.
- `adws/__tests__/adwUpgrade.test.ts` — Vitest unit suite over `executeUpgrade` (injected deps) and the two pure helpers.
- `features/per-issue/feature-541.feature` — Per-issue BDD scenarios (agent-input only; never executed by the runner) covering the acceptance criteria.
- `features/per-issue/step_definitions/feature-541.steps.ts` — Step definitions for the per-issue scenarios.

## Implementation Plan

### Phase 1: Foundation
Confirm the consumed primitives are present and exported (they are): `computeFrameworkHash` (#537), `readAdwVersion`/`writeAdwVersion` (#538), `claimUpgradeOrFindExisting`/`buildClaimBranchName`. Establish the orchestrator skeleton and the injectable-deps seam by copying the structural shape of `adwMerge.tsx`: a thin `main()`, an exported core function with a `Deps` interface, and a `buildDefaultUpgradeDeps()` factory. No behavior yet — just the types, the lifecycle wrapper wiring, and argument parsing.

### Phase 2: Core Implementation
Implement `executeUpgrade` orchestration: runtime hash recomputation → claim-branch derivation → existing-branch worktree checkout → `/adw_init` Claude invocation → `.adw-version` write → single regen commit → push → PR open. Implement the two pure helpers (`buildUpgradePrBody`, `buildUpgradeFailureComment`). Wire the LLM-failure branch to post the non-workflow comment and return cleanly without opening a PR or posting a workflow comment. Wire the success branch to open the PR and return without any workflow comment.

### Phase 3: Integration
Wire `buildDefaultUpgradeDeps()` to the real modules and confirm the end-to-end CLI path (`bunx tsx adws/adwUpgrade.tsx <issueNumber> [--target-repo owner/repo]`) composes correctly. Add the BDD per-issue scenarios. Run the full validation suite (lint, type-check, unit tests, build) for zero regressions. **Forward-compat note (out of scope for this issue):** the orchestrator that actually *spawns* `adwUpgrade` (the `initializeWorkflow()` hash-check, a separate PRD slice) will register an `upgrade-orchestrator` → `adwUpgrade` mapping in `deriveOrchestratorScript()` and an `OrchestratorId.Upgrade` constant. This issue intentionally does **not** add those, to keep `adwUpgrade` a clean standalone CLI orchestrator and avoid unused-symbol churn.

## Step by Step Tasks

### Task 1 — Scaffold `adws/adwUpgrade.tsx` (skeleton + types)
- Create `adws/adwUpgrade.tsx` with the shebang/header doc comment in the style of `adwMerge.tsx`, documenting the usage line and the "does NOT call `initializeWorkflow()`" exception-list note.
- Define `UpgradeRunResult` (`{ readonly outcome: 'completed' | 'failed'; readonly reason: string; readonly prUrl?: string }`).
- Define `UpgradeDeps` with one field per side effect: `computeFrameworkHash(frameworkRepoRoot) => string`, `ensureWorktree(branch, baseBranch, baseRepoPath) => string`, `getDefaultBranch(cwd) => string`, `runInitCommand(args) => Promise<{ success: boolean; error?: string }>`, `writeAdwVersion(worktreePath, hash) => void`, `commitChanges(message, cwd) => boolean`, `pushBranch(branch, cwd) => void`, `createPullRequest(options) => { url: string; number: number }`, `commentOnIssue(issueNumber, body, repoInfo) => void`, `ensureLogsDirectory(adwId) => string`, `log`.
- Import the confirmed symbols from `./core`, `./vcs`, `./github`, `./agents`, `./providers`, and `./phases/orchestratorLock`.

### Task 2 — Implement the pure helpers
- `buildUpgradePrBody(issueNumber: number, hash: string): string` — returns a PR body that **begins** with `Implements #${issueNumber}` (required for auto-close + `concurrencyGuard` linked-PR detection) followed by a short description and the full framework `hash`.
- `buildUpgradePrTitle(hash: string): string` — e.g. `` `chore: upgrade ADW framework config (${hash.slice(0, 12)})` ``.
- `buildUpgradeFailureComment(reason: string, adwId: string, issueNumber: number): string` — a **non-workflow** comment: no line may start with `## :emoji:` and the body must not contain `<!-- adw-bot -->`. Include the failure reason and the re-run command. This guarantees `isAdwComment(body) === false`.

### Task 3 — Implement `executeUpgrade` core orchestration
- Signature: `export async function executeUpgrade(issueNumber: number, adwId: string, repoInfo: RepoInfo, baseRepoPath: string, frameworkRepoRoot: string, deps: UpgradeDeps): Promise<UpgradeRunResult>`.
- Compute `hash = deps.computeFrameworkHash(frameworkRepoRoot)` (single runtime hash for both branch name and `.adw-version`); guard: on empty/throw, post failure comment and return `{ outcome: 'failed', reason: 'hash_error' }`.
- `branch = buildClaimBranchName(hash)`.
- `worktreePath = deps.ensureWorktree(branch, deps.getDefaultBranch(baseRepoPath), baseRepoPath)` inside try/catch; on error → failure comment + `{ outcome: 'failed', reason: 'worktree_error' }`.
- Build `issueJson` (`{ number, title, body }` — title/body may be empty for the tracking issue; the orchestrator does not need to fetch them) and `logsDir = deps.ensureLogsDirectory(adwId)`. Run `deps.runInitCommand(...)` (the `/adw_init` Claude call, cwd = `worktreePath`, model `sonnet`, log to `${logsDir}/adw-upgrade-init.jsonl`).
- **LLM failure branch:** if `!result.success` → `deps.commentOnIssue(issueNumber, buildUpgradeFailureComment(result.error ?? 'unknown', adwId, issueNumber), repoInfo)`; return `{ outcome: 'failed', reason: 'llm_failed' }`. Do **not** write `.adw-version`, commit, push, or open a PR. Do **not** post any workflow comment.
- **Success branch:** `deps.writeAdwVersion(worktreePath, hash)` → `deps.commitChanges('chore: regenerate .adw/ for framework upgrade ' + hash.slice(0, 12), worktreePath)` → `deps.pushBranch(branch, worktreePath)` → `pr = deps.createPullRequest({ title: buildUpgradePrTitle(hash), body: buildUpgradePrBody(issueNumber, hash), sourceBranch: branch, targetBranch: deps.getDefaultBranch(worktreePath), linkedIssueNumber: issueNumber })`.
- Return `{ outcome: 'completed', reason: 'pr_opened', prUrl: pr.url }`. Post **no** workflow comment.
- Use guard clauses / early returns throughout (coding-guideline nesting discipline, max depth ~2); keep the file under 300 lines (extract helpers if needed).

### Task 4 — Implement `buildDefaultUpgradeDeps()`
- Wire each `UpgradeDeps` field to its real implementation: `computeFrameworkHash` from `./core`; `ensureWorktree`, `pushBranch`, `commitChanges` from `./vcs`; `getDefaultBranch` from `./vcs/branchOperations`; `writeAdwVersion` from `./core`; `commentOnIssue` from `./github`; `ensureLogsDirectory` from `./core`; `log` from `./core`.
- `runInitCommand`: wrap `runClaudeAgentWithCommand('/adw_init', [String(issueNumber), adwId, issueJson, frameworkRepoRoot], 'adw-upgrade', logPath, 'sonnet', undefined, undefined, undefined, worktreePath)` and map to `{ success, error }`.
- `createPullRequest`: build the code host via `createRepoContext({ repoId, cwd: worktreePath }).codeHost.createPullRequest(...)` (provider-consistent; validates the worktree remote). Pass `repoId` through from `main()`.

### Task 5 — Implement `main()` entry point
- Parse args with `parseTargetRepoArgs` + `parseOrchestratorArguments` (usage: `<issueNumber> [adw-id] [--target-repo owner/repo] [--clone-url <url>]`, `supportsCwd: false`, `supportsIssueType: false`).
- `const adwId = parsedAdwId ?? generateAdwId('adwupgrade')` — mint an id when the CLI omits one (acceptance criterion CLI form is `bunx tsx adws/adwUpgrade.tsx <issueNumber>`).
- `repoId = buildRepoIdentifier(targetRepo)`; `repoInfo = { owner: repoId.owner, repo: repoId.repo }`.
- `baseRepoPath = targetRepo ? ensureTargetRepoWorkspace(targetRepo) : process.cwd()` (mirrors `adwMerge`).
- `frameworkRepoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')` (mirrors `adwInit`).
- Run inside `runWithRawOrchestratorLifecycle(repoInfo, issueNumber, adwId, async () => { result = await executeUpgrade(issueNumber, adwId, repoInfo, baseRepoPath, frameworkRepoRoot, buildDefaultUpgradeDeps(repoId)); })`; if the lock was not acquired, log and `process.exit(0)`.
- Exit code: `process.exit(result?.outcome === 'completed' ? 0 : 1)`. Guard `main()` behind `if (import.meta.url === \`file://${process.argv[1]}\`)` so importing the module in tests does not execute it.

### Task 6 — Unit tests (`adws/__tests__/adwUpgrade.test.ts`)
- Mirror the `adwMerge.test.ts` injected-deps style; build a `makeDeps(overrides)` helper returning a fully-stubbed `UpgradeDeps` with spy counters.
- **Success path:** all deps succeed → `outcome === 'completed'`; `createPullRequest` called exactly once with a body satisfying `/Implements #<issueNumber>/`; `commentOnIssue` **never** called; `writeAdwVersion` called with the value returned by `computeFrameworkHash` (asserts runtime recomputation, not a passed-in value).
- **Branch derivation:** `ensureWorktree` called with `adw-upgrade-<hash>` (assert against `buildClaimBranchName(hash)`).
- **LLM failure path:** `runInitCommand` returns `{ success: false, error }` → `outcome === 'failed'`; `commentOnIssue` called once; `createPullRequest`, `writeAdwVersion`, `commitChanges`, `pushBranch` **never** called.
- **Non-workflow comment guard:** assert `isAdwComment(buildUpgradeFailureComment(...)) === false` (import `isAdwComment` from `../core/workflowCommentParsing`).
- **PR body helper:** assert `buildUpgradePrBody(N, hash)` contains `Implements #N` and the full `hash`.
- **Worktree error path:** `ensureWorktree` throws → `outcome === 'failed'`, failure comment posted, no PR.

### Task 7 — BDD per-issue scenarios
- Create `features/per-issue/feature-541.feature` tagged `@adw-541` with scenarios for: (a) successful upgrade opens a PR linking the tracking issue and posts no workflow comment; (b) the regen commit lands on top of the claim commit (two commits on the branch); (c) `.adw-version` contains the runtime-computed hash; (d) LLM failure posts a non-workflow comment and opens no PR.
- Create `features/per-issue/step_definitions/feature-541.steps.ts`. Author phrasing against the regression vocabulary registry where applicable; assert on observable outcomes (PR opened, comment classification, `.adw-version` content), not on source-file structure.

### Task 8 — Validate
- Run every command in the **Validation Commands** section below and confirm zero errors and zero regressions.

## Testing Strategy

### Unit Tests
`.adw/project.md` declares `## Unit Tests: enabled`, so unit tests are in scope.

Per the parent PRD's testing decisions, `adwUpgrade.tsx` is "shallow composition … integration-level smoke testing only" for its *I/O wiring*. We therefore unit-test the **decision logic and pure helpers** in isolation via dependency injection (the established `executeMerge` / `MergeDeps` pattern), not the real LLM/network/git side effects:

- `executeUpgrade` success path: PR opened with `Implements #<n>` body; no `commentOnIssue`; `writeAdwVersion` receives the `computeFrameworkHash` result (runtime-recompute assertion).
- `executeUpgrade` LLM-failure path: non-workflow `commentOnIssue` posted; no PR, no `.adw-version` write, no commit/push.
- `executeUpgrade` worktree-error path: failure comment posted; no PR.
- Branch-name derivation equals `buildClaimBranchName(hash)`.
- `buildUpgradeFailureComment(...)` is **not** an ADW comment (`isAdwComment(...) === false`) — the load-bearing concurrency-guard guarantee.
- `buildUpgradePrBody(...)` embeds `Implements #<issueNumber>` and the full hash.

All tests use injected stub deps — no real filesystem, git, GitHub, or Claude CLI. Tests live in `adws/__tests__/adwUpgrade.test.ts` (Vitest), consistent with `adws/__tests__/adwMerge.test.ts`.

### Edge Cases
- **Runtime hash drifts from the claim branch name** (framework hash advanced between A's claim and this run): accepted per PRD Q26/Q32 "recursive-churn". This orchestrator always uses its own runtime hash; in the rare drift case the derived branch may not match A's pushed branch — document the behavior; do not engineer around it.
- **Regeneration produces no diff** (`.adw/` already current): `commitChanges` returns `false`. Decide and document: proceed to push + PR regardless (the empty claim commit still anchors the PR), or short-circuit to `{ outcome: 'completed', reason: 'noop' }`. Recommended: treat a `false` from `commitChanges` as "nothing new to regenerate" but still ensure a PR exists (idempotent — `createPullRequest` reuses an existing PR for the branch).
- **PR already exists for the branch** (re-run after a partial failure): `githubCodeHost.createPullRequest` already reuses the existing PR — idempotent, no duplicate.
- **`adwId` omitted on the CLI:** `main()` mints one via `generateAdwId`.
- **No `--target-repo` (self-hosting against the framework repo itself):** `baseRepoPath = process.cwd()`, exactly as `adwMerge`.
- **Failure comment must never accidentally become an ADW comment:** covered by the `isAdwComment` unit assertion; if the heading style is ever changed, the test fails loudly.

## Acceptance Criteria
- CLI invocation `bunx tsx adws/adwUpgrade.tsx <issueNumber>` runs end-to-end against a target worktree (and `… <issueNumber> [adw-id] --target-repo owner/repo` for external targets).
- The framework hash is recomputed at runtime via `computeFrameworkHash(frameworkRepoRoot)` and is the value written to `.adw-version` — not a passed-in/branch-name-pinned value.
- The upgrade PR shows two commits on `adw-upgrade-<hash>`: the empty claim commit (from `upgradeClaim`) + the single regen commit from this orchestrator.
- `.adw-version` at the target worktree root contains the runtime-computed hash (+ trailing newline, via `writeAdwVersion`).
- On `/adw_init` LLM failure, a non-workflow comment (for which `isAdwComment()` returns `false`) is posted to the tracking issue and the orchestrator exits cleanly (non-zero exit code, no PR, no workflow comment).
- On success, **no** workflow comment is posted to the tracking issue; the opened PR (body containing `Implements #<issueNumber>`) is the sole success signal.
- The orchestrator does not call `initializeWorkflow()` and uses `runWithRawOrchestratorLifecycle`.
- `bun run lint`, both `tsc --noEmit` checks, `bun run test:unit`, and `bun run build` all pass with zero regressions.

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions. Project-specific commands are taken from `.adw/commands.md`.

- `bun run lint` — ESLint must pass with no errors.
- `bunx tsc --noEmit` — Root type-check passes.
- `bunx tsc --noEmit -p adws/tsconfig.json` — `adws/` type-check passes (the `## Additional Type Checks` from `.adw/commands.md`).
- `bunx vitest run adws/__tests__/adwUpgrade.test.ts` — The new unit suite passes (every branch of `executeUpgrade` + both pure helpers).
- `bun run test:unit` — Full unit suite passes (zero regressions across the repo).
- `bun run build` — Build completes with no errors.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — Regression BDD suite stays green (confirms no orchestrator-wide regression).
- End-to-end smoke (manual / integration, requires a real target repo + Claude CLI + a pre-pushed `adw-upgrade-<hash>` claim branch and tracking issue): `bunx tsx adws/adwUpgrade.tsx <trackingIssueNumber> --target-repo <owner/repo>` → assert (1) a PR opens linking the issue with two commits on the branch, (2) `.adw-version` on the branch equals the runtime hash, (3) no workflow comment on the issue; then with a forced `/adw_init` failure → assert a single non-workflow comment and no PR.

## Notes
- **Coding guidelines (`.adw/coding_guidelines.md`):** strict-mode TypeScript, no `any`, explicit types/interfaces, guard clauses over nested conditionals (max depth ~2), pure functions isolated from side effects (the `UpgradeDeps` seam exists precisely for this), files under 300 lines, immutable data, JSDoc on the exported surface. The pure helpers (`buildUpgradePrBody`, `buildUpgradeFailureComment`, `buildUpgradePrTitle`) keep formatting logic side-effect-free and directly testable.
- **No new libraries required.** Everything composes from existing modules. (If one were needed, the install command per `.adw/commands.md` is `bun add <package>`.)
- **Exception-list membership is structural, not a registry edit.** "Joins the `adwMerge.tsx` exception list" means: does not call `initializeWorkflow()` and uses `runWithRawOrchestratorLifecycle`. There is no literal list to append to.
- **Do not delete `adwInit.tsx` in this issue.** Its removal is a separate PRD slice (#30, "Files to delete"). Deleting it here would break the legacy `/adw_init` orchestrator path before its replacement is wired.
- **Do not modify `deriveOrchestratorScript()` / `OrchestratorId` in this issue.** The cron/handoff spawn wiring belongs to the `initializeWorkflow()` hash-check slice that *invokes* `adwUpgrade`. Adding an unused `OrchestratorId.Upgrade` here would be dead code. Recorded as forward-compat work for that slice.
- **Rate-limit / auth pause is out of scope.** Per the acceptance criteria, any `/adw_init` non-success (including transient rate-limit) is treated as an LLM failure → non-workflow comment + clean exit. Participating in the pause/resume queue (as `adwInit` does via `AuthRequiredError`/`handleAuthRequiredPause`) is a future enhancement, not required here.
- **Provider-agnostic PR open.** Using `createRepoContext({ repoId, cwd: worktreePath }).codeHost.createPullRequest(...)` keeps the orchestrator aligned with the GitHub/GitLab provider abstraction; `createGitHubCodeHost(repoId)` is an acceptable GitHub-only simplification if RepoContext validation proves awkward against a freshly-created worktree.
- **Why the failure comment shape matters:** `concurrencyGuard.getInProgressIssueCount` counts an issue as in-progress iff one of its comments satisfies `isAdwComment` AND it has no linked merged/closed PR. A failed upgrade must therefore avoid both `^## :emoji: ` headings and the `<!-- adw-bot -->` signature so it is not counted — directly serving user story 22.

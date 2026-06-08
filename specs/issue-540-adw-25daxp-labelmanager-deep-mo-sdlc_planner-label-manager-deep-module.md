# Feature: labelManager deep module

## Metadata
issueNumber: `540`
adwId: `25daxp-labelmanager-deep-mo`
issueJson: `{"number":540,"title":"labelManager deep module","body":"## Parent PRD\n\n`specs/prd/adw-init-hash-and-label-classification.md`\n\n## What to build\n\nManages the six `adw:*` labels on target repos: `adw:chore`, `adw:bug`, `adw:feature`, `adw:pr_review`, `adw:upgrade`, `adw:none`. Idempotent pre-create on first contact with a new target; lazy-create when `applyLabel` fails with \"not found\"; read-and-classify the `labels[]` on an issue to return `{optOut, classification, conflict}`.\n\nSee \"Label lifecycle management\" and \"Label-based classification\" sections of the parent PRD.\n\n## Acceptance criteria\n\n- [ ] `ensureAdwLabelsExist(repoInfo)` creates all six labels and is idempotent\n- [ ] `applyLabel(issueNumber, label, repoInfo)` succeeds on existing label\n- [ ] `applyLabel` lazy-creates and retries when the label is missing\n- [ ] `readAdwLabels(issue)` correctly classifies zero/one/multiple `adw:<type>` labels, with or without `adw:none`\n- [ ] Unit tests cover all branches of the `readAdwLabels` shape\n\n## Blocked by\n\nNone - can start immediately\n\n## User stories addressed\n\n- User story 17\n- User story 18","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-06-08T11:10:54Z","comments":[],"actionableComment":null}`

## Feature Description

`labelManager` is a new deep module that owns the lifecycle of the six `adw:*` labels ADW relies on for label-based issue classification, and the pure read-side that interprets the labels present on an issue. It is the single source of truth for:

1. **Label provisioning** — `ensureAdwLabelsExist(repoInfo)` idempotently pre-creates all six `adw:*` labels (`adw:chore`, `adw:bug`, `adw:feature`, `adw:pr_review`, `adw:upgrade`, `adw:none`) on a target repo, so the operator never has to hand-create them on every new target (User Story 17).
2. **Resilient label application** — `applyLabel(issueNumber, label, repoInfo)` adds a label to an issue and, if the label has been deleted by a human (so the `gh` call fails with "not found"), lazy-recreates the label and retries, so ADW does not silently break on `label-not-found` (User Story 18).
3. **Label-based classification (read side)** — `readAdwLabels(issue)` is a pure function that inspects an issue's `labels[]` and returns `{ optOut, classification, conflict }`, the structured signal that downstream routing (the webhook `issues.opened` handler, `initializeWorkflow()`, the CRON recovery scan) consumes to decide whether to skip the issue (`adw:none`), trust an explicit label, refuse a multi-label conflict, or fall back to the LLM classifier.

The module is the foundational primitive for the broader "label-based classification" redesign in the parent PRD. This issue delivers the module and its unit tests as an independently-testable vertical slice; the call-site wiring into the webhook/cron/classifier paths is explicitly downstream work (see Notes — Scope boundary).

The value: labels are created and repaired automatically, classification intent is read deterministically from labels instead of via fragile body-regex matching, and the entire "operator forgot to create labels" / "human deleted a label and ADW broke" failure class is eliminated.

## User Story

As the framework operator
I want ADW to automatically create the six `adw:*` labels the first time it touches a new target repo, lazy-recreate any label a human deletes, and read classification intent directly from an issue's labels
So that I never pre-create labels by hand, ADW never breaks on a label-not-found error, and an issue's `adw:*` labels are honored as the deterministic classification signal without LLM intermediation.

## Problem Statement

The parent PRD replaces body-slash-command classification (which misfires whenever `/feature` appears in unrelated prose) with **label-based classification**. That redesign needs a reliable label substrate that does not exist today:

- There is no code that provisions the `adw:*` label set on a target repo. Without it, every new target would require manual `gh label create` by the operator, and the very first `applyLabel` would fail because the label does not exist.
- The existing label helpers in `adws/github/issueApi.ts` (`issueHasLabel`, `addIssueLabel`) are thin, single-purpose, and fail-open: `addIssueLabel` swallows errors and never recovers from a deleted label. If a human deletes `adw:feature`, classification persistence silently no-ops.
- There is no structured reader that turns the messy reality of an issue's `labels[]` (zero, one, or multiple `adw:<type>` labels, with or without the `adw:none` opt-out) into the unambiguous `{ optOut, classification, conflict }` shape the routing layer needs to make a clean decision.

## Solution Statement

Introduce a focused deep module, `adws/github/labelManager.ts`, that sits beside the existing GitHub label helpers in `issueApi.ts` and exposes three operations plus the canonical label data:

- A single canonical `ADW_LABEL_DEFINITIONS` table (name + color + description for all six labels) and an `ADW_CLASSIFICATION_LABELS` map from the four classification labels (`adw:chore`/`adw:bug`/`adw:feature`/`adw:pr_review`) to the existing `IssueClassSlashCommand` type, so downstream routing can drop `classification` straight into `issueTypeToOrchestratorMap`.
- `readAdwLabels(issue)` — a **pure** function (no I/O) returning `{ optOut, classification, conflict }`. This is the most-tested surface (all branches required by the acceptance criteria) and, being pure, is trivially unit-testable.
- `ensureAdwLabelsExist(repoInfo)` and `applyLabel(issueNumber, label, repoInfo)` — the I/O-touching operations, built on the `gh` CLI via an **injected `exec` boundary** (`LabelManagerDeps` + `buildDefaultLabelManagerDeps()`), exactly mirroring the dependency-injection deep-module pattern already used by `adws/core/remoteReconcile.ts` and `adws/core/processLiveness.ts`. Production callers invoke `ensureAdwLabelsExist(repoInfo)` with no deps; tests inject a `vi.fn()` exec stub to drive every branch (success, "not found" → lazy-create → retry, idempotent re-run) without touching real GitHub.

Idempotency for `ensureAdwLabelsExist` is achieved with `gh label create --force` (create-or-update semantics, never errors on an existing label). Lazy-create for `applyLabel` is achieved by issuing the `gh issue edit --add-label` with `maxAttempts: 1` (fail fast, since "not found" is not in `execWithRetry`'s non-retryable list), detecting a "not found" error, creating the missing label with `--force`, and retrying the add once.

The module exports its surface through `adws/github/index.ts`. No existing trigger/classifier/orchestrator files are modified in this slice — the module is delivered ready for downstream consumption.

## Relevant Files

Use these files to implement the feature:

- `specs/prd/adw-init-hash-and-label-classification.md` — Parent PRD. The authoritative spec. See **Label lifecycle management** (defines `ensureAdwLabelsExist` pre-create + lazy-create-on-not-found), **Label-based classification** (defines the six labels, the `adw:none` opt-out, the single/zero/multiple `adw:<type>` routing rules), and **Testing Decisions → `labelManager`** (defines the exact test cases this slice must satisfy).
- `adws/github/issueApi.ts` — **Prior art / pattern to extend.** Contains the existing `issueHasLabel(issueNumber, labelName, repoInfo)` and `addIssueLabel(issueNumber, labelName, repoInfo)` helpers. Shows the exact `gh issue edit --repo owner/repo --add-label` invocation, the `{ stdio: ['pipe','pipe','pipe'] }` option to silence output, and the fail-open logging convention `labelManager` will improve upon (lazy-create instead of swallow).
- `adws/github/githubApi.ts` — Defines `RepoInfo { owner, repo }`, the repo-targeting type every `labelManager` I/O function takes. Re-exports the github surface.
- `adws/github/index.ts` — The module's public export surface. New `labelManager` exports are added here (this is the only existing file modified by this slice).
- `adws/github/__tests__/prApi.test.ts` — **Sibling test conventions** for `adws/github/`. Shows the Vitest layout and the `RepoInfo` fixture style used in this directory.
- `adws/core/remoteReconcile.ts` + `adws/core/__tests__/remoteReconcile.test.ts` — **The deep-module DI pattern to follow.** `ReconcileDeps` interface + `buildDefaultReconcileDeps()` factory + optional `deps?` parameter defaulting to the factory; pure helper (`mapArtifactsToStage`) separated from the I/O orchestration; test uses `makeDeps(overrides)` + `vi.fn()` to drive every branch. `labelManager` mirrors this structure exactly.
- `adws/core/processLiveness.ts` — Second reference for the same DI convention (`ProcessLivenessDeps` + `defaultDeps` + `deps: Deps = defaultDeps` parameter default). Confirms the idiom of injecting raw command-execution boundaries for CLI-touching modules.
- `adws/core/utils.ts` — Defines `execWithRetry(command, options?)`. Note two behaviors `labelManager` depends on: (1) `options.maxAttempts` (default 3) — `applyLabel` passes `maxAttempts: 1` so a "not found" failure surfaces immediately instead of retrying 3× with backoff; (2) `NON_RETRYABLE_PATTERNS` includes `'already exists'` but **not** `'not found'`, which is why fail-fast matters for the lazy-create path.
- `adws/types/issueTypes.ts` — Defines `GitHubIssue`, `GitHubLabel { id, name, color, description }`, and `IssueClassSlashCommand = '/chore' | '/bug' | '/feature' | '/pr_review' | '/adw_init'`. `readAdwLabels` takes an issue shaped like `GitHubIssue` and returns a `classification` typed as `IssueClassSlashCommand | null`.
- `adws/types/issueRouting.ts` — Defines `issueTypeToOrchestratorMap: Record<IssueClassSlashCommand, string>`. Documents why aligning `classification` to `IssueClassSlashCommand` lets downstream routing reuse this map directly (no extra mapping layer).
- `adws/core/issueClassifier.ts` — The downstream LLM-classifier path (`classifyGitHubIssue`) that `readAdwLabels` will gate in a later slice (when `classification` is null and `conflict` is false). Read for context only; **not modified in this slice.**
- `.adw/project.md` — Confirms `## Unit Tests: enabled` (this slice includes unit tests) and `## Application Type: cli`. Library install command: `bun add <package>` (none needed).
- `.adw/commands.md` — Project validation commands (lint, type-check, test, build).
- `.adw/coding_guidelines.md` — Coding guidelines (strict TypeScript, immutability, purity, guard clauses, max nesting depth ~2, files < 300 lines, no decorators). Must be adhered to.

### New Files

- `adws/github/labelManager.ts` — The deep module. Exports: `readAdwLabels` (pure), `ensureAdwLabelsExist`, `applyLabel`, the constants (`ADW_LABEL_DEFINITIONS`, `ADW_CLASSIFICATION_LABELS`, `ADW_NONE_LABEL`), the optional helper `issueTypeToAdwLabel`, the DI scaffolding (`LabelManagerDeps`, `buildDefaultLabelManagerDeps`), and the types (`AdwLabelReading`, `AdwLabelDefinition`).
- `adws/github/__tests__/labelManager.test.ts` — Vitest unit tests covering all branches of `readAdwLabels`, the idempotent multi-label provisioning in `ensureAdwLabelsExist`, and the success / lazy-create-retry / non-"not found"-rethrow branches of `applyLabel`.

## Implementation Plan

### Phase 1: Foundation
Establish the module's data and types — the canonical label table, the classification map, the opt-out sentinel, the result/definition types, and the DI scaffolding — before any behavior is written. These are the load-bearing contracts that the three operations and all downstream consumers depend on. Aligning `classification` to the existing `IssueClassSlashCommand` type (rather than inventing a new enum) is the key foundational decision: it keeps the read side compatible with `issueTypeToOrchestratorMap` and `commitPrefixMap` with zero glue.

### Phase 2: Core Implementation
Implement the three operations in increasing I/O complexity:
1. `readAdwLabels` (pure, no deps) — the highest-value, most-tested surface.
2. `ensureAdwLabelsExist` (write-only, idempotent via `--force`).
3. `applyLabel` (write + read-back error discrimination + lazy-create-retry).
Private command-builder/exec helpers keep each public function flat (guard clauses, max nesting depth ~2 per the coding guidelines). All `gh` invocation goes through the injected `deps.exec` boundary so every path is unit-testable.

### Phase 3: Integration
Export the module's surface through `adws/github/index.ts` so it is reachable via the `../github` barrel that every trigger/phase/orchestrator already imports from. Define and document the consumption contract for the downstream slices (webhook `issues.opened` handler, `initializeWorkflow()`, CRON recovery scan) that will call these functions — **without modifying those files in this slice** (they are separate issues and modifying them here would create merge contention and untestable cross-module coupling, per the PRD's "Modules NOT tested in isolation"). Verify the full module compiles under the strict `adws/tsconfig.json` and that the public surface is importable.

## Step by Step Tasks
Execute every step in order, top to bottom.

### 1. Scaffold `labelManager.ts` with canonical label data and types
- Create `adws/github/labelManager.ts` with a file-level JSDoc describing the module's responsibility (label lifecycle + pure label reading) and its DI-for-testability design, mirroring the header style of `adws/core/remoteReconcile.ts`.
- Import `execWithRetry`, `log`, and `type LogLevel` from `../core`; `type RepoInfo` from `./githubApi`; `type GitHubIssue`, `type GitHubLabel`, `type IssueClassSlashCommand` from `../types/issueTypes`; and `type ExecSyncOptions` from `child_process`.
- Define `export const ADW_NONE_LABEL = 'adw:none'` (the opt-out sentinel).
- Define `export const ADW_CLASSIFICATION_LABELS` as a `Record<string, IssueClassSlashCommand>` literal mapping the four classification labels to slash commands: `'adw:chore' → '/chore'`, `'adw:bug' → '/bug'`, `'adw:feature' → '/feature'`, `'adw:pr_review' → '/pr_review'`. Use `as const satisfies Record<string, IssueClassSlashCommand>`. (Deliberately excludes `adw:upgrade` and `adw:none` — see Notes — Label semantics.)
- Define `export interface AdwLabelDefinition { name: string; color: string; description: string }`.
- Define `export const ADW_LABEL_DEFINITIONS: readonly AdwLabelDefinition[]` listing all six labels with GitHub hex colors (no leading `#`) and short descriptions, e.g. `adw:chore`/`fbca04`, `adw:bug`/`d73a4a`, `adw:feature`/`0e8a16`, `adw:pr_review`/`1d76db`, `adw:upgrade`/`5319e7`, `adw:none`/`e4e4e4`.
- Define `export interface AdwLabelReading { optOut: boolean; classification: IssueClassSlashCommand | null; conflict: boolean }`.

### 2. Implement the pure `readAdwLabels` reader
- Implement `export function readAdwLabels(issue: Pick<GitHubIssue, 'labels'>): AdwLabelReading`.
- Build a `Set<string>` of the issue's label names (`issue.labels.map(l => l.name)`).
- `optOut` = the set contains `ADW_NONE_LABEL`.
- Compute `matched` = the classification labels (`Object.keys(ADW_CLASSIFICATION_LABELS)`) present in the set.
- `conflict` = `matched.length > 1`.
- `classification` = `matched.length === 1 ? ADW_CLASSIFICATION_LABELS[matched[0]] : null`.
- Return `{ optOut, classification, conflict }`. Keep it pure (no logging, no I/O) so it is a same-input/same-output function per the coding guidelines.
- Add the small inverse convenience `export function issueTypeToAdwLabel(issueType: IssueClassSlashCommand): string | null` deriving the `adw:<type>` label name from `ADW_CLASSIFICATION_LABELS` (returns `null` for `/adw_init`, which has no classification label). This supports the downstream "persist the LLM-inferred classification as a label" caller without it re-deriving the mapping.

### 3. Implement the DI scaffolding and private `gh` command helpers
- Define `export interface LabelManagerDeps { readonly exec: (command: string, options?: ExecSyncOptions & { maxAttempts?: number }) => string; readonly logger: (message: string, level?: LogLevel) => void }`.
- Define `export function buildDefaultLabelManagerDeps(): LabelManagerDeps` returning `{ exec: execWithRetry, logger: log }`.
- Add a private `createLabel(def: AdwLabelDefinition, repoInfo: RepoInfo, deps: LabelManagerDeps): void` that runs `gh label create '<name>' --repo <owner>/<repo> --color <color> --description '<description>' --force` via `deps.exec`. Single-quote the `--description` (it contains spaces) and the label name. `--force` gives create-or-update idempotency.
- Add a private `resolveLabelDefinition(label: string): AdwLabelDefinition` that returns the matching entry from `ADW_LABEL_DEFINITIONS`, or a default definition (`{ name: label, color: 'ededed', description: 'ADW label' }`) for an unknown label name, so lazy-create can run for any label `applyLabel` is asked to add.
- Add a private `addLabelToIssue(issueNumber: number, label: string, repoInfo: RepoInfo, deps: LabelManagerDeps): void` that runs `gh issue edit <n> --repo <owner>/<repo> --add-label '<label>'` via `deps.exec` with `{ stdio: ['pipe','pipe','pipe'], maxAttempts: 1 }` (fail fast so a "not found" surfaces without 3× backoff).
- Add a private `isLabelNotFoundError(error: unknown): boolean` returning `/not found/i.test(String(error))`.

### 4. Implement `ensureAdwLabelsExist`
- Implement `export function ensureAdwLabelsExist(repoInfo: RepoInfo, deps: LabelManagerDeps = buildDefaultLabelManagerDeps()): void`.
- Iterate `ADW_LABEL_DEFINITIONS` and call `createLabel(def, repoInfo, deps)` for each.
- Wrap each `createLabel` in a try/catch that logs a warning via `deps.logger` and continues on failure (resilient pre-create — one label's transient/permission failure must not abort provisioning of the rest). Because `--force` never errors on an existing label, the happy path and a repeat run both complete without throwing (idempotent).
- Log a single success line summarizing how many labels were ensured.

### 5. Implement `applyLabel` with lazy-create-and-retry
- Implement `export function applyLabel(issueNumber: number, label: string, repoInfo: RepoInfo, deps: LabelManagerDeps = buildDefaultLabelManagerDeps()): void`.
- Try `addLabelToIssue(issueNumber, label, repoInfo, deps)` and return on success.
- In `catch (error)`: guard clause — if `!isLabelNotFoundError(error)`, log and rethrow (an unexpected error must not be masked by a spurious label creation).
- On a "not found" error: `deps.logger(...'lazy-creating'..., 'warn')`, then `createLabel(resolveLabelDefinition(label), repoInfo, deps)`, then retry `addLabelToIssue(...)` exactly once. Let any error from the retry propagate.

### 6. Wire exports through `adws/github/index.ts`
- Add an export block to `adws/github/index.ts`:
  - functions/values: `ensureAdwLabelsExist`, `applyLabel`, `readAdwLabels`, `issueTypeToAdwLabel`, `buildDefaultLabelManagerDeps`, `ADW_LABEL_DEFINITIONS`, `ADW_CLASSIFICATION_LABELS`, `ADW_NONE_LABEL`
  - types: `type AdwLabelReading`, `type AdwLabelDefinition`, `type LabelManagerDeps`
- Place the block near the existing `issueHasLabel`/`addIssueLabel` exports so related label operations are colocated.

### 7. Write unit tests for `readAdwLabels` (all branches)
- Create `adws/github/__tests__/labelManager.test.ts` importing from `vitest` and the module under test. Add a `makeIssue(...labelNames: string[])` helper that builds `{ labels: GitHubLabel[] }`.
- Cover every branch of the result shape:
  - Zero `adw:<type>`, no `adw:none` → `{ optOut:false, classification:null, conflict:false }`.
  - Zero `adw:<type>`, with `adw:none` → `{ optOut:true, classification:null, conflict:false }`.
  - Exactly one `adw:<type>` for each of `adw:chore`/`adw:bug`/`adw:feature`/`adw:pr_review` → correct `classification` slash command, `conflict:false`, `optOut:false`.
  - Exactly one `adw:<type>` **with** `adw:none` → correct `classification`, `optOut:true`, `conflict:false`.
  - Multiple `adw:<type>`, no `adw:none` → `{ optOut:false, classification:null, conflict:true }`.
  - Multiple `adw:<type>`, with `adw:none` → `{ optOut:true, classification:null, conflict:true }`.
  - Non-adw labels (e.g. `hitl`, a bare `bug` without the `adw:` prefix) are ignored. Labels that resemble but do not match the `adw:` namespace (e.g. `adw-bug` with a hyphen, `adwesome`) are also ignored — matching is exact, not prefix-based.
  - `adw:upgrade` alone is **not** counted as a classification → `{ optOut:false, classification:null, conflict:false }` (documents the marker semantics).
- Add a small test for `issueTypeToAdwLabel`: maps `/feature` → `adw:feature` and returns `null` for `/adw_init`.

### 8. Write unit tests for `ensureAdwLabelsExist` (DI exec)
- Add a `makeDeps(overrides)` helper returning `{ exec: vi.fn().mockReturnValue(''), logger: vi.fn(), ...overrides }`, mirroring `remoteReconcile.test.ts`'s `makeDeps`.
- Assert `exec` is called exactly six times, once per label, each command containing `gh label create`, the `--force` flag, the correct label name, and `--repo acme/widgets`.
- Assert idempotency: calling `ensureAdwLabelsExist` twice does not throw and issues 6 commands each time (no error parsing needed because of `--force`).
- Assert resilience: if `exec` throws for one label, the remaining labels are still attempted (total 6 calls) and no exception escapes.

### 9. Write unit tests for `applyLabel` (success + lazy-create-retry + persistent-not-found + rethrow)
- Success path: `exec` resolves the first `gh issue edit --add-label` call → assert exactly one `exec` call, command contains `--add-label 'adw:feature'`, and no `gh label create` is issued.
- Lazy-create path: make `exec` throw a `not found` error on the first `gh issue edit` call, succeed on the `gh label create` call, and succeed on the retried `gh issue edit` call → assert the create was issued for the missing label and the edit was attempted twice; `applyLabel` returns without throwing.
- Persistent-not-found path: make `exec` throw a `not found` error on the first `gh issue edit`, succeed on the `gh label create`, then throw `not found` again on the retried `gh issue edit` → assert exactly one `gh label create` was issued (no create/retry loop) and `applyLabel` fails loudly (the retry's error propagates).
- Non-"not found" path: make the first `gh issue edit` throw a generic error (e.g. `HTTP 500`) → assert `applyLabel` rethrows and **no** `gh label create` is issued.

### 10. Run validation commands
- Run every command in the `## Validation Commands` section. All must pass with zero errors and zero regressions before the feature is considered complete.

## Testing Strategy

### Unit Tests
`.adw/project.md` contains `## Unit Tests: enabled`, so this slice includes unit tests. Tests live in `adws/github/__tests__/labelManager.test.ts` (Vitest, run via `bun run test:unit`).

- **`readAdwLabels` (pure)** — exhaustively covers the result shape: the cartesian of {zero, one (×4 types), multiple} `adw:<type>` labels × {with, without} `adw:none`, plus ignored non-adw labels and the `adw:upgrade`-is-not-a-classification case. This is the surface the acceptance criteria explicitly require "all branches" coverage for, and being a pure function it needs no mocks.
- **`ensureAdwLabelsExist` (DI exec stub)** — verifies all six labels are provisioned, the `--force` idempotency flag is used, `repoInfo` is threaded into `--repo owner/repo`, a repeat run is a no-error no-op, and a single label failure does not abort the batch.
- **`applyLabel` (DI exec stub)** — verifies the existing-label success path (single call, no create), the lazy-create-and-retry path (create + retry on "not found"), the persistent-not-found path (exactly one create, then the retry's error propagates — no create/retry loop), and the rethrow-without-create path for unexpected errors.
- **`issueTypeToAdwLabel`** — verifies the inverse mapping and the `/adw_init` → `null` edge.

The DI approach (injecting `exec`/`logger` via `LabelManagerDeps`, defaulting to `execWithRetry`/`log`) means no real `gh` CLI or network is touched; every branch is driven by a `vi.fn()` stub and assertions are made on the exact commands constructed. This matches the established deep-module test pattern in `adws/core/__tests__/remoteReconcile.test.ts` and `processLiveness.test.ts`.

### Edge Cases
- Issue with **no labels at all** → `{ optOut:false, classification:null, conflict:false }` (downstream falls back to the LLM classifier).
- Issue carrying only non-adw labels (`hitl`, `bug`, `enhancement`) → treated as zero `adw:<type>`; non-adw labels never affect the result.
- `adw:none` present **alongside** a valid single `adw:<type>` → `optOut:true` is reported independently of `classification`; the read side reports facts and leaves precedence (opt-out wins) to the routing caller.
- `adw:upgrade` present (the tracking-issue marker) → never counted as a classification or a conflict; it is one of the six ensured labels but not a new-issue classification input.
- `applyLabel` for a label name **not** in `ADW_LABEL_DEFINITIONS` → lazy-create still works using a default color/description (`resolveLabelDefinition` fallback).
- `applyLabel` first attempt fails with a non-"not found" error (auth, 5xx) → rethrown, no spurious label creation.
- `applyLabel` where the label stays "not found" even after lazy-create → exactly one create is issued and the retry's error propagates (bounded single retry, no create/retry loop).
- `ensureAdwLabelsExist` where one `gh label create` fails (transient/permission) → the other five are still attempted; no throw escapes.
- Label names contain a colon (`adw:feature`) and descriptions contain spaces → commands single-quote these arguments so the shell parses them correctly.

## Acceptance Criteria
- `ensureAdwLabelsExist(repoInfo)` issues a create for all six `adw:*` labels and is idempotent — a second invocation produces no error (verified via `--force` and the repeat-run test).
- `applyLabel(issueNumber, label, repoInfo)` adds the label in a single `gh issue edit` call when the label already exists, issuing no `gh label create`.
- `applyLabel` detects a "not found" failure, lazy-creates the missing label, and retries the add successfully; an unexpected (non-"not found") error is rethrown without creating a label.
- `readAdwLabels(issue)` returns the correct `{ optOut, classification, conflict }` for zero/one/multiple `adw:<type>` labels, with and without `adw:none`, ignoring non-adw labels.
- Unit tests cover all branches of the `readAdwLabels` shape (and the `ensureAdwLabelsExist` / `applyLabel` paths), and pass.
- The module surface is exported from `adws/github/index.ts` and importable via the `../github` barrel.
- `bun run lint`, the type checks, `bun run test:unit`, and `bun run build` all pass with zero errors and zero regressions.

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `bun run lint` — ESLint over the codebase; zero errors/warnings on the new module and test.
- `bunx tsc --noEmit` — root TypeScript type-check passes.
- `bunx tsc --noEmit -p adws/tsconfig.json` — adws-scoped strict type-check passes (the `## Additional Type Checks` command from `.adw/commands.md`).
- `bunx vitest run adws/github/__tests__/labelManager.test.ts` — the new unit-test file passes (all `readAdwLabels` branches + `ensureAdwLabelsExist` + `applyLabel` paths green).
- `bun run test:unit` — the full Vitest suite passes (zero regressions in sibling tests).
- `bun run build` — `tsc` build succeeds with no errors.

## Notes

- **Coding guidelines.** `.adw/coding_guidelines.md` applies: strict TypeScript (no `any`, prefer type narrowing over `!`), immutability (treat the label tables as `readonly`/`as const`), purity (`readAdwLabels` and `issueTypeToAdwLabel` must be pure), guard clauses and max nesting depth ~2 (use early returns in `applyLabel`'s catch; extract the `gh` command builders so the public functions stay flat), file under 300 lines, no decorators, JSDoc on the public surface. The module is well under the line limit.
- **No new libraries.** Implementation uses only existing primitives (`execWithRetry`, `log`, the `gh` CLI). `.adw/project.md` library install command is `bun add <package>` — not needed here.
- **Scope boundary (vertical slice).** This issue delivers the `labelManager` module + unit tests as an independently-mergeable slice. It deliberately does **not** modify `trigger_webhook.ts`, `trigger_cron.ts`, `initializeWorkflow()`, or `core/issueClassifier.ts`. Per the parent PRD's "Modules NOT tested in isolation," those call-site wirings are integration-tested in their own slices: (1) the `issues.opened` handler calling `ensureAdwLabelsExist` on first contact and routing on `readAdwLabels`; (2) `initializeWorkflow()`/classifier gating the LLM fallback on `classification === null && !conflict` and persisting the inferred label via `applyLabel` + `issueTypeToAdwLabel`; (3) the CRON recovery scan re-using `readAdwLabels` for eligibility. The exports added here are the contract those slices consume.
- **Label semantics decision.** `ADW_CLASSIFICATION_LABELS` intentionally maps only the four routable types (`adw:chore`/`adw:bug`/`adw:feature`/`adw:pr_review`). `adw:none` is the opt-out sentinel (`optOut`), and `adw:upgrade` is a tracking-issue marker that the PRD explicitly exempts from classification and multi-label refusal — so neither participates in the `classification`/`conflict` computation, while both remain part of the six-label set that `ensureAdwLabelsExist` provisions. This keeps `readAdwLabels` aligned with the PRD's "zero/one/multiple `adw:<type>` × with/without `adw:none`" test matrix.
- **`classification` typed as `IssueClassSlashCommand`.** Aligning the read-side output to the existing `IssueClassSlashCommand` (rather than a new label-string enum) lets downstream routing feed `classification` straight into `issueTypeToOrchestratorMap` / `commitPrefixMap` / `branchPrefixMap` with no adapter.
- **`execWithRetry` interaction.** `applyLabel`'s initial add uses `maxAttempts: 1` because `'not found'` is **not** in `NON_RETRYABLE_PATTERNS` (`adws/core/utils.ts`); without this, a missing-label add would retry 3× with exponential backoff before the lazy-create path could engage. `ensureAdwLabelsExist` relies on `gh label create --force` so the `'already exists'` non-retryable pattern is never hit.
- **DI default-parameter pattern.** `ensureAdwLabelsExist` / `applyLabel` take `deps: LabelManagerDeps = buildDefaultLabelManagerDeps()` so production callers pass only `(repoInfo)` / `(issueNumber, label, repoInfo)` while tests inject a stub — identical to `deriveStageFromRemote(..., deps?)` and `isProcessLive(..., deps = defaultDeps)`.
- **Conditional docs.** `.adw/conditional_docs.md` was checked; no entry's conditions match `adw:*` label provisioning/classification (the nearest, `feature-fygx90-hitl-label-gate-automerge.md`, concerns the auto-merge `hitl` gate, a different label and code path). No conditional documentation needs to be pulled in for this slice.

# Feature: app_docs living-docs — post-write self-check guards (bloat + regrowth)

## Metadata
issueNumber: `611`
adwId: `ih6ju7-app-docs-living-docs`
issueJson: `{"number":611,"title":"app_docs living-docs: post-write self-check guards (bloat + regrowth)","body":"## Parent PRD\n\n`specs/prd/app-docs-module-living-docs.md`\n\n## What to build\n\nBuild a deterministic guards module (pure functions over the registry module’s parsed entries): a **bloat** check (a module doc whose size exceeds a threshold) and a **regrowth** check (entries whose ownership overlaps — i.e. convergence produced a duplicate module). Wire it into the document phase as a **post-write self-check**: after `/document` writes, run the guards and surface flags — log both, and route the bloat flag to `/refactor` or a filed refactor issue (an oversized doc signals the module needs refactoring; there is no doc-split path). Measurement lives here, not in `/refactor` (which is blind to `app_docs/`).\n\nEnd-to-end outcome: a run that writes an oversized doc emits a bloat flag; a run that produces an overlapping entry emits a regrowth flag.\n\n## Acceptance criteria\n\n- [ ] Guards module: bloat detection at threshold boundaries + regrowth (overlap) detection, with no false positives on disjoint entries (vitest)\n- [ ] Document phase runs the guards as a post-write self-check and logs flags\n- [ ] Bloat flag is routed to `/refactor` or a filed refactor issue\n- [ ] BDD content-assertion scenarios (`@adw-{issue}`): oversize doc emits bloat flag; overlapping entry emits regrowth flag\n\n## Blocked by\n\n- Blocked by #609\n\n## User stories addressed\n\n- User story 11\n- User story 12","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-06-17T08:21:04Z","comments":[],"actionableComment":null}`

## Feature Description

This is the **second slice** of the per-module living-docs PRD (`specs/prd/app-docs-module-living-docs.md`). The first slice (#609, the blocked-by, now merged) landed the **registry module** (`adws/core/conditionalDocsRegistry.ts` — parses/serializes `.adw/conditional_docs.md` into structured `ConditionalDocEntry` records carrying `docPath`, `ownedGlobs`, `conditions`) and rewrote `/document` to **converge**: route a documented change to the index entry that already owns the touched files and rewrite that module doc in place, instead of appending a new per-run snapshot.

Convergence is **non-deterministic** (semantic/glob matching by an LLM) and, for non-ADW target repos, is the *sole* mechanism keeping `app_docs/` lean — there is no one-off migration backstop there. #609 deliberately left two safety nets out of scope. This slice adds them as a **deterministic, pure guards module** plus a **post-write self-check** wired into the document phase:

- **Bloat** — a module doc the rewrite produced is larger than a threshold. An oversized doc is a refactor signal for the underlying **module** (there is no doc-split path). The flag is surfaced by the document phase and routed onward to a refactor follow-up. Measurement lives *here* because `/refactor` is blind to `app_docs/` — it sees only changed code files, never the docs.
- **Regrowth** — the rewrite produced a *second* index entry whose ownership overlaps an existing one (convergence misfired and duplicated a module instead of routing to the entry that already owned the area). Caught early, this is the only line of defence for repos with no migration to fall back on.

The guards are **pure functions over the registry module's parsed entries plus the produced docs' sizes**: given those, they compute a bloat flag (a doc over the threshold) and regrowth flags (entry pairs whose owned globs overlap). They are deterministic and lifted out of the LLM. The document phase runs them as a post-write self-check after `/document` writes, **logs** both flag sets, and **routes** the bloat flag to a refactor follow-up.

Value: the post-write self-check is the durable safety net that makes convergence trustworthy on repos without a migration — misfires (duplicate modules, runaway-size docs) are surfaced deterministically rather than silently accumulating, which is exactly the unbounded-index problem the PRD set out to prevent.

## User Story

**User story 11** — As an ADW maintainer, I want `/document` to flag when a rewritten module doc exceeds a size threshold, so that an oversized doc surfaces a module that needs refactoring.

**User story 12** — As an ADW maintainer, I want `/document` to flag when it produces an index entry that overlaps an existing one, so that convergence misfires (regrowth) are caught early on repos that have no migration backstop.

As an ADW maintainer
I want `/document`'s post-write self-check to deterministically flag an oversized module doc (bloat) and an overlapping index entry (regrowth), log both, and route the bloat flag to a refactor follow-up
So that convergence misfires are caught early — even on target repos with no one-off migration — and oversized docs reach the actor that can refactor the underlying module.

## Problem Statement

#609 made `/document` converge, but convergence is non-deterministic and, for non-ADW repos, is the only thing keeping `app_docs/` lean. It can misfire in two ways with no current detection:

1. It can rewrite a module doc into something **oversized** — a signal the underlying module has grown too complex — and nothing flags it.
2. It can **duplicate a module** by appending a second index entry whose ownership overlaps an existing one (regrowth), silently regrowing the very unbounded index the PRD eliminated.

There is no deterministic safety net catching either case. On a target repo there is no migration to clean up after a misfire, so an undetected regrowth persists indefinitely.

## Solution Statement

Add a deep, **pure** guards module (`adws/core/docsGuards.ts`) over the registry module's parsed entries:

- `checkBloat(sizes, threshold)` — flags any produced doc whose size **exceeds** the threshold (strictly greater; at-threshold is not bloat).
- `checkRegrowth(entries)` — flags pairs of entries whose owned globs **overlap** (the same file area is owned by two entries), using a deterministic, segment-aware glob-overlap test that produces **no false positives on disjoint entries** and excludes legacy (no-`Owns:`) entries.
- An exported threshold constant (`DOC_BLOAT_THRESHOLD_LINES`) so both the wiring and the BDD fixtures construct the boundary from one source of truth.

Wire a **post-write self-check** into the document phase (`adws/phases/docsSelfCheck.ts`, called by `executeDocumentPhase`): after `runDocumentAgent` writes, read and parse `.adw/conditional_docs.md` via the registry module, measure the produced doc's size, run the guards, **log** both flag sets, and **route** each bloat flag to a refactor follow-up — a filed refactor issue (recommended) that names the oversized doc's area (its owned globs → the module's source files), idempotent by title. The self-check is a side-effecting boundary that isolates fs/GitHub I/O and is driveable in-process (injectable deps) so the BDD scenarios can pin emit / no-emit / route / log hermetically.

The guards are unit-tested (vitest, pure table tests at boundaries) and the wired phase behaviour is pinned by the already-frozen `@adw-611` BDD scenarios. `/document.md` itself is **not** modified by this slice — the guards are deterministic TypeScript run by the phase, not LLM prompt logic.

## Relevant Files

Use these files to implement the feature:

- `specs/prd/app-docs-module-living-docs.md` — parent PRD. Implementation Decisions name the **guards module (deep, pure)** contract ("given parsed entries and a doc's size, computes a bloat flag … and regrowth flags") and the **bloat action** ("surfaced by `/document`; the downstream actor is `/refactor` or a filed refactor issue"). Testing Decisions name the vitest scope (threshold boundaries, overlap detection, no false positives on disjoint).
- `adws/core/conditionalDocsRegistry.ts` — the registry module from #609. The guards consume its `ConditionalDocEntry` / `ConditionalDocsRegistry` types, `parseConditionalDocs`, and `matchesGlob`. **Single source of truth for the index format — do not re-parse markdown elsewhere.** Read its header comment for the canonical serialized format and the `Owns:`-block legacy-tolerance rule.
- `adws/core/__tests__/conditionalDocsRegistry.test.ts` — the prior-art test style to mirror exactly (pure table tests, canonical fixtures, boundary cases, `describe`/`it` with `vitest`).
- `adws/core/testVerdict.ts` — prior art for a deep, pure verdict module: a single pure function mapping a structured input to a structured result with a documented guard-clause branch table. Mirror this shape for the guards.
- `app_docs/feature-o4qdu5-app-docs-living-docs-convergence-registry.md` — current-state module doc for the registry; documents its contracts/invariants (lossless round-trip, legacy entries never match, `**` spans separators / `*` does not, segment-aware globbing). The guards' overlap logic must respect the same glob semantics.
- `adws/phases/documentPhase.ts` — the wiring site. `executeDocumentPhase` already calls `runDocumentAgent` (returns `result.docPath`) then commits/pushes. The post-write self-check is inserted after agent success and before/around the commit. Already imports `log` and `AgentStateManager.appendLog`.
- `adws/agents/documentAgent.ts` — `runDocumentAgent(...) : Promise<AgentResult & { docPath: string }>`; `docPath` is the produced doc to measure for bloat.
- `adws/phases/workflowInit.ts` — defines `WorkflowConfig` (the `config` passed to the phase). Note: `config.ctx` (`WorkflowContext`) does **not** carry owner/repo; derive `RepoInfo` from `config.targetRepo` (`{ owner, repo }`) when present, else `getRepoInfo(config.worktreePath)`. Mirrors the `repoInfo ?? getRepoInfo()` pattern used throughout this file.
- `adws/phases/upgradeGate.ts` — prior art for filing a tracking issue from a phase via an injectable `createIssue` dep (`UpgradeGateDeps`), plus `applyLabel` and an idempotency search (`findOpenUpgradeIssue`). Mirror the `Deps` injection pattern for the self-check so the BDD can drive it in-process.
- `adws/github/issueApi.ts` — `createIssue(title, body, repoInfo): number` (uses `gh issue create`), `issueHasLabel`, `addIssueLabel`, and `findOpenUpgradeIssue(repoInfo)` (label-based idempotency search to mirror). `RepoInfo` is `{ owner, repo }` from `adws/github/githubApi.ts`.
- `adws/core/index.ts` — barrel exports for `adws/core`. Add the guards module's exports here (mirroring the `testVerdict` / `resolveFreezeGuard` export lines) for discoverability; note the registry module is imported by direct path, so a direct-path import of the guards is also acceptable.
- `features/per-issue/feature-611.feature` — **already frozen** `@adw-611` scenarios (6 scenarios + Background). The implementation must satisfy these exactly. They mandate: an **exported threshold** the fixtures build the boundary from; an in-process self-check **entry point**; observable **emitted flag set**, **routed refactor follow-up** (mock-GitHub filing OR in-process hand-off record naming the area), and **logged output**. Read the "Step-definition note" (lines ~146–162) — it is the build contract for the step defs.
- `.adw/scenarios.md` — scenario config: per-issue dir `features/per-issue/`, run-by-tag `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@{tag}"`, and a `## Regression Scenario Directory` set (so the `@regression` auto-promotion sweep is skipped for this issue).
- `.adw/commands.md` — validation commands (lint, type-check, `bun run test:unit` vitest, build, scenarios-by-tag).
- `.adw/coding_guidelines.md` — keep files < 300 lines, prefer pure functions, isolate side effects at boundaries, guard clauses / max nesting depth ~2, no `any`, declarative over imperative.

### New Files

- `adws/core/docsGuards.ts` — the deep, pure guards module: `DOC_BLOAT_THRESHOLD_LINES`, `DocSize`/`BloatFlag`/`RegrowthFlag`/`GuardFlags` types, `globsOverlap`, `checkBloat`, `checkRegrowth`, `runDocsGuards`. No fs/network — values in, flags out.
- `adws/core/__tests__/docsGuards.test.ts` — vitest table tests: bloat at threshold boundaries (under / at / over by one), regrowth overlap matrix (identical glob, subset/nested glob, sibling-disjoint, legacy no-glob entry), no-false-positive on disjoint, purity.
- `adws/phases/docsSelfCheck.ts` — the side-effecting wiring: `executeDocsPostWriteSelfCheck(params, deps?)` reads + parses the index, measures produced doc sizes, runs `runDocsGuards`, logs both flag sets, routes each bloat flag to a refactor follow-up (idempotent), and returns `{ flags, routed }`. Injectable `DocsSelfCheckDeps` (readFile, createIssue, findExistingRefactorIssue, log) with real defaults, mirroring `UpgradeGateDeps`.
- `features/per-issue/step_definitions/feature-611.steps.ts` — step definitions realizing the 12 novel phrases listed in the frozen feature file, driving `executeDocsPostWriteSelfCheck` in-process over seeded temp-fixture worktrees and asserting emitted / routed / logged flags. (May be produced by the `generate_step_definitions` phase; this plan specifies its contract.)

## Implementation Plan

### Phase 1: Foundation — the pure guards module

Build `adws/core/docsGuards.ts` as a deep, pure module over the registry module's parsed entries, exactly mirroring the `testVerdict.ts` / `conditionalDocsRegistry.ts` shape (documented branch behaviour, no I/O). Export the threshold constant so every consumer — wiring and BDD fixtures — references one source of truth. Cover it with vitest table tests at the boundaries the PRD and AC1 name.

### Phase 2: Core Implementation — the post-write self-check wiring

Build `adws/phases/docsSelfCheck.ts` as the side-effecting boundary that reads + parses `.adw/conditional_docs.md` (via the registry module), measures the produced doc's size, runs the guards, logs both flag sets, and routes each bloat flag to a refactor follow-up that names the oversized doc's area. Use injectable deps (defaults wired to the real fs / `createIssue`) so the behaviour is hermetically driveable in-process. Make routing idempotent (don't file a duplicate refactor issue for the same doc).

### Phase 3: Integration — wire into the document phase and pin with BDD

Call `executeDocsPostWriteSelfCheck` from `executeDocumentPhase` after `runDocumentAgent` succeeds (non-fatal: a self-check failure must never fail the document phase). Implement `features/per-issue/step_definitions/feature-611.steps.ts` realizing the frozen `@adw-611` scenarios by driving the self-check entry point in-process over seeded fixtures, building the bloat boundary from the exported threshold. Run the full validation suite.

## Step by Step Tasks

Execute every step in order, top to bottom.

### Task 1 — Create the pure guards module `adws/core/docsGuards.ts`

- Import the registry types/helpers: `import { type ConditionalDocEntry, type ConditionalDocsRegistry, matchesGlob } from './conditionalDocsRegistry';`.
- Export the threshold constant (the single source of truth; the BDD fixtures import it to build the boundary):
  - `export const DOC_BLOAT_THRESHOLD_LINES = 400;` — module docs are current-state references (the registry doc is ~35 lines); 400 lines is a generous ceiling signalling genuine bloat. Document the rationale and that it is intentionally a defined constant (easy to retune).
- Define the structured types (immutable, explicit — no `any`):
  - `export interface DocSize { docPath: string; lineCount: number; }`
  - `export interface BloatFlag { docPath: string; lineCount: number; threshold: number; }`
  - `export interface RegrowthFlag { docPathA: string; docPathB: string; globA: string; globB: string; }`
  - `export interface GuardFlags { bloat: BloatFlag[]; regrowth: RegrowthFlag[]; }`
- Implement the glob-overlap core (pure, deterministic, segment-aware):
  - `ownershipRoot(glob: string): string` — the leading path segments before the first segment containing a wildcard (`*`/`?`). E.g. `adws/vcs/**` → `adws/vcs`; `adws/core/foo.ts` → `adws/core/foo.ts`; `adws/foo/*.ts` → `adws/foo`.
  - `isSegmentPrefix(a: string, b: string): boolean` — true iff `a`'s `/`-split segments are a leading subsequence of `b`'s (so `adws/core` is a prefix of `adws/core/foo.ts` but **not** of `adws/coreutils/x.ts`).
  - `export function globsOverlap(a: string, b: string): boolean` — `true` if `a === b`, else if one's ownership root is a segment-prefix of the other's. This catches the duplicate-module case (identical roots) and the nested case, and returns `false` for sibling-disjoint roots (`adws/vcs` vs `adws/core`).
- Implement `export function checkBloat(sizes: readonly DocSize[], threshold: number): BloatFlag[]` — map each `DocSize` with `lineCount > threshold` (strictly greater) to a `BloatFlag`; filter the rest. Document the boundary: at-threshold and below → no flag.
- Implement `export function checkRegrowth(entries: readonly ConditionalDocEntry[]): RegrowthFlag[]`:
  - Consider only entries with non-empty `ownedGlobs` (legacy/no-`Owns:` entries never participate — they cannot route and cannot regrow; this prevents ~190 false positives over the live index).
  - For each unordered pair of such entries (i < j), if any `globA ∈ A.ownedGlobs` and `globB ∈ B.ownedGlobs` satisfy `globsOverlap(globA, globB)`, emit one `RegrowthFlag{ docPathA, docPathB, globA, globB }` (first overlapping glob pair; do not emit duplicates for the same entry pair).
  - Use guard clauses / extracted helpers to keep nesting ≤ 2 (extract the per-pair overlap check into a named function).
- Implement `export function runDocsGuards(entries: readonly ConditionalDocEntry[], sizes: readonly DocSize[], threshold: number = DOC_BLOAT_THRESHOLD_LINES): GuardFlags` — `{ bloat: checkBloat(sizes, threshold), regrowth: checkRegrowth(entries) }`. This is the single entry point the wiring calls.
- Keep the whole module pure (no fs, no network, no logging) and under 300 lines.

### Task 2 — Export the guards module from `adws/core/index.ts`

- Add export lines mirroring the existing `testVerdict` / `resolveFreezeGuard` entries, e.g.:
  - `export type { DocSize, BloatFlag, RegrowthFlag, GuardFlags } from './docsGuards';`
  - `export { DOC_BLOAT_THRESHOLD_LINES, checkBloat, checkRegrowth, runDocsGuards, globsOverlap } from './docsGuards';`

### Task 3 — Write vitest unit tests `adws/core/__tests__/docsGuards.test.ts` (AC1)

Mirror `conditionalDocsRegistry.test.ts` style (`describe`/`it`, canonical fixtures, no mocks — pure tables). Cover:
- **Bloat threshold boundaries:** with `threshold = DOC_BLOAT_THRESHOLD_LINES` (and a small explicit threshold for clarity): `lineCount = threshold - 1` → no flag; `= threshold` → no flag (at-threshold is not bloat); `= threshold + 1` → exactly one flag whose `docPath`/`lineCount`/`threshold` are correct. Multiple docs → only the over-threshold ones flagged.
- **Regrowth overlap matrix:**
  - Identical owned glob across two entries (`adws/triggers/**` vs `adws/triggers/**`) → one regrowth flag naming both docPaths.
  - Nested/subset globs (`adws/core/**` vs `adws/core/foo.ts`) → flagged.
  - Sibling-disjoint globs (`adws/vcs/**` vs `adws/core/**`) → **no** flag (no-false-positive, AC1).
  - Prefix-collision guard: `adws/core/**` vs `adws/coreutils/**` → **no** flag (segment-aware).
  - Legacy entries (`ownedGlobs: []`) — two of them, or one legacy + one real → **no** regrowth flag.
  - Single entry, or empty registry → no flags.
- **`globsOverlap` unit cases** for the matrix above (identical / nested / disjoint / segment-collision).
- **Purity:** calling the functions does not mutate the input arrays/objects.
- Run `bun run test:unit` and confirm green.

### Task 4 — Create the self-check wiring `adws/phases/docsSelfCheck.ts` (AC2, AC3)

- Define `RefactorFollowUp` (the routed record): `{ docPath: string; ownedGlobs: string[]; issueNumber?: number; }`.
- Define `DocsSelfCheckResult`: `{ flags: GuardFlags; routed: RefactorFollowUp[]; }`.
- Define injectable `DocsSelfCheckDeps` (mirror `UpgradeGateDeps`): `{ readFile(path): string; createIssue(title, body, repoInfo): number; findExistingRefactorIssue(repoInfo, docPath): number | null; log(message, level?): void; }`, plus a `buildDefaultDocsSelfCheckDeps()` factory wiring `fs.readFileSync`, `createIssue` (from `adws/github`), a label/title-search idempotency impl mirroring `findOpenUpgradeIssue`, and `log`.
- Define params: `{ worktreePath: string; producedDocPaths: string[]; repoInfo: RepoInfo; threshold?: number; }`.
- Implement `export function executeDocsPostWriteSelfCheck(params, deps = buildDefaultDocsSelfCheckDeps()): DocsSelfCheckResult`:
  1. Read `<worktreePath>/.adw/conditional_docs.md` via `deps.readFile`; `parseConditionalDocs` it. (Guard: if the file is missing/empty, parse the empty string — registry tolerates it.)
  2. Measure sizes: for each path in `producedDocPaths`, `deps.readFile` it and compute `lineCount = content.split('\n').length`; build `DocSize[]`. (Guard-clause around a missing produced doc — skip it, do not throw.)
  3. `const flags = runDocsGuards(registry.entries, sizes, params.threshold ?? DOC_BLOAT_THRESHOLD_LINES);`
  4. **Log both flag sets** (AC2): for each bloat and regrowth flag, `deps.log(...)` a structured one-line message naming the area (resolve a bloat flag's `docPath` → its entry's `ownedGlobs` for the "area" text). Also `AgentStateManager.appendLog` from the caller (see Task 5) so it lands in orchestrator state.
  5. **Route each bloat flag** (AC3): resolve the flag's `docPath` → owning entry → `ownedGlobs` (the module's source files / "area"). Idempotency: `deps.findExistingRefactorIssue(repoInfo, docPath)`; if an open refactor issue for this doc already exists, record it in `routed` (with its number) and skip filing. Otherwise `deps.createIssue(title, body, repoInfo)` with a **deterministic title** embedding the docPath (e.g. `` `docs-bloat`: app_docs/feature-vcs.md exceeds 400 lines — refactor adws/vcs/ ``) and a body that **names the area** (the owned globs as the refactor target file set, the line count, and that an oversized doc signals the module needs refactoring — there is no doc-split path). Push a `RefactorFollowUp{ docPath, ownedGlobs, issueNumber }` to `routed`. Wrap filing in try/catch and treat failure as non-fatal (log a warning, still return).
  6. Return `{ flags, routed }`.
- Keep nesting ≤ 2 (extract the per-bloat-flag routing into a named helper `routeBloatFlag(flag, registry, repoInfo, deps): RefactorFollowUp`). Keep the file < 300 lines and side effects only at this boundary.
- **Routing decision (recorded for the build agent):** prefer **filing a refactor issue** over invoking `/refactor`. `/refactor` applies coding-guideline fixes to changed *code* files and is blind to `app_docs/`; it is not a "module is oversized, redesign it" actor and running it inline would be heavy. A filed issue is a durable, decoupled work item naming the module + its source files that a human or a later ADW cycle can act on, and it fits ADW's issue-driven model. The frozen §5 is agnostic to mechanism, so this satisfies AC3.

### Task 5 — Wire the self-check into `executeDocumentPhase` (AC2)

- In `adws/phases/documentPhase.ts`, after the agent-success state write (around line 91) and before `runCommitAgent`, call the self-check non-fatally:
  - Derive `repoInfo`: `const repoInfo = config.targetRepo ? { owner: config.targetRepo.owner, repo: config.targetRepo.repo } : getRepoInfo(worktreePath);` (import `getRepoInfo` + `type RepoInfo` from `../github`).
  - `try { const selfCheck = executeDocsPostWriteSelfCheck({ worktreePath, producedDocPaths: [result.docPath], repoInfo }); AgentStateManager.appendLog(orchestratorStatePath, \`Docs self-check: ${selfCheck.flags.bloat.length} bloat, ${selfCheck.flags.regrowth.length} regrowth flag(s); routed ${selfCheck.routed.length} refactor follow-up(s)\`); } catch (e) { log(\`Docs post-write self-check failed (non-fatal): ${e}\`, 'warning'); }`
  - The self-check must **never** fail the document phase — it is advisory. (Commit/push proceed regardless.)
- Confirm the call site does not change the existing return shape (`{ costUsd, modelUsage, phaseCostRecords }`).

### Task 6 — Implement step definitions `features/per-issue/step_definitions/feature-611.steps.ts` (AC4)

Follow the frozen feature file's "Step-definition note" (drive the self-check **in-process**, the way feature-609 drives convergence). Reuse the registered Background phrase **G18** (`the ADW codebase is checked out`). Implement the 12 novel phrases:
- **Fixture seeding (Given steps):** create a temp fixture worktree; build `.adw/conditional_docs.md` via the registry module's `serializeConditionalDocs` with entries carrying explicit `ownedGlobs`; create the `app_docs/` doc files the entries point at. Resolve `"the area owning files under {string}"` → the entry whose owned glob matches that path-area prefix → that entry's `docPath`.
  - `a written module doc for the area owning files under {string} whose size exceeds the bloat threshold` — seed an entry owning a glob under `{string}`, write its doc **padded to `DOC_BLOAT_THRESHOLD_LINES + N` lines** (import the exported constant; **never hard-code a magic line count**).
  - `... whose size is within the bloat threshold` — write the doc a few lines long.
  - `a conditional-docs index with two entries whose owned globs both match files under {string}` — two entries both owning a glob under `{string}` (regrowth fixture).
  - `a conditional-docs index whose two entries own disjoint areas with no common file` — two entries owning sibling-disjoint globs.
  - `a second entry whose owned globs also match files under {string}` — appends a second overlapping entry to the current fixture index (for §6).
- **Action step (When):** `the post-write self-check runs` — call `executeDocsPostWriteSelfCheck` over the fixture (worktreePath = fixture root; producedDocPaths = the seeded doc(s) resolved from the Given area), injecting deps that **capture** the routed follow-ups and logged lines (an in-process recording `createIssue`/`log`, or the mock GitHub API). Stash the returned `{ flags, routed }` and captured logs on the World.
- **Assertion steps (Then):**
  - `the self-check emits a bloat flag for the area owning files under {string}` — assert `flags.bloat` contains a flag whose `docPath` is the entry owning `{string}`.
  - `the self-check emits no bloat flag for the area owning files under {string}` — assert no such bloat flag.
  - `the self-check emits a regrowth flag naming the two overlapping entries for files under {string}` — assert `flags.regrowth` contains a flag whose `docPathA`/`docPathB` are the two entries owning `{string}`.
  - `the self-check emits no regrowth flag` — assert `flags.regrowth` is empty.
  - `the bloat flag is routed to a refactor follow-up for the area owning files under {string}` — assert `routed` contains an entry naming that area (its `ownedGlobs`/`docPath`), satisfied by EITHER a recorded refactor-issue filing whose body names the area OR an in-process hand-off record naming the area.
  - `the self-check logs a bloat flag for the area owning files under {string}` / `... logs a regrowth flag for the two overlapping entries for files under {string}` — assert the captured logged output contains the corresponding flag for the area.
- Clean up the temp fixture worktree in an `After` hook.
- **Vocabulary:** these phrases are novel (the feature file records the registry gap and surfaces it to the maintainer). If the `generate_step_definitions` vocabulary gate (`features/regression/vocabulary.md`, per `.adw/scenarios.md`) blocks unregistered phrases for per-issue scenarios, register the new phrases or follow the per-issue free-form path used by prior per-issue features (e.g. feature-506) — do not alter the frozen `.feature` wording.

### Task 7 — Run the full validation suite (zero regressions)

- Run every command in **Validation Commands** below and confirm all pass: lint, type-check (root + `adws/tsconfig.json`), `bun run test:unit` (new `docsGuards.test.ts` green + no regressions), build, the `@adw-611` scenarios green, and the `@regression` suite green.

## Testing Strategy

### Unit Tests
`.adw/project.md` contains `## Unit Tests: enabled`, so unit tests are in scope (vitest).

- **`adws/core/__tests__/docsGuards.test.ts`** — pure table tests mirroring `conditionalDocsRegistry.test.ts` / `testVerdict.test.ts`:
  - **Bloat boundaries (AC1):** under / at / over the threshold by one line; at-threshold is **not** bloat (`>` semantics); only over-threshold docs flagged; flag fields (`docPath`, `lineCount`, `threshold`) correct; empty `sizes` → no flags.
  - **Regrowth overlap (AC1):** identical glob → flag; nested/subset glob → flag; sibling-disjoint → no flag (no false positive); `adws/core` vs `adws/coreutils` segment-collision → no flag; legacy (`ownedGlobs: []`) entries → never flagged; single/zero entries → no flags; flag names both entry docPaths.
  - **`globsOverlap`** direct cases for the matrix.
  - **Purity:** inputs not mutated.
- The self-check wiring (`docsSelfCheck.ts`) and document-phase integration are pinned by the BDD scenarios (ADW's primary validation surface), driven in-process — consistent with the project's "BDD scenarios as the plan/implementation contract" stance. The injectable `DocsSelfCheckDeps` keep that driving hermetic.

### Edge Cases
- **At-threshold doc** — exactly `DOC_BLOAT_THRESHOLD_LINES` lines → no bloat flag (boundary).
- **Legacy index entries (no `Owns:` block)** — the live `.adw/conditional_docs.md` is dominated by ~190 legacy entries with empty `ownedGlobs`; regrowth must **not** flag any pair of them (the no-false-positive guarantee at scale). Verified by unit test and implicitly by running the `@regression` suite against the real index.
- **Missing/empty `.adw/conditional_docs.md`** — self-check parses the empty string (registry tolerates) → no regrowth; no throw.
- **Missing produced doc file** — self-check skips measuring it (guard clause), no throw; document phase unaffected.
- **Idempotent routing** — a second document run that re-flags the same oversized doc must not file a duplicate refactor issue (title-search guard).
- **Self-check failure** — any throw inside the self-check is caught and logged; the document phase still commits/pushes and returns success (advisory, non-fatal).
- **Segment-collision globs** (`adws/core/**` vs `adws/coreutils/**`) — not overlapping; no regrowth false positive.
- **`*` vs `**` scope** — `adws/foo/*.ts` and `adws/foo/sub/**` share root `adws/foo` and are conservatively flagged as a possible overlap; document this as intended conservative behaviour (regrowth flags are advisory, not a hard gate), distinct from the disjoint sibling-root case which is never flagged.

## Acceptance Criteria

- [ ] **AC1 — Guards module (vitest):** `adws/core/docsGuards.ts` provides bloat detection correct at threshold boundaries (under/at/over by one; at-threshold not flagged) and regrowth (overlap) detection with **no false positives on disjoint entries** (including ≥190 legacy no-glob entries), covered by `adws/core/__tests__/docsGuards.test.ts`, all green under `bun run test:unit`.
- [ ] **AC2 — Phase runs guards + logs:** `executeDocumentPhase` runs the post-write self-check after `/document` writes and logs both the bloat and regrowth flag sets (to the logger and orchestrator state); a self-check failure is non-fatal.
- [ ] **AC3 — Bloat routed:** an emitted bloat flag is routed to a refactor follow-up (a filed refactor issue, idempotent by title) whose content **names the oversized doc's area** (its owned globs / source files).
- [ ] **AC4 — BDD `@adw-611`:** all 6 frozen scenarios pass — oversize doc emits a bloat flag (§1); within-budget doc emits none (§2); overlapping entries emit a regrowth flag (§3); disjoint entries emit none (§4); the bloat flag is routed onward naming the area (§5); the phase logs both flags (§6). Run via `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-611"`.
- [ ] **No regressions:** lint, type-check (root + adws), build, full vitest suite, and the `@regression` BDD suite all pass.
- [ ] **No `/document.md` behaviour change required** by this slice (guards are deterministic TypeScript run by the phase). The exported threshold constant is the single source of truth shared by the wiring and the BDD fixtures.

## Validation Commands

Execute every command to validate the feature works correctly with zero regressions (from `.adw/commands.md`):

- `bun run lint` — ESLint; zero errors.
- `bunx tsc --noEmit` — root type-check; zero errors.
- `bunx tsc --noEmit -p adws/tsconfig.json` — additional `adws/` type-check; zero errors.
- `bun run test:unit` — vitest; the new `docsGuards.test.ts` passes and the full suite is green (no regressions).
- `bun run build` — `tsc` build; succeeds.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-611"` — the 6 frozen per-issue scenarios pass end-to-end (bloat emit/no-emit, regrowth emit/no-emit, route, log-both).
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — the regression suite stays green (confirms regrowth produces no false positives over the real ~190-entry index).

## Notes

- **Adhere to `.adw/coding_guidelines.md`:** the guards module is pure (values in, flags out — no I/O); side effects (fs read, `createIssue`, logging) live only in `docsSelfCheck.ts` at the phase boundary. Keep every new/edited file < 300 lines, use guard clauses to keep nesting ≤ 2 (extract the per-pair overlap check and the per-bloat-flag routing into named helpers), avoid `any`, and prefer `map`/`filter` over imperative loops.
- **Single source of truth for the index format:** the guards consume the registry module's parsed entries and `matchesGlob` — do **not** re-parse `.adw/conditional_docs.md` markdown or re-implement globbing in the guards. This is the PRD's explicit "registry module is the single source of truth" decision.
- **Threshold is an exported constant** (`DOC_BLOAT_THRESHOLD_LINES`), imported by both the wiring and the BDD fixtures, so the at-threshold boundary tracks any retune (the frozen feature file mandates building the fixture boundary from the exported threshold — never a hard-coded line count). Measured in **lines** (`content.split('\n').length`). Making the threshold `.adw/`-configurable is a future extension and out of scope.
- **Routing mechanism:** file a refactor issue (recommended) rather than invoking `/refactor`. Rationale recorded in Task 4. The frozen §5 is mechanism-agnostic, so a filed issue satisfies AC3; the issue body must name the module area (owned globs) as the refactor target.
- **`/document.md` is NOT modified by this slice.** The convergence prompt rewrite was #609; this slice adds deterministic guards run by the phase. **Pre-existing worktree state to be aware of:** this worktree currently has uncommitted working-tree changes that **revert** `.claude/commands/document.md` and `.claude/commands/adw_init.md` to their pre-#609 (old per-run-snapshot, no `Owns:` globs) format — visible in `git status`/`git diff` against `HEAD`. This appears to be a worktree-setup asset-copy artifact, not part of #611's committed base. It is a **#609 integrity concern, not #611 scope**, and #611's deliverables (pure guards + phase wiring + tests/scenarios) are correct regardless. **Recommendation:** restore both files to `HEAD` (`git checkout HEAD -- .claude/commands/document.md .claude/commands/adw_init.md`) before the document phase runs in anger, so `/document` keeps emitting the `Owns:` globs that the regrowth guard consumes; flag to the maintainer if unsure. Do not let this slice silently re-commit the reversion.
- **Self-check scope per run:** bloat is measured on the doc(s) the run produced (`result.docPath`), not the whole `app_docs/` corpus — this keeps the check scoped to this run's output and avoids filing refactor issues for unrelated pre-existing docs. Regrowth is computed over the whole parsed index (a new entry can overlap any existing one).
- **Hash-input propagation:** the guards (`adws/core/docsGuards.ts`) and wiring (`adws/phases/docsSelfCheck.ts`) are framework TypeScript, not `.adw/` templates, so they ship to target repos via the normal framework version — no `hashInputs` change is needed for this slice (unlike a `/document.md` prompt change, which would be a hash input). The convergence + self-check behaviour reaches target repos because it runs in the framework's document phase.
- **No new libraries** are required (the glob matcher is the registry module's zero-dependency implementation, reused/extended). If that changes, install via `bun add <package>` per `.adw/commands.md`.
- **BDD scenarios are already frozen** (`features/per-issue/feature-611.feature`, gherkin-freeze): implement to satisfy them; do not edit the `.feature` wording. The 6 scenarios expand the issue's 2 named outcomes with boundary (no-emit) and wiring (route, log-both) coverage.

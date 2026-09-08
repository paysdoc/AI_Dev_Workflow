# Living-Docs System — Document Phase, Convergence Registry, Post-Write Guards, and Whole-Index Health

## Overview

This is the whole living-docs pipeline: the orchestrator phase that invokes `/document` after a workflow's build+review complete, the registry module that parses/serializes/collapses `.adw/conditional_docs.md` so `/document` converges onto one entry per module instead of appending, the pure per-write guards that flag an oversized or newly-overlapping doc at write time, and — since #810 — a periodic whole-index health check enforced both by a CI gate and a cron sweep, because write-time convergence alone let 177 dangling entries and 64 overlapping globs accumulate silently for two months after the June 2026 living-docs migration (#609–#612) was partially reverted by conflict-resolution merges that kept a stale branch's whole 191-entry index instead of the migrated 47-entry one.

## Responsibilities

### The document phase (`adws/phases/documentPhase.ts`)

- Posts a `document_running` stage comment on the issue via `repoContext`
- Invokes `runDocumentAgent` with the ADW ID, logs directory, spec file path, and an optional screenshots directory
- On agent failure, posts `document_failed` and throws, halting the workflow
- On success, runs `runCommitAgent` to commit the generated documentation files, then pushes via `pushBranch`
- Posts a `document_completed` stage comment and records the phase cost

### The convergence registry (`adws/core/conditionalDocsRegistry.ts`)

- Parses `.adw/conditional_docs.md` into a structured `ConditionalDocsRegistry` (preamble + ordered `ConditionalDocEntry` records: `docPath`, `ownedGlobs`, `conditions`) and serializes it back, round-trip lossless
- Matches changed file paths against entries' owned globs (`findOwningEntry`, `findOwningEntries`) via a pure, zero-dependency glob matcher (`**` spans path separators, `*` does not, `?` matches one char)
- Collapses sibling entries that describe the same area into one (`collapseEntries`): unions their globs (de-duplicated, order-preserving), inserts the merged entry at the first collapsed entry's position, returns `prunedDocPaths` for the caller to delete from disk — immutable, and a no-op when a path in the collapse set is absent from the registry
- Pure upsert (`upsertEntry`): replaces an entry in place by `docPath`, or appends when novel; two upserts of the same `docPath` never grow the array
- Exposes `conditionalDocs: ConditionalDocsRegistry` as a structured field on `ProjectConfig` (the raw string stays available as `conditionalDocsMd` for LLM-facing consumers)

### Per-write guards (`adws/core/docsGuards.ts`, `adws/phases/docsSelfCheck.ts`)

- `docsGuards.ts` is pure, no I/O: given parsed entries and produced-doc sizes, computes `BloatFlag[]` (a produced doc exceeds `DOC_BLOAT_THRESHOLD_LINES = 400`) and `RegrowthFlag[]` (two entries' owned globs overlap) via a segment-aware `globsOverlap` that never false-positives on legacy entries (`ownedGlobs: []`) or sibling-disjoint roots
- `docsSelfCheck.ts` wires the guards into `documentPhase.ts` as a non-fatal post-write step (runs after `runDocumentAgent` succeeds, never blocks commit/push): reads and parses the index, measures only the **current run's produced doc** sizes (not the whole corpus), logs both flag sets, and routes each bloat flag to an idempotent-by-title refactor issue naming the module's owned globs

### Whole-index health (`adws/core/docsIndexHealth.ts`, `adws/core/docsIndexReportBody.ts`) — #810

- `docsIndexHealth.ts` is the pure decision core shared by the CI gate and the cron sweep — given the index content and the repo's file list, classifies every finding as a deterministic **repair** (`drop-dangling-entry`: a `docPath` with no file behind it, resolved against the repo root so top-level `README.md`/`adws/README.md` are never mistaken for `app_docs/` members; `prune-dead-glob`: an `Owns:` glob matching zero tracked files — an entry whose every glob dies keeps its place as a legacy entry, it is never dropped) or a judgement-required **violation** (`non-canonical` serialization, `duplicate-entry`, `orphan-doc` — an `app_docs/feature-*.md` file no entry indexes, `overlap` — aggregated per unordered entry pair with every file both own, `count-out-of-band` against a `CountBand`)
- `assessDocsIndexHealth(inputs, band)` parses → computes repairs → applies them immutably (`applyRepairs`) → computes violations **on the repaired registry**, so a dropped dangling entry never also trips the count band and a pruned dead glob never also appears in an overlap
- `DEFAULT_COUNT_BAND = {min: 25, max: 60}` is the single source of truth for the count check (44 module docs + 2 READMEs + headroom; the lower bound is what would have caught the June regression)
- `formatRepair`/`formatViolation` are the shared one-line renderers the gate's report, the sweep's log, and the sweep's PR/issue bodies all use (overlap lines truncate to 5 files then `… and N more`)
- `docsIndexReportBody.ts` builds the sweep's single report issue: `DOCS_INDEX_REPORT_MARKER` (`Reconciles: docs-index-health`) + an order-independent sha1 `Fingerprint:` line (`docsIndexViolationFingerprint`) let `findOpenDocsIndexReport` reconcile against the lowest-numbered open issue carrying the marker, mirroring `promotionReconcileLink.ts`'s shape

### The CI gate (`adws/checkLivingDocsIndex.ts`) — rewritten for #810

- `bun run lint:docs-index`, run in `.github/workflows/git-cli-guard.yml` on every `pull_request`/`push`. Credential-free: lists repo files with a filesystem walk (`listRepoFiles`, skipping `.git`/`node_modules` anywhere and `.worktrees`/`dist`/`coverage`/`logs`/`agents` **only at the repo root** — a bare basename match would wrongly prune `adws/agents/`, `adws/phases/logs/`, etc.) instead of `git ls-files`, so it constructs no `GitContext` and needs no forge access
- Exports `runLivingDocsIndexCheck(rootDir)` behind the `checkLivingDocsIndex` argv guard; prints a PASS/FAIL line per check (round-trip, dangling, orphans, duplicates, overlaps, count-in-band) plus a non-fatal `⚠ WARN` block for dead globs (a chore PR renaming a file must not be blocked by CI; the sweep prunes it within a cadence). Exit code is 1 iff any violation or any `drop-dangling-entry` repair
- `adws/core/docsIndexHealth.ts` is the gate's only implementation of the checks — the gate and the cron sweep share it so they can never drift apart

### The cron sweep (`adws/triggers/docsIndexSweep.ts`, `docsIndexSweepDefaults.ts`) — #810

- Dispatched from `trigger_cron.ts`'s `runDocsIndexSweepTick(cycleCount)` on `DOCS_INDEX_SWEEP_INTERVAL_CYCLES` (default 4320 ≈ daily), mirroring `runPromotionSweepTick`/`runPerIssueScenarioSweepTick`: cadence gate, then a null-launch-context skip (logged, never a cwd-derived fallback), then a non-fatal swallow of any throw
- Reads the index and lists tracked files from a dedicated worktree synced to fresh `origin/<default>` (`perIssueSweepPersist.ts`'s `prepareSweepBase`, generalised via `SweepPersistSpec` so this sweep gets its own `chore/docs-index-sweep` branch/PR copy — `DOCS_INDEX_SWEEP_SPEC` — instead of colliding with the per-issue sweep's `chore/scenario-sweep`), assesses health, and: persists any repairs through `persistCommitViaPr` (a generalised `persistRemovalViaPr`) as an immediately-merged PR — never a direct commit; reconciles violations into at most one open `hitl` + `adw:none` issue (`adw:none` so the cron's auto-pickup never hands a judgement call to an agent — a human relabels to `adw:chore` to delegate), refreshed only when the violation-set fingerprint changes, closed when the index goes clean
- The count band applies **only to the self-host (framework) repo** (`boundary.gitContext.selfHost ? DEFAULT_COUNT_BAND : null` in `makeDocsIndexSweepDefaults`) — a freshly initialised target repo's tiny index must never trip it
- `cleanupSweepBase`'s `finally`-block `deleteRemoteBranch` fires on every exit path (merge success or failure) — a failed merge leaves the repair unlanded (never committed to the shared base) and the next cadence re-derives and re-attempts the same deterministic repair from fresh `origin/<default>`

## Contracts & Invariants

- **Document phase:** throws on agent failure (callers propagate to `handleWorkflowError`); the commit uses the orchestrator's `issueType`; `repoContext` is optional (stage comments silently skipped, phase still executes); `pushBranch` is called unconditionally and does not throw on a no-op push
- **Registry:** `serializeConditionalDocs(parseConditionalDocs(content)) === content` for any canonical input; legacy entries (no `Owns:`) parse to `ownedGlobs: []`, never match by glob, but may still be routed to semantically by `/document`; all registry functions are pure — no filesystem I/O
- **Per-write guards:** bloat boundary is strictly greater (`lineCount > threshold`); legacy entries never cause regrowth flags; the self-check is non-fatal (any throw inside `executeDocsPostWriteSelfCheck` is caught in `documentPhase.ts` and logged as a warning); bloat routing is idempotent by issue title
- **Whole-index health:** violations are computed on the **repaired** registry, never the raw one; `isFeatureDocPath` matches only direct-child `app_docs/feature-*.md` (excludes `app_docs/assets/**`); an entry whose every glob dies keeps its `Conditions:` and is never dropped by a glob-only repair
- **Gate:** a dangling entry or any judgement violation fails the gate; a dead glob alone does not; the gate imports nothing from `adws/github/gitContextFactory` and constructs no `GitContext`
- **Sweep:** files at most one open `hitl`+`adw:none` issue per repo, reconciled by the `Reconciles: docs-index-health` + fingerprint marker (lowest issue number wins on a tie, exactly as `promotionReconcileLink.ts`); every repair lands only through a merged PR, never a direct commit on the cron host's own checkout; a target-repo tick repairs only the target's index, never the framework's, and every repo operation is issued through the cron's launch context
- **Migration invariants (historical, still enforced by the gate):** after convergence, every index entry's `docPath` exists on disk, every `app_docs/feature-*.md` on disk has exactly one index entry, no duplicate `docPath`s, and no two entries' `ownedGlobs` claim a common file

## Configuration

- `DOC_BLOAT_THRESHOLD_LINES` (`adws/core/docsGuards.ts`): 400 lines, shared by the per-write wiring and its BDD fixtures
- `DocsSelfCheckDeps` (`adws/phases/docsSelfCheck.ts`): injectable `readFile`/`createIssue`/`findExistingRefactorIssue`/`log`; `buildDefaultDocsSelfCheckDeps()` wires the real fs/GitHub APIs
- `DEFAULT_COUNT_BAND` (`adws/core/docsIndexHealth.ts`): `{min: 25, max: 60}`, the single source of truth for both the gate and the sweep
- `DOCS_INDEX_SWEEP_INTERVAL_CYCLES` (`adws/core/config.ts`, default `4320`): cron cadence for the docs-index sweep, alongside its siblings `PER_ISSUE_SCENARIO_SWEEP_INTERVAL_CYCLES`/`PROMOTION_SWEEP_INTERVAL_CYCLES`
- `DOCS_INDEX_SWEEP_SPEC` (`adws/triggers/docsIndexSweepDefaults.ts`): the sweep's dedicated branch (`chore/docs-index-sweep`) and PR title/body
- `package.json`'s `lint:docs-index` script (`bunx tsx adws/checkLivingDocsIndex.ts`) and `.github/workflows/git-cli-guard.yml`'s `docs-index` job wire the gate into CI
- Manual invocation: `bunx tsx adws/checkLivingDocsIndex.ts [rootDir]` for the gate; `bunx tsx adws/triggers/docsIndexSweep.ts [--target-repo owner/repo]` for an immediate sweep (the first cadence-eligible cron tick otherwise fires ~24h after cron start)

## Gotchas

- **Per-write guards and whole-index health are deliberately separate implementations, not layers of the same check.** `docsGuards.ts`'s `checkRegrowth` uses a segment-prefix heuristic tuned to be conservative for a per-write advisory (it would false-positive on `adws/foo/*.ts` vs `adws/foo/sub/**`, which own disjoint files); `docsIndexHealth.ts`'s overlap check is exact and file-based because it is a hard CI gate that must never cry wolf. Do not fold one into the other.
- **Convergence has no notion of a dangling entry and only ever touches the area of the current change** — this is precisely the gap #810's periodic sweep/gate exist to close; a feature branch cut before a mass-deletion migration merge, or a `resolve_conflict` textual-union resolution, can silently reintroduce hundreds of dangling entries that `/document` will never notice on its own.
- **`collapseEntries` does not delete files** — it returns `prunedDocPaths` but never touches the filesystem; the caller (`/document`, or a hand-driven convergence pass) must `git rm` those `app_docs/` files and serialize the returned registry back to disk. (`git rm <path>` on a hyphenated filename can trip this repo's `pre-tool-use.ts` rm-safety hook via an overly broad regex on `-[a-z]*r`-shaped substrings inside the path itself, not an actual flag — if blocked, remove the file with `fs.unlinkSync` plus `git add -- <path>` to stage the deletion instead of retrying `git rm`.)
- **The gate's filesystem walk skips `agents`/`logs`/`.worktrees`/`dist`/`coverage` only at the repo root** — matching them by bare basename anywhere in the tree (as an earlier draft of this gate did) wrongly prunes legitimate nested source directories that happen to share a name, such as `adws/agents/` or `adws/phases/logs/`, silently marking every `Owns:` glob into them as a dead glob.
- **Dead globs are gate warnings, not failures** — `adwChore` has no document phase, so a chore PR that renames a file with an explicit `Owns:` glob must not be blocked; the sweep repairs it within one cadence instead.
- **The count band is skipped entirely (`countBand: null`) off the self-host repo** — it is ADW-calibrated and would false-alarm on a freshly initialised target repo's small index.
- **`resolve_conflict` resolving `.adw/conditional_docs.md` by textual union instead of through the registry (parse → collapse → serialize) is the root cause of the June 2026 regression and remains unfixed** — it is out of scope for #810 and deserves its own issue; until it lands, a conflict on this file should be resolved by hand through the registry module, never by keeping "the whole file" from either side.
- **`checkLivingDocsIndex.ts` takes an optional `[rootDir]` CLI argument** (defaults to `process.cwd()`) specifically so it can be exercised against `fs.mkdtempSync` fixtures in tests without touching the real checkout.

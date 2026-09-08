# Feature: Docs index health — cron sweep + CI gate for `.adw/conditional_docs.md`

## Metadata
issueNumber: `810`
adwId: `o0g36j-docs-index-health-cr`
issueJson: `{"number":810,"title":"Docs index health: cron sweep + CI gate for conditional_docs.md (living-docs regrowth after #612)","body":"## Parent PRD\n\nspecs/prd/app-docs-module-living-docs.md\n\n## Background — why the living-docs consolidation silently regressed\n\n#609–#612 shipped the per-module living-docs model and were merged to `dev` on 2026-06-19 (PR #642, `c7bf098b`): 47 index entries ↔ 47 module docs, `checkLivingDocsIndex.ts` green.\n\nWithin 48 h it was undone. Feature branches cut before the migration still carried the old 191-entry `.adw/conditional_docs.md`. Where git could auto-merge, the migration survived (`e750d842`, `7e3e3264` both stayed at 47). Where the migration's mass deletion collided with a branch's appended entry in the same hunk, the ADW `resolve_conflict` agent resolved by keeping the branch's whole file:\n\n| commit | entries | |\n|---|---|---|\n| `c7bf098b` | 47 | migration merged (#642) |\n| `926d8657` | 195 | \"merge: resolve conflicts between feature-issue-641 … and dev\" |\n| `d918ef65` | 217 | \"merge: resolve conflicts between feature-issue-638 … and dev\" |\n| `9125bc3a` | 217 | dev → main (#656) |\n\nNothing caught it because `checkLivingDocsIndex.ts` was scoped as a **one-off migration acceptance gate** — never wired into CI or `package.json` — and the `/document` post-write guards only inspect the entry being written (legacy entries have no `Owns:`, so the regrowth guard cannot see them). The PRD deliberately chose write-time convergence over a periodic backstop; convergence has no notion of \"dangling entry\" and only touches the area of the current change, so 177 dead entries in untouched areas persisted for two months while `/document`, unable to route to the missing module owners, created new overlapping docs instead (64 overlapping `Owns:` globs by 2026-08-28).\n\nCost: every planner read ~45k tokens of index, 58 % dead links, and could not find the module docs that would have answered in one read (the #797 plan agent hit the 30-min watchdog at ~600k context tokens).\n\n**One-off repair applied by hand on 2026-08-28** (deterministic, via the registry module; on `dev`): dropped 177 dangling entries, re-indexed the 25 orphaned module docs verbatim from `c7bf098b`, pruned 5 dead globs, resolved all 37 overlapping pairs by the rule *module doc keeps its package globs; feature doc loses the overlapping glob; feature-vs-feature → newest doc, with two explicit overrides (`checkLivingDocsIndex.ts` → convergence-registry doc, `docsSelfCheck.ts` → post-write-guards doc)*. Result: 70 entries / 86 KB (was 222 / 179 KB), gate passes round-trip, orphans, duplicates and overlaps; still fails the count band and a gate bug (below).\n\n## What to build\n\nMake index health a **periodic, whole-index** property, not a per-write side-effect.\n\n1. **Cron docs-index sweep** — `adws/triggers/docsIndexSweep.ts`, dispatched from `trigger_cron.ts` on `DOCS_INDEX_SWEEP_INTERVAL_CYCLES` (mirror `runPerIssueScenarioSweepTick` / `runPromotionSweepTick`: acts on the cron's launch-boundary `GitContext`, skips non-fatally without one). Each tick, using `parseConditionalDocs`/`serializeConditionalDocs`:\n   - **auto-repair, deterministic:** drop entries whose `docPath` does not exist; prune `Owns:` globs matching zero tracked files; persist via the dedicated worktree + branch + immediately-merged PR path (`perIssueSweepPersist.ts` pattern), never a direct commit on the shared checkout.\n   - **report, judgment required:** overlapping `Owns:` globs, orphan docs, entry count outside band → file exactly **one** open `hitl`-labelled issue (reconcile against an existing open one via a back-link, as `promotionReconcileLink.ts` does), listing the offending pairs.\n   - Pure decision logic in `adws/core/docsIndexHealth.ts` (checks → `{repairs, violations}`), unit-tested; the sweep is the thin I/O shell.\n2. **CI gate** — `bun run lint:docs-index` → `adws/checkLivingDocsIndex.ts`, added to `.github/workflows/git-cli-guard.yml` (or a sibling workflow) so a merge can never land a broken index again. Prerequisites in the gate itself:\n   - fix the dangling check: it resolves every `docPath` under `app_docs/`, so the legitimate top-level entries `README.md` and `adws/README.md` are reported as dangling;\n   - remove its `gitContextForRepo` call (transitional allowlist entry in `adws/guard/constructionRule.ts`) — the gate needs no forge access;\n   - share the check implementations with `docsIndexHealth.ts` rather than duplicating them;\n   - reconsider `MAX_ENTRIES = 60` vs the current 44 module docs + 2 READMEs + registry doc: either make the band module-count-derived or fold the 24 post-migration feature docs into their module docs (task 3).\n3. **Convergence pass** to get inside the band: fold these post-migration feature docs into the owning `feature-9gjajh-*` module docs (content merge, rewrite-in-place; `collapseEntries` for the index): `hrl5jd`, `t6m62c`, `n9880l`, `sh8m9r`, `s59wpc`, `ni6fpk`, `mnmihl`, `lnef5d`, `78celh`, `tlk8qf`, `6uquvb`, `ne2we8`, `vpb048`, `ih6ju7`, `d0hv98`, `oqb76h`, `e2er82`, `k817bh`, `k2tkdn`, `bq1f45`, `2ubuuc`, `0rvmyc`, `mk1wgc`, `o4qdu5`. `oqb76h` (gitContext base-path authority) is effectively the module doc for `adws/gitContext/` — promote it to one rather than folding it.\n\n## Acceptance criteria\n\n- [ ] `bunx tsx adws/checkLivingDocsIndex.ts` exits 0 on `dev` and runs in CI on every PR\n- [ ] Cron sweep auto-prunes dangling entries / dead globs via a merged sweep PR, and files at most one open `hitl` issue for overlap/orphan/count violations\n- [ ] A synthetic regression (restore 20 dangling entries on a branch) is caught by CI and repaired by the sweep\n- [ ] Index entry count within the gate's band; zero overlapping `Owns:` globs; zero orphan docs\n- [ ] Sweep and gate act only on the launch-boundary repo; `bun run lint:git-guard` green\n\n## Follow-up (not in scope here)\n\n- `resolve_conflict` must resolve `.adw/conditional_docs.md` through the registry (parse → collapse → serialize), never by textual union — the root cause of the June revert. Deserves its own issue.\n\n## Blocked by\n- Blocked by #797\n\n## Touched Files\n\n- adws/triggers/docsIndexSweep.ts (new), adws/triggers/trigger_cron.ts\n- adws/core/docsIndexHealth.ts (new), adws/core/environment.ts\n- adws/checkLivingDocsIndex.ts, adws/guard/constructionRule.ts\n- package.json, .github/workflows/git-cli-guard.yml\n- .adw/conditional_docs.md, app_docs/\n\n## User stories addressed\n\n- PRD user stories 5, 6, 12 (collapse siblings, no regrowth, flag convergence misfires) — made durable by a whole-index periodic check instead of write-time-only.\n","state":"OPEN","author":"paysdoc","labels":["adw:feature"],"createdAt":"2026-08-28T11:31:25Z","comments":[],"actionableComment":null}`

## Feature Description

`.adw/conditional_docs.md` is the registry every planner reads to decide which `app_docs/` module docs to load. Its health is currently a per-write side-effect: `/document` converges only the area it touches, the post-write guards only see the entry being written, and `adws/checkLivingDocsIndex.ts` is a one-off migration acceptance script that nobody runs. That is how the June 2026 living-docs consolidation was silently undone within 48 hours and stayed broken for two months.

This feature makes index health a **periodic, whole-index property** enforced at two points:

1. **A pure health module** (`adws/core/docsIndexHealth.ts`) that, given the index content and the repo's file list, classifies every finding as either a deterministic **repair** (dangling entry, dead `Owns:` glob) or a judgment-required **violation** (non-canonical serialization, duplicate `docPath`, orphan doc, overlapping `Owns:` globs, entry count outside the band). One implementation, two consumers.
2. **A cron docs-index sweep** (`adws/triggers/docsIndexSweep.ts`) that, on a daily cadence and only for the cron's launch-boundary repo, applies the repairs through a dedicated worktree + branch + immediately-merged PR (the `perIssueSweepPersist.ts` path, generalised) and reconciles the violations into exactly one open `hitl` issue (refreshed when the violation set changes, closed when the index is clean again).
3. **A CI gate** (`bun run lint:docs-index` → the rewritten `adws/checkLivingDocsIndex.ts`) that runs on every PR and push, needs no GitHub credentials, resolves `docPath`s against the repo root (so `README.md` and `adws/README.md` are no longer false dangling), and fails on every violation and every dangling entry so a merge can never land a broken index again.
4. **A convergence pass** that folds 23 post-migration feature docs into their owning module docs (and promotes `feature-oqb76h-…` to the `adws/gitContext/` module doc), bringing the index from 70 entries to 47 — inside the gate's `[25, 60]` band with zero overlaps and zero orphans.

## User Story

As an ADW maintainer (and as every planning agent that primes on this repo)
I want the docs index to be checked and repaired as a whole on a schedule, and to be gated in CI on every PR
So that a stale, overlapping or dangling `.adw/conditional_docs.md` can never again silently persist for months and cost every planner tens of thousands of tokens of dead links

## Problem Statement

- `checkLivingDocsIndex.ts` is not wired into `package.json` or CI, so no merge is gated on index health. It also has two defects: every `docPath` is resolved as an `app_docs/feature-*.md` listing member (so the legitimate `README.md` / `adws/README.md` entries are reported dangling), and it constructs a `GitContext` via `gitContextForRepo` (a transitional allowlist entry in `adws/guard/constructionRule.ts`) just to run `git ls-files` — which also means it needs forge credentials and cannot run in a bare CI checkout.
- Nothing periodic looks at the whole index. Convergence in `/document` has no concept of a dangling entry and only touches the current change's area; the post-write regrowth guard cannot see legacy entries (no `Owns:`). The 2026-08-28 hand repair fixed the state once but not the mechanism.
- The hand-repaired index still fails the gate: 70 entries against `MAX_ENTRIES = 60`, and one overlapping pair (`feature-9gjajh-providers.md` owns `adws/providers/**` while `feature-e2er82-github-forge-adapter.md` owns five files under it). Verified on this branch: `bunx tsx adws/checkLivingDocsIndex.ts` reports 3 failing checks (dangling READMEs, 5 overlapping files in that one pair, count 70 > 60); the segment-prefix `checkRegrowth` in `docsGuards.ts` flags the same single pair; there are currently 0 dead globs and 8 entries without `Owns:` (6 feature docs + the 2 READMEs).

## Solution Statement

- **Pure core, thin shells.** `adws/core/docsIndexHealth.ts` exposes `assessDocsIndexHealth({ content, files }, countBand)` → `{ registry, repairs, repaired, violations }`. Repairs are computed on the parsed registry, applied immutably to produce `repaired`, and violations are computed on `repaired` (so a dropped dangling entry no longer counts toward the band). Both the gate and the sweep call this one function and share its formatting helpers; `docsGuards.ts` (per-write, segment-prefix regrowth heuristic) is left untouched — it serves the `/document` self-check, not the whole-index check.
- **Gate without git.** The gate lists repo files with a filesystem walk (skipping `.git`, `node_modules`, `.worktrees`, `dist`, `coverage`, `logs`, `agents`) instead of `git ls-files`. In a CI checkout that is exactly the tracked set; locally the only difference is untracked files, which cannot mask an overlap or a dangling entry. Dead globs are reported as **warnings** by the gate (a chore PR has no document phase, so a rename must not block it — the sweep repairs it within a day); everything else fails. The gate accepts an optional `[rootDir]` argument so it can be exercised against fixtures, and exports `runLivingDocsIndexCheck(rootDir)` behind the same argv guard `checkGitGhGuard.ts` uses. With the `gitContextForRepo` import gone, the transitional allowlist entry for `adws/checkLivingDocsIndex.ts` is deleted — the guard's stale-entry ratchet would fail the build otherwise.
- **Sweep mirrors the siblings.** `runDocsIndexSweep({ boundary, …deps })` lists tracked files and reads the index from a dedicated worktree synced to fresh `origin/<default>` (`prepareSweepBase` generalised with a `SweepPersistSpec` so `perIssueScenarioSweep` keeps its `chore/scenario-sweep` branch and the docs sweep gets `chore/docs-index-sweep`), persists the repaired index through `persistCommitViaPr` (a generic extraction of `persistRemovalViaPr`, which becomes a one-line wrapper), and reconciles violations into one `hitl` issue via a `Reconciles: docs-index-health` body marker plus a violation-set fingerprint (lowest issue number wins, as `promotionReconcileLink.ts`). The report issue also carries `adw:none` so the cron's auto-pickup (which classifies any unlabelled issue) does not hand a judgment call to an agent; the body tells the human how to delegate by relabelling. `trigger_cron.ts` gains `runDocsIndexSweepTick` on `DOCS_INDEX_SWEEP_INTERVAL_CYCLES` (default 4320 ≈ daily), with the same cadence gate / null-boundary skip / non-fatal swallow as the other two ticks. The count band is only enforced for the self-host (framework) repo — it is ADW-calibrated and would false-alarm on a freshly initialised target repo.
- **Band stays fixed, index shrinks.** `DEFAULT_COUNT_BAND = { min: 25, max: 60 }` moves into the health module as the single source of truth (a module-count-derived band is circular, since the bijection check already ties entries to docs). The convergence pass brings the index to 47 entries, leaving headroom for genuinely novel modules; the min bound keeps catching a mass-deletion merge accident.

## Relevant Files

Use these files to implement the feature:

- `README.md` — project overview; the feature list gets a bullet for the docs-index gate + sweep alongside the existing "CI-enforced git/gh guardrail" bullet.
- `.adw/coding_guidelines.md` — pure core / side effects at the edges, guard clauses, max nesting 2, files under 300 lines, no `any`, JSDoc on public APIs. Applies to every new module here.
- `.adw/project.md` — `## Unit Tests: enabled`; `bun add <package>` for libraries (none needed).
- `.adw/commands.md` — validation commands (`bun run lint`, `bunx tsc --noEmit`, `bunx tsc --noEmit -p adws/tsconfig.json`, `bun run test:unit`, `bun run build`, cucumber by tag).
- `adws/core/conditionalDocsRegistry.ts` — `parseConditionalDocs`, `serializeConditionalDocs`, `matchesGlob`, `findOwningEntries`, `collapseEntries`. The health module builds on these and never re-implements glob matching.
- `adws/core/docsGuards.ts` — the per-write guards (`checkRegrowth` uses a segment-prefix heuristic). Left as-is; the plan explains why the whole-index overlap check is file-based instead.
- `adws/checkLivingDocsIndex.ts` — the gate to rewrite: keep its PASS/FAIL output style, move every check into the health module, drop the `gitContextForRepo`/`readLocalRepoInfo`/`REPO_ROOT` imports, add the `[rootDir]` argument and the export + argv guard.
- `adws/checkGitGhGuard.ts` — the sibling CI script: its `collectTsFiles`/`visitDir` walker and its `if (process.argv[1]?.includes('checkGitGhGuard')) main();` guard are the patterns for the gate's walker and entry guard.
- `adws/guard/constructionRule.ts` — delete the `{ file: 'adws/checkLivingDocsIndex.ts', … owner: '#796' }` transitional entry; `findStaleSanctionedEntries` fails the guard while it is present and the file no longer constructs anything.
- `adws/triggers/trigger_cron.ts` — add `boundDocsIndexSweep()` + `runDocsIndexSweepTick()` mirroring `boundPromotionSweep()` / `runPromotionSweepTick()`, and call the tick in `checkAndTrigger` right after `runPromotionSweepTick(cycleCount)`.
- `adws/triggers/perIssueScenarioSweep.ts` — the sibling sweep whose lazily-memoised `SweepBase`, injectable deps and `finally { cleanupSweepBase }` shape the docs sweep copies.
- `adws/triggers/perIssueSweepPersist.ts` — generalise: `SweepPersistSpec`, `prepareSweepBase(boundary, spec = PER_ISSUE_SWEEP_SPEC)`, `persistCommitViaPr(commit, base)`; `persistRemovalViaPr` stays as a wrapper so `perIssueScenarioSweep.ts` and its tests are untouched.
- `adws/triggers/promotionSweep.ts` / `adws/triggers/promotionSweepDefaults.ts` — the `makeDefaultDeps(boundary)` factory pattern (production deps closing over the boundary, split into a `*Defaults.ts` file for length) and the CLI entry guard (`process.argv[1]?.includes('promotionSweep')` + `buildLaunchBoundary(parseTargetRepoArgs(...))`).
- `adws/core/promotionReconcileLink.ts` — the back-link marker + lowest-issue-number reconcile pattern the report reconcile copies.
- `adws/core/promotionIssueBody.ts` — the pure `{ title, body, labels }` issue-spec builder pattern; `HITL_LABEL = 'hitl'` lives there as a private constant today.
- `adws/phases/docsSelfCheck.ts` — how the post-write self-check files/reuses a follow-up issue idempotently (for contrast: this feature reconciles by body marker, not title).
- `adws/core/config.ts` — `PER_ISSUE_SCENARIO_SWEEP_INTERVAL_CYCLES` / `PROMOTION_SWEEP_INTERVAL_CYCLES` live here (not in `environment.ts` as the issue's touched-files list says); add `DOCS_INDEX_SWEEP_INTERVAL_CYCLES` beside them.
- `adws/core/index.ts` — barrel: export the new constant and the health module's public API.
- `adws/core/launchGitContext.ts` — `LaunchBoundary` (`gitContext`, `repoId`, lazy `providers`); `gitContext.selfHost` decides whether the count band applies in the sweep.
- `adws/gitContext/gitContext.ts` — `lsFiles(cwd, prefix?)`, `addAndCommitPaths(paths, message, worktreePath)`, `createWorktreeForNewBranch`, `removeWorktree`, `pushBranch`, `deleteRemoteBranch` — everything the sweep needs; no new git primitives.
- `adws/providers/types.ts` — `IssueTracker.listIssues(IssueListQuery)`, `createIssue`, `applyLabel`, `updateIssueBody`, `closeIssue`; `CodeHost.getDefaultBranch`, `findPullRequestByBranch`, `createPullRequest`, `mergePullRequest`.
- `adws/github/labelManager.ts` — `ADW_NONE_LABEL = 'adw:none'` (cron opt-out), `applyLabel` lazy-creates unknown labels with a default definition, so `hitl` needs no new definition.
- `adws/triggers/cronLabelEligibility.ts` — confirms `adw:none` → `opt_out`, which is why the report issue carries it.
- `.github/workflows/git-cli-guard.yml` — add the docs-index job.
- `package.json` — add `"lint:docs-index": "bunx tsx adws/checkLivingDocsIndex.ts"` next to `lint:git-guard`.
- `.adw/conditional_docs.md` and `app_docs/` — the convergence pass (task 3) rewrites 23 module docs in place, deletes 23 feature docs, promotes `feature-oqb76h-gitcontext-base-path-authority.md`, and collapses the index to 47 entries.
- `.claude/commands/document.md` — the `/document` convergence contract (steps 5–7: collapse siblings, rewrite in place, one entry per module) that the convergence pass follows by hand.
- `adws/triggers/__tests__/trigger_cron.test.ts`, `adws/triggers/__tests__/perIssueSweepPersist.test.ts`, `adws/triggers/__tests__/perIssueScenarioSweep.test.ts`, `adws/core/__tests__/conditionalDocsRegistry.test.ts`, `adws/core/__tests__/promotionReconcileLink.test.ts` — the unit-test styles to mirror (fake `GitContext`/`CodeHost`/`LaunchBoundary` builders, hoisted `vi.mock('../../core', () => ({ log: vi.fn() }))`, table tests over pure functions).
- `vitest.config.ts` — tests must live under `adws/**/__tests__/**/*.test.ts`.
- `features/per-issue/feature-745.feature` + `features/per-issue/step_definitions/feature-745.steps.ts` — the BDD pattern for driving an exported cron tick seam in-process; the `@adw-810` §2 dispatch scenarios follow it.
- `features/per-issue/step_definitions/feature-758.steps.ts` — the real-git sweep harness (throwaway origin/host repo pair, real worktree/commit/push, faked `gh`) that the `@adw-810` §3/§4 sweep scenarios follow; note its fixture builds a `GitContext` with an explicit `selfHost: true`.
- `features/per-issue/step_definitions/feature-769.steps.ts` — the recording `GitContext` plus target (`selfHost: false`) / framework (`selfHost: true`) fixture pair behind the `@adw-810` launch-boundary isolation scenarios.

Conditional docs matched for this task (read them):
- `app_docs/feature-o4qdu5-app-docs-living-docs-convergence-registry.md` — registry contracts, the migration bijection/no-overlap invariants, and the gate's current gotchas.
- `app_docs/feature-ih6ju7-app-docs-living-docs-post-write-guards.md` — why `checkRegrowth` is conservative and advisory.
- `app_docs/feature-vpb048-promotion-sweep-originate.md` — sweep shell / defaults / reconcile / tick-seam contracts.
- `app_docs/feature-9gjajh-cron-triggers.md` — `cronBoundary`, the null-boundary skip rule for every sweep tick, `runGuardedTick`.
- `app_docs/feature-9gjajh-issue-routing-and-eligibility.md` — owns `perIssueScenarioSweep.ts` / `perIssueSweepPersist.ts`.
- `app_docs/feature-bq1f45-git-gh-cli-guard.md` — the three guard rules and the transitional-entry ratchet.
- `app_docs/feature-oqb76h-gitcontext-base-path-authority.md` — `lsFiles`, `addAndCommitPaths`, worktree ops.
- `app_docs/feature-9gjajh-providers.md` — `IssueTracker` / `CodeHost` surfaces.
- `app_docs/feature-9gjajh-root-config.md` — `package.json` scripts and `.github/` workflows.
- `app_docs/feature-9gjajh-document-phase.md` — where the living-docs system will be documented after the fold.

### New Files

- `adws/core/docsIndexHealth.ts` — pure: types (`DocsIndexRepair`, `DocsIndexViolation`, `CountBand`, `DocsIndexHealthInputs`, `DocsIndexAssessment`), `DEFAULT_COUNT_BAND`, `isFeatureDocPath`, `findRepairs`, `applyRepairs`, `findViolations`, `assessDocsIndexHealth`, `formatRepair`, `formatViolation`.
- `adws/core/docsIndexReportBody.ts` — pure: `DOCS_INDEX_REPORT_MARKER`, `docsIndexViolationFingerprint`, `buildDocsIndexReportIssue`, `parseDocsIndexReportMarker`, `findOpenDocsIndexReport`.
- `adws/triggers/docsIndexSweep.ts` — the I/O shell: `DocsIndexSweepDeps`, `DocsIndexSweepReport`, `runDocsIndexSweep`, CLI entry guard.
- `adws/triggers/docsIndexSweepDefaults.ts` — `DOCS_INDEX_SWEEP_SPEC`, `DOCS_INDEX_SWEEP_COMMIT_MESSAGE`, `makeDocsIndexSweepDefaults(boundary, getBase)` (production deps closing over the boundary and the lazily-prepared `SweepBase`).
- `adws/core/__tests__/docsIndexHealth.test.ts`, `adws/core/__tests__/docsIndexReportBody.test.ts`, `adws/triggers/__tests__/docsIndexSweep.test.ts`, `adws/__tests__/checkLivingDocsIndex.test.ts` — unit tests (see Testing Strategy).

## Implementation Plan

### Phase 1: Foundation

Build the pure health module and its report-body sibling first, fully unit-tested, because both the gate and the sweep are thin shells over them. Generalise `perIssueSweepPersist.ts` (spec-parameterised base, generic `persistCommitViaPr`) without changing the per-issue sweep's behaviour, and add the `DOCS_INDEX_SWEEP_INTERVAL_CYCLES` constant. Nothing in this phase touches git, GitHub or the cron.

### Phase 2: Core Implementation

Rewrite `adws/checkLivingDocsIndex.ts` as a credential-free gate over the health module (filesystem walk, `[rootDir]` argument, exported runner + argv guard), delete its transitional allowlist entry, and wire `lint:docs-index` into `package.json` and the CI workflow. Then build the docs-index sweep shell and its production defaults: dedicated worktree, repairs persisted via an immediately-merged PR, violations reconciled into one `hitl` + `adw:none` issue, cleanup on every exit path, never throwing.

### Phase 3: Integration

Dispatch the sweep from `trigger_cron.ts` on its own cadence with the same three guarantees as the sibling ticks. Run the convergence pass over `app_docs/` and `.adw/conditional_docs.md` (23 folds + 1 promotion, index → 47 entries) so the gate is green on this branch, then add the README bullet and run the full validation set, including the synthetic 20-dangling-entries regression against the gate and the sweep.

## Step by Step Tasks

Execute every step in order, top to bottom.

### 1. Pure health module — `adws/core/docsIndexHealth.ts`
- Types:
  - `CountBand = { readonly min: number; readonly max: number }`; `export const DEFAULT_COUNT_BAND: CountBand = { min: 25, max: 60 }` (moved from the gate; JSDoc: 44 module docs + 2 READMEs + headroom for novel modules; min catches a mass-deletion merge).
  - `DocsIndexRepair = { kind: 'drop-dangling-entry'; docPath } | { kind: 'prune-dead-glob'; docPath; glob }`.
  - `DocsIndexViolation = { kind: 'non-canonical'; firstDiffLine } | { kind: 'duplicate-entry'; docPath } | { kind: 'orphan-doc'; docPath } | { kind: 'overlap'; docPathA; docPathB; files: string[] } | { kind: 'count-out-of-band'; count; band: CountBand }`.
  - `DocsIndexHealthInputs = { readonly content: string; readonly files: readonly string[] }` — `files` are repo-root-relative posix paths (tracked files for the sweep, a filesystem walk for the gate).
  - `DocsIndexAssessment = { registry; repairs; repaired; violations }`.
- `isFeatureDocPath(p)`: `app_docs/feature-*.md` (direct children only; excludes `app_docs/assets/`).
- `findRepairs(registry, files)`: dangling = `docPath` not in the file set (resolved against the repo root — this is the README fix); dead glob = an `Owns:` glob matching zero files via `matchesGlob`. Legacy entries (no `Owns:`) can only produce `drop-dangling-entry`.
- `applyRepairs(registry, repairs)`: immutable; drops entries, filters globs; an entry whose globs all die keeps its `Conditions:` and becomes a legacy entry (it is not dropped).
- `findViolations(content, repaired, files, band | null)`: `non-canonical` when `serializeConditionalDocs(parseConditionalDocs(content)) !== content` (report `firstDiffLine`, reuse the gate's `findFirstDiffLine` logic here); `duplicate-entry`; `orphan-doc` = feature doc present in `files` with no entry; `overlap` = for every file with ≥2 owning entries (`findOwningEntries`), aggregated per unordered entry pair with the file list; `count-out-of-band` only when `band` is non-null. Keep it file-based (precise) — do not reuse `docsGuards.checkRegrowth`, whose segment-prefix heuristic is deliberately conservative for the per-write advisory.
- `assessDocsIndexHealth(inputs, band = DEFAULT_COUNT_BAND)`: parse → repairs → repaired → violations on `repaired`.
- `formatRepair(r)` / `formatViolation(v)`: one-line strings shared by the gate output, the sweep log, the PR/commit body and the report issue (overlap lines show up to 5 files then `… and N more`).
- Barrel-export the types, `DEFAULT_COUNT_BAND` and `assessDocsIndexHealth` from `adws/core/index.ts` under a `// Docs index health (pure — no I/O)` heading.

### 2. Unit tests — `adws/core/__tests__/docsIndexHealth.test.ts`
- Fixture registry with: two module entries (`adws/vcs/**`, `adws/core/x.ts`), one legacy entry, the two top-level README entries, one dangling entry, one entry with a dead glob.
- Cases: README entries are **not** dangling when present in `files`; dangling entry → `drop-dangling-entry`; dead glob → `prune-dead-glob` while a live glob in the same entry survives; `applyRepairs` never mutates the input (deep-equal before/after) and preserves entry order; an entry whose only glob dies stays as a legacy entry; orphan feature doc detected, `app_docs/assets/x.png` never orphan; duplicate `docPath`; overlap aggregated once per pair with the file list, legacy entries never overlap; count band boundaries `min-1`, `min`, `max`, `max+1`, and `band = null` skips the check; violations use the repaired count (a dangling entry above `max` does not trip the band once dropped); non-canonical content (an extra blank line) reported with its line; empty content → no entries, no crash; `formatViolation` overlap truncation at 5 files.

### 3. Pure report-body module — `adws/core/docsIndexReportBody.ts`
- `DOCS_INDEX_REPORT_MARKER = 'Reconciles: docs-index-health'` and a `Fingerprint: <hex>` line; `docsIndexViolationFingerprint(violations)`: order-independent (sort the formatted lines, hash with `node:crypto` sha1, first 12 hex chars).
- `buildDocsIndexReportIssue({ violations, indexPath, defaultBranch })` → `{ title, body, labels: ['hitl', ADW_NONE_LABEL] }`. Title: `` `docs-index-health`: N violation(s) in .adw/conditional_docs.md ``. Body: marker + fingerprint lines first, then one section per violation kind, the resolution rule from the issue (*module doc keeps its package globs; feature doc loses the overlapping glob; feature-vs-feature → newest doc*), a note that the body is regenerated by the sweep whenever the violation set changes (put notes in comments), and how to delegate (remove `adw:none`, add `adw:chore`).
- `parseDocsIndexReportMarker(body)` → `{ fingerprint } | null`; `findOpenDocsIndexReport(issues)` → lowest-numbered issue whose body carries the marker (mirrors `reconcilePromotionLink`).
- Tests in `adws/core/__tests__/docsIndexReportBody.test.ts`: marker + fingerprint present; fingerprint stable across violation order; labels exactly `['hitl', 'adw:none']`; marker parse round-trip; lowest number wins; no marker → null.

### 4. Generalise the persist path — `adws/triggers/perIssueSweepPersist.ts`
- Add `export interface SweepPersistSpec { readonly branch: string; readonly prTitle: string; readonly prBody: string }` and `export const PER_ISSUE_SWEEP_SPEC` (today's `chore/scenario-sweep` + title + body). Keep `SWEEP_BRANCH` / `SWEEP_COMMIT_MESSAGE` exports unchanged.
- `prepareSweepBase(boundary, spec = PER_ISSUE_SWEEP_SPEC)`: use `spec.branch` for the pre-clean/create and `spec.prTitle`/`spec.prBody` in `openPr`.
- Extract `export async function persistCommitViaPr(commit: (base: SweepBase) => boolean, base: SweepBase, label = 'perIssueSweepPersist'): Promise<void>` holding today's open-PR guard, push, PR, merge and error handling; `persistRemovalViaPr(paths, base)` becomes `if (paths.length === 0) return; return persistCommitViaPr(b => b.ctx.removeAndCommitPaths(paths, SWEEP_COMMIT_MESSAGE, b.worktreePath), base)`.
- Extend `adws/triggers/__tests__/perIssueSweepPersist.test.ts`: a custom spec drives `createWorktreeForNewBranch`/`removeWorktree` with its branch and `createPullRequest` with its title; `persistCommitViaPr` skips when `commit` returns false; existing tests pass unchanged.

### 5. Cadence constant
- `adws/core/config.ts`: `DOCS_INDEX_SWEEP_INTERVAL_CYCLES = parseInt(process.env.DOCS_INDEX_SWEEP_INTERVAL_CYCLES || '4320', 10)` beside the other two sweep constants, same JSDoc style (≈ daily at the 20 s poll).
- Export it from `adws/core/index.ts`'s config line.

### 6. Rewrite the gate — `adws/checkLivingDocsIndex.ts`
- Header docblock: no longer a one-off; it is the CI gate (`bun run lint:docs-index`), credential-free, sharing checks with `docsIndexHealth.ts`.
- Remove the `gitContextFactory` and `REPO_ROOT` imports; delete `listTrackedFiles`, `checkRoundTrip`, `checkBijection`, `checkNoOverlap`, `checkCountSanity`, `findDuplicates`, `MIN_ENTRIES`/`MAX_ENTRIES`.
- I/O boundary: `readIndexContent(rootDir)`, `listRepoFiles(rootDir)` — recursive `fs.readdirSync(..., { withFileTypes: true })` walk in the style of `checkGitGhGuard.ts`'s `visitDir`, skipping `IGNORED_DIR_NAMES = ['.git', 'node_modules', '.worktrees', 'dist', 'coverage', 'logs', 'agents']`, returning posix root-relative paths.
- `export function runLivingDocsIndexCheck(rootDir: string): { exitCode: 0 | 1; lines: string[] }`: empty/missing index → exit 1; otherwise `assessDocsIndexHealth({ content, files })` with `DEFAULT_COUNT_BAND`; print the header (`N entries, M docs`), then one `✔ PASS` / `✖ FAIL` line per check (canonical round-trip, no dangling entries, no orphan docs, no duplicate docPaths, no overlapping ownedGlobs, count in band) and a `⚠ WARN` block for dead globs (non-fatal — repaired by the sweep). `exitCode = 1` iff any violation or any `drop-dangling-entry` repair.
- `main()`: `rootDir = path.resolve(process.argv[2] ?? process.cwd())`, print lines, `process.exit(exitCode)`; guard with `if (process.argv[1]?.includes('checkLivingDocsIndex')) main();` so the module is importable by tests.
- `adws/__tests__/checkLivingDocsIndex.test.ts`: build fixtures in `fs.mkdtempSync` dirs (real fs, no mocks): a healthy fixture (index + matching `app_docs/feature-*.md` + `README.md` + `adws/README.md`, ≥ 25 entries generated in a loop) → exit 0 and the READMEs are not reported dangling; the same fixture plus 20 dangling entries → exit 1 with all 20 named; a dead glob alone → exit 0 with a WARN line; an overlap → exit 1.

### 7. Guard allowlist and CI wiring
- `adws/guard/constructionRule.ts`: delete the `adws/checkLivingDocsIndex.ts` transitional entry (and its mention in the file's docblock if any). `bun run lint:git-guard` must be green — the ratchet fails while the entry is present and the file no longer constructs anything.
- `package.json`: `"lint:docs-index": "bunx tsx adws/checkLivingDocsIndex.ts"`.
- `.github/workflows/git-cli-guard.yml`: add a second job `docs-index` (`name: Fail on a broken living-docs index`) with the same checkout / setup-bun / `bun install` steps and `run: bun run lint:docs-index`; keep the workflow's `on: [pull_request, push]`.

### 8. Sweep production defaults — `adws/triggers/docsIndexSweepDefaults.ts`
- `DOCS_INDEX_SWEEP_SPEC: SweepPersistSpec = { branch: 'chore/docs-index-sweep', prTitle: 'chore: docs-index sweep — repair .adw/conditional_docs.md', prBody: 'Automated repair: dropped dangling entries and pruned dead Owns: globs found by the docs-index health sweep. Details in the commit message.' }`; `DOCS_INDEX_SWEEP_COMMIT_MESSAGE = 'chore: repair conditional_docs index (drop dangling entries, prune dead globs)'`; `INDEX_PATH = '.adw/conditional_docs.md'`; `REPORT_LABEL_SEARCH = 'label:"hitl"'`.
- `makeDocsIndexSweepDefaults(boundary, getBase: () => SweepBase | null)` returning: `readIndex()` (from `base.worktreePath`, null on any error), `listFiles()` (`base.ctx.lsFiles(base.worktreePath)`, `[]` on error), `persistIndex(content, repairs)` (write the file into the worktree, then `persistCommitViaPr(b => b.ctx.addAndCommitPaths([INDEX_PATH], commitMessageWith(repairs), b.worktreePath), base, 'docsIndexSweep')`), `listReportCandidates()` (`issueTracker.listIssues({ fields: ['number','body','state'], state: 'open', search: REPORT_LABEL_SEARCH, limit: 100 })`, `[]` on error), `fileReport(spec)` (`createIssue` then `applyLabel` for each label; returns the number), `refreshReport(n, body)` (`updateIssueBody`), `closeReport(n)` (`closeIssue(n, 'Docs index is healthy again — closed by the docs-index sweep.')`), `countBand` = `boundary.gitContext.selfHost ? DEFAULT_COUNT_BAND : null`.
- Every default reads from the sweep worktree, never from `basePath` or `process.cwd()`; no additional `GitContext` or providers are constructed.

### 9. Sweep shell — `adws/triggers/docsIndexSweep.ts`
- `DocsIndexSweepDeps { boundary: LaunchBoundary; readIndex?; listFiles?; persistIndex?; listReportCandidates?; fileReport?; refreshReport?; closeReport?; countBand?: CountBand | null; log? }` — `boundary` required, everything else optional with `makeDocsIndexSweepDefaults` fallbacks over a lazily-memoised `SweepBase` (`prepareSweepBase(boundary, DOCS_INDEX_SWEEP_SPEC)`, created at most once and only when a base-dependent default runs; torn down in `finally` via `cleanupSweepBase`).
- `DocsIndexSweepReport { repairs; violations; persisted: boolean; reportIssue: number | null; reportAction: 'filed' | 'refreshed' | 'closed' | 'unchanged' | 'none' }`.
- `runDocsIndexSweep(deps)`: read index (null/empty → log + return empty report; a target repo without an index is a no-op); `assessDocsIndexHealth`; if repairs → `persistIndex(serializeConditionalDocs(repaired), repairs)` (log each repair); then reconcile: `findOpenDocsIndexReport(candidates)`; violations empty → close an open report if any; violations present and no report → `fileReport(buildDocsIndexReportIssue(...))`; report present with a different fingerprint → `refreshReport`; same fingerprint → `unchanged`. Each I/O step is wrapped so the sweep still returns its report and never throws. Persistence failures (push, PR open, merge) are logged at `error` by the shared `persistCommitViaPr` — its inherited *left open, retried next sweep* wording — because a repair that did not land is the sweep's headline failure; the other steps (read index, list files, file/refresh/close report) log at `warn`.
- CLI entry guard mirroring `promotionSweep.ts`: `if (process.argv[1]?.replace(/\\/g, '/').includes('docsIndexSweep')) runDocsIndexSweep({ boundary: buildLaunchBoundary(parseTargetRepoArgs(process.argv.slice(2))) })…` logging the report summary; `bunx tsx adws/triggers/docsIndexSweep.ts [--target-repo owner/repo]`.
- Keep the file under 300 lines (defaults are in step 8's file).

### 10. Sweep unit tests — `adws/triggers/__tests__/docsIndexSweep.test.ts`
- Hoisted mocks as in `perIssueScenarioSweep.test.ts` (`vi.mock('../../core', …)` exposing `log`; fake `GitContext`/`CodeHost`/`IssueTracker`/`LaunchBoundary` builders). All deps injected — no `SweepBase` is ever prepared.
- Cases: 20 dangling entries in the injected index → `persistIndex` receives content with exactly those entries gone and the rest byte-identical, `repairs.length === 20`; no repairs → `persistIndex` not called; dead glob → pruned in persisted content; violations + no open report → `fileReport` called once with labels `['hitl','adw:none']` and marker in body; violations + open report with same fingerprint → no `fileReport`/`refreshReport`; different fingerprint → `refreshReport` on the lowest-numbered report; two open reports → the lowest number is the one refreshed; no violations + open report → `closeReport`; `countBand: null` → no `count-out-of-band` even with 3 entries; `readIndex` returns null → empty report, nothing called; a throwing `persistIndex` is swallowed and the report is still returned; a throwing `fileReport` is swallowed.

### 11. Cron dispatch — `adws/triggers/trigger_cron.ts`
- Import `DOCS_INDEX_SWEEP_INTERVAL_CYCLES` and `runDocsIndexSweep`; add `boundDocsIndexSweep()` and `export async function runDocsIndexSweepTick(cycleCount, sweep = boundDocsIndexSweep())` with the identical cadence gate, `'docsIndexSweep: no launch GitContext available — skipping pass'` warn-skip, and non-fatal swallow; call `await runDocsIndexSweepTick(cycleCount)` immediately after `runPromotionSweepTick` in `checkAndTrigger` with a comment mirroring its neighbours.
- `adws/triggers/__tests__/trigger_cron.test.ts`: add a `runDocsIndexSweepTick` block with the same five cases as the promotion tick (cadence-eligible dispatch once, off-cadence no dispatch, null thunk warn-skip, off-cadence null thunk logs nothing, throwing sweep swallowed).

### 12. Convergence pass — `app_docs/` and `.adw/conditional_docs.md`
- For each row below: (a) rewrite the target module doc in place, merging the feature doc's still-true content into the current-state template of `.claude/commands/document.md` (Overview / Responsibilities / Contracts & Invariants / Configuration / Gotchas — no changelog, no per-run history, drop superseded claims); (b) delete the feature doc with `git rm <path>` (the pre-tool-use hook rejects plain `rm` with force/recursive flags); (c) collapse the index with a throwaway script (not committed) that calls `collapseEntries(registry, [target, source], { docPath: target, conditions })` per pair and writes `serializeConditionalDocs(...)` back — `Owns:` becomes the de-duplicated union minus any source glob already covered by a target package glob (e.g. every `adws/providers/github/*` glob of `e2er82` is subsumed by `adws/providers/**`), `Conditions:` is the hand-curated union with duplicates and dead references removed.

  | fold (delete) | into (rewrite in place) |
  |---|---|
  | `hrl5jd` unit-test rail / JUnit report | `feature-9gjajh-test-report-and-verdict.md` |
  | `n9880l` adwVersion read/write, `t6m62c` adwUpgrade regen gate + failure cap + redrive | `feature-9gjajh-hash-and-versioning.md` (add `adws/core/upgradeFailureCap.ts`, `adws/triggers/upgradeRedrive.ts`) |
  | `sh8m9r` branch-name persistence, `tlk8qf` hash-check upgrade gate, `mk1wgc` orchestrator/phase provider migration | `feature-9gjajh-workflow-lifecycle-phases.md` |
  | `s59wpc` adwPrReview phaseRunner migration | `feature-9gjajh-pr-and-merge-phases.md` (add its four explicit globs) |
  | `ni6fpk` region-overlap serialisation | `feature-9gjajh-issue-routing-and-eligibility.md` (add `regionOverlap.ts`, `regionOverlapSignals.ts`, `adws/core/resolveResumeSpawn.ts`) |
  | `mnmihl` scenario-authoring skip gate | `feature-9gjajh-test-and-scenario-phases.md` |
  | `lnef5d` mock infrastructure, `78celh` Docker behavioural isolation | `feature-9gjajh-bdd-regression-suite.md` (add `test/mocks/**`, `test/Dockerfile`, `test/docker-run.sh`) |
  | `6uquvb` build continuation committed state | `feature-9gjajh-build-and-plan-phases.md` (add `adws/phases/__tests__/planPhase.test.ts`) |
  | `ne2we8` promotion tag state, `vpb048` promotion sweep, `2ubuuc` rot/reuse advisory | `feature-9gjajh-promotion-system.md` (add the promotion sweep, decider, reconcile-link, issue-body, tag-state, rot-advisory globs and `.claude/commands/promote_regression_vocabulary.md`) |
  | `ih6ju7` post-write guards, `o4qdu5` convergence registry | `feature-9gjajh-document-phase.md` — becomes the living-docs module doc; also document this feature here (health module, sweep, gate) and add `adws/core/conditionalDocsRegistry.ts`, `adws/core/docsGuards.ts`, `adws/core/docsIndexHealth.ts`, `adws/core/docsIndexReportBody.ts`, `adws/phases/docsSelfCheck.ts`, `adws/triggers/docsIndexSweep.ts`, `adws/triggers/docsIndexSweepDefaults.ts`, `adws/checkLivingDocsIndex.ts`, `.adw/conditional_docs.md`, `.claude/commands/document.md` and the feature-609/610 scenario files to its `Owns:` |
  | `d0hv98` exhaustive stage classifier | `feature-9gjajh-takeover-and-coordination.md` |
  | `e2er82` GitHub forge adapter | `feature-9gjajh-providers.md` (drop the five overlapping globs — `adws/providers/**` already covers them; this clears the last overlap) |
  | `0rvmyc` target-repo guardrails injection | `feature-9gjajh-claude-agents-core.md` |
  | `k2tkdn` boundary constructor, `k817bh` repo-identity cross-check, `bq1f45` git/gh CLI guard | `feature-oqb76h-gitcontext-base-path-authority.md` — **promoted** to the `adws/gitContext/` module doc: keep the file, tighten `Owns:` to `adws/gitContext/**`, `adws/core/launchGitContext.ts`, `adws/core/repoIdentityCrossCheck.ts`, `adws/checkGitGhGuard.ts`, `adws/guard/**`, `adws/phases/branchIdentityFallback.ts`, `adws/core/orchestratorNames.ts` (+ their test files), drop the redundant `adws/gitContext/__tests__/**`. If the merged doc would exceed `DOC_BLOAT_THRESHOLD_LINES` (400), fold `bq1f45` into `feature-9gjajh-root-config.md` instead. |

- Do not touch the `README.md` / `adws/README.md` entries. Expected result: 47 entries (44 module docs + 2 READMEs + the promoted gitContext doc), 0 overlaps, 0 orphans, 0 dangling, canonical round-trip. Update the gate-related gotchas that move into the document-phase doc: the gate now takes `[rootDir]`, walks the filesystem, and warns (not fails) on dead globs.

### 13. README bullet
- `README.md` feature list: add a bullet after "CI-enforced git/gh guardrail" describing the docs-index health gate (`bun run lint:docs-index`, wired into `.github/workflows/git-cli-guard.yml`) and the daily cron sweep (auto-repairs dangling entries / dead globs through a merged `chore/docs-index-sweep` PR, files one reconciled `hitl` issue for overlap / orphan / count violations, acts only on the launch-boundary repo).

### 14. Validation
- Run every command in `Validation Commands`, including the synthetic-regression one-liner; `bun run lint:docs-index` must exit 0 on this branch and the guard must be green with the allowlist entry removed.

## Testing Strategy

### Unit Tests
- `adws/core/__tests__/docsIndexHealth.test.ts` — table tests over the pure API (see step 2): repair classification, immutability of `applyRepairs`, violations on the repaired registry, overlap aggregation, band boundaries and `null` band, canonical round-trip detection, README-at-root not dangling.
- `adws/core/__tests__/docsIndexReportBody.test.ts` — marker/fingerprint/labels, order-independent fingerprint, lowest-number reconcile.
- `adws/triggers/__tests__/perIssueSweepPersist.test.ts` — extended for `SweepPersistSpec` and `persistCommitViaPr`; existing cases unchanged.
- `adws/triggers/__tests__/docsIndexSweep.test.ts` — fully-injected shell: repair persistence, one-issue reconcile (file / refresh / unchanged / close), target-repo band skip, no-index no-op, swallowed failures.
- `adws/triggers/__tests__/trigger_cron.test.ts` — `runDocsIndexSweepTick` cadence / skip / swallow.
- `adws/__tests__/checkLivingDocsIndex.test.ts` — `runLivingDocsIndexCheck` against temp-dir fixtures: healthy → 0, 20 dangling → 1, dead glob → 0 + WARN, overlap → 1.

### BDD Scenarios (`features/per-issue/feature-810.feature`, tag `@adw-810`)

The scenarios are authored; they are the RED tests for this plan. They are organised in seven sections, each with its own observation mode — the shell must expose the seams they drive:

- **§1 the pure health module, in-process over throwaway fixture registries** (the fixture index, its doc files and its tracked-file set are step-constructed inputs, never framework source files): a drop repair for an entry whose doc file is absent; `README.md` / `adws/README.md` never reported dangling; a dead glob pruned while the entry's live globs are byte-identical; an entry whose every glob is dead keeps its place (legacy entry, not dropped); an overlap violation naming both entries plus the overlapping file, with **no repairs**; an orphan violation with **no repairs**; a Scenario Outline over one-above / inside / one-below the band; a healthy fixture yielding neither repairs nor violations.
- **§2 `runDocsIndexSweepTick` with an injected sweep** (the `feature-745.steps.ts` in-process seam): dispatched exactly once on a cadence-eligible cycle; not dispatched one-before / one-after / mid-interval; a null launch context logs the skip, does not dispatch, and does not raise; a throwing sweep is logged **as an error** and does not raise.
- **§3 the real sweep over a throwaway origin/host repository pair with the forge faked** (the `feature-758.steps.ts` harness — real worktree, commit and push; `gh` stubbed — *not* an injected `persistIndex`): a dangling entry lands pruned on the `chore/docs-index-sweep` branch with a PR opened and merged; a dead glob pruned while its entry survives; the repair reaches origin's default branch only through the merge and the host's local default branch gains no commit; a healthy index opens no PR and leaves origin's tip unchanged; 20 restored dangling entries dropped in one tick with every live entry retained; a failed merge reported **as an error**, the dangling entry still on origin, the cycle not raising, and a later sweep re-attempting; a target-repo tick repairing the target and leaving the framework checkout's index alone, every repo operation issued through the launch context (`feature-769.steps.ts` fixture pair).
- **§4 the same repo-pair harness with recorded forge calls**: three violation kinds in one tick → exactly one issue carrying `hitl` whose body names the overlapping pair, the orphan doc and the count against the band (**the fixture boundary must be built `selfHost: true` for the count violation to appear — off the self-host the sweep passes `countBand: null`**); a second tick over the same violations reconciling by back-link and filing nothing; a violation outliving a *closed* tracker re-filed as one new issue; overlapping entries left untouched with no PR opened; no violations → no issue; the issue created in the launch-boundary repository, not the cron host's.
- **§5 the gate spawned as a command**: a 20-dangling fixture checkout exits non-zero **naming all 20**; a healthy fixture exits 0; the READMEs are not reported dangling; the verdict is reached with no forge credentials and no forge request issued; `lint:git-guard` green with no stale allowlist entry for the gate.
- **§6 the gate over this checkout**: exit 0 through the package script entry point, and separately zero overlaps, zero orphans, count inside the band (task 12's only observable).
- **§7** `tsc` passes with the new module, trigger, constant, dispatch site and the gate's dropped dependency.

Deliberately **not** BDD-covered (per the feature file's scope notes), and therefore covered by the unit tests above instead: the `.github/workflows/git-cli-guard.yml` wiring (asserting it in-repo means substring-matching workflow YAML), the prose merged by the convergence pass, the gate's dead-glob WARN path, and the sweep closing an open report when the index goes clean.

### Edge Cases
- Index file missing or empty: gate exits 1; sweep no-ops (target repos without a living-docs index must not get PRs or issues).
- Top-level `docPath`s (`README.md`, `adws/README.md`) resolve against the repo root, never under `app_docs/`.
- An entry whose every `Owns:` glob is dead keeps its conditions (becomes legacy) — the sweep never deletes a doc file, only index entries/globs.
- Dead globs in the gate are warnings, so a chore PR renaming a file does not fail CI; the sweep prunes them within a cadence.
- Untracked local files in the gate's filesystem walk cannot mask a dangling entry or an overlap; `logs/`, `agents/`, `.worktrees/`, `node_modules/` are skipped.
- Non-canonical index content is a violation (human judgment), never auto-canonicalised — the parser silently drops unrecognised lines and the sweep must not lose them.
- Count band applies only to the self-host repo; a fresh target repo with 3 entries files no issue.
- Report reconcile: two open marker issues → the lowest number is refreshed; a stale fingerprint → body refreshed; identical fingerprint → no write; a report issue closed by a human while violations persist → a new one is filed on the next cadence (open-state search only), exactly like a stranded promotion tracker.
- A merge that fails leaves the repair unlanded and logged at `error`, and `cleanupSweepBase` in the sweep's `finally` deletes the remote `chore/docs-index-sweep` branch (closing the stale PR), so a later cadence re-derives the same deterministic repair from fresh `origin/<default>` and re-attempts it. If a sweep PR is still open when a tick starts, `persistCommitViaPr`'s duplicate guard skips that cycle and the repair is retried once the PR is resolved — either way the repairs were never committed to the shared base, so nothing is lost.
- Sweep worktree always torn down in `finally`, including when the index is unreadable or persistence throws.
- The three sweeps run sequentially in one tick, each on its own branch/worktree; they never share `SweepBase`.

## Acceptance Criteria

- `bunx tsx adws/checkLivingDocsIndex.ts` and `bun run lint:docs-index` exit 0 on this branch without any GitHub credential in the environment, and the `docs-index` job runs in `.github/workflows/git-cli-guard.yml` on every `pull_request` and `push`.
- `bunx tsx adws/checkLivingDocsIndex.ts <fixture-with-20-dangling-entries>` exits 1 naming all 20; `runDocsIndexSweep` with the same index persists a repaired index with exactly those 20 entries removed via `persistCommitViaPr` (unit + BDD proven).
- `adws/core/docsIndexHealth.ts` is the only implementation of the checks; `adws/checkLivingDocsIndex.ts` imports nothing from `adws/github/gitContextFactory` and constructs no `GitContext`; the `adws/checkLivingDocsIndex.ts` transitional entry is gone from `SANCTIONED_CONSTRUCTION_SITES`; `bun run lint:git-guard` is green.
- `trigger_cron.ts` dispatches `runDocsIndexSweep` only on `cycleCount % DOCS_INDEX_SWEEP_INTERVAL_CYCLES === 0`, skips with a warning when no launch boundary exists, and swallows a throwing sweep.
- The sweep files at most one open `hitl` (+ `adw:none`) issue carrying `Reconciles: docs-index-health`, refreshes it only when the fingerprint changes, and closes it when the index is clean.
- `.adw/conditional_docs.md` has 47 entries, 0 overlapping `Owns:` globs, 0 orphan docs, 0 dangling entries, canonical round-trip; the 23 folded feature docs no longer exist under `app_docs/`; `feature-oqb76h-gitcontext-base-path-authority.md` is the `adws/gitContext/` module doc.
- All validation commands pass with zero regressions.

## Validation Commands

Execute every command to validate the feature works correctly with zero regressions.

- `bun run lint`
- `bunx tsc --noEmit`
- `bunx tsc --noEmit -p adws/tsconfig.json`
- `bun run build`
- `bun run test:unit`
- `bun run lint:git-guard`
- `bun run lint:docs-index`
- `bunx tsx adws/checkLivingDocsIndex.ts`
- Synthetic regression (must print `exit=1` and list 20 dangling entries):
  `tmp=$(mktemp -d) && mkdir -p "$tmp/.adw" "$tmp/app_docs" "$tmp/adws" && cp .adw/conditional_docs.md "$tmp/.adw/" && cp app_docs/*.md "$tmp/app_docs/" && cp README.md "$tmp/" && cp adws/README.md "$tmp/adws/" && for i in $(seq -w 1 20); do printf '\n- app_docs/feature-ghost%s-missing.md\n  - Conditions:\n    - When a ghost entry is present\n' "$i" >> "$tmp/.adw/conditional_docs.md"; done && bunx tsx adws/checkLivingDocsIndex.ts "$tmp"; echo "exit=$?"`
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-810"`
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"`
- `grep -c '^- ' .adw/conditional_docs.md` (expect `47`) and `ls app_docs/feature-*.md | wc -l` (expect `45`)

## Notes

- Strictly adhere to `.adw/coding_guidelines.md`: pure decision logic in `adws/core/`, side effects only in the trigger shells and the gate's I/O boundary, guard clauses over nesting, files under 300 lines (`trigger_cron.ts` is already over — add the tick by mirroring its neighbours rather than restructuring it), no `any`, JSDoc on exported functions.
- No new libraries. `node:crypto` covers the fingerprint.
- `adws/core/environment.ts` (listed in the issue's touched files) holds paths only; the cadence constants live in `adws/core/config.ts`, which is where `DOCS_INDEX_SWEEP_INTERVAL_CYCLES` belongs.
- Why not `git ls-files` in the gate: the `git-gh-shellout` rule permits raw git only inside `adws/gitContext` / `adws/providers/github`, and constructing a `GitContext` requires a resolvable credential (its constructor probes the `TokenProvider`) plus an allowlist entry that must not exist. A filesystem walk is the only credential-free, guard-clean option and is exact in CI.
- Why file-based overlap rather than `docsGuards.checkRegrowth`: the whole-index check is a hard gate and must not raise conservative false positives (`adws/foo/*.ts` vs `adws/foo/sub/**` overlap under the heuristic but own disjoint files). Today both definitions agree on the live index (one pair), but they will diverge as module docs adopt mixed glob shapes.
- Why `adw:none` on the report issue: the cron auto-classifies and spawns a workflow for any unlabelled open issue on a registered repo; overlap/orphan/count violations are judgment calls, and the June regression was itself an agent making a judgment call on this index. A human removes `adw:none` and adds `adw:chore` to delegate once the resolution is decided.
- Dead globs are gate warnings, not failures, because the SDLC document phase runs before merge but `adwChore` has no document phase — a chore that renames a file with an explicit `Owns:` glob must not be blocked; the sweep repairs it within one cadence.
- The `dev` branch currently has no required status check (ruleset "Basic" is a `pull_request` rule with zero required approvals and no `required_status_checks`), and ADW's auto-merge does not consult CI. The gate therefore blocks a merge only once the repo owner adds `docs-index` (and `guard`) as required status checks in the ruleset — a GitHub settings change, called out here rather than done by this feature. Until then the gate still surfaces the failure on every PR.
- First cadence-eligible sweep fires ~24 h after cron start (`cycleCount` starts at 0); for an immediate run use `bunx tsx adws/triggers/docsIndexSweep.ts`.
- Out of scope (own issue, per the issue text): `resolve_conflict` resolving `.adw/conditional_docs.md` through the registry instead of textual union.

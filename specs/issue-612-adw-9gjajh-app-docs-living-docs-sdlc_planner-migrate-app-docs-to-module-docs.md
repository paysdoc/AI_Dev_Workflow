# Feature: One-off ADW migration — cluster 195 per-run app_docs into ~40 per-module living docs

## Metadata
issueNumber: `612`
adwId: `9gjajh-app-docs-living-docs`
issueJson: `{"number":612,"title":"app_docs living-docs: one-off ADW migration (191 docs to module docs)","body":"## Parent PRD\n\n`specs/prd/app-docs-module-living-docs.md`\n\n## What to build\n\nA one-off, ADW-only migration that clusters the existing ~191 per-run `app_docs/feature-*.md` snapshots into ~40 per-module current-state docs and rewrites `.adw/conditional_docs.md` to one entry per module, reusing the registry module’s serialization. Clustering is fully automated; the resulting boundaries become the seed taxonomy. This is a destructive whole-`app_docs/` rewrite — history remains in git. Non-ADW repos get no migration; they rely on convergence shipped in #609/#610.\n\n**HITL:** requires human review before merge (destructive rewrite of the entire docs tree + the taxonomy that convergence will route against thereafter).\n\n## Acceptance criteria\n\n- [ ] Existing per-run docs are clustered into ~40 per-module current-state docs\n- [ ] `conditional_docs.md` is rewritten to one entry per module via the registry module\n- [ ] Old per-run `feature-*` docs and their entries are removed (history preserved in git)\n- [ ] Resulting index parses cleanly through the registry module and passes the regrowth guard (no overlapping entries)\n- [ ] Human review gate satisfied before merge\n\n## Blocked by\n\n- Blocked by #610\n\n## User stories addressed\n\n- User story 8","state":"OPEN","author":"paysdoc","labels":["hitl"],"createdAt":"2026-06-17T08:21:06Z","comments":[],"actionableComment":null}`

## Feature Description

`app_docs/` currently holds **195 per-run snapshot docs** (`feature-{adwId}-*.md`), and `.adw/conditional_docs.md` holds **196 entries / 1614 lines** — one entry appended for every historical `/document` run. `/prime` and every planning run read the whole index, so prime cost grows without bound, duplicate same-issue docs exist, and overlapping subsystem docs make a planner load three superseded snapshots where one current-truth doc would do.

Issues #609 and #610 already shipped the durable fix: `/document` now **converges** (semantic-first routing → rewrite the owning module doc in place → collapse sibling entries → create only for genuinely novel areas), backed by the pure, tested **registry module** `adws/core/conditionalDocsRegistry.ts` (parse / serialize / `findOwningEntries` / `collapseEntries` / `upsertEntry`). Convergence keeps the index lean *going forward* and is the sole mechanism for non-ADW repos.

This feature is the **one-off, ADW-only back-migration**: it clusters the 195 legacy snapshots into ~40 per-module current-state docs and rewrites `.adw/conditional_docs.md` to **one entry per module** so ADW gets the full prime-cost benefit immediately rather than only as areas are re-touched. The resulting module boundaries become the **seed taxonomy** that convergence routes against thereafter. It is a destructive whole-`app_docs/` rewrite; history is preserved in git. It is **HITL-gated** (the `hitl` label is already on the issue) — a human reviews the destructive diff before merge.

## User Story

As an ADW maintainer (PRD user story 8),
I want a one-off migration that collapses the existing 195 ADW per-run docs into ~40 per-module current-state docs and rewrites the index to one entry per module,
So that the repo gets the flat-prime-cost / current-truth benefit of living docs immediately, and the resulting module boundaries seed the taxonomy that `/document` convergence routes against from then on.

## Problem Statement

The convergence behavior in #609/#610 only converges areas *as they are re-touched* by a future `/document` run. ADW's existing 195-doc / 196-entry backlog will not shrink until every subsystem happens to be documented again — which may be never for stable modules. Until then ADW keeps paying the full ~46K-token prime cost and planners keep ingesting superseded/duplicate snapshots. A one-time, fully-automated clustering is needed to realize the benefit now and to establish a clean seed taxonomy (disjoint module ownership) for convergence to maintain.

## Solution Statement

Run a **one-off, agent-driven migration in this worktree** (the throwaway clustering + authoring pass described step-by-step below) that:

1. **Restores the committed convergence base** — discards out-of-scope uncommitted working-tree edits that revert #609/#610 (see Notes → Working-tree anomaly).
2. **Derives a seed taxonomy** of ~40 modules mapped to ADW's real structure (`adws/` subsystems, top-level orchestrators, `workers/`, `.claude/` commands & skills, `features/` BDD, `specs/`, root config), assigning each module a set of **disjoint** `Owns:` globs so no file is claimed by two entries (this is what makes the regrowth check pass *by construction*).
3. **Authors one current-state module doc per cluster** (Overview / Responsibilities / Contracts & Invariants / Configuration / Gotchas — present tense, from current source truth), reusing each legacy snapshot only as raw material. The single already-conformant module doc (`app_docs/feature-o4qdu5-app-docs-living-docs-convergence-registry.md`, the only entry today carrying an `Owns:` block) is **preserved verbatim** as a fixed cluster seed, and its reserved globs are off-limits to every other entry.
4. **Rewrites `.adw/conditional_docs.md` through the registry module's canonical serialization** — build `ConditionalDocEntry[]` (one per module, with regenerated `Conditions:` and disjoint `Owns:`), serialize via `serializeConditionalDocs`, overwrite the file.
5. **Deletes the superseded per-run snapshots** (`app_docs/feature-*.md` not retained as module docs); history stays in git.
6. **Machine-verifies the result** with a small, pure one-off check script (`adws/checkLivingDocsIndex.ts`) that reuses the registry module: lossless parse↔serialize round-trip, doc↔entry bijection (no orphan docs, no dangling `docPath`s), **no overlapping ownership** (the "regrowth guard" the acceptance criteria name), and entry-count sanity (~40).
7. **HITL review** — a human reviews the destructive diff before merge (label already present).

Clustering is a *throwaway agent pass* and is intentionally **not** unit-tested (per the PRD testing decisions); correctness of the index format is guaranteed by the registry module (already unit-tested) plus the one-off check script and the human gate.

## Relevant Files

Use these files to implement the feature:

- `specs/prd/app-docs-module-living-docs.md` — Parent PRD. The migration is user story 8 and the "Migration" implementation decision; honor "Out of Scope" (no doc-split, no non-ADW migration, no separate registry artifact, no planning-side read change, no history preservation in-tree).
- `adws/core/conditionalDocsRegistry.ts` — **The registry module to reuse.** `parseConditionalDocs` / `serializeConditionalDocs` (canonical format + lossless round-trip), `ConditionalDocEntry` / `ConditionalDocsRegistry` shapes, `findOwningEntries` + `matchesGlob` (used by the regrowth/overlap check), `upsertEntry`. The migration builds and serializes the new index through this module; do not hand-roll the markdown format. **Do not modify it.**
- `adws/core/__tests__/conditionalDocsRegistry.test.ts` — Existing serialization/round-trip/ownership tests (from #609). This is the "light coverage" the PRD assigns to the migration; keep it green, do not add migration-specific unit tests.
- `.adw/conditional_docs.md` — The live index being rewritten (196 entries / 1614 lines today). The migration overwrites it with ~40 module entries. The lone conformant entry (`feature-o4qdu5-...`, the only one with an `Owns:` block) must be carried over verbatim.
- `app_docs/feature-o4qdu5-app-docs-living-docs-convergence-registry.md` — The one already-migrated module doc (current-state format exemplar + a fixed cluster seed to preserve, **not** delete). Its reserved globs: `adws/core/conditionalDocsRegistry.ts`, `adws/core/__tests__/conditionalDocsRegistry.test.ts`, `.adw/conditional_docs.md`, `.claude/commands/document.md`, and the `features/per-issue/feature-609|610.*` files — no other entry may claim these.
- `.claude/commands/document.md` (committed `HEAD` version) — The convergence `/document` prompt. Source of the **current-state module reference format** (`# <Module Title>` / Overview / Responsibilities / Contracts & Invariants / Configuration / Gotchas — no `ADW ID`, `Date`, `What Was Built`, `Files Modified`, or changelog) and the Conditional Docs Entry Format (`Owns:` + `Conditions:`). **Read it; do not modify it** (it is owned by #609/#610 and must be restored to `HEAD` first — see Notes).
- `.claude/commands/adw_init.md` (committed `HEAD` version) — Seeds new-repo index entries with `Owns:` blocks; a hash-input that propagates `document.md`. **Read for taxonomy/format alignment; do not modify it** (restore to `HEAD` first).
- `adws/core/projectConfig.ts` — The only *code* consumer of the registry (`conditionalDocs` structured field + `conditionalDocsMd` raw string). Confirms the planning-side read needs **no** code change — it automatically benefits from the smaller index. Do not modify.
- `adws/phases/documentPhase.ts` / `adws/agents/documentAgent.ts` — Thin wrappers that run the `/document` agent; confirm the migration is a one-off data/agent pass and does **not** touch phase wiring. Read-only context.
- `.adw/coding_guidelines.md` — The new check script must adhere: pure, immutable, strongly typed (no `any`), guard-clause-first, max nesting depth ~2, file < 300 lines, side effects (fs reads) isolated at the boundary.
- `.adw/commands.md` — Validation commands (lint, type-check, unit tests, build, script execution).
- `app_docs/` (all 195 `feature-*.md`) — The corpus to cluster; each file is raw material for exactly one module doc, then deleted (unless retained as a module doc).

### New Files

- `app_docs/feature-9gjajh-<module-slug>.md` (~40 files) — One current-state module doc per cluster. Filename convention follows the existing corpus: `feature-{shortAdwId}-{module-slug}.md` using the short adwId token `9gjajh` (e.g., `feature-9gjajh-vcs-worktrees.md`, `feature-9gjajh-coordination-kernel.md`, `feature-9gjajh-cost-tracking.md`). The existing `feature-o4qdu5-...registry.md` is retained under its current name as the documentation-system module doc.
- `adws/checkLivingDocsIndex.ts` — Small, pure, one-off verification script (run via `bunx tsx`) that reuses `adws/core/conditionalDocsRegistry.ts` to machine-check the migrated index. Scope boundary: this is the migration's acceptance gate / a lightweight index linter — it is **not** the deferred "guards module" (PRD stories 11–13): no doc-size/bloat flag, no surfacing into `/document`'s post-write self-check. Exits non-zero with a clear report on any violation.

## Implementation Plan

### Phase 1: Foundation
Restore the committed convergence base (discard the working-tree reversion of #609/#610), inventory the corpus through the registry module, and derive the seed taxonomy: a ~40-module list where each module maps to a set of **disjoint** `Owns:` globs over ADW's real structure, with the existing `feature-o4qdu5` doc's globs reserved. Disjointness is the design constraint that makes the regrowth/overlap check pass.

### Phase 2: Core Implementation
Execute the throwaway clustering + authoring pass: assign every legacy snapshot to exactly one module, author one current-state module doc per cluster from current source truth (preserving the `feature-o4qdu5` doc verbatim), build the new `ConditionalDocsRegistry` (one entry per module), serialize it via the registry module to overwrite `.adw/conditional_docs.md`, and delete the superseded per-run snapshots.

### Phase 3: Integration
Add and run the one-off verification script (`adws/checkLivingDocsIndex.ts`) reusing the registry module; confirm the rewritten index round-trips losslessly, is a doc↔entry bijection, has no overlapping ownership, and lands near ~40 entries. Run the standard validation suite (lint, type-check, existing registry unit tests, build). Confirm `projectConfig` parses the new index with no code change. Produce a reviewer summary and satisfy the HITL gate before merge.

## Step by Step Tasks
Execute every step in order, top to bottom.

### 1. Restore the committed convergence base (discard contamination)
- The worktree's working tree has uncommitted edits that **revert** #609/#610: `.claude/commands/document.md` (back to per-run snapshots), `.claude/commands/adw_init.md` (removes `Owns:` seeding + the `document.md` hash-input), and a stray `README.md` edit. These are out of scope for #612 and would undo the convergence this migration depends on.
- Run `git checkout HEAD -- .claude/commands/document.md .claude/commands/adw_init.md README.md` to restore the committed convergence versions.
- Verify the restoration: `git status --short` shows none of those three files; `git diff origin/dev -- .claude/commands/document.md .claude/commands/adw_init.md` is empty. The migration PR must contain **only** docs + index (+ the check script), never a `document.md`/`adw_init.md` change.

### 2. Inventory the corpus through the registry module
- List every `app_docs/feature-*.md` (expect ~195) and confirm the count.
- Parse `.adw/conditional_docs.md` and confirm entry count (~196) and that **exactly one** entry carries an `Owns:` block: `feature-o4qdu5-app-docs-living-docs-convergence-registry.md`. Record its reserved globs and conditions verbatim.
- Confirm `app_docs/` contains no non-`feature-*.md` files to protect (e.g., `assets/`); scope all later deletions to `app_docs/feature-*.md` regardless.

### 3. Derive the seed taxonomy (disjoint module ownership)
- Enumerate ~40 modules mapped to ADW's real structure. Use the README "Project Structure" tree and the actual directories as the spine. Indicative groupings (refine to land near 40, medium granularity):
  - **`adws/core/**` is a grab-bag — split it into several modules** (e.g., coordination-kernel `processLiveness`/`heartbeat`/`hungOrchestratorDetector`, state & config `agentState`/`stateHelpers`/`topLevelState`/`projectConfig`, claude-stream parsing, hashing/versioning `hashComputer`/`adwVersion`, pause/auth queues, test-report/verdict, classifier/routing/workflow-mapping, slack/logging, …) so no single doc owns the entire `adws/core/**` subtree.
  - One module each for cohesive subsystems: `adws/agents/**`, `adws/phases/**` (or split build/test/scenario/review/merge/upgrade groups), `adws/github/**`, `adws/vcs/**`, `adws/providers/**` (or per provider), `adws/triggers/**` (or split cron/webhook/takeover/coordination), `adws/cost/**`, `adws/promotion/**`, `adws/proof/**`, `adws/r2/**`, `adws/jsonl/**`, `adws/types/**`, the top-level orchestrators (`adws/adw*.tsx`), `workers/cost-api/**`, `workers/screenshot-router/**`, `.claude/commands/**`, `.claude/skills/**`, `.claude/hooks/**`, `features/regression/**`, `features/per-issue/**` + BDD infra, `test/**` infra, `specs/prd/**`, root config (`README.md`, `package.json`, `.github/**`, `UBIQUITOUS_LANGUAGE.md`, `known_issues.md`).
- Assign each module a set of `Owns:` globs that is **pairwise disjoint** from every other module's globs. Reserve the `feature-o4qdu5` doc's exact globs for that doc only; do not let any other entry's glob match them (e.g., if a "core" module owns `adws/core/**`, carve out `conditionalDocsRegistry.ts` so it is owned solely by the registry doc — prefer explicit sub-globs/file lists over a broad `adws/core/**` that would subsume reserved files).
- Record the taxonomy as the working map: `{ moduleSlug, docPath, ownedGlobs[], memberLegacyDocs[] }`. Every one of the ~195 legacy docs must map to exactly one module (use the doc's subject + the source files it describes; corroborate with each legacy entry's `Conditions:` text).

### 4. Author one current-state module doc per cluster (throwaway pass)
- For each module, write `app_docs/feature-9gjajh-<module-slug>.md` in the **current-state module reference format** from the committed `.claude/commands/document.md` and the `feature-o4qdu5` exemplar:
  - `# <Module Title>`, then `## Overview`, `## Responsibilities`, `## Contracts & Invariants`, `## Configuration`, `## Gotchas`.
  - Present tense / current truth only. **No** per-run history, changelog, `ADW ID`, `Date`, `Specification`, `What Was Built`, or `Files Modified` sections.
  - Derive content from the **current source** the module owns (read the real files), using the legacy snapshots only as hints. Drop claims that no longer hold in current source (superseded behavior is removed, not stacked).
- **Preserve** `app_docs/feature-o4qdu5-app-docs-living-docs-convergence-registry.md` exactly as-is (it is already a conformant module doc). Do not re-author or rename it.

### 5. Rewrite the index through the registry module's serialization
- Build a `ConditionalDocsRegistry`: keep the `# Conditional Documentation` preamble; one `ConditionalDocEntry` per module with `docPath`, the disjoint `ownedGlobs` from step 3, and `conditions` regenerated from the authored doc's current content (descriptive enough for semantic routing — name the module's responsibility in plain language, not just file paths).
- Carry the `feature-o4qdu5` entry over **verbatim** (same `docPath`, `Owns:`, `Conditions:`).
- Serialize via `serializeConditionalDocs(...)` (do not hand-write the markdown) and overwrite `.adw/conditional_docs.md`. The simplest reliable path is to drive this from within the `adws/checkLivingDocsIndex.ts` script's sibling/build step or a throwaway `bunx tsx` snippet that imports the registry — the canonical format must come from the module, not by hand.

### 6. Delete the superseded per-run snapshots
- Delete every `app_docs/feature-*.md` that is **not** a retained module doc (i.e., all legacy per-run snapshots; keep the ~40 new `feature-9gjajh-*` docs and the preserved `feature-o4qdu5` doc).
- Confirm no kept doc was deleted and no legacy doc survives. History remains recoverable in git (do not attempt to preserve snapshots in-tree — explicitly out of scope per the PRD).

### 7. Add the one-off verification script
- Create `adws/checkLivingDocsIndex.ts` (run via `bunx tsx adws/checkLivingDocsIndex.ts`). It reads `.adw/conditional_docs.md` and the `app_docs/` directory and, reusing `adws/core/conditionalDocsRegistry.ts`, asserts (printing a clear per-check PASS/FAIL and exiting non-zero on any failure):
  1. **Lossless round-trip:** `serializeConditionalDocs(parseConditionalDocs(content)) === content` (index is in canonical form).
  2. **Doc↔entry bijection:** every entry `docPath` exists on disk under `app_docs/`; every `app_docs/feature-*.md` on disk is referenced by exactly one entry (no orphan docs, no dangling `docPath`s, no duplicate `docPath`).
  3. **Regrowth guard — no overlapping ownership:** no two entries' `ownedGlobs` claim a common file. Implement by classifying the set of tracked repo files (`git ls-files`) with `findOwningEntries(registry, files)` and asserting **≤ 1** owning entry per file; report any file with ≥ 2 owners and the colliding `docPath`s.
  4. **Count sanity:** entry count is in a sane band for "one per module" (e.g., assert ≤ 60 and warn if < 25), confirming the index collapsed from ~196 toward ~40.
- Keep the script pure/typed/guard-clause-first and under the 300-line limit; isolate the filesystem reads at the boundary.

### 8. Run the migration verification gate
- Run `bunx tsx adws/checkLivingDocsIndex.ts`. Resolve every failure by fixing the taxonomy/docs/index (e.g., split a glob that overlaps, add a missing module doc, regenerate a stale condition) and re-run until all checks pass.

### 9. Confirm the planning-side read is unaffected
- Confirm `adws/core/projectConfig.ts` still parses `.adw/conditional_docs.md` into `conditionalDocs` without error and needs **no** code change (the smaller index is consumed automatically). The existing `conditionalDocsRegistry.test.ts` must remain green.

### 10. Prepare the HITL review summary
- The `hitl` label is already on the issue; the stateless auto-merge gate defers merge until a human approves. Produce a concise reviewer summary in the PR body: docs before/after (~195 → ~40), entries before/after (~196 → ~40), lines before/after (~1614 → expected few hundred), count of deleted snapshots, and the list of the ~40 module boundaries (the seed taxonomy). Note this is a destructive whole-`app_docs/` rewrite with history preserved in git.

### 11. Run the Validation Commands
- Run every command in **Validation Commands** below and confirm all pass with zero regressions before handing off for human review.

## Testing Strategy

### Unit Tests
`.adw/project.md` declares `## Unit Tests: enabled`, so this subsection is included — but **this feature adds no new unit-tested module**, by design:
- Per the PRD testing decisions, the clustering is a *throwaway agent pass and is not unit-tested*, and the migration is *lightly covered via the registry module (serialization correctness)*. That coverage already exists in `adws/core/__tests__/conditionalDocsRegistry.test.ts` (parse/serialize round-trips, ownership extraction, collapse/upsert) and must stay green; it is the authoritative proof that the index format the migration emits is correct.
- The new `adws/checkLivingDocsIndex.ts` is a one-off operational gate that asserts against *live repo state* (the on-disk index and `git ls-files`), not a pure unit under test; it is intentionally **not** unit-tested (a unit test against mutating live state would be brittle and is exactly the kind of low-value agent-written test the coding guidelines warn against). It is exercised directly as a Validation Command.
- Do **not** introduce a permanent regression test that reads the live `.adw/conditional_docs.md` — convergence will keep mutating it, so such a test would rot.

### Edge Cases
- **Same-issue duplicate snapshots** (~11 known pairs) cluster into the same module → exactly one surviving doc + entry.
- **Broad subsystem overlap** among legacy docs → resolved by disjoint `Owns:` globs; the overlap check (step 7.3) fails loudly if two modules claim a shared file.
- **`adws/core/**` coarseness** → must split into multiple modules; a single entry owning `adws/core/**` would subsume the reserved `feature-o4qdu5` globs and fail the overlap check.
- **Reserved-glob collision** → no entry other than `feature-o4qdu5` may own `adws/core/conditionalDocsRegistry.ts`, `.adw/conditional_docs.md`, `.claude/commands/document.md`, or the `feature-609|610` BDD files.
- **Orphan / dangling paths** → a deleted snapshot still referenced by an entry, or a kept doc with no entry → caught by the bijection check (step 7.2).
- **Non-canonical index** → hand-edited markdown that doesn't round-trip → caught by the round-trip check (step 7.1); fix by re-serializing through the registry.
- **Files owned by no module** (e.g., a brand-new area) → acceptable (legacy entries were also partial), but prefer assigning every documented area to a module; the count-sanity check only warns, it does not fail, on under-coverage.
- **Empty/legacy entries with no `Owns:`** in the *input* → fine to read; every *output* entry should carry an `Owns:` block so the seed taxonomy is glob-routable from day one.

## Acceptance Criteria
- The ~195 legacy per-run `app_docs/feature-*.md` snapshots are clustered into ~40 per-module current-state docs (Overview / Responsibilities / Contracts & Invariants / Configuration / Gotchas; present tense; no history/changelog/`ADW ID`/`Date`/`Files Modified`).
- `.adw/conditional_docs.md` is rewritten to **one entry per module** (~40 entries), produced by serializing a `ConditionalDocsRegistry` through `serializeConditionalDocs` (not hand-written), with the `feature-o4qdu5` entry preserved verbatim.
- All superseded per-run `feature-*` docs and their index entries are removed; history remains in git; `app_docs/` non-feature files (if any) and the retained module docs are untouched.
- `bunx tsx adws/checkLivingDocsIndex.ts` passes: lossless registry round-trip, doc↔entry bijection, **no overlapping ownership** (regrowth guard), and ~40-entry count sanity.
- The existing `conditionalDocsRegistry.test.ts` stays green and `adws/core/projectConfig.ts` parses the new index with no code change.
- `.claude/commands/document.md` and `.claude/commands/adw_init.md` are unchanged vs `origin/dev` (the working-tree reversion was discarded); the PR diff is docs + index + the check script only.
- The `hitl` gate is satisfied: a human reviews the destructive diff before merge.

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `git diff --name-only origin/dev -- .claude/commands/document.md .claude/commands/adw_init.md` — **must print nothing** (confirms the #609/#610 reversion was discarded and the migration does not touch the convergence prompts).
- `bunx tsx adws/checkLivingDocsIndex.ts` — the migration gate: registry round-trip, doc↔entry bijection, no overlapping ownership (regrowth guard), ~40-entry count sanity. Must exit 0.
- `bun run lint` — Lint the new script and config with zero errors.
- `bunx tsc --noEmit` — Root type-check passes.
- `bunx tsc --noEmit -p adws/tsconfig.json` — `adws/` type-check passes (covers the new `adws/checkLivingDocsIndex.ts`).
- `bun run test:unit` — Vitest suite passes, including `adws/core/__tests__/conditionalDocsRegistry.test.ts` (serialization/round-trip/ownership coverage for the format the migration emits).
- `bun run build` — Build succeeds with no errors.

## Notes

- **Adhere strictly to `.adw/coding_guidelines.md`:** the new `adws/checkLivingDocsIndex.ts` must be pure where possible, immutable, strongly typed (no `any`), guard-clause-first with max nesting depth ~2, under 300 lines, with filesystem reads isolated at the boundary. It must consume the registry module rather than re-implement parsing/serialization or glob matching.
- **Working-tree anomaly (must handle first):** at planning time this worktree carries uncommitted edits that **revert** #609/#610 — `document.md` back to per-run snapshots, `adw_init.md` stripped of `Owns:` seeding, plus a stray `README.md` line. The committed `HEAD` (branch tip, post-`#633`/`#634` merges) has the correct convergence behavior. Step 1 restores all three to `HEAD`. Do not build the migration against the reverted working-tree `document.md`, and never let those reversions reach the PR — they would undo the dependency (#610) this issue is blocked by.
- **Scope discipline — the "regrowth guard" here is a verification, not the guards module.** The PRD's deep, pure **guards module** (doc-size/bloat flag + regrowth-overlap flag, wired into `/document`'s post-write self-check; user stories 11–13) is explicitly *deferred to a later slice* (confirmed in the #609 and #610 specs) and is **out of scope for #612**. This feature satisfies the acceptance criterion "passes the regrowth guard (no overlapping entries)" with the one-off overlap check in `adws/checkLivingDocsIndex.ts` (reusing `findOwningEntries`/`matchesGlob`). Do not build the bloat-size flag or hook anything into `/document` here.
- **Reuse, don't reinvent:** the registry module (`adws/core/conditionalDocsRegistry.ts`) is the single source of truth for the index format. Produce the new index by constructing `ConditionalDocEntry[]` and calling `serializeConditionalDocs`; verify by `parseConditionalDocs`. Hand-written markdown that doesn't round-trip is a bug.
- **Clustering is a throwaway agent pass** (PRD): there is no permanent clustering code and no clustering unit test. The durable, tested artifacts are the registry module (pre-existing) and the small check script; everything else is reviewable data (docs + index) gated by HITL.
- **Granularity target** is "medium" — ~30–50 modules for ADW (aim ~40). An oversized resulting module doc is a *refactor signal for that module*, not a doc-split (no doc-split path exists — out of scope). A bad cluster *split* self-heals later via convergence's sibling-collapse; a bad *merge* persists until the module is refactored — bias toward slightly finer clusters where unsure.
- **No new library is required.** Per `.adw/commands.md`, the install command would be `bun add <package>` and scripts run via `bunx tsx`, but this feature needs neither.
- **Propagation:** this migration edits only ADW's own `app_docs/` + index (+ a script); it changes no hash-input, so it does **not** trigger `adwUpgrade` regeneration in target repos. Non-ADW repos rely solely on the convergence shipped in #609/#610 — they get no migration (out of scope).
- **HITL:** the `hitl` label is already on the issue. Under ADW's stateless auto-merge gate, merge is deferred until the PR is approved; add the reviewer summary (step 10) to make the destructive diff fast to review.

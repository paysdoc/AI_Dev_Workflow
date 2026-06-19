# Feature: app_docs living-docs — semantic routing + sibling collapse

## Metadata
issueNumber: `610`
adwId: `8ah63o-app-docs-living-docs`
issueJson: `{"number":610,"title":"app_docs living-docs: semantic routing + sibling collapse","body":"## Parent PRD\n\n`specs/prd/app-docs-module-living-docs.md`\n\n## What to build\n\nUpgrade `/document` routing from explicit file globs to **semantic judgment** against the module descriptions in the index (conditions rarely enumerate every file in a module, and routing must work even when globs miss). Add **collapse-and-prune**: when a change maps to an area covered by multiple sibling entries, fold them into one module doc and remove the redundant entries. On every rewrite, **regenerate the entry’s description/conditions** so the matcher keeps matching against accurate text. Creating a new module doc + entry happens only when the change is genuinely novel.\n\nEnd-to-end outcome: a run over an area with several sibling docs converges them to one; a genuinely novel change creates exactly one new doc + entry.\n\n## Acceptance criteria\n\n- [ ] `/document` selects the owning module by semantic match against index descriptions\n- [ ] Multiple sibling entries for one area are collapsed into one doc + one entry, redundant entries pruned\n- [ ] The rewritten entry’s description/conditions are regenerated to reflect current content\n- [ ] A genuinely novel change creates exactly one new module doc + entry (no over-merge into an unrelated module)\n- [ ] BDD content-assertion scenarios (`@adw-{issue}`): 3-sibling area collapses to 1; novel change creates exactly 1\n\n## Blocked by\n\n- Blocked by #609\n\n## User stories addressed\n\n- User story 5\n- User story 6\n- User story 10","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-06-17T08:20:49Z","comments":[],"actionableComment":null}`

## Feature Description

This feature is the second slice of the **app_docs Module Living Docs** PRD (`specs/prd/app-docs-module-living-docs.md`). Slice #609 (merged, commit `8b6af53`) introduced the pure **registry module** (`adws/core/conditionalDocsRegistry.ts`) and rewrote `/document` to *converge*: it routes a documented change to the module doc that already **owns** the touched area by **explicit file globs**, rewrites that doc in place, and updates the single existing index entry instead of appending a duplicate.

Slice #610 upgrades that convergence on three axes the #609 slice explicitly deferred:

1. **Semantic routing.** Replace the glob-only routing key with **semantic judgment against each entry's description/conditions text**. This is necessary because index entries rarely enumerate every file in a module — today **only 1 of 198** entries in ADW's `.adw/conditional_docs.md` carries an `Owns:` glob block, so glob-only routing cannot match the other 197 legacy entries at all. Globs remain a corroborating signal but are no longer required for a match.
2. **Collapse-and-prune.** When a change maps to an area covered by **multiple sibling entries**, fold them into **one** module doc, delete the now-redundant doc files, remove their index entries, and keep a single merged entry (union of their owned globs). Convergence becomes a structural side-effect of normal operation rather than a manual cleanup chore.
3. **Regenerate description/conditions on every rewrite.** Whenever a module doc is rewritten, regenerate the entry's `Conditions:` (and the doc's descriptive overview) from current source truth, so the semantic matcher keeps matching against accurate text instead of stale conditions.

A genuinely novel change still creates **exactly one** new module doc + entry, with an explicit guard against over-merging an unrelated change into an existing module.

The value: `/prime` and every planning run read the index in full; keeping it converged to roughly one entry per module (a few dozen) instead of one per feature (unbounded) keeps prime cost flat as the project ages, and keeps each module doc a trustworthy current-truth reference rather than a stack of superseded snapshots.

## User Story

As a `/document` agent (PRD user stories 5, 6, 10),
I want to route a change to the owning module by **semantic match**, **collapse sibling entries** that describe the same area into one doc + one entry, **regenerate** that entry's description/conditions on every rewrite, and create a new module doc **only when the change is genuinely novel**,
So that the conditional-docs index converges toward one entry per module, the semantic matcher keeps matching against accurate text, and the registry never regrows duplicate modules.

## Problem Statement

The #609 convergence routing matches a touched change to an owning entry **by explicit file globs only**. Two gaps remain:

- **Glob-only routing cannot reach legacy entries.** 197 of 198 entries in ADW's index have no `Owns:` block, so `findOwningEntry` returns `undefined` for them and `/document` falls through to "create new" — re-appending duplicates for areas that are already documented. Conditions rarely enumerate every file in a module, and the planning side has no diff to match globs against. Routing must work on the module's *description*, not only on a glob list.
- **No sibling collapse.** When an area is already covered by several overlapping entries (the PRD notes ~11 same-issue duplicate pairs plus broad subsystem overlap among the 198 entries), #609 routes to the *first* match and leaves the rest. The index never actually converges; the redundant siblings persist forever and keep costing prime tokens and misleading planners with superseded claims.

Without semantic routing and collapse-and-prune, the index stays inflated and the "one entry per module" goal is unreachable for any repo that did not get a one-off migration.

## Solution Statement

Extend the deep, pure **registry module** with a tested **collapse** capability and **multi-match** query, then rewrite the `/document` prompt to (a) route semantically against entry descriptions, (b) collapse-and-prune siblings into one doc + one entry, (c) regenerate the merged entry's description/conditions, and (d) create new only when genuinely novel. Lock the observable behavior with `@adw-610` BDD content-assertion scenarios that extend the hermetic #609 harness.

Concretely:

- **Registry (`adws/core/conditionalDocsRegistry.ts`)** — add two pure, immutable, FS-free functions that make sibling-collapse a deterministic **code** outcome (not LLM judgment), mirroring the existing `findOwningEntry`/`upsertEntry` style:
  - `findOwningEntries(registry, changedFilePaths): ConditionalDocEntry[]` — **all** entries (document order) with ≥1 owned glob matching ≥1 changed path. (`findOwningEntry` becomes its first element.)
  - `collapseEntries(registry, docPathsToCollapse, merged): { registry, prunedDocPaths }` — removes every listed entry, inserts **one** merged entry at the position of the first removed entry, with `ownedGlobs` = the **union** of the collapsed entries' globs and `conditions` = the regenerated `merged.conditions`; returns the new registry plus the `prunedDocPaths` (collapsed paths minus the survivor) so the caller deletes those doc files. Idempotent: collapsing a single entry into itself is the existing rewrite-in-place case.
- **`/document` prompt (`.claude/commands/document.md`)** — replace the glob-only "Route by ownership" step with **semantic-first** routing (judge ownership from each entry's `Conditions:`/description, with `Owns:` globs as a corroborating signal), add an explicit **collapse-and-prune** step, make rewrite-in-place **regenerate the entry's `Conditions:` and the doc's description** every time, and strengthen the **novel-only** create step with an anti-over-merge guard.
- **`adw_init.md`** — keep `.claude/commands/document.md` in `hashInputs:` (so the prompt change propagates to all target repos via `.adw/` regeneration) and keep the convergent `Owns:` seeding, with a light emphasis that seeded `Conditions:` must be descriptive enough for semantic routing.
- **BDD (`features/per-issue/feature-610.feature` + step defs)** — extend the #609 hermetic harness (drive the registry's pure functions over a temp fixture index, stub the doc body) to seed a **3-sibling** area and assert it collapses to exactly **1** doc + **1** entry with the redundant docs pruned, that the merged entry's conditions are regenerated, and that a **novel** change creates exactly **1** new doc + entry without over-merging.

This keeps the testable core deterministic (the registry decides the *counts*), while the non-deterministic semantic *judgment* lives in the prompt — exactly the split #609 established.

## Relevant Files

Use these files to implement the feature:

- `specs/prd/app-docs-module-living-docs.md` — Parent PRD. Authoritative source for the doc model, registry-as-index decision, routing strategy ("semantic judgment against the ~40 module descriptions"), the collapse/prune behavior, and the testing decisions (pure-module vitest + `@adw-{issue}` content-assertion scenarios). Read first.
- `adws/core/conditionalDocsRegistry.ts` — The deep, pure registry module from #609 (parse/serialize/`findOwningEntry`/`upsertEntry`/`matchesGlob`, types `ConditionalDocEntry`/`ConditionalDocsRegistry`). **#610 adds `findOwningEntries` and `collapseEntries` here.** Single source of truth for the index format.
- `adws/core/__tests__/conditionalDocsRegistry.test.ts` — Vitest table tests for the registry (round-trip, legacy tolerance, glob boundaries, `findOwningEntry`, `upsertEntry` convergence). **#610 adds describe blocks for `findOwningEntries` and `collapseEntries`.** Mirror this file's pure-function table-test style exactly.
- `.claude/commands/document.md` — The `/document` slash-command prompt. **The primary behavioral change of #610.** The committed HEAD version is the #609 glob-only convergence prompt (Route by ownership → Rewrite in place → Create new). **NOTE: the working tree currently has stray uncommitted edits that revert this file to the pre-#609 per-run-snapshot format — restore the #609 committed version first (see Task 1).**
- `.claude/commands/adw_init.md` — Bootstraps target repos. Its `hashInputs:` list must continue to include `.claude/commands/document.md` so the prompt change propagates via `adwUpgrade`. Step 4 seeds `.adw/conditional_docs.md` with `Owns:` + `Conditions:` entries. **NOTE: the working tree currently has stray edits that remove `document.md` from `hashInputs` and delete the step-4 `Owns:` guidance — restore the #609 committed version first (see Task 1).**
- `.adw/conditional_docs.md` — The live ADW index (198 entries; only 1 has an `Owns:` block). Real-world evidence of why semantic routing is required. Not edited by this feature directly (a `/document` run edits it at runtime); used to understand the entry format and the sibling-overlap problem.
- `features/per-issue/feature-609.feature` — The predecessor content-assertion scenario. **Template to mirror** for `feature-610.feature` (Feature narrative style, contract enumeration, observability/rot-prevention note, vocabulary note, `@adw-{issue}` + `@adw-{adwId}` tags on Feature and every Scenario).
- `features/per-issue/step_definitions/feature-609.steps.ts` — The hermetic harness that drives the registry's pure functions over a temp fixture worktree with a stubbed doc body. **Template to extend** for `feature-610.steps.ts` (Before/After temp-dir hooks scoped to the tag, `flushRegistry`/`readRegistry`/`writeModuleDoc` helpers, count-based assertions on produced artefacts only).
- `adws/core/projectConfig.ts` — Consumes the registry via `parseConditionalDocs` and exposes `ProjectConfig.conditionalDocs`. **No change required** — `findOwningEntries`/`collapseEntries` are purely additive exports. Listed to confirm the additions don't break the consumer.
- `app_docs/feature-o4qdu5-app-docs-living-docs-convergence-registry.md` — The living module doc for the registry (#609). This is the entry in `.adw/conditional_docs.md` whose `Owns:` block already covers `adws/core/conditionalDocsRegistry.ts`, its test, `.adw/conditional_docs.md`, and `.claude/commands/document.md` — i.e. the module a `/document` run for #610 will itself route to. Context for the conditional-doc that matches this task's area.
- `.adw/coding_guidelines.md` — Coding guidelines (purity, immutability, type safety, max-depth-2 nesting, guard clauses, files < 300 lines). The new registry functions must adhere strictly.
- `.adw/scenarios.md` — BDD config. Confirms per-issue scenarios live under `features/per-issue/` as `feature-{N}.feature`, the `@regression` auto-promotion sweep is **skipped** (deliberate human decision), and step phrases are validated against `features/regression/vocabulary.md`.

### New Files

- `features/per-issue/feature-610.feature` — The `@adw-610` content-assertion scenarios (**six**, §1–§6): semantic routing over a glob miss → the owning entry is updated in place (not appended); 3-sibling collapse → 1 doc + 1 entry; surgical prune of the redundant siblings with unrelated entries untouched; regenerated description on the merged/rewritten entry; novel-change → exactly 1 (no over-merge); and a TypeScript type-check backstop. Mirrors `feature-609.feature`.
- `features/per-issue/step_definitions/feature-610.steps.ts` — Hermetic step definitions extending the #609 harness with sibling-seeding Givens, a collapse-driving When (over `findOwningEntries` + `collapseEntries`), and count/prune assertions on produced artefacts. Mirrors `feature-609.steps.ts`.

## Implementation Plan

### Phase 1: Foundation
Restore the #609 committed baseline in the working tree (discard the stray reverts on `document.md` and `adw_init.md`) so #610 builds on convergence, not the pre-#609 per-run-snapshot prompt. Then extend the pure registry module with the deterministic collapse primitives (`findOwningEntries`, `collapseEntries`) and their vitest tests. These are pure, FS-free, immutable functions and are the deterministic core that the BDD scenarios pin — they land first so everything downstream composes them.

### Phase 2: Core Implementation
Rewrite the `/document` prompt for semantic-first routing, collapse-and-prune, regenerate-on-rewrite, and novel-only creation. Keep `adw_init.md`'s `hashInputs:` and convergent seeding intact so the prompt change propagates to target repos. This is the behavioral payload of the feature.

### Phase 3: Integration
Author the `@adw-610` BDD content-assertion scenarios and their hermetic step definitions, extending the #609 harness to prove 3-sibling-collapse and novel-only-create as deterministic registry outcomes. Validate end-to-end: lint, type-check (root + adws), registry unit tests, the `@adw-610` scenarios, and build — zero regressions.

## Step by Step Tasks
Execute every step in order, top to bottom.

### Task 1 — Restore the #609 convergence baseline (discard stray reverts)
- The worktree started with uncommitted edits that revert `.claude/commands/document.md` and `.claude/commands/adw_init.md` to the pre-#609 per-run-snapshot format. Restore the committed #609 versions so #610 extends convergence:
  - Run `git checkout -- .claude/commands/document.md .claude/commands/adw_init.md` (HEAD is `8b6af53`, the #609 merge).
  - Confirm `document.md` now contains the `### 4. Route by ownership`, `### 5. Rewrite in place`, `### 6. Create new` sections and the current-state module-reference Documentation Format.
  - Confirm `adw_init.md` frontmatter `hashInputs:` lists `.claude/commands/document.md`, and step 4 retains the `Owns:` glob seeding guidance.
- Leave the `README.md` working-tree edit (adds the `conditionalDocsRegistry.ts` index line) in place — it is correct and harmless. Do not introduce unrelated changes.

### Task 2 — Add `findOwningEntries` (plural) to the registry
- In `adws/core/conditionalDocsRegistry.ts`, add a pure exported function `findOwningEntries(registry, changedFilePaths): ConditionalDocEntry[]` returning **all** entries (document order) whose `ownedGlobs` has ≥1 glob matching ≥1 path in `changedFilePaths`. Reuse the existing `matchesGlob`. Entries with empty `ownedGlobs` never match (legacy tolerance, same rule as `findOwningEntry`).
- Refactor `findOwningEntry` to return `findOwningEntries(registry, changedFilePaths)[0]` (or keep as-is and let the new function stand alongside — choose the lower-churn option). Behavior of `findOwningEntry` must not change.
- Keep functions pure (no FS, no mutation), guard-clause style, max depth 2.

### Task 3 — Add `collapseEntries` to the registry
- In the same module, add a pure exported function:
  - Signature: `collapseEntries(registry: ConditionalDocsRegistry, docPathsToCollapse: string[], merged: { docPath: string; conditions: string[] }): { registry: ConditionalDocsRegistry; prunedDocPaths: string[] }`.
  - Behavior: remove every entry whose `docPath` is in `docPathsToCollapse`; build one merged `ConditionalDocEntry` with `docPath: merged.docPath`, `conditions: merged.conditions`, and `ownedGlobs` = the de-duplicated **union** of the collapsed entries' `ownedGlobs` (document order preserved); insert the merged entry at the index of the **first** collapsed entry (so position is stable); return the new registry and `prunedDocPaths` = `docPathsToCollapse` minus `merged.docPath`.
  - Edge cases: a `docPath` in the list that is not present is ignored (no throw); collapsing a single entry into the same `docPath` reduces to an in-place rewrite (length unchanged, `prunedDocPaths: []`); the function is immutable (original `registry` untouched).
- Optionally factor an internal `unionGlobs(globLists: string[][]): string[]` helper for clarity; keep it pure.
- Update the file's top-of-file canonical-format comment if the new functions warrant a one-line mention. Keep the file under 300 lines (it is ~175 today; the additions fit).

### Task 4 — Unit tests for `findOwningEntries` and `collapseEntries`
- In `adws/core/__tests__/conditionalDocsRegistry.test.ts`, add two `describe` blocks following the existing pure table-test style:
  - `findOwningEntries`: returns all matching entries in document order; returns `[]` when none match; legacy (empty-glob) entries never appear; multiple entries matching the same path are all returned (unlike singular first-match).
  - `collapseEntries`: 3 sibling entries owning one area collapse to exactly 1 entry (`result.registry.entries` length drops by 2; exactly one entry has the merged `docPath`); merged `ownedGlobs` is the de-duplicated union of the three; `prunedDocPaths` equals the two non-survivor paths; a missing `docPath` in the list is a no-op; single-entry collapse keeps length and yields `prunedDocPaths: []`; original registry is not mutated (purity); unrelated entries are preserved unchanged and in order.
- Run `bun run test:unit` (or `bunx vitest run adws/core/__tests__/conditionalDocsRegistry.test.ts`) and confirm green.

### Task 5 — Rewrite `/document` routing to semantic-first
- In `.claude/commands/document.md`, replace the `### 4. Route by ownership` step:
  - Read `.adw/conditional_docs.md` (via the registry's understanding of the format) and, for the touched files **and the nature of the change**, **semantically judge** which existing entry's module **owns** this area by reading each entry's `Conditions:`/description text — not only its `Owns:` globs. Routing must succeed even when no glob matches (the common case for legacy entries with no `Owns:` block).
  - Treat `Owns:` globs as a **corroborating** signal: a glob hit is strong evidence of ownership; absence of a glob hit does **not** rule out a semantic match.
  - Define the decision: **match** → go to rewrite/collapse; **no plausible owning module** → go to create-new (novel).
- Keep the language tight and imperative, consistent with the existing prompt's voice.

### Task 6 — Add the collapse-and-prune step to `/document`
- In `.claude/commands/document.md`, add a step (e.g. `### 5. Collapse sibling entries for the area`) before/within rewrite-in-place:
  - When the change maps to an area covered by **more than one** entry (multiple siblings describe the same module/area), **fold them into one**: pick a single survivor module doc, rewrite it in place to current-state truth, **delete the now-redundant sibling doc files**, **remove their entries** from `.adw/conditional_docs.md`, and keep **one** merged entry whose `Owns:` globs are the union of the collapsed entries' globs.
  - State the post-condition explicitly: after the run, exactly **one** entry and exactly **one** module doc cover the area; the redundant docs and entries are gone.
  - Reference that the deterministic collapse semantics are the registry's `collapseEntries` contract (the index must still parse/serialize losslessly through the registry).

### Task 7 — Regenerate description/conditions on every rewrite; strengthen novel-only
- In the rewrite-in-place step of `.claude/commands/document.md`, require that **every** rewrite **regenerates** the entry's `Conditions:` block **and** the module doc's descriptive Overview from current source truth (so the semantic matcher keeps matching against accurate text), and ensures `Owns:` globs cover all touched files. Never duplicate a `docPath`.
- In the `### Create new (novel area)` step, strengthen the guard: create a new doc + **exactly one** new entry **only** when no existing module plausibly owns the area (semantically or by glob). Add an explicit anti-over-merge instruction: do **not** fold a genuinely novel change into an unrelated existing module just to avoid creating an entry.
- Update the `## Report` section to state whether the run **collapsed siblings** (and how many), **rewrote in place**, or **created new**.

### Task 8 — Keep `adw_init.md` propagation and seeding intact
- Confirm `.claude/commands/adw_init.md` frontmatter `hashInputs:` still includes `.claude/commands/document.md` (restored in Task 1). This is what raises `.adw-version` and triggers `adwUpgrade` to regenerate `.adw/` across registered target repos so the new `/document` behavior propagates (PRD "Propagation" decision).
- In step 4 (Create `.adw/conditional_docs.md`), keep the `Owns:` glob seeding and add a light instruction that each entry's `Conditions:` must be **descriptive enough to support semantic routing** (name the module's responsibility, not just a file path), since #610 routes on description text. Do not remove the `Owns:` guidance.

### Task 9 — Author `feature-610.feature` (`@adw-610`)
- Create `features/per-issue/feature-610.feature` mirroring `feature-609.feature`:
  - Tag the Feature and **every** Scenario with `@adw-610 @adw-8ah63o-app-docs-living-docs`.
  - Feature narrative: this slice adds semantic routing + sibling collapse on top of #609's glob convergence; enumerate the pinned contracts (semantic routing over a glob miss updates the owning entry in place; 3-sibling → 1 doc + 1 entry; the prune of the redundant siblings is surgical — unrelated entries untouched; merged/rewritten entry description/conditions regenerated; novel → exactly 1, no over-merge).
  - Include the observability/rot-prevention note (every assertion targets a **produced** artefact — the converged fixture index and `app_docs/` docs — never a source file read as text) and a scope note that the **semantic judgment is an opaque precondition** (the sibling set is supplied as test input, exactly as #609 supplied the glob), so the **collapse COUNT is deterministic registry code**.
  - Scenarios (count-based, hermetic) — the **six** `@adw-610` scenarios, mapped to the feature file's §1–§6:
    1. **§1 Semantic routing over a glob miss (AC1, core):** Given an index whose only entry for an area is described semantically but does **not** glob the touched file, When a `/document` run documents a change touching that file, Then the index holds exactly one entry for the area, And it is the pre-existing entry **updated in place** (not a second appended sibling).
    2. **§2 3-sibling collapse (AC2/AC5 headline):** Given an index where 3 sibling entries all describe one area, When a `/document` run documents a change in that area, Then the index holds exactly one entry owning that area, And exactly one module doc covers it.
    3. **§3 Surgical prune (AC2):** Given an index with 3 sibling entries for one area alongside entries for N unrelated modules, When a `/document` run documents a change in that area, Then exactly one entry owns the area, And the redundant sibling entries for that area are pruned, And every unrelated module entry is left unchanged.
    4. **§4 Regenerated description (AC3):** Given an index whose single entry for an area carries a **stale** seeded description, When a `/document` run rewrites the owning doc, Then exactly one entry owns the area, And its description/conditions are regenerated to reflect current content (no longer the stale seeded text).
    5. **§5 Novel creates exactly one, no over-merge (AC4/AC5 headline):** Given an index describing N unrelated modules, none owning a novel area, When a `/document` run documents a change there, Then exactly one new module doc and one new index entry are created for that area, And every unrelated module entry is left unchanged.
    6. **§6 Type-check backstop:** Given the ADW codebase is checked out, Then the ADW TypeScript type-check passes (the collapse/prune helpers + semantic-routing wiring compile).
  - Add a vocabulary note: reuse `the ADW codebase is checked out` (G18); list the novel collapse phrases introduced here and surface the registry gap to the maintainer (mirroring #609's note). Per `.adw/scenarios.md`, the `@regression` sweep is skipped (human decision); do not add `@regression`.

### Task 10 — Author `feature-610.steps.ts` (hermetic harness extension)
- Create `features/per-issue/step_definitions/feature-610.steps.ts` extending the `feature-609.steps.ts` pattern:
  - `Before`/`After` hooks scoped to `@adw-610` create/remove a temp fixture dir with `.adw/` and `app_docs/`. Reset per-scenario state.
  - Import the registry's pure functions (`parseConditionalDocs`, `serializeConditionalDocs`, `findOwningEntries`, `collapseEntries`, `upsertEntry`, `matchesGlob`, types) from `../../../adws/core/conditionalDocsRegistry.ts`.
  - Helpers: `flushRegistry`/`readRegistry`/`writeModuleDoc` (copy from #609).
  - Givens seed fixture state per scenario using the feature file's `the area under {string}` phrase family (a path-area prefix), each seeded entry with its own stub `app_docs/` doc:
    - §1 `a conditional-docs index whose only entry for the area under {string} is described semantically but does not list {string} among its owned file globs` — the seeded globs deliberately exclude the touched file so glob-only routing misses it.
    - §2 `a conditional-docs index with three sibling entries describing the same area under {string}`.
    - §3 `a conditional-docs index with three sibling entries describing the area under {string} alongside entries for {int} unrelated modules`.
    - §4 `a conditional-docs index whose single entry for the area under {string} carries a stale description that no longer reflects the module's current content` — seed a recognisable stale marker.
    - §5 `a conditional-docs index describing {int} unrelated modules, none of which owns the area under {string}`.
  - Shared When: `the /document agent documents a change touching {string}` (the concrete path under the area). Drive each route deterministically through the registry seam (semantic route + survivor `docPath` supplied as test input, doc body stubbed):
    - §1: route the pre-existing entry semantically and `upsertEntry` it **in place** — globs miss, so `findOwningEntries` alone would not find it; assert no sibling is appended.
    - §2/§3: `findOwningEntries`/seeded siblings → choose a survivor `docPath` → `collapseEntries(reg, siblingDocPaths, { docPath, conditions: [regenerated...] })` → write survivor doc, **delete** each `prunedDocPaths` file, serialize back.
    - §4: rewrite the owning doc and regenerate the entry's description/conditions so the produced text differs from the seeded stale marker.
    - §5: reuse #609's novel-area branch — exactly one new doc + entry, unrelated entries untouched.
  - Thens (assert produced artefacts only): `the conditional-docs index holds exactly one entry for the area under {string}`; `exactly one module doc covers the area under {string}`; `that one entry is the pre-existing entry, updated in place rather than appended alongside a new sibling` (§1); `the redundant sibling entries that described the area under {string} are pruned from the index` (§3); `every unrelated module entry is left unchanged` (§3/§5); `the entry for the area under {string} carries a regenerated description reflecting the module's current content rather than the stale seeded text` (§4 — an output-vs-seeded-input delta, not merely non-empty); `the /document agent creates exactly one new module doc and one new index entry for the area under {string}` (§5). §6 reuses G18 `the ADW codebase is checked out` + T22 `the ADW TypeScript type-check passes`.
  - No assertion may read a repo source file as text, substring-match it, or parse it as JSON/AST (rot-prevention rule).

### Task 11 — Run the full validation suite
- Run every command in `## Validation Commands` below. All must pass with zero errors and zero regressions. Fix any failures before considering the task complete.

## Testing Strategy

### Unit Tests
`.adw/project.md` declares `## Unit Tests: enabled`, so unit tests are in scope.

- **`findOwningEntries` (pure, table tests):** returns all matching entries in document order; `[]` when none match; legacy empty-glob entries never match; when several entries match the same path, all are returned (contrast with the singular first-match).
- **`collapseEntries` (pure, table tests):** 3 siblings collapse to 1 (length − 2, single survivor `docPath`); merged `ownedGlobs` is the de-duplicated union; `prunedDocPaths` = non-survivor paths; missing-`docPath` entries are ignored (no throw); single-entry collapse is in-place (length unchanged, `prunedDocPaths: []`); purity (original registry unchanged); unrelated entries preserved in order.
- All registry tests live in `adws/core/__tests__/conditionalDocsRegistry.test.ts`, following the existing input→output table style (no internal call-shape assertions), run via `bun run test:unit`.

### Edge Cases
- **Glob-miss semantic match:** a touched file matched by **no** `Owns:` glob still routes to the semantically owning entry (the 197-legacy-entry reality). Pinned at the prompt level; the harness treats the owning/sibling set as supplied input.
- **Single sibling = rewrite-in-place:** "collapse" of one entry is the existing #609 rewrite case — length unchanged, nothing pruned. Must not regress #609 scenarios.
- **Novel area, no over-merge:** a genuinely novel change creates exactly one entry and does not get absorbed into an unrelated module.
- **Union de-dup:** collapsing entries with overlapping globs yields a de-duplicated union (no duplicate glob lines), so the serialized index still round-trips losslessly through the registry.
- **Lossless siblings:** entries the run does **not** route to survive byte-identically (registry round-trip), so collapse never mangles or reorders unrelated entries.
- **Empty / malformed index tolerance:** `findOwningEntries`/`collapseEntries` behave on an empty registry and on entries missing a `Conditions:` block without throwing.

## Acceptance Criteria
- `/document` selects the owning module by **semantic match** against index entry descriptions/conditions, succeeding even when no `Owns:` glob matches the touched files.
- Multiple sibling entries for one area are **collapsed into one doc + one entry**, with the redundant doc files and index entries **pruned**; the post-run index has exactly one entry and one module doc for that area.
- Every rewrite **regenerates** the entry's `Conditions:`/description from current source truth (non-empty, current), so the semantic matcher keeps matching against accurate text.
- A genuinely novel change creates **exactly one** new module doc + entry, with no over-merge into an unrelated module and no unrelated entry modified.
- `@adw-610` BDD content-assertion scenarios exist and pass: a 3-sibling area collapses to 1 doc + 1 entry (redundant pruned); a novel change creates exactly 1.
- The pure registry additions (`findOwningEntries`, `collapseEntries`) are covered by passing vitest table tests and are immutable/FS-free.
- `.claude/commands/document.md` remains a `hashInputs:` of `adw_init.md` so the behavior propagates to target repos.
- Lint, type-check (root + `adws/tsconfig.json`), unit tests, the `@adw-610` scenarios, and build all pass with zero regressions.

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions. Commands are sourced from `.adw/commands.md`.

- `bun run lint` — ESLint across the repo; zero errors.
- `bunx tsc --noEmit` — Root type-check passes (registry additions type-check).
- `bunx tsc --noEmit -p adws/tsconfig.json` — `adws/` project type-check passes.
- `bun run test:unit` — Vitest unit suite passes, including the new `findOwningEntries` and `collapseEntries` table tests in `adws/core/__tests__/conditionalDocsRegistry.test.ts` and the unchanged #609 registry tests.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-610"` — The new content-assertion scenarios pass (3-sibling collapse → 1; regenerated conditions; novel → exactly 1).
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-609"` — The predecessor convergence scenarios still pass (no regression from the registry refactor or prompt rewrite).
- `bun run build` — `tsc` build succeeds with no errors.

## Notes
- **Adhere strictly to `.adw/coding_guidelines.md`:** the new registry functions must be pure, immutable (return new values, never mutate inputs), strongly typed (no `any`), guard-clause-first with max nesting depth ~2, and the file must stay under 300 lines. Mirror the existing `upsertEntry`/`findOwningEntry` idiom.
- **Library install command** (per `.adw/commands.md`): `bun add <package>`. **No new libraries are required** — `collapseEntries`/`findOwningEntries` are plain TypeScript over existing types, and the step definitions use only `@cucumber/cucumber`, `assert`, `fs`, `os`, `path` (all already in use by `feature-609.steps.ts`).
- **Working-tree hygiene (important):** the worktree began with stray uncommitted edits that **revert** `.claude/commands/document.md` and `.claude/commands/adw_init.md` to the pre-#609 per-run-snapshot format. Task 1 restores the committed #609 baseline; do not build on the reverted files. The `README.md` edit (adds the `conditionalDocsRegistry.ts` line) is correct and may be kept/committed.
- **Why the counts are testable despite semantic routing:** the *semantic judgment* (which module owns a change; which entries are siblings) is non-deterministic LLM work in a real `/document` run, but the *collapse counts* are deterministic registry code. The `@adw-610` harness supplies the sibling set as test input (exactly as #609 supplied the glob) and drives `collapseEntries`, so the "3 → 1" and "novel → 1" outcomes are pinned hermetically without invoking an LLM. The prompt rewrite is the non-deterministic layer; the scenarios are its regression contract plus the registry's behavioral oracle.
- **Out of scope for #610 (later PRD slices):** the **guards module** (bloat-size flag + regrowth-overlap flag, PRD user stories 11–13) and the **one-off 191-doc migration** (PRD user story 8). #610 covers PRD user stories 5 (collapse siblings), 6 (novel-only create), and 10 (regenerate description/conditions), plus the semantic-routing upgrade that enables them. Do not implement the guards or the migration here.
- **Propagation cost note (from PRD):** changing `document.md` raises the framework hash and triggers `adwUpgrade` to regenerate `.adw/` in all registered target repos — intended behavior, the mechanism by which non-ADW repos get convergence without a migration.
- **`@regression` sweep is skipped** for this issue: `.adw/scenarios.md` sets a `## Regression Scenario Directory`, so promotion to the regression suite is a deliberate human decision; the agent must not auto-promote the `@adw-610` scenarios.

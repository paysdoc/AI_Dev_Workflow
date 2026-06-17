# PRD: app_docs Module Living Docs

## Problem Statement

`/prime` and every planning run read `.adw/conditional_docs.md` in full to decide which feature docs to load. That index grows by **one entry per `/document` run, appended forever** — today 191 entries / 1558 lines / ~46K tokens — so the always-paid cost of priming grows without bound as the project accumulates features.

The doc bodies compound the waste: `/document` writes one immutable per-run snapshot (`feature-{adwId}-*.md`), so (a) re-runs of the same issue produce near-duplicate docs (~11 same-issue duplicate pairs exist today) and (b) within a subsystem, later docs silently supersede earlier ones — a planning task on that subsystem loads three overlapping docs when only the newest is current truth, and the stale two cost tokens and can mislead.

Consolidating doc *files* does nothing for prime cost unless the number of index *entries* drops, and any one-time cleanup is re-inflated by the very next `/document` run.

## Solution

Treat `app_docs/` as **disposable working context** (history lives in git), not an audit record, and move from **per-run snapshot docs** to **per-module living docs**:

- One doc per code module (~30–50 for ADW; "medium" granularity), holding a **current-state reference** ("what this module does now, its contracts/invariants, config, gotchas"), **rewritten in place** on each change — never an accumulating changelog.
- `conditional_docs.md` becomes the registry: **one entry per module**, so the index is bounded by module count (a few dozen) instead of feature count (unbounded). Prime cost stays flat forever.
- `/document` is rewritten to **converge**: it semantically routes a change to the owning module doc, rewrites that doc to current truth, collapses any sibling entries for the same area, and only creates a new doc+entry when the change is genuinely novel. Consolidation becomes a structural side-effect of normal operation, not a recurring manual chore.
- A one-off migration collapses ADW's existing 191 docs into the new module structure. Other repos rely solely on the convergence behavior shipping in `/document`.

From a developer's and planning agent's perspective: priming a repo costs a fixed, small amount regardless of project age, and reading a module's doc yields current truth rather than a pile of superseded snapshots.

## User Stories

1. As an ADW maintainer, I want the `/prime` index cost to stay flat as the project ages, so that planning runs don't get steadily slower and more expensive.
2. As a planning agent, I want one current-state doc per module instead of several overlapping per-run snapshots, so that I load less redundant context and don't ingest stale claims.
3. As a `/document` agent, I want to route a change to the module doc that already owns the touched area, so that I update existing documentation instead of appending a duplicate.
4. As a `/document` agent, I want to rewrite a module doc to reflect current source truth, so that superseded behavior is removed rather than stacked.
5. As a `/document` agent, I want to collapse sibling entries that describe the same area into one, so that the index converges toward one entry per module.
6. As a `/document` agent, I want to create a new module doc only when a change is genuinely novel, so that the registry doesn't regrow duplicate modules.
7. As a target-repo owner, I want convergence to keep my `app_docs/` lean automatically, so that I never have to hand-prune documentation.
8. As an ADW maintainer, I want a one-off migration that collapses the existing 191 ADW docs into module docs, so that the repo gets the full benefit immediately rather than only as areas are re-touched.
9. As a developer reading docs, I want a module doc to describe current behavior only, so that I can trust it without diffing against git history.
10. As an ADW maintainer, I want the index entry's description/conditions regenerated whenever its doc is rewritten, so that semantic routing keeps matching against accurate text.
11. As an ADW maintainer, I want `/document` to flag when a rewritten module doc exceeds a size threshold, so that an oversized doc surfaces a module that needs refactoring.
12. As an ADW maintainer, I want `/document` to flag when it produces an index entry that overlaps an existing one, so that convergence misfires (regrowth) are caught early on repos that have no migration backstop.
13. As a developer, I want the index format parsed and serialized by a single tested module, so that `/document` and the guards share one reliable representation of the registry.
14. As an ADW maintainer, I want the convergence behavior verified by BDD content-assertion scenarios, so that the `/document` prompt rewrite is regression-protected the way other command/skill prompts are.
15. As a maintainer of a non-ADW target repo, I want the same convergence behavior to ship in `/document` automatically, so that my repo never accumulates the unbounded index in the first place.

## Implementation Decisions

- **Doc model:** per-module living docs replace per-run snapshot docs. Format is a current-state reference, rewritten in place; no per-feature history sections, no changelog tail. Doc size is bounded by module complexity; an oversized doc is treated as a refactor signal for the module, **not** split (there is no doc-split path).
- **Registry = the index.** `conditional_docs.md` holds one entry per module, each entry carrying the doc path, the semantic match conditions, and the file globs the module owns. No separate registry artifact.
- **Registry module (deep, pure):** parses `conditional_docs.md` into structured entries and serializes structured entries back to markdown. Single source of truth for the index format; consumed by `/document` routing, the guards, and the migration. Replaces today's raw-string read of the index.
- **Guards module (deep, pure):** given parsed entries and a doc's size, computes a bloat flag (size over threshold) and regrowth flags (entries whose ownership overlaps). Deterministic; lifted out of the LLM.
- **`/document` rewrite (LLM prompt + phase wiring):** from the diff, identify touched files and understand the change; semantically match it against the module descriptions in the index; on match, rewrite the owning module doc to current state from source, collapse and prune sibling entries, and regenerate that entry's description/conditions; on no match, create one new module doc + entry; never append a second entry for an already-covered area; run the guards as a post-write self-check and log/act on flags.
- **Routing strategy:** semantic judgment against the ~40 module descriptions (not glob-only), because conditions rarely enumerate every file in a module and the planning side has no diff to match globs against.
- **Bloat action:** the guard flag is surfaced by `/document`; the downstream actor is `/refactor` or a filed refactor issue. `/refactor` is not the measurement point (it is blind to `app_docs/` and sees only changed code files).
- **Migration:** one-off, ADW-only, fully-automated clustering of the existing 191 docs into ~40 module docs plus a rewritten index, reusing the registry module's serialization. The resulting boundaries become the seed taxonomy; a bad cluster *split* self-heals via convergence's sibling-collapse, a bad *merge* persists until the module is refactored. Other repos get no migration — convergence is their sole mechanism.
- **Propagation:** `/document.md` (and any seeding in `adw_init`) are hash-inputs, so the change propagates to all registered target repos via the existing `.adw/` regeneration path.

## Testing Decisions

- **What makes a good test here:** assert external behavior, not implementation details. For the pure modules that means input markdown / structured entries in, expected entries / markdown / flags out — never internal call shapes. For the `/document` prompt, that means asserting observable outcomes (one entry per area after two runs; sibling entries collapsed; a new entry only for novel areas; flags emitted on oversize/overlap), not prompt wording.
- **Modules unit-tested (vitest):** the registry module (parse/serialize round-trips, malformed-entry handling, ownership extraction) and the guards module (bloat threshold boundaries, regrowth overlap detection, no-false-positive on disjoint entries). Prior art: `adws/core/__tests__/testVerdict.test.ts` and `testReportParser.test.ts` — pure-function table tests over a structured signature.
- **`/document` convergence behavior:** BDD content-assertion scenarios tagged `@adw-{issue}`, following the established pattern (e.g. the `@adw-438` depaudit content-assertion scenarios) — verifying the no-append, collapse-siblings, novel-only-creates, and self-check-flag properties.
- **Migration:** lightly covered via the registry module (serialization correctness); the clustering itself is a throwaway agent pass and is not unit-tested.

## Out of Scope

- Splitting an oversized module doc (an oversized doc is a refactor signal, not an automated split).
- Migrating non-ADW target repos (they rely on convergence only).
- A separate machine registry artifact distinct from `conditional_docs.md`.
- Changing the planning-side read mechanism (it benefits automatically from the smaller index; no code change).
- Preserving per-run historical documentation (history lives in git).

## Further Notes

- The unbounded cost was diagnosed as the index entry count, not file count or disk; the fix is durable only because it changes how `/document` writes, not just a one-time cleanup.
- Convergence is non-deterministic (semantic matching) and is the sole mechanism for non-ADW repos; the post-write self-check flags are the only safety net there, which is why the regrowth guard is in scope.
- `/document` becomes heavier per run (semantic match + current-source read + rewrite); this moves cost from many planning-reads to one document-write per feature — an amortized win.

# Patch: Integrate branch onto current origin/dev and absorb #611's post-write-guards module into the seed taxonomy

## Metadata
adwId: `9gjajh-app-docs-living-docs`
reviewChangeRequest: `Issue #1: Stale base — the branch is not integrated with #611, which merged into origin/dev after this branch was cut. Merge-base is 6d5ec54 (the #610/#634 merge); origin/dev is now 6c42a32 (#635 = #611 post-write-guards). origin/dev is NOT an ancestor of HEAD. Because #611 added adws/core/docsGuards.ts, adws/core/__tests__/docsGuards.test.ts, adws/phases/docsSelfCheck.ts, +24 lines wiring in adws/core/index.ts and adws/phases/documentPhase.ts, a 13-line index entry in .adw/conditional_docs.md, and app_docs/feature-ih6ju7-app-docs-living-docs-post-write-guards.md — and #612 touched none of those — git diff origin/dev (the spec's own validation/HITL review artifact) shows the entire #611 guards module as DELETED and index.ts/documentPhase.ts as reverted. git merge-tree confirms real conflict markers in .adw/conditional_docs.md. The migrated index has 0 references to feature-ih6ju7, so after merge that doc is an orphan, violating the doc-to-entry bijection / no-orphans acceptance criterion that checkLivingDocsIndex.ts enforces; the gate's PASS holds only against the pre-#611 corpus. The implementation is otherwise correct: 45 docs/45 entries, all six gate checks pass, tsc + lint clean. Resolution: Rebase or merge this branch onto current origin/dev. Re-run the migration clustering so #611's app_docs/feature-ih6ju7-...post-write-guards.md and its conditional_docs entry are absorbed into the seed taxonomy as one disjoint module (or folded into a guards/self-check module), resolving the .adw/conditional_docs.md conflict by re-serializing through the registry. Then re-run bunx tsx adws/checkLivingDocsIndex.ts to re-prove round-trip/bijection/overlap/count against the integrated corpus, and confirm git diff origin/dev no longer shows the phantom guards-module deletion and that validation command 1 (document.md/adw_init.md vs origin/dev) still prints nothing.`

## Issue Summary
**Original Spec:** `specs/issue-612-adw-9gjajh-app-docs-living-docs-sdlc_planner-migrate-app-docs-to-module-docs.md`

**Issue:** The branch was cut from `6d5ec54` (#610/#634 merge) and is now stale: `origin/dev` advanced to `6c42a32` when #611 (post-write self-check guards) merged, and `origin/dev` is **not** an ancestor of `HEAD`. The #612 migration was authored against the pre-#611 corpus, so it has no knowledge of #611's artifacts. Consequently:
- `git diff origin/dev` — which the spec uses as its own validation/HITL review artifact — shows the **entire #611 guards module as deleted** (`adws/core/docsGuards.ts`, `adws/core/__tests__/docsGuards.test.ts`, `adws/phases/docsSelfCheck.ts`) and `adws/core/index.ts` / `adws/phases/documentPhase.ts` as reverted. This is a *phantom* deletion (those files simply never existed on this branch), but it reads as #612 destroying #611.
- `.adw/conditional_docs.md` is a **real merge conflict** (both #611 and #612 rewrote it). `git merge-tree` confirms one `changed in both` block with conflict markers, all inside that file.
- After any merge, `app_docs/feature-ih6ju7-app-docs-living-docs-post-write-guards.md` lands on disk with **zero references** in the migrated index → an **orphan doc**, violating the doc↔entry bijection / no-orphans criterion that `adws/checkLivingDocsIndex.ts` enforces. The current PASS only holds against the pre-#611 corpus.

The migration itself is correct (45 docs / 45 entries; all gate checks, `tsc`, and `lint` clean). This patch only re-bases it onto the integrated corpus.

**Solution:** Integrate `origin/dev` into the branch (merge), then absorb #611's already-conformant module doc + index entry **verbatim** as one disjoint seed-taxonomy module — exactly the way the spec already preserves `feature-o4qdu5` as a fixed pre-conformant cluster seed. The only true conflict (`.adw/conditional_docs.md`) is resolved **not by hand-editing markers but by re-serializing through the registry module** (`parseConditionalDocs` our side → `upsertEntry` the #611 entry → `serializeConditionalDocs`). The doc is already in current-state format (Overview / Responsibilities / Contracts & Invariants / Configuration / Gotchas), and its three owned globs are explicit file paths claimed by no other entry — so disjointness holds by construction (the taxonomy has **no** `adws/core/**` or `adws/phases/**` wildcard that could collide). Then re-prove the gate against the integrated corpus and confirm the phantom deletion is gone.

## Files to Modify
Use these files to implement the patch:

- `.adw/conditional_docs.md` — resolve the merge conflict by **regenerating through the registry** with the `feature-ih6ju7` entry upserted (45 → 46 entries). Do **not** hand-merge the conflict markers.

Accepted as-is from `origin/dev` via the merge (no manual authoring — these are #611's work and must not be altered by #612):
- `app_docs/feature-ih6ju7-app-docs-living-docs-post-write-guards.md` — #611's module doc; already in current-state format. Preserved verbatim, treated like `feature-o4qdu5`.
- `adws/core/docsGuards.ts`, `adws/core/__tests__/docsGuards.test.ts`, `adws/phases/docsSelfCheck.ts` — #611's new files (non-conflicting additions).
- `adws/core/index.ts`, `adws/phases/documentPhase.ts` — #611's wiring (non-conflicting modifications; #612 never touched them).
- `specs/issue-611-adw-ih6ju7-...post-write-guards.md`, `specs/patch/patch-adw-ih6ju7-...restore-609-convergence-prompts.md` — #611's spec files (come back via merge; auto-owned by the `specs/**` glob, so no new orphan).

Do **not** modify (per spec — restore-to-HEAD discipline already satisfied): `.claude/commands/document.md`, `.claude/commands/adw_init.md`, `adws/core/conditionalDocsRegistry.ts`, `README.md`.

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Integrate `origin/dev` (resolve the divergent base)
- `git fetch origin` to confirm `origin/dev` is at `6c42a32` (#635 / #611).
- `git merge origin/dev` (preferred — preserves the migration commit and matches ADW's `/resolve_conflict` mechanism; a rebase onto `origin/dev` is an acceptable alternative but merge is recommended for this destructive-docs commit).
- Expect **exactly one** conflict: `.adw/conditional_docs.md`. All other #611 artifacts merge cleanly and must be **accepted as-is** — they are #611's work, not #612's to change: `adws/core/docsGuards.ts`, `adws/core/__tests__/docsGuards.test.ts`, `adws/phases/docsSelfCheck.ts`, the wiring in `adws/core/index.ts` and `adws/phases/documentPhase.ts`, `app_docs/feature-ih6ju7-...post-write-guards.md`, and the two `specs/` files.
- Do **not** hand-resolve the `.adw/conditional_docs.md` markers — Step 2 regenerates the file canonically.

### Step 2: Absorb #611's entry into the seed taxonomy via the registry (resolve the conflict canonically)
- Treat `app_docs/feature-ih6ju7-...post-write-guards.md` exactly like `feature-o4qdu5`: a pre-conformant module doc **preserved verbatim** as a fixed cluster seed. Do not re-author, rename, or re-cluster it; it is already current-state format.
- Run a throwaway `bunx tsx` snippet (the migration is a throwaway agent pass — no permanent generator code) that resolves the conflict by re-serializing through the registry module:
  ```ts
  import { execSync } from 'child_process';
  import { writeFileSync } from 'fs';
  import {
    parseConditionalDocs,
    serializeConditionalDocs,
    upsertEntry,
  } from './adws/core/conditionalDocsRegistry';

  // "ours" = the clean 45-entry migrated index (HEAD side of the conflict)
  const ours = parseConditionalDocs(
    execSync('git show HEAD:.adw/conditional_docs.md').toString(),
  );
  // "theirs" = origin/dev; lift #611's entry verbatim (guarantees identical Owns/Conditions)
  const theirs = parseConditionalDocs(
    execSync('git show origin/dev:.adw/conditional_docs.md').toString(),
  );
  const guards = theirs.entries.find((e) => e.docPath.includes('feature-ih6ju7'));
  if (!guards) throw new Error('ih6ju7 entry not found in origin/dev index');

  const merged = upsertEntry(ours, guards); // 45 → 46 entries
  writeFileSync('.adw/conditional_docs.md', serializeConditionalDocs(merged));
  ```
- The absorbed entry owns exactly `adws/core/docsGuards.ts`, `adws/core/__tests__/docsGuards.test.ts`, `adws/phases/docsSelfCheck.ts` — explicit file paths owned by no other entry. Disjointness is guaranteed by construction: the taxonomy contains **no** `adws/core/**` or `adws/phases/**` wildcard (those subtrees are owned via explicit file lists), so nothing else can claim these three files. The wiring files `adws/core/index.ts` (owned by `feature-9gjajh-state-and-config`) and `adws/phases/documentPhase.ts` (owned by `feature-9gjajh-document-phase`) keep their existing owners — #611's entry does not claim them.
- `git add .adw/conditional_docs.md` to mark the conflict resolved, then complete the merge commit.

### Step 3: Re-prove the gate against the integrated corpus
- Run `bunx tsx adws/checkLivingDocsIndex.ts`. All checks must pass against the merged corpus:
  - **round-trip:** index is canonical (re-serialized through the registry in Step 2);
  - **bijection:** 46 docs / 46 entries — `feature-ih6ju7` is now referenced (no longer orphan), no dangling `docPath`s;
  - **overlap:** `docsGuards.ts` / `docsGuards.test.ts` / `docsSelfCheck.ts` each have exactly one owner;
  - **count sanity:** 46 ≤ 60.
- If the script reports a residual overlap or orphan, fix the taxonomy through the registry (re-run the Step 2 snippet) and re-run — never hand-edit the index.

### Step 4: Confirm the phantom deletion is gone, then run the full validation suite
- Verify `git diff origin/dev` no longer shows #611's module as deleted/reverted (Validation commands below), then run every command in **Validation** with zero regressions. The unit suite now includes #611's `adws/core/__tests__/docsGuards.test.ts` (present via the merge) and must stay green.

## Validation
Execute every command to validate the patch is complete with zero regressions.

- `git merge-base --is-ancestor origin/dev HEAD && echo "INTEGRATED"` — must print `INTEGRATED` (the stale-base condition is resolved; `origin/dev` is now an ancestor of `HEAD`).
- `git diff --name-only origin/dev -- .claude/commands/document.md .claude/commands/adw_init.md` — **must print nothing** (the #609/#610 reversion stays discarded; #611 did not touch these prompts, so the merge does not disturb them). *(Spec Validation Command 1.)*
- `git diff --name-status origin/dev -- adws/core/docsGuards.ts adws/core/__tests__/docsGuards.test.ts adws/phases/docsSelfCheck.ts adws/core/index.ts adws/phases/documentPhase.ts app_docs/feature-ih6ju7-app-docs-living-docs-post-write-guards.md` — **must print nothing** (the phantom guards-module deletion / index.ts / documentPhase.ts reversion is gone; #611 is fully integrated).
- `bunx tsx adws/checkLivingDocsIndex.ts` — the migration gate: round-trip, doc↔entry bijection (now 46/46, `feature-ih6ju7` not orphan), no overlapping ownership, count sanity. Must exit 0.
- `bun run lint` — zero errors.
- `bunx tsc --noEmit` — root type-check passes.
- `bunx tsc --noEmit -p adws/tsconfig.json` — `adws/` type-check passes.
- `bun run test:unit` — Vitest suite passes, including `adws/core/__tests__/conditionalDocsRegistry.test.ts` **and** the merged-in `adws/core/__tests__/docsGuards.test.ts`.
- `bun run build` — build succeeds with no errors.

## Patch Scope
**Lines of code to change:** ~13 (the single `feature-ih6ju7` entry, +1 doc reference), all **mechanically generated** by `serializeConditionalDocs` in the Step 2 snippet — no hand-edited markdown. The merge brings in #611's files but the patch authors none of them.
**Risk level:** medium (a merge of a divergent base plus a destructive whole-`app_docs/` rewrite; HITL-gated by design, so a human reviews the integrated diff before merge).
**Testing required:** the one-off gate `bunx tsx adws/checkLivingDocsIndex.ts` re-proven against the integrated corpus, plus the full validation suite (lint, root + `adws/` type-check, unit tests including #611's `docsGuards.test.ts`, build), and the two `git diff origin/dev` checks confirming the phantom deletion is gone and the convergence prompts are untouched.

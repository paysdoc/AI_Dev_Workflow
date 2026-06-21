# Patch: Restore four command/skill files reverted by the #640 plan commit

## Metadata
adwId: `rk9n3v-feat-tell-resumed-bu`
reviewChangeRequest: `Issue #1: The plan commit c2a95c4 reverts already-merged work in four files unrelated to #640. The branch is 0 commits behind origin/dev (merge-base == dev tip f28ef7b), so these are confirmed reverts of merged content, not rebase staleness: (1) .claude/commands/document.md — reverts the convergent current-state module-doc format (semantic-first routing, sibling collapse, rewrite-in-place, Owns: globs) back to the old append-only changelog format; (2) .claude/commands/adw_init.md — removes the /document Owns:-glob convergent-routing instructions and drops document.md from hashInputs; (3) .claude/commands/extract_dependencies.md — removes the /extract_touched_paths companion-command doc; (4) .claude/skills/prd-to-issues/SKILL.md — removes the 'Order region-colliding slices' rule and the ## Touched Files template (region-overlap serialization, merged #649). This silently regresses the convergent-documentation system and the region-overlap serialization feature. README.md (+6 lines) is benign-additive (it documents test/source files that exist) and may be left as-is. The in-scope #640 implementation (adws/phases/*) is correct. Resolution: Restore the four reverted files to origin/dev state, staging ONLY those files (do not use git add -A): run git checkout origin/dev -- .claude/commands/document.md .claude/commands/adw_init.md .claude/commands/extract_dependencies.md .claude/skills/prd-to-issues/SKILL.md. The revert lives in the plan commit (HEAD~2), which cannot be amended, so commit the restoration on top. Leave README.md, the adws/phases/* implementation, and the feature-640 scenario/spec files untouched.`

## Issue Summary
**Original Spec:** `specs/issue-640-adw-rk9n3v-feat-tell-resumed-bu-sdlc_planner-resume-build-continue-not-restart.md`

**Issue:** The plan commit `c2a95c4` (the branch's HEAD~2) silently reverted already-merged, out-of-scope work in four `.claude/` files. The branch's merge-base equals the `origin/dev` tip (`f28ef7b`), i.e. the branch is **0 commits behind dev**, so these are confirmed content reverts of merged work — not rebase staleness. `git log origin/dev..HEAD -- <the four files>` confirms `c2a95c4` is the **sole** commit that touched them. The reverts regress two shipped systems:
- **Convergent-documentation system** — `document.md` reverts the current-state module-doc format (semantic-first routing, sibling collapse, rewrite-in-place, `Owns:` globs) back to the old append-only changelog format; `adw_init.md` removes the `/document` `Owns:`-glob convergent-routing instructions and drops `document.md` from `hashInputs`; `extract_dependencies.md` removes the `/extract_touched_paths` companion-command doc.
- **Region-overlap serialization (merged #649)** — `prd-to-issues/SKILL.md` removes the "Order region-colliding slices" rule and the `## Touched Files` template.

This is the recurring "worktree born with dependency reversion" class (≥9th occurrence; here the revert is committed inside the plan commit rather than only in the working tree).

**Solution:** Restore the four files to their `origin/dev` content verbatim via `git checkout origin/dev -- <paths>` (which stages only those four paths — no `git add -A`). Because the revert is baked into the plan commit at HEAD~2, which cannot be amended, commit the restoration as a new commit on top. `README.md` (+6/−0, additive and benign), the in-scope `adws/phases/*` implementation, and the feature-640 scenario/spec files are left untouched.

## Files to Modify
Restore these four files to `origin/dev` state (verbatim — no hand-editing):

- `.claude/commands/document.md` — restore convergent current-state module-doc format (vs origin/dev: 57+/63−).
- `.claude/commands/adw_init.md` — restore `/document` `Owns:`-glob convergent-routing instructions + `document.md` in `hashInputs` (vs origin/dev: 0+/11−).
- `.claude/commands/extract_dependencies.md` — restore `/extract_touched_paths` companion-command doc (vs origin/dev: 0+/7−).
- `.claude/skills/prd-to-issues/SKILL.md` — restore "Order region-colliding slices" rule + `## Touched Files` template (region-overlap serialization, #649) (vs origin/dev: 1+/11−).

**Explicitly NOT modified:** `README.md` (benign-additive, leave as-is), `adws/phases/**` (correct in-scope #640 implementation), `features/per-issue/feature-640.feature`, `features/per-issue/step_definitions/feature-640.steps.ts`, and the `specs/issue-640-...` spec file.

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Restore the four reverted files from origin/dev
- Confirm `git fetch` is current enough that `origin/dev` resolves to `f28ef7b` (the merge-base); if unsure, run `git fetch origin dev` first.
- Run exactly (stages ONLY these four paths — `git checkout <tree> -- <paths>` writes to both working tree and index):
  ```sh
  git checkout origin/dev -- .claude/commands/document.md .claude/commands/adw_init.md .claude/commands/extract_dependencies.md .claude/skills/prd-to-issues/SKILL.md
  ```
- Do **NOT** run `git add -A` or `git add .` — that would risk sweeping in unrelated working-tree changes. The `git checkout` above already stages precisely the four files.

### Step 2: Verify the restore is exact and scope-limited (before committing)
- `git diff origin/dev -- .claude/commands/document.md .claude/commands/adw_init.md .claude/commands/extract_dependencies.md .claude/skills/prd-to-issues/SKILL.md` → must print **nothing** (the four files now match dev byte-for-byte).
- `git status --short` → must show only the four files staged (`M  .claude/...`), nothing unstaged, no `README.md`, no `adws/phases/*`.
- If anything other than the four files appears staged, unstage it (`git restore --staged <file>`) before continuing.

### Step 3: Commit the restoration on top of HEAD
- The revert lives in the plan commit `c2a95c4` at HEAD~2, which cannot be amended (two clean commits sit above it), so commit the restoration as a new commit on top:
  ```sh
  git commit -m "patch: restore command/skill files reverted by #640 plan commit"
  ```
- Keep the commit to only the four staged files. Do not touch `README.md` or any `adws/phases/*` file.

## Validation
Execute every command; the patch is complete only when all pass with zero regressions.

- `git diff origin/dev -- .claude/commands/document.md .claude/commands/adw_init.md .claude/commands/extract_dependencies.md .claude/skills/prd-to-issues/SKILL.md` — must be **empty** (four files restored exactly to dev).
- `git diff --stat origin/dev` — remaining differences must be **only** in-scope files: `README.md` (+6), `adws/phases/__tests__/planPhase.test.ts`, `adws/phases/buildPhase.ts`, `adws/phases/index.ts`, `adws/phases/planPhase.ts`, `adws/workflowPhases.ts`, `features/per-issue/feature-640.feature`, `features/per-issue/step_definitions/feature-640.steps.ts`, and the `specs/issue-640-...` spec (plus this patch file). No `.claude/commands/*` or `.claude/skills/*` entries.
- `bun run lint` — Lint passes (no regression).
- `bunx tsc --noEmit` — Repo type-check passes.
- `bunx tsc --noEmit -p adws/tsconfig.json` — ADW type-check passes.
- `bun run test:unit` — Full unit suite green (the in-scope #640 `planPhase.test.ts` coverage and all existing tests; the markdown restore touches no code under test).
- `bun run build` — Build succeeds.

## Patch Scope
**Lines of code to change:** ≈92 lines restored across 4 markdown command/skill files via a single verbatim `git checkout` (no hand-editing of content).
**Risk level:** low — restoration is a byte-for-byte `git checkout` from `origin/dev`, touches only `.claude/` command/skill markdown (no TypeScript/code under test), and exactness is provable via an empty `git diff origin/dev`.
**Testing required:** Confirm the four-file `git diff origin/dev` is empty and `git diff --stat origin/dev` shows only in-scope files; then run the spec's validation suite (lint, both type checks, unit tests, build) to confirm zero regression to the #640 implementation.

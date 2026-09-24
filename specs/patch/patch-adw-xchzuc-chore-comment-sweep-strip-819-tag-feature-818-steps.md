# Patch: Strip the `(#819)` issue tag from the feature-818 step-file comment

## Metadata
adwId: `xchzuc-chore-comment-sweep`
reviewChangeRequest: ``Issue #1: Coding-guideline check (Comments rule: never cite issue numbers) over the branch's changed files found one violation, which is also a failed acceptance criterion ('no issue-number tags remain in the listed files'): features/per-issue/step_definitions/feature-818.steps.ts:79 still reads '// The GitHub port factories now take the caller's GitContext (#819); forgeProviders'' — the plan's step 4 explicitly said to strip `(#819)` there and keep the rest of the sentence, which carries rationale. The grep audits for banners and tags are otherwise clean across the 13 files, no eslint-disable or shebang lines changed, and the guard passes. This is routed to patch rather than refactor deliberately: a whole-file /refactor pass would apply the nesting/extraction guidelines to this 611-line step file and change code, which would fail the comment-only guard and the @adw-872 scenario that are this chore's acceptance criteria. Resolution: Patch: delete the ` (#819)` tag from the comment at features/per-issue/step_definitions/feature-818.steps.ts:79, leaving every other character of the file untouched, then re-run `bun run lint:comment-only` on the 13 listed files and `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-872"` to confirm both still pass.``

## Issue Summary
**Original Spec:** `specs/issue-872-adw-xchzuc-chore-comment-sweep-sdlc_planner-comment-sweep-per-issue-batch-1.md`

**Issue:** The batch-4 comment sweep left one issue-number tag behind. `features/per-issue/step_definitions/feature-818.steps.ts:79` still reads `// The GitHub port factories now take the caller's GitContext (#819); forgeProviders'`. That violates the **Comments** rule in `.adw/coding_guidelines.md` ("never cite issue numbers") and fails the acceptance criterion "no issue-number tags remain in the listed files". The spec's step 4 called for exactly this tag to be stripped (it was at ~91 before the header JSDoc was trimmed; it now sits at line 79). Every other audit on the branch is clean: banners, `eslint-disable`/shebang lines, and the comment-only guard all pass. A re-grep of all ten swept TS files for `(#NNN)` / `issue #NNN` / `#NNN` inside `//`, `/*`, and `*` lines confirms line 79 is the only remaining hit.

**Solution:** Delete the seven characters ` (#819)` from that one comment line and change nothing else. The rest of the sentence stays verbatim: it explains why an unused `tokenProvider` and `GitContext` are built on the GitLab wiring path (the `forgeProviders` signature carries them even though the GitLab branch reads credentials from `deps.gitlab`), which is the reason for a non-obvious choice and therefore a keeper under the Comments rule. The PRD's *Out of Scope* forbids rewording kept prose, so the word "now" and the rest of the block are left as they are. This is deliberately a patch, not a `/refactor` pass: any code change to this file would fail the comment-only guard and the `@adw-872` scenario that are the chore's acceptance criteria.

## Files to Modify
Use these files to implement the patch:

- `features/per-issue/step_definitions/feature-818.steps.ts` — line 79 only. Remove ` (#819)` from the comment. No other line changes.

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Confirm the target line is the only remaining tag
- Run `sed -n '79p' features/per-issue/step_definitions/feature-818.steps.ts` and confirm it reads exactly:
  `    // The GitHub port factories now take the caller's GitContext (#819); forgeProviders'`
- Run the comment-line tag grep over the ten swept TS files and confirm line 79 is the sole hit:
  `grep -nE '^\s*(//|/\*|\*).*(\(#[0-9]+\)|issue #[0-9]+|#[0-9]{3,})' features/per-issue/step_definitions/feature-533-given.steps.ts features/per-issue/step_definitions/feature-797.steps.ts features/per-issue/step_definitions/feature-810.steps.ts features/per-issue/step_definitions/feature-817.steps.ts features/per-issue/step_definitions/feature-818.steps.ts features/per-issue/step_definitions/feature-823-probes.steps.ts features/per-issue/step_definitions/feature-823.steps.ts features/per-issue/step_definitions/feature-846.steps.ts features/per-issue/step_definitions/takeover-probe-ctx.ts features/per-issue/support/feature-846-ensure-driver.ts`
- If the line has moved, locate it by content, not by number. Do not proceed if more than one hit appears; report it instead, because that would mean the review's "otherwise clean" finding no longer holds.

### Step 2: Delete the tag with a single exact-string edit
- Use the Edit tool (not `sed`, not a regex) on `features/per-issue/step_definitions/feature-818.steps.ts` with this exact, unique replacement:
  - old_string: `// The GitHub port factories now take the caller's GitContext (#819); forgeProviders'`
  - new_string: `// The GitHub port factories now take the caller's GitContext; forgeProviders'`
- Leave the two continuation lines below it (80–81) and the four-space indentation untouched. Do not reword "now", do not re-flow the sentence, and do not touch any other comment or any code in the file.
- Do not run `/refactor` or apply any other coding guideline to this file. The only permitted diff for this chore is comment text and the blank lines comment removal leaves behind.

### Step 3: Prove the diff is exactly one comment line
- `git diff --numstat -- features/` must print exactly one row: `1	1	features/per-issue/step_definitions/feature-818.steps.ts`.
- `git diff -U0 -- features/per-issue/step_definitions/feature-818.steps.ts` must show one removed line and one added line that differ only by ` (#819)`.
- If anything else shows up, revert it with `git checkout -- <file>` and redo Step 2.

### Step 4: Run the validation commands
- Run every command under `Validation` below and confirm each exits 0 (the tag grep is the exception: it must find nothing and therefore exit 1).
- The guard resolves its base ref itself by fetching `origin/<default branch>` through the code host. Do not pass `--base` and do not hardcode a branch name.

## Validation
Execute every command to validate the patch is complete with zero regressions.

- `grep -nE '\(#[0-9]+\)|issue #[0-9]+' features/per-issue/step_definitions/feature-818.steps.ts` — must print nothing (grep exits 1). No issue-number tag remains in the file.
- `bun run lint:comment-only features/per-issue/feature-816.feature features/per-issue/feature-819.feature features/per-issue/feature-823.feature features/per-issue/step_definitions/feature-533-given.steps.ts features/per-issue/step_definitions/feature-797.steps.ts features/per-issue/step_definitions/feature-810.steps.ts features/per-issue/step_definitions/feature-817.steps.ts features/per-issue/step_definitions/feature-818.steps.ts features/per-issue/step_definitions/feature-823-probes.steps.ts features/per-issue/step_definitions/feature-823.steps.ts features/per-issue/step_definitions/feature-846.steps.ts features/per-issue/step_definitions/takeover-probe-ctx.ts features/per-issue/support/feature-846-ensure-driver.ts` — must print `✔ PASS` against `origin/dev` and exit 0.
- `bun run test` — typecheck (`bunx tsc --noEmit`) passes.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-872"` — must report `1 scenario (1 passed)`, `3 steps (3 passed)`.
- `git diff --numstat -- features/` (run before committing) — exactly one row, `1	1	features/per-issue/step_definitions/feature-818.steps.ts`, proving the patch touched nothing else.

## Patch Scope
**Lines of code to change:** 1 line (7 characters removed from a `//` comment; zero code tokens change)
**Risk level:** low
**Testing required:** Comment-only guard over the 13 swept files, TypeScript typecheck, and the `@adw-872` per-issue scenario. No unit tests or regression scenarios exercise comment text, so the guard plus the scenario are the proof.

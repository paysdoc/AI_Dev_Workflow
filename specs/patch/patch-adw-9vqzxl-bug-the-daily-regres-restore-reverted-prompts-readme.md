# Patch: Restore the eleven prompt files the plan commit reverted, and drop its three README lines

## Metadata
adwId: `9vqzxl-bug-the-daily-regres`
reviewChangeRequest:
```text
Issue #1: Plan commit 8bd53809 rewrote 11 framework prompt files back to older content, none of which the spec touches: `.claude/commands/{adw_init,clean_local_repo,document,feature,generate_step_definitions,resolve_conflict,resolve_failed_test,review,scenario_writer}.md` and `.claude/skills/{depaudit-triage,implement-tdd}/SKILL.md`. dev has not changed these files since the merge-base, so the merge would roll them back on dev without a conflict. (1) `bun run lint:branch-names`, which CI runs in `.github/workflows/git-cli-guard.yml`, fails with 8 hardcoded `main`/`develop` references in clean_local_repo.md, document.md, resolve_conflict.md, resolve_failed_test.md and review.md. It passes at the merge-base. (2) With the committed files, 5 unit tests fail. Both tests in `adws/__tests__/adwInitPrompt.test.ts` fail because the `.github/adw.yml` heredoc and the Comments entry are gone. Three in `adws/__tests__/depauditTriageSkill.test.ts` fail because the issue body carries `/adw_sdlc` again and `--label adw:bug` is gone. Local test:unit passes only because the working tree holds uncommitted restorations of those two files: adw_init.md is staged and the depaudit-triage SKILL.md is unstaged. (3) Behaviour regresses. feature.md and implement-tdd go back to gating unit tests on a `## Unit Tests` section of `.adw/project.md`, which adw_init no longer writes, so plans would leave out unit tests. review.md loses its step-definition independence check. clean_local_repo.md would delete every local branch except `main` and `develop`, and that includes `dev`. scenario_writer.md would install Cucumber in target repos again. document.md drops `Decisions:` handling and diffs against `origin/main`. The same commit also added three README lines about planCommitGuard.ts and selfHostLaunch.ts. They are accurate but out of scope.
Resolution: Restore the 11 files to dev's content and commit: `git checkout origin/dev -- .claude/commands/adw_init.md .claude/commands/clean_local_repo.md .claude/commands/document.md .claude/commands/feature.md .claude/commands/generate_step_definitions.md .claude/commands/resolve_conflict.md .claude/commands/resolve_failed_test.md .claude/commands/review.md .claude/commands/scenario_writer.md .claude/skills/depaudit-triage/SKILL.md .claude/skills/implement-tdd/SKILL.md`. Then check that `git diff origin/dev...HEAD -- .claude/` is empty, `bun run lint:branch-names` exits 0, and `bun run test:unit` passes on a clean tree. Optionally remove the three unrelated README lines as well.
```

## Issue Summary
**Original Spec:** `specs/issue-962-adw-9vqzxl-bug-the-daily-regres-sdlc_planner-fix-regression-host-fail-docker-readonly.md`

**Issue:** The plan commit `8bd53809` carries 11 prompt files that the #962 fix never touches. Each is byte-identical to the ADW runner's checkout. That checkout is on `main` at `3d43b81a`, which lacks dev's newer prompt commits, such as `39b78f00` (review Step 4) and `66e18a66` (the `unitTests` switch). It is the only commit on the branch that touches `.claude/`. Dev has not changed any file under `.claude/` since the merge base `ddaf010a`, so a merge would take the branch's copies without a conflict. Planning confirmed each effect the review lists:
- `bun run lint:branch-names` exits 1 with 8 violations: `clean_local_repo.md:12`, `document.md:6`, `:17`, `:18` and `:19`, `resolve_conflict.md:12`, `resolve_failed_test.md:16` and `review.md:17`. The `branch-names` job of `.github/workflows/git-cli-guard.yml` runs it on every pull request.
- On the committed files, 5 unit tests fail:
  - Both tests in `adws/__tests__/adwInitPrompt.test.ts`: the `.github/adw.yml` heredoc and the `- **Comments** —` entry are gone.
  - Three tests in `adws/__tests__/depauditTriageSkill.test.ts`: the issue body carries `/adw_sdlc`, and the `--label adw:bug` and `gh label create 'adw:bug'` lines are gone.
  - Local `test:unit` passes only because of the two uncommitted restorations: `adw_init.md` is staged and `depaudit-triage/SKILL.md` is unstaged. Both already hold dev's content.
- Behaviour regresses:
  - `feature.md` and `implement-tdd` gate unit tests on a `## Unit Tests` section of `.adw/project.md` again, instead of on `unitTests` in `.github/adw.yml`.
  - `review.md` loses Step 4, the step-definition independence check.
  - `clean_local_repo.md` deletes every local branch except `main` and `develop`, which includes `dev`.
  - `scenario_writer.md` bootstraps Cucumber in target repos again.
  - `document.md` drops its `Decisions:` handling and diffs against `origin/main`.
- The same commit adds three README lines that #962 does not need:
  - the "Planner off-limits guard" feature bullet;
  - the `selfHostLaunch.ts` tree line;
  - the `planCommitGuard.ts` tree line.

  Both files exist on dev, but dev's README does not list them.

**Solution:** Undo the plan commit's edits to these 12 paths and nothing else, in one commit on top of `HEAD`. No history rewrite is needed.
- **Prompts.** Restore the 11 files with one `git checkout` from the merge base `ddaf010a`. At planning time `origin/dev` (`f35d68d4`) and the merge base hold identical content for all of `.claude/`, so this gives exactly the review's resolution. Using the merge base keeps the restore exact even if dev moves before the build runs.
- **README.** Reverse only the plan commit's three README hunks with `git show 8bd53809 -- README.md | git apply -R`. A `--check` dry run applies cleanly. Afterwards, README's branch diff is exactly the build commit's "Docker (optional)" change (12 insertions, 4 deletions).

Planning applied this patch to a scratch copy of `HEAD` and checked the result:
- `.claude/` matches the merge base byte for byte.
- `bunx tsx adws/checkBranchNames.ts <copy>` prints `✔ PASS  No file names a branch to act on.`
- `adwInitPrompt.test.ts`, `depauditTriageSkill.test.ts` and `regressionWorkflow.test.ts` pass all 19 tests. The first two fail 5 tests on `HEAD` as committed.

Rejected alternatives:
- `git checkout origin/dev -- README.md` also drops the build commit's "Docker (optional)" changes.
- `git revert 8bd53809` also deletes the spec and `features/per-issue/feature-962.feature`.
- A rebase that edits `8bd53809` gives the same tree but needs a force-push.

## Files to Modify
Use these files to implement the patch:

`git checkout` restores the 11 prompt files to the merge base's content. Do not edit them by hand.
- `.claude/commands/adw_init.md`
- `.claude/commands/clean_local_repo.md`
- `.claude/commands/document.md`
- `.claude/commands/feature.md`
- `.claude/commands/generate_step_definitions.md`
- `.claude/commands/resolve_conflict.md`
- `.claude/commands/resolve_failed_test.md`
- `.claude/commands/review.md`
- `.claude/commands/scenario_writer.md`
- `.claude/skills/depaudit-triage/SKILL.md`
- `.claude/skills/implement-tdd/SKILL.md`

`git apply -R` removes three lines from one file:
- `README.md`: lines 40, 661 and 794 go. The build commit's "Docker (optional)" changes stay.

Nothing else changes. Leave the #962 fix exactly as committed: `.github/workflows/regression.yml`, `test/Dockerfile`, `test/docker-run.sh`, `adws/__tests__/regressionWorkflow.test.ts`, `features/`, `app_docs/`, `specs/adr/` and the spec. Do not touch `.adw-version`, and do not merge dev into the branch.

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

Run every command from the worktree root, and write every path out in full as below. In zsh, an unquoted `$VAR` that holds several paths reaches git as a single argument. `features/per-issue/feature-962.feature` puts the build agent in TDD mode, but this patch changes no behaviour, so it has no RED step. Do not add or change tests, step definitions or `.feature` files.

### Step 1: Confirm the starting state
- Check the commits:
  - `git rev-parse HEAD` prints `6d0103fce5c2faf4d9979b8bbb626340046575c1`.
  - `git merge-base HEAD origin/dev` prints `ddaf010ada3f73b83a4b8b42a5e93b791f841d33`.
  - If either differs, for example because dev was merged into the branch, stop and report.
- `git log --format='%h %s' ddaf010a..HEAD -- .claude/` lists only `8bd53809 plan-orchestrator: fix: add plan for regression host/docker jobs`.
- `git status --porcelain -- .claude/ README.md` prints exactly these two lines:
  ```text
  M  .claude/commands/adw_init.md
   M .claude/skills/depaudit-triage/SKILL.md
  ```
  Leave uncommitted changes to other paths alone, such as this untracked plan file. The commit in Step 4 names its paths, so it excludes them.
- `git show 8bd53809 -- README.md | git apply -R --check` exits 0. If it fails, stop and report. Do not fall back to hand edits.

### Step 2: Restore the 11 prompt files from the merge base
- Run exactly:
  ```sh
  git checkout ddaf010ada3f73b83a4b8b42a5e93b791f841d33 -- .claude/commands/adw_init.md .claude/commands/clean_local_repo.md .claude/commands/document.md .claude/commands/feature.md .claude/commands/generate_step_definitions.md .claude/commands/resolve_conflict.md .claude/commands/resolve_failed_test.md .claude/commands/review.md .claude/commands/scenario_writer.md .claude/skills/depaudit-triage/SKILL.md .claude/skills/implement-tdd/SKILL.md
  ```
- This sets the index and the working tree of those 11 paths and touches nothing else. No fetch is needed.
- The two uncommitted restorations already hold this content, so the checkout only stages `depaudit-triage/SKILL.md`.
- `.claude/commands/adw_init.md` matches `.gitignore:41` but is tracked, so `git checkout` and the commit treat it like the others. No `-f` is needed.

### Step 3: Remove the plan commit's three README lines
- Run exactly:
  ```sh
  git show 8bd53809 -- README.md | git apply -R
  ```
- This removes three lines:
  - line 40, `- **Planner off-limits guard** — …`;
  - line 661, `│   ├── selfHostLaunch.ts  # …`;
  - line 794, `│   ├── planCommitGuard.ts  # …`.
- Git reports hunks 2 and 3 at an offset, because the build commit added lines above them.
- This changes only the working tree.

### Step 4: Commit only the 12 paths
- Run:
  ```sh
  git commit \
    -m "patchAgent: fix: restore prompts reverted by plan commit" \
    -m "Creating the worktree copied the ADW runner's older .claude/ prompts over the tracked copies, and the plan commit picked them up together with three README lines outside this fix. Restore the prompts to the branch point and drop those lines, so the branch-name guard and the prompt unit tests pass and merging keeps dev's prompts." \
    -- README.md .claude/commands/adw_init.md .claude/commands/clean_local_repo.md .claude/commands/document.md .claude/commands/feature.md .claude/commands/generate_step_definitions.md .claude/commands/resolve_conflict.md .claude/commands/resolve_failed_test.md .claude/commands/review.md .claude/commands/scenario_writer.md .claude/skills/depaudit-triage/SKILL.md .claude/skills/implement-tdd/SKILL.md
  ```
- The pathspec commits these 12 paths and nothing else. Do not use `git add -A`, `git commit -a`, `--amend`, `git revert`, a rebase or a push.
- Leave this plan file untracked. After this build, the review-patch phase commits it (`runCommitAgent` → `/commit`, `adws/phases/reviewPhase.ts:260`) and pushes the branch (`:271`).

### Step 5: Run the validation
- Run every command under `## Validation`, in order.
- This patch changes only Markdown. If a gate fails for a reason outside these 12 paths, report it. Do not change any other file to fix it.

## Validation
Execute every command to validate the patch is complete with zero regressions.

Use `origin/dev` as it stands, without fetching. At planning time it was `f35d68d4`.

1. **The restore is one commit of exactly the 12 paths, and the branch no longer changes `.claude/`:**
   ```sh
   git show --format= --name-only HEAD                    # exactly the 12 paths of Files to Modify
   git show --format= --stat HEAD | tail -1               # 12 files changed, 182 insertions(+), 78 deletions(-)
   git diff --name-only origin/dev...HEAD -- .claude/     # prints nothing (the 11 paths before the patch)
   git status --porcelain -- .claude/ README.md           # prints nothing: no uncommitted restoration is left
   git diff --name-only origin/dev...HEAD | wc -l         # 31 (42 before the patch)
   ```
2. **README carries only #962's change:**
   ```sh
   grep -cE 'planCommitGuard\.ts|selfHostLaunch\.ts|Planner off-limits guard' README.md   # 0 (3 before the patch)
   diff <(git diff origin/dev...HEAD -- README.md | grep -E '^[+-]' | grep -vE '^(\+\+\+|---)') <(git show 6d0103fc -- README.md | grep -E '^[+-]' | grep -vE '^(\+\+\+|---)')   # prints nothing
   ```
3. **The branch-name guard passes:** `bun run lint:branch-names` exits 0 and prints `✔ PASS  No file names a branch to act on.` Before the patch it exits 1 with the 8 violations listed under Issue.
4. **The prompt tests pass on the committed files, and dev's prompt behaviour is back:**
   ```sh
   bunx vitest run adws/__tests__/adwInitPrompt.test.ts adws/__tests__/depauditTriageSkill.test.ts   # 6 passed (5 failed on HEAD as committed)
   grep -n '^## Step 4: Step Definition Independence Check' .claude/commands/review.md                # line 47 (absent before)
   grep -cF '`## Unit Tests` section' .claude/commands/feature.md .claude/skills/implement-tdd/SKILL.md   # 0 and 0 (3 and 1 before)
   grep -cF '`unitTests` to `false`' .claude/commands/feature.md .claude/skills/implement-tdd/SKILL.md     # 2 and 1 (0 and 0 before)
   grep -cF 'Install Cucumber dependencies' .claude/commands/scenario_writer.md                        # 0 (1 before)
   grep -cF '### 8. Check decisions' .claude/commands/document.md                                     # 1 (0 before)
   grep -cF 'origin/main' .claude/commands/document.md                                                # 0 (3 before)
   ```
5. **Zero regressions, using the spec's gates:**
   ```sh
   bun run lint
   bunx tsc --noEmit
   bunx tsc --noEmit -p adws/tsconfig.json
   bun run build
   rm -f tsconfig.tsbuildinfo        # the type-check and build write it, because the root tsconfig is incremental
   bun run test:unit                 # all pass, including regressionWorkflow.test.ts, with no uncommitted change under .claude/
   bun run lint:git-guard
   bun run lint:docs-index
   NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-962"   # 12 scenarios (12 passed), as before the patch
   NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-939"   # 4 scenarios (4 passed)
   ```

## Patch Scope
**Lines of code to change:** None by hand. One commit of 12 files (182 insertions, 78 deletions):
- `git checkout` restores 11 prompt files: 182 lines added, 75 removed.
- `git apply -R` removes 3 README lines.

**Risk level:** low
**Testing required:**
- Git-state checks show that the restore is one commit of exactly the 12 paths, and that the branch no longer changes `.claude/` (1–2).
- The branch-name guard passes (3).
- The two prompt unit tests pass on the committed files, and content checks show dev's prompt behaviour is back (4).
- The spec's lint, type, build and unit gates, plus the `@adw-962` and `@adw-939` scenarios, show nothing else changed (5).

## Notes
- **Framework hash.** `adw_init.md` and `document.md` are `hashInputs` of the framework hash (the frontmatter of `adw_init.md`), so the restore returns the branch's computed hash to dev's value. The branch does not change `.adw-version`; leave it alone.
- **Root cause (out of scope, still open).** This is the same cause as patches `axbb2a` (#937), `3lva71` (#939) and `0mdjtu` (#934):
  - The runner's checkout is on `main` at `3d43b81a`. Its `copyClaudeAssetsToWorktree` (`adws/phases/worktreeSetup.ts:212` at that commit) copies every file of its `.claude/commands/` and `.claude/skills/`, tracked or not, over a new worktree's copies.
  - The plan commit then picked them up.
  - Moving the runner's checkout to the current dev stops this recurring.
- **The three README lines.** They describe real files, but they belong in a separate docs chore, not in this fix.

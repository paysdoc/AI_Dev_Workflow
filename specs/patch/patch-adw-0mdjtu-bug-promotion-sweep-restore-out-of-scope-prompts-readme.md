# Patch: Reverse the plan commit's stale command prompts and README tree hunks

## Metadata
adwId: `0mdjtu-bug-promotion-sweep`
reviewChangeRequest:
```text
Issue #1: Planning commit 09fb8ca9 committed stale, out-of-scope copies of `.claude/commands/adw_init.md`, `bug.md`, `chore.md`, `document.md` and `feature.md`, plus unrelated README.md directory-tree hunks. `adw_init.md` and `document.md` are byte-identical to `origin/main`. The spec said to leave these pre-existing worktree edits alone. Relative to the merge base, they delete rules that exist on dev:
- In `bug.md`, `chore.md` and `feature.md`: the read-only research, write-only-the-plan and stop-once-written rules. These came from fix 2294d856, which stopped plan agents hitting the 30-minute watchdog.
- In `adw_init.md`: the rule to leave an existing non-empty `.adw/conditional_docs.md` unchanged.
- In `document.md`: the `Decisions:` / `## Decisions` ADR handling.
Simulating the merge into current origin/dev with `git merge-tree` drops the read-only rules from bug/chore/feature.md and the adw_init rule with no conflict at all, and conflicts in `document.md` and `README.md`.
Resolution: Reverse only the planning commit's edits to those files: `git show 09fb8ca9 -- README.md .claude/commands/ | git apply -R`. A `--check` dry run applies cleanly and keeps the build agent's README edits: the Scenario promotion sweep bullet, the Scenario Promotion paragraph and the two promotionSweep tree lines. Afterwards `git diff origin/dev...HEAD --stat` must list no `.claude/commands/` file, and README.md must show only the build agent's 7-line change. With this reversal simulated in a temporary index, the merge into origin/dev is conflict-free.
```

## Issue Summary
**Original Spec:** `specs/issue-934-adw-0mdjtu-bug-promotion-sweep-sdlc_planner-fix-promotion-sweep-ramp-marker-tags.md`

**Issue:** The plan commit `09fb8ca9` (`HEAD~2`) carries six files that the spec told the planner to leave alone: "The worktree already carries unrelated uncommitted edits to `README.md` and `.claude/commands/*.md` from before planning; leave those as they are."
- **Five slash-command prompts.** Each is byte-identical to `3f1ed745` (2026-09-28), the stale `main` that the ADW runner's checkout holds. Patch `axbb2a` (`86aec027` on dev) fixed the same problem on another branch. Relative to the merge base `a47f7670`, these prompts delete rules that are on dev:
  - `bug.md` (`2294d856`), `chore.md` and `feature.md` (`cae6dbe7`) lose four rules: research is read-only, write only the plan, stop once it is written, and list the Validation Commands without running them. These rules keep plan agents under the 30-minute watchdog.
  - `adw_init.md` (`92a759ff`) loses the guard that leaves an existing non-empty `.adw/conditional_docs.md` unchanged.
  - `document.md` (`92a759ff`) loses its ADR handling: `Decisions:` blocks, `## Decisions` sections and step 8 "Check decisions".
- **README.md.** 9 directory-tree hunks (23 lines added, 4 removed) list files unrelated to #934. Neither dev nor main carries them.

Planning ran `git merge-tree` against `origin/dev` (`d16c5784`). The merge silently takes the branch's stale `bug.md`, `chore.md`, `feature.md` and `adw_init.md`: dev did not change them after the merge base, so git sees only the branch's edit. It conflicts once in `document.md` and three times in `README.md`, because dev refreshed the same tree regions differently. `adw_init.md` and `document.md` are also `hashInputs` of the framework hash, so the stale copies would ship in the next framework version.

**Solution:** Reverse exactly the plan commit's hunks for those six paths with `git show 09fb8ca9 -- README.md .claude/commands/ | git apply -R`, then commit only those paths on top of `HEAD`. Planning checked the result in a temporary index:
- The dry run applies cleanly. Git reports README hunks 8 and 9 at a one-line offset, caused by the tree line the build commit added.
- The five prompts return to their merge-base content. Four of them equal dev. Dev has since changed `document.md`, so the branch's copy drops out of the branch diff and the merge takes dev's version.
- README's remaining diff against the merge base is exactly the four hunks from `517f823d` (4 lines added, 3 removed): the "Scenario promotion sweep" bullet (line 33), the "Scenario Promotion" paragraph (line 338), the `promotionSweep.test.ts` tree line and the `promotionSweepDefaults.ts` tree comment.
- Only these six paths differ from `HEAD`.
- The merge into `origin/dev` is conflict-free, and its `.claude/commands/` equals dev's.

Rejected alternatives:
- `git checkout origin/dev -- <prompts>`, the `axbb2a` route. Dev has moved `document.md` past the merge base, so this would add dev's newer `document.md` to the branch diff. It also does nothing for README.
- `git checkout <base> -- README.md` drops the build agent's four hunks.
- `git revert 09fb8ca9` also deletes the spec and `feature-934.feature`.
- A rebase needs a force-push and gives the same net tree. No later commit touches the prompts, and the README hunks from `517f823d` do not overlap the plan commit's.

The restore persists for the rest of this workflow. On this repository's path, `copyClaudeAssetsToWorktree` runs only when the worktree is first created (`adws/phases/workflowInit.ts:278`). Reusing a worktree only merges dev and copies `.env` (`workflowInit.ts:262-275`), and once this patch lands that merge no longer conflicts. Agents read slash commands from the worktree, so this workflow's later document phase also gets the `document.md` that has its ADR handling.

## Files to Modify
Use these files to implement the patch:

`git apply -R` restores each file. Do not edit them by hand.
- `.claude/commands/adw_init.md`: back to merge-base content.
- `.claude/commands/bug.md`: back to merge-base content.
- `.claude/commands/chore.md`: back to merge-base content.
- `.claude/commands/document.md`: back to merge-base content.
- `.claude/commands/feature.md`: back to merge-base content.
- `README.md`: only the plan commit's 9 directory-tree hunks are removed. The build agent's 4 hunks stay.

Nothing else changes. Leave `features/per-issue/feature-934.feature`, the spec, `.adw-version` and everything under `adws/`, `app_docs/`, `features/` and `specs/adr/` alone.

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

Run every command from the worktree root. `features/per-issue/feature-934.feature` puts the build agent in TDD mode, but this patch changes no behaviour, so there is no RED step. Do not add or change tests, step definitions or `.feature` files.

### Step 1: Confirm the preconditions
- `git status --porcelain -- README.md .claude/commands/` prints nothing.
- `git log --format='%h %s' 09fb8ca9..HEAD -- README.md .claude/commands/` lists only `517f823d build-agent: fix: repair promotion sweep ramp, marker PR, tags`, so no later commit touched the prompts.
- `git show 09fb8ca9 -- README.md .claude/commands/ | git apply -R --check` exits 0. If it fails, for example because dev was merged into the branch after planning, stop and report. Do not fall back to hand edits or `git checkout`.

### Step 2: Reverse the plan commit's edits to the six files
- Run exactly:
  ```sh
  git show 09fb8ca9 -- README.md .claude/commands/ | git apply -R
  ```
- This changes only the working tree. `git diff --stat` must list exactly the six paths and end with `6 files changed, 43 insertions(+), 31 deletions(-)`.

### Step 3: Commit only the six paths
- Run:
  ```sh
  git commit \
    -m "patchAgent: chore: restore command prompts and README to the merge base" \
    -m "The plan commit carried stale copies of five slash-command prompts from the runner's checkout and an unrelated README directory-tree refresh. Reverse those hunks so the branch keeps the read-only planner rules of bug, chore and feature, adw_init's conditional_docs guard and /document's ADR handling, and merges into dev without conflicts. The build agent's README changes stay." \
    -- README.md .claude/commands/adw_init.md .claude/commands/bug.md .claude/commands/chore.md .claude/commands/document.md .claude/commands/feature.md
  ```
- The pathspec commits these six paths and nothing else. Do not use `git add -A`, `git commit -a`, `--amend`, `git revert` or a rebase.
- Leave this untracked patch plan file alone. The review-patch loop commits it after this build and then pushes. Do not push.

### Step 4: Run the validation
- Run every command under `## Validation`.

## Validation
Execute every command to validate the patch is complete with zero regressions.

Use `origin/dev` as it stands, without fetching. At planning time it was `d16c5784`.

1. **The branch no longer carries the prompts, and README carries only the build agent's change:**
   ```sh
   git diff origin/dev...HEAD --stat -- .claude/commands/   # prints nothing
   git diff origin/dev...HEAD --stat -- README.md           # README.md | 7 +-, 1 file changed, 4 insertions(+), 3 deletions(-)
   diff <(git diff origin/dev...HEAD -- README.md | grep -E '^[+-]' | grep -vE '^(\+\+\+|---)') <(git show 517f823d -- README.md | grep -E '^[+-]' | grep -vE '^(\+\+\+|---)')   # prints nothing
   git show --format= --name-only HEAD                      # exactly the six paths
   ```
2. **The deleted rules are back, and the build agent's README edits remain:**
   ```sh
   grep -c 'Research is read-only' .claude/commands/bug.md .claude/commands/chore.md .claude/commands/feature.md   # 1 for each file
   grep -c 'already exists and is not empty, leave it unchanged' .claude/commands/adw_init.md                     # 1
   grep -c '### 8. Check decisions' .claude/commands/document.md                                                  # 1
   grep -c '^## Decisions$' .claude/commands/document.md                                                          # 1
   grep -cF 'dedicated `chore/promotion-sweep` branch and lands it' README.md                                      # 1
   grep -cF 'also lists and reads its candidates from that worktree' README.md                                     # 1
   grep -cF 'promotionSweep.test.ts' README.md                                                                     # 1
   grep -cF 'makeDefaultDeps(boundary, getBase)' README.md                                                         # 1
   grep -cE 'deployWorkersWorkflow\.test\.ts|docsIndexSweepHarness\.ts|0001_initial\.sql' README.md                # 0 (3 before the patch)
   ```
3. **The merge into dev is conflict-free and keeps dev's prompts:**
   ```sh
   MERGED=$(git merge-tree --write-tree HEAD origin/dev) && git diff --quiet origin/dev "$MERGED" -- .claude/commands/ && echo "clean merge; prompts == origin/dev"
   ```
   This prints `clean merge; prompts == origin/dev`. If a newer `origin/dev` conflicts in a file that this patch does not touch, report the conflict and leave it alone; it is outside this patch.
4. **The tests that touch the real prompts and framework-hash inputs pass:**
   ```sh
   bunx vitest run adws/core/__tests__/hashComputer.test.ts adws/__tests__/adwUpgrade.test.ts adws/__tests__/prTemplateMarker.test.ts adws/phases/__tests__/worktreeSetup.test.ts
   NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression and (@framework-hash or @upgrade-regen)" --format summary   # 10 scenarios (10 passed)
   ```
5. **Zero regressions, using the spec's gates:** `bun run lint`, `bunx tsc --noEmit`, `bunx tsc --noEmit -p adws/tsconfig.json`, `bun run build`, `bun run lint:docs-index`, `bun run test:unit` and `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-934"`. Expect the same results as before the patch, which changes only Markdown. No unit test or step definition reads the content of the real `README.md`.

## Patch Scope
**Lines of code to change:** 0 written by hand. `git apply -R` changes 74 lines in one restore commit. The five prompts gain 39 lines and lose 8; `README.md` gains 4 and loses 23.
**Risk level:** low
**Testing required:** Validation 1–3 check the git state: the six paths match the merge base apart from the build agent's README hunks, the rules are restored and the merge into dev is clean. Validation 4–5 run the tests that read these files, plus the spec's unit, lint, type-check, build and BDD gates, to confirm nothing else changed.

## Notes
- Do not touch `.adw-version`. `adw_init.md` and `document.md` are `hashInputs`, so the restore moves the branch's computed framework hash back to the merge base's. The stamp is `58ba2954…` on the branch, on dev and at the merge base. The only hash check against the real checkout, in `feature-537`, tests the digest's format.
- The dropped README hunks are a directory-tree refresh that neither dev nor main carries. Dev refreshed three of the same regions in its own way: the agents tests, the `legacyModelUsage.ts` comment and the triggers tests. A tree refresh belongs in its own chore.
- Root cause, outside this patch: `copyClaudeAssetsToWorktree` (`adws/phases/worktreeSetup.ts:212`) copies the runner checkout's prompts over a new worktree's tracked copies. The lasting fix is the operator action the `axbb2a` patch recorded: move the runner's checkout from `main` to the current `dev`.

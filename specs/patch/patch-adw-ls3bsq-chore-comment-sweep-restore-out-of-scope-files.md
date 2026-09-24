# Patch: Restore README.md and scenario_writer.md to origin/dev

## Metadata
adwId: `ls3bsq-chore-comment-sweep`
reviewChangeRequest:
```text
Issue #1: Commit c3a6c1f6 changes two files outside the 31 Touched Files: README.md (+2 lines describing the comment-only guard) and .claude/commands/scenario_writer.md (-1 line). The plan's Step 1 says these showed as modified from outside this chore and must not be staged or edited, and the spec's scope validation command carves them out. The scenario_writer.md hunk deletes the rule 'Feature files carry no commentary. Scenario titles and steps are the explanation. At most one short line under Feature: if the domain term is not self-evident.' that commit bebda8dd (issue #853, merged via PR #885) added to dev, so merging this branch would silently revert part of the blocking issue's deliverable.
Resolution: Restore both files to their origin/dev content (git checkout origin/dev -- README.md .claude/commands/scenario_writer.md), commit, and confirm that `git diff --name-only origin/dev -- . ':!specs/'` lists only adws/agents files. If the README addition is wanted, land it as its own docs change.
```

## Issue Summary
**Original Spec:** specs/issue-880-adw-ls3bsq-chore-comment-sweep-sdlc_planner-comment-sweep-adws-agents.md
**Issue:** Commit `c3a6c1f6` staged two files the spec's Step 1 explicitly excluded. `README.md` gained two lines (a *Comment-only guard* feature bullet and a `checkCommentOnly.ts` entry in the directory tree). `.claude/commands/scenario_writer.md` lost the rule line `Feature files carry no commentary. Scenario titles and steps are the explanation. At most one short line under `Feature:` if the domain term is not self-evident.` that commit `bebda8dd` (issue #853, PR #885) added to `dev`. Merging as-is would silently revert part of the blocking issue's deliverable and widen the batch beyond its 31 Touched Files.

Verified state at planning time:
- `origin/dev` (`34901ec0`) is the merge base, so restoring from `origin/dev` yields the exact pre-chore content of both files.
- `origin/dev`'s `README.md` contains no mention of `checkCommentOnly` or "comment-only", so the README hunk is new prose, not a duplicate of something already on `dev`.
- The branch has no remote counterpart yet (`git ls-remote --heads origin chore-issue-880-comment-sweep-adws-agents` is empty) and the comment-only guard currently reports `✔ PASS` for all 31 files.

**Solution:** Check both files out from `origin/dev`, commit only those two paths in a follow-up commit, and confirm the branch's non-spec diff against `origin/dev` contains only `adws/agents/` paths. No edit to any of the 27 swept files, no edit to the spec, no history rewrite. The README prose about the guard is dropped here; if wanted, it belongs in a separate docs change against `dev`.

Approaches considered (fewest changes wins):
1. **`git checkout origin/dev -- README.md .claude/commands/scenario_writer.md` + new commit** — 3 lines net, byte-exact restore, review can be re-verified by diffing one small commit. **Chosen.**
2. Amend / rewrite `c3a6c1f6` — same file result but rewrites the SHA the review refers to, forcing a re-review of the full 27-file diff; interactive rebase is also unavailable in this environment. Rejected.
3. Hand-edit the two files — reproduces the same 3 lines by hand with room for whitespace drift; the checkout is strictly safer. Rejected.

## Files to Modify
Use these files to implement the patch:

- `README.md` — restore to `origin/dev` content (removes the two added lines: the *Comment-only guard* bullet under the feature list and the `├── checkCommentOnly.ts` tree entry).
- `.claude/commands/scenario_writer.md` — restore to `origin/dev` content (re-adds the `Feature files carry no commentary…` rule under section 5's `Rules:` list).

No other file changes. Do not touch the 27 `adws/agents/` files, `specs/`, or anything else.

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Restore both files from origin/dev
- Run from the worktree root (`/Users/martin/projects/paysdoc/AI_Dev_Workflow/.worktrees/chore-issue-880-comment-sweep-adws-agents`):
  ```bash
  git fetch origin dev
  git checkout origin/dev -- README.md .claude/commands/scenario_writer.md
  ```
- Confirm the staged change is exactly the inverse of the stray hunks:
  ```bash
  git diff --cached --stat
  ```
  Expected: `.claude/commands/scenario_writer.md | 1 +` and `README.md | 2 -`, nothing else. If any other path appears, unstage it (`git restore --staged <path>`) before continuing.

### Step 2: Confirm the restored content
- The #853 rule is back and appears once:
  ```bash
  grep -c 'Feature files carry no commentary' .claude/commands/scenario_writer.md
  ```
  Expected output: `1`.
- The README no longer carries the out-of-scope guard prose:
  ```bash
  grep -c 'checkCommentOnly' README.md
  ```
  Expected output: `0`.

### Step 3: Commit only the two restored paths
- Commit with the two paths named explicitly so nothing else can ride along:
  ```bash
  git commit -m "patch: restore README.md and scenario_writer.md to origin/dev content

  c3a6c1f6 staged two files outside the 31 Touched Files of issue #880.
  Restoring both from origin/dev drops the out-of-scope README addition and
  re-adds the scenario_writer.md rule that bebda8dd (issue #853) shipped.

  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" -- README.md .claude/commands/scenario_writer.md
  ```
- `git status --short` must be empty afterwards.

### Step 4: Confirm the branch scope is now only adws/agents
- Run the reviewer's scope check:
  ```bash
  git diff --name-only origin/dev -- . ':!specs/'
  ```
  Every line must start with `adws/agents/` (27 paths). Neither `README.md` nor `.claude/commands/scenario_writer.md` may appear.

## Validation
Execute every command to validate the patch is complete with zero regressions.

1. `git diff --name-only origin/dev -- . ':!specs/' | grep -v '^adws/agents/'` — must print nothing (only Touched Files differ from `origin/dev`; the spec's original carve-out for the two files is no longer needed).
2. `git diff --quiet origin/dev -- README.md .claude/commands/scenario_writer.md && echo IDENTICAL` — must print `IDENTICAL`.
3. `grep -c 'Feature files carry no commentary' .claude/commands/scenario_writer.md` — must print `1` (the #853 rule is restored).
4. `bun run lint:comment-only adws/agents/__tests__/claudeAgent.test.ts adws/agents/__tests__/gitAgent.test.ts adws/agents/__tests__/refactorAgent.test.ts adws/agents/__tests__/rotAnalysisAgent.test.ts adws/agents/__tests__/scenarioFidelityAgent.test.ts adws/agents/agentProcessHandler.ts adws/agents/alignmentAgent.ts adws/agents/bddScenarioRunner.ts adws/agents/buildAgent.ts adws/agents/claudeAgent.ts adws/agents/commandAgent.ts adws/agents/dependencyExtractionAgent.ts adws/agents/diffEvaluatorAgent.ts adws/agents/documentAgent.ts adws/agents/gitAgent.ts adws/agents/index.ts adws/agents/installAgent.ts adws/agents/jsonlParser.ts adws/agents/patchAgent.ts adws/agents/planAgent.ts adws/agents/prAgent.ts adws/agents/refactorAgent.ts adws/agents/resolutionAgent.ts adws/agents/reviewAgent.ts adws/agents/rotAnalysisAgent.ts adws/agents/scenarioAgent.ts adws/agents/scenarioFidelityAgent.ts adws/agents/stepDefAgent.ts adws/agents/testAgent.ts adws/agents/testRetry.ts adws/agents/validationAgent.ts` — must still print `✔ PASS` for 31 files (regression check; this patch does not touch them).
5. `bun run test` — package `test` script (typecheck) passes.

## Patch Scope
**Lines of code to change:** 3 (2 lines removed from `README.md`, 1 line restored in `.claude/commands/scenario_writer.md`); zero source-code lines.
**Risk level:** low
**Testing required:** Scope diff against `origin/dev`, byte-identity check on the two restored files, the comment-only guard on the 31 swept files, and the typecheck. No behaviour changes; no unit or scenario tests are affected.

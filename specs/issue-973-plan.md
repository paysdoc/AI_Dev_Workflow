# PR-Review: Restore runtime default-branch resolution in `.claude/` prompts regressed by PR #974

## PR-Review Description
PR #974 (branch `chore-issue-973-fix-conditional-docs-serialization`) has one review comment, from `paysdoc`, on `.claude/commands/clean_local_repo.md` line 12:

> This is incorrect. 'develop' is not a branch in many repos. It has to be the <default> branch as determined by the code host (github, gitlab, ...). Excluding main is fine.

The PR changes that line to:

```
- <for each branch except main and develop (`git branch -D <branchName>`) >
```

On `origin/dev`, the line resolves the default branch at run time from the remote (the code host) and also spares the current branch:

```
- <for each branch except the default branch (the `HEAD branch:` line of `git remote show origin`) and the current branch (`git branch -D <branchName>`) >
```

Root cause: the comment points at one line, but the defect is wider. The plan-orchestrator commit `16c0a5c5` ("plan-orchestrator: chore: fix conditional docs serialization") committed stale copies of 11 `.claude/` files. Those copies reverted later work on `dev`, mainly `87c070ea` ("remove hardcoded branches, enforce App identity", ADR-0019) and `66e18a66` ("restore prompts and unify unit-test switch"). The `pre-pr-commit` commit `f79b981c` restored 2 of them (`adw_init.md`, `depaudit-triage/SKILL.md`). The other 9 still differ from `origin/dev` with stale content. Nothing in issue #973 called for touching any `.claude/` file.

`bun run lint:branch-names` (the CI `branch-names` job in `.github/workflows/git-cli-guard.yml`) currently **fails** on this branch with 8 violations, all in those regressed files:

```
.claude/commands/clean_local_repo.md:12   ... except main and develop ...
.claude/commands/document.md:6            ... against the main branch ...
.claude/commands/document.md:17-19        git diff origin/main ...
.claude/commands/resolve_conflict.md:12   (e.g., `main`, `develop`, ...)
.claude/commands/resolve_failed_test.md:16 git diff origin/main ...
.claude/commands/review.md:17             (parse for `main`, `develop`, etc.)
```

Other files carry functional regressions that the branch-name gate does not catch:
- `review.md` loses **Step 4: Step Definition Independence Check** and its `remediationStrategy` rules.
- `feature.md` goes back to the obsolete `.adw/project.md` `## Unit Tests` switch instead of `.github/adw.yml` `unitTests`.
- The diffs in `generate_step_definitions.md`, `scenario_writer.md` and `implement-tdd/SKILL.md` are also unrelated to #973.

Resolution: restore all 9 files byte-for-byte from `origin/dev`. For `clean_local_repo.md`, the restored line already does what the reviewer asks. The default branch comes from the code host via the `HEAD branch:` line of `git remote show origin`, which works for GitHub, GitLab and others. `develop` is no longer named. The reviewer allows excluding `main`, but the plan does not add it back. Naming it would hard-code a branch, which ADR-0019 and the branch-name guard forbid. On a repo whose default branch is `main`, the default-branch exclusion already protects it.

## Summary of Original Implementation Plan
Source: `specs/issue-973-adw-tu043o-docs-index-health-1-sdlc_planner-fix-conditional-docs-serialization.md`.

The daily docs-index sweep reported `.adw/conditional_docs.md` as non-canonical, with the first divergence at line 15 (the file's first `  - Decisions:` header). The cause was operational. The sweep ran on a cron host with ADW code from before PR #948, whose parser ignores `Decisions:` and folds `    - 0043` into Conditions. The index itself is canonical. The plan had four steps:
1. Run `bun run lint:docs-index` to confirm the round-trip check passes. Make a formatting-only fix only if it fails.
2. Add one regression test to `adws/core/__tests__/docsIndexHealthDecisions.test.ts`. The test serializes a registry whose first entry has a `Decisions:` block and asserts that `findViolations` reports no `non-canonical` violation.
3. Leave the parser, serializer, health module, gate and sweep unchanged.
4. Run the validation commands. The PR description should ask the operator to update or restart the cron host so the sweep closes #973 itself.

Steps 1–2 are implemented (commit `16828239`). The plan did not call for any `.claude/` change.

## Relevant Files
Use these files to resolve the review:

- `README.md`: project overview. The **Branch-name guard** bullet describes `bun run lint:branch-names`, which forbids naming `main`/`master`/`dev`/`develop` in `.claude/commands/` (ADR-0019).
- `.adw/coding_guidelines.md`: guidelines. All files touched here are prompt markdown restored verbatim from `origin/dev`, so no new code is added.
- `.adw/commands.md`: source of the validation commands.
- `adws/checkBranchNames.ts`: the branch-name guard. Its `REMEDY` names the `HEAD branch:` line of `git remote show origin` as the sanctioned way for a prompt to resolve the default branch. Read-only.
- `specs/adr/0019-dev-and-main-branches-with-runner-clone.md`: the decision that the base branch is resolved at run time and never hard-coded. Read-only.
- `.github/workflows/git-cli-guard.yml`: the CI `branch-names` job, which currently fails on this PR. Read-only.
- `.claude/commands/clean_local_repo.md`: **the reviewed file.** Line 12 hard-codes `main` and `develop`. Restore it from `origin/dev`.
- `.claude/commands/document.md`: regressed to `git diff origin/main` and "the main branch" (lines 6, 17–19), plus other content changes. Restore from `origin/dev`.
- `.claude/commands/resolve_conflict.md`: regressed to `` `main`, `develop` `` in the `incomingBranch` example (line 12). Restore from `origin/dev`.
- `.claude/commands/resolve_failed_test.md`: regressed to `git diff origin/main` (line 16). Restore from `origin/dev`.
- `.claude/commands/review.md`: regressed to "parse for `main`, `develop`" (line 17), and Step 4 (Step Definition Independence Check) was dropped. Restore from `origin/dev`.
- `.claude/commands/feature.md`: regressed to the obsolete `.adw/project.md` `## Unit Tests` switch. Restore from `origin/dev`.
- `.claude/commands/generate_step_definitions.md`: stale content unrelated to #973. Restore from `origin/dev`.
- `.claude/commands/scenario_writer.md`: stale content unrelated to #973. Restore from `origin/dev`.
- `.claude/skills/implement-tdd/SKILL.md`: stale content unrelated to #973. Restore from `origin/dev`.
- `adws/core/__tests__/docsIndexHealthDecisions.test.ts`: the original chore's regression test. Leave it unchanged; it is listed only so it gets re-run.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### 1. Confirm the regression set before touching anything
- Run `git fetch origin dev` so `origin/dev` is current.
- Run `git diff origin/dev --stat -- .claude/`. Expected: exactly these 9 files differ:
  - `.claude/commands/clean_local_repo.md`
  - `.claude/commands/document.md`
  - `.claude/commands/feature.md`
  - `.claude/commands/generate_step_definitions.md`
  - `.claude/commands/resolve_conflict.md`
  - `.claude/commands/resolve_failed_test.md`
  - `.claude/commands/review.md`
  - `.claude/commands/scenario_writer.md`
  - `.claude/skills/implement-tdd/SKILL.md`
- If `origin/dev` has moved and the list differs, restore every `.claude/` path that differs, but only if this branch's commits changed it (`git log --oneline origin/dev..HEAD -- <path>` is non-empty). Do not touch `.claude/` files this branch never changed.

### 2. Restore the regressed `.claude/` files from `origin/dev`
- Run:
  ```
  git checkout origin/dev -- \
    .claude/commands/clean_local_repo.md \
    .claude/commands/document.md \
    .claude/commands/feature.md \
    .claude/commands/generate_step_definitions.md \
    .claude/commands/resolve_conflict.md \
    .claude/commands/resolve_failed_test.md \
    .claude/commands/review.md \
    .claude/commands/scenario_writer.md \
    .claude/skills/implement-tdd/SKILL.md
  ```
- Do not hand-edit these files. A byte-for-byte restore is the fix, because `dev` already holds the reviewed, guard-clean versions.
- Verify that `git diff origin/dev -- .claude/` prints nothing.

### 3. Confirm `clean_local_repo.md` answers the review comment
- `.claude/commands/clean_local_repo.md` line 12 must read exactly:
  ```
  - <for each branch except the default branch (the `HEAD branch:` line of `git remote show origin`) and the current branch (`git branch -D <branchName>`) >
  ```
- Check it against the comment:
  - `develop` is no longer named.
  - The default branch is resolved at run time from the remote, i.e. the code host's configured default, which works for GitHub, GitLab and others.
  - The current branch is also spared, so the command never tries to delete the checked-out branch.
- Do **not** add `main` to the exclusion list. The reviewer allows it ("Excluding main is fine"), but naming a branch breaks ADR-0019 and the branch-name guard's intent. When `main` is the default branch, the default-branch exclusion already covers it.

### 4. Leave the original chore's work untouched
- Make no change to `adws/core/__tests__/docsIndexHealthDecisions.test.ts`, `.adw/conditional_docs.md`, the original spec, or any `adws/` source.
- Leave the committed `README.md` tree-listing additions as they are. They list files that exist (`regressionWorkflow.test.ts`, `prReviewPhase.test.ts`, `startupFailureLog.ts`/`.test.ts`, `cronIssueFilterFixtures.ts`, `strandedStartingRecovery.test.ts`, `migrations/0001_initial.sql`).
- The working tree also has an uncommitted `README.md` edit: it adds `fixtures/` entries that exist on disk and removes a duplicated `planCommitGuard.ts` line. It is accurate, and the review does not ask about it. Leave it in whatever state the workflow commits it. Do not revert it as part of this review.

### 5. Run validation commands
- Execute every command in `Validation Commands` below and confirm that each one exits with code 0.
- `bun run lint:branch-names` must report `✔ PASS  No file names a branch to act on.` It fails on the branch today, and this check proves the review is resolved.

## Validation Commands
Execute every command to validate the review is complete with zero regressions.

- `git diff origin/dev --stat -- .claude/`: must print nothing (every regressed prompt matches `dev`).
- `grep -n "develop" .claude/commands/clean_local_repo.md`: must print nothing and exit 1, confirming `develop` is gone from the reviewed file.
- `bun run lint:branch-names`: the CI branch-name gate. Must PASS (8 violations before the fix).
- `bun run lint:docs-index`: the docs-index gate from the original chore. The round-trip and every other FAIL-level check must still pass.
- `bun run lint`: ESLint.
- `bunx tsc --noEmit`: root type check.
- `bunx tsc --noEmit -p adws/tsconfig.json`: adws type check.
- `bun run test:unit -- adws/__tests__/checkBranchNames.test.ts adws/core/__tests__/docsIndexHealthDecisions.test.ts adws/core/__tests__/docsIndexHealth.test.ts adws/core/__tests__/conditionalDocsRegistry.test.ts adws/__tests__/checkLivingDocsIndex.test.ts`: targeted suites for the branch-name guard and the original chore.
- `bun run test:unit`: full Vitest suite, for zero regressions.
- `bun run build`: build check.

## Notes
- Root cause of the review finding: the plan-orchestrator commit `16c0a5c5` swept stale `.claude/` copies into the branch. These look like the same out-of-date ADW deployment that produced the #973 false positive. Two of the 11 files were restored by `f79b981c`; this plan restores the other 9. Mention this in the PR update. If plan commits keep picking up stale `.claude/` content, the `planCommitGuard` snapshot or the cron/runner host's checkout should be checked, but that is out of scope here.
- ADR-0019 and `checkBranchNames.ts` say prompts must resolve the base branch at run time, using "the `HEAD branch:` line of `git remote show origin`". That is the wording `dev` already uses, so the restore matches both the reviewer's request and the repo's own guard.
- No coding-guideline violations are introduced. The only non-prompt file changed by this PR (`docsIndexHealthDecisions.test.ts`, 104 lines) already follows `.adw/coding_guidelines.md`: tested through the public API, under 300 lines, no issue numbers or restating comments. No `/refactor` step is needed.
- Do not edit or close issue #973 by hand. The docs-index sweep owns its lifecycle and closes it once a current-`dev` cron host sees a clean index.

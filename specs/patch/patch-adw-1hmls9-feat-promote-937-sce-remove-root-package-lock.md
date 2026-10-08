# Patch: Remove the out-of-scope root `package-lock.json`

## Metadata
adwId: `1hmls9-feat-promote-937-sce`
reviewChangeRequest: ``Issue #1: Out-of-scope lockfile: build commit 40645354 added a 5,070-line root `package-lock.json` (npm lockfileVersion 3) next to `bun.lock`. The spec is a pure relocation ('No production code changes, no new library') and does not call for it. The repo deleted this file on purpose when it moved to Bun (commit 2501513e, issue #86). Accepted ADR-0009 (`specs/adr/0009-bun-as-package-manager-node-as-runtime.md`) records that `package-lock.json` is absent, and `.github/dependabot.yml` relies on that ('this repo has no package-lock.json'): its `bun` ecosystem regenerates only `bun.lock`. If merged, the second lockfile drifts from `bun.lock` on the first dependency bump, because nothing regenerates it. It also buries the relocation diff of this hitl PR. Resolution: Remove the file from the branch with `git rm package-lock.json` and commit, leaving `bun.lock` as the only lockfile. Make no other change.``

## Issue Summary
**Original Spec:** `specs/issue-1005-adw-1hmls9-feat-promote-937-sce-sdlc_planner-promote-937-review-screenshots-regression.md`

**Issue:** Build commit `40645354` added a root `package-lock.json` (5,070 lines, npm `lockfileVersion: 3`) next to `bun.lock`. The spec is a pure relocation ("No production code changes, no new library") and calls for no lockfile. Checked while planning:
- `git log --oneline origin/dev..HEAD -- package-lock.json` lists only `40645354`, and `origin/dev` has no root `package-lock.json`. Of the branch's `5856 insertions(+)` against `origin/dev`, 5,070 are this file.
- `2501513e` deleted the file when the repo moved to Bun (issue #86). ADR-0009's Confirmation records "`bun.lock` is present; `package-lock.json` and `yarn.lock` are absent". `.github/dependabot.yml` relies on that, and so does `app_docs/feature-9gjajh-root-config.md` (line 25): the `bun` ecosystem regenerates only `bun.lock`.
- Nothing reads the file. Outside the docs, `git grep package-lock` finds only the comment in `dependabot.yml`. No code, test, feature or workflow runs `npm install` or `npm ci`.
- How it got in: the SDLC install agent ran `npm install 2>&1 | tail -5` (`agents/1hmls9-feat-promote-937-sce/sdlc-orchestrator/install-agent/output.jsonl`), which wrote the file into the worktree. The build agent's commit step stages with `git add -A` (`.claude/commands/commit.md`), so `40645354` picked it up.

**Solution:** Add one deletion commit on top of `HEAD`: `git rm package-lock.json`, then commit only that deletion. `bun.lock` stays the only root lockfile, and no other path changes. Rejected alternatives:
- amending `40645354`: the resolution asks for a new commit, and the review-patch flow only adds commits;
- also adding a `.gitignore` entry or fixing `/install`: the review says "Make no other change" (see Notes).

## Files to Modify
Use these files to implement the patch:

- `package-lock.json` (repository root): delete it with `git rm`. This is the only path that changes.

Not modified:
- `bun.lock`, `package.json` and `.gitignore`;
- `workers/cost-api/package-lock.json`, which `origin/dev` already tracks;
- `.github/dependabot.yml`, ADR-0009 and `.claude/commands/install.md`;
- the relocation's nine paths: `README.md`, the moved feature, the five step-definition files, `features/regression/vocabulary.md` and the spec.

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom. Run every command from the worktree root, `/Users/martin/projects/paysdoc/AI_Dev_Workflow/.worktrees/feature-issue-1005-promote-937-scenario-to-regression`.

### Step 1: Confirm the pre-patch state
- `git fetch origin dev`
- `git status --porcelain`: the only allowed output is this plan, `?? specs/patch/patch-adw-1hmls9-feat-promote-937-sce-remove-root-package-lock.md`. If a tracked file shows as modified, stop and report it. Do not stash.
- `git ls-files -- package-lock.json`: prints `package-lock.json` only. Run from the root, this pathspec matches the root file and not `workers/cost-api/package-lock.json`. If it prints nothing, the deletion has already landed: skip to Validation.
- `git log --oneline origin/dev..HEAD -- package-lock.json`: prints only `40645354 build-agent: feat: promote #937 scenario into regression suite`.
- `git cat-file -e origin/dev:package-lock.json 2>/dev/null && echo "present on origin/dev" || echo "absent on origin/dev"`: prints `absent on origin/dev`.

### Step 2: Delete the root lockfile from the branch
- Run exactly this, as a Bash call of its own with nothing chained after it:
  ```sh
  git rm package-lock.json
  ```
  It prints `rm 'package-lock.json'`, deletes the file from the working tree and stages the deletion.
- Why on its own: `.claude/hooks/pre-tool-use.ts` (`isDangerousRmCommand`) blocks a command in which `rm` is followed, anywhere later in the same string, by a dash flag whose letters include `r` (`--dry-run`, `--porcelain`, `--error-unmatch`, `-r`), when the string also contains a `.` or `/`. So `git rm package-lock.json && git status --porcelain` is blocked, and the bare command is not. Every command in this plan was checked against a copy of that function while planning.
- Use no flag. `--cached` would leave the file on disk, untracked, and the orchestrator's `git add -A` commit would add it back. `-r` and `-f` are not needed, because the file is unmodified.
- Run no `npm` or `npx` command (`npm install`, `npm i`, `npm ci`). npm writes a root `package-lock.json`, which the orchestrator's `git add -A` commit would pick up again. `node_modules/` is already installed; do not reinstall.

### Step 3: Check the staged change
- `git diff --cached --name-status`: prints exactly `D	package-lock.json`.
- `test ! -e package-lock.json && echo "PASS: root package-lock.json deleted from the working tree"`: prints the message.
- `git ls-files -- bun.lock workers/cost-api/package-lock.json`: prints both paths, so the other lockfiles are untouched.

### Step 4: Commit the deletion alone
- Commit with the repo's `<agent name>: <type>: <description>` convention. Only the deletion is staged, so a plain `git commit` records nothing else. Use the message as written: it avoids the word `rm`, which the hook scans for.
  ```sh
  git commit -m "patchAgent: chore: drop out-of-scope root package-lock.json" -m "Build commit 40645354 swept in an npm lockfile (lockfileVersion 3) that an npm install had left in the worktree. The repo uses Bun: ADR-0009 records that package-lock.json is absent, and Dependabot's bun ecosystem regenerates only bun.lock, so a second lockfile would drift from it on the first dependency bump. bun.lock stays the only root lockfile."
  ```
- Do not run `git add -A`, `git add .` or `git commit -a`. This plan stays uncommitted for the orchestrator's `review-patch-agent` commit, which also pushes the branch.
- Do not amend or rebase `40645354`, and do not push.
- `git show --name-status --format='%h %s' HEAD`: the new commit lists `D	package-lock.json` and nothing else.

## Validation
Execute every command to validate the patch is complete with zero regressions.

Checks 3 and 4 are the spec's Validation Commands. The orchestrator's unit-test and scenario test phases both passed on the pre-patch tip `40645354` (`execution.log`, 21:32 and 21:35 UTC), and nothing reads the deleted file. Fix a failure only if this patch caused it; otherwise report it with its output and change nothing else.

1. **No root `package-lock.json`, tracked or on disk, and `bun.lock` is the only root lockfile, unchanged.** The second command prints exactly `bun.lock`:
   ```sh
   test ! -e package-lock.json && test -z "$(git ls-files -- package-lock.json)" && echo "PASS: no root package-lock.json, tracked or on disk"
   git ls-files | grep -E '^(package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?)$'
   git diff --quiet origin/dev...HEAD -- bun.lock package.json workers && echo "PASS: bun.lock, package.json and workers/ untouched by the branch"
   ```
2. **The branch diff is the relocation alone again.** The first command prints exactly `D	package-lock.json`: since the build commit, the patch changed nothing else. The second prints exactly the nine paths listed below. The third prints ` 9 files changed, 786 insertions(+), 21 deletions(-)` (with the lockfile it was 10 files and 5856 insertions).
   ```sh
   git diff --name-status 40645354 HEAD -- . ':(exclude)specs/patch'
   git diff --name-only origin/dev...HEAD -- . ':(exclude)specs/patch'
   git diff --shortstat origin/dev...HEAD -- . ':(exclude)specs/patch'
   ```
   The nine paths:
   ```
   README.md
   features/regression/review/feature-937.feature
   features/regression/step_definitions/feature-937-agent.ts
   features/regression/step_definitions/feature-937-then.steps.ts
   features/regression/step_definitions/feature-937-workflow.ts
   features/regression/step_definitions/feature-937-world.ts
   features/regression/step_definitions/feature-937.steps.ts
   features/regression/vocabulary.md
   specs/issue-1005-adw-1hmls9-feat-promote-937-sce-sdlc_planner-promote-937-review-screenshots-regression.md
   ```
3. **Static checks and the unit suite (spec).** Each command exits 0:
   ```sh
   bunx tsc --noEmit
   bunx tsc --noEmit -p adws/tsconfig.json
   bun run lint
   bun run build
   bun run test:unit
   bun run lint:docs-index
   ```
4. **Scenarios (spec). The full `@regression` run is the primary acceptance command.** The dry-run reports no undefined and no ambiguous step. The full run is green and includes the 8 `@review-comment-screenshots` scenarios.
   ```sh
   NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression" --dry-run
   NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"
   ```
5. **Nothing recreated the lockfile.** Run this last. The first command prints its message. `git status --porcelain` lists only this plan as untracked (`?? specs/patch/patch-adw-1hmls9-feat-promote-937-sce-remove-root-package-lock.md`). If anything else appears, report it rather than leave it for the orchestrator's `git add -A` commit.
   ```sh
   test ! -e package-lock.json && echo "PASS: validation recreated no root package-lock.json"
   git status --porcelain
   ```

## Patch Scope
**Lines of code to change:** 0 lines of source. One commit deletes the 5,070-line generated root `package-lock.json`.
**Risk level:** low. Nothing in code, tests, CI or Dependabot reads the file, `node_modules/` is not touched, and `bun.lock` is unchanged.
**Testing required:** the lockfile and branch-diff checks (Validation 1–2), the spec's static checks and unit suite (3), the `@regression` dry-run and full run (4), and a final check that validation recreated no lockfile (5).

## Notes
- **Root cause, left for a follow-up.** `/install` (`.claude/commands/install.md`) says only "Install dependencies". This run's install agent chose `npm install`, although `.adw/commands.md` names `bun install`. `/commit` stages with `git add -A`, so any ADW run in this repo whose install agent picks npm can commit a root `package-lock.json` again. Two follow-ups are possible, each a separate change:
  - have `/install` run the `## Install Dependencies` command from `.adw/commands.md`;
  - ignore `/package-lock.json` in `.gitignore`.

  This review rules out both here ("Make no other change").
- **No documentation update.** ADR-0009, `.github/dependabot.yml` and `app_docs/feature-9gjajh-root-config.md` already describe the state this patch restores.

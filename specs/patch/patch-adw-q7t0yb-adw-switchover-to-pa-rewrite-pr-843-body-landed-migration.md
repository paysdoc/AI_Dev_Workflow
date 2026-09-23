# Patch: Rewrite the PR #843 body — migration landed, checklist ticked, Step 13 operator handoff restated

## Metadata
adwId: `q7t0yb-adw-switchover-to-pa`
reviewChangeRequest: `Issue #2: PR #843 (draft, head = this branch) still opens with > **BLOCKED at spec Step 1 — do not merge.** This PR carries only the plan spec; the migration has not been performed., its Summary says it "adds the implementation plan", and every checklist item after "plan drafted" is unchecked. That is now false: HEAD 331f701f contains the full switchover. Because #840 is hitl, the human approver reads this body as the handoff; spec Step 13 requires it to restate that runbook step 7.4 (local full suite, one live smoke workflow from the branch through PR creation, tag the pre-merge commit pre-gitcontext-switchover and push it) is the operator's, the rollback path (runbook step 8: hand-revert of the merge commit on dev and main; ADW cannot repair its own switch), the exact 1.1.0 pin with Dependabot owning bumps, and the note that the .adw/** edits change ADW's content hash and will trip the upgrade gate for registered target repos. It must also disclose the patchedDependencies dist patch (issue 3) and the expected-red per-issue scenarios for feature-816/819/823 that now describe deleted guard behaviour. Resolution: Rewrite the PR #843 body via gh pr edit 843 --body-file … (keep it a draft, no Closes/Fixes line): remove the BLOCKED preamble, describe the migration as landed (imports moved, guard narrowed, directories deleted, docs retired), tick the checklist items that are done, and add the Step 13 operator-gate, rollback, pin/Dependabot, content-hash, dist-patch and expected-red-per-issue notes.`

## Issue Summary
**Original Spec:** specs/issue-840-adw-20l8es-adw-switchover-to-pa-sdlc_planner-devplatform-switchover.md
**Issue:** PR #843's body is the pre-migration one: a "BLOCKED at spec Step 1" preamble, a Summary that says the PR only adds the plan, and 12 of 13 checklist items unticked. HEAD `331f701f` contains the whole switchover, and because #840 is `hitl` the human approver reads this body as the handoff. Spec Step 13 requires the body to restate the operator gate (runbook step 7.4), the rollback path (runbook step 8), the exact pin with Dependabot owning bumps and a content-hash note; the review also wants the `patchedDependencies` dist patch and the expected-red per-issue scenarios (816/819/823) disclosed.
**Solution:** Replace the body wholesale with `gh pr edit 843 --body-file …` — PR stays a draft, no `Closes`/`Fixes`/`Resolves` line. Every fact in the new body was verified on this worktree on 2026-09-23 (see "Verified" below). Two corrections to the request's premises are baked in: (1) the content-hash note must say the hash is **unchanged** — `computeFrameworkHash` reads only the three `hashInputs:` files declared in `.claude/commands/adw_init.md` (`adw_init.md`, `document.md`, `templates/vocabulary.md.template`), none of which this branch touches, and `bunx tsx adws/core/hashComputer.ts` prints `58ba295455740726331f43cb118c3c17a6f95d844c794cc6ab9b96cc97d203d0` on both HEAD and `origin/dev`, equal to `.adw-version` — so the upgrade gate does **not** trip; (2) ADW's issue-link contract (`adws/forge/issueLinkMarker.ts`, used by the HITL Slack notifier's `findReviewPr`, `linkedPrDetector` and the per-issue sweep) recognises only `(Closes|Implements) #N`; the current "Tracks #840" is invisible to it, so the new body carries the PR template's bare, non-closing `Implements #840` (GitHub's closing keywords are only the close/fix/resolve forms).

### Verified at patch-plan time (2026-09-23, HEAD `331f701f`, worktree with the issue #1 doc deletion staged)
- **Branch:** merge-base with `origin/dev` = `1ec1295c`; 13 ahead / 5 behind (the 5 are PR #842 — runbook-only edits to `specs/runbooks/gitcontext-extraction.md`); `git merge-tree --write-tree origin/dev HEAD` → clean, no conflict. Diff vs `origin/dev`: 269 files, +2165 / −15938; 96 files deleted under `adws/gitContext/` + `adws/providers/` (37 under `__tests__/`); 134 `.ts/.tsx` files modified under `adws/`; guard: `extractionRule.ts` + its two tests deleted (−564 lines), `constructionRule.ts`/`identityRule.ts`/`violationTypes.ts`/`guardReport.ts` adjusted; BDD: `features/regression/upgrade/feature-729.feature` + 2 regression step files + 11 per-issue step files repointed; docs: `.adw/conditional_docs.md`, `README.md`, `adws/README.md`, `app_docs/feature-oqb76h-gitcontext-base-path-authority.md` edited, `app_docs/feature-9gjajh-providers.md` deleted (issue #1 patch, staged).
- **Dependency:** `package.json` `"@paysdoc/devplatform": "1.1.0"` (exact); `bun.lock` pins `@paysdoc/devplatform@1.1.0` with sha512 integrity; `patchedDependencies` → `patches/@paysdoc%2Fdevplatform@1.1.0.patch` (118 lines): adds `Issue.createdAt`/`Issue.url` and `PullRequestRecord.updatedAt`/`url` to `dist/providers/types.d.ts`, makes `fetchAllPRsCmd` request `updatedAt,url`, makes the GitHub mapper emit `createdAt`/`url`, and gives `JiraIssueTracker` an `instanceUrl` constructor argument plus `fields.created` → `createdAt` and a `/browse/<key>` URL. The installed `node_modules/@paysdoc/devplatform/dist/providers/types.d.ts` shows the patch applied. Library `main` (= v1.1.0 + one `ci:` commit, #15) still lacks `Issue.createdAt`/`url` and the Jira constructor change; no `paysdoc/devplatform` issue or PR covers it. npm has exactly `1.0.0` and `1.1.0`; latest release v1.1.0 on 2026-09-22.
- **Dependabot:** `.github/dependabot.yml` does not exist; runbook A2 = issue #841, OPEN.
- **Guard tests on imported names:** `adws/__tests__/checkGitGhGuard.test.ts` lines 284, 297, 399, 471 (all tagged `#840`).
- **Launch boundary:** `adws/core/launchGitContext.ts` imports `createForgeCredentials` from the library and feeds it `appConfig: readGitHubAppConfig()` (line 96); `forgeProviders()` is the default assembly seam.
- **Gates run here:** `bunx tsc --noEmit` exit 0; `bunx tsc --noEmit -p adws/tsconfig.json` exit 0; `bun run test:unit` → 144 files, 2313 tests, 0 failed (4.9 s); `bun run lint:git-guard` → 272 files scanned, `Exempt packages: none`, `Sanctioned construction sites — 1 permanent, 0 sunset` (`adws/core/launchGitContext.ts`), no extraction-readiness section, PASS; `bun run lint:docs-index` → 46 entries / 44 docs, all six checks pass; `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` → 53 scenarios (11 passed, 42 pending, 0 failed), 357 steps; `test ! -d adws/gitContext && test ! -d adws/providers` → directories gone.
- **`bun run lint` is RED in this worktree, exit 1, 22 `no-undef` errors — all in two untracked, throwaway import-rewrite helpers at the repo root: `scratch-analyze.mjs` and `scratch-transform.mjs` (mtime 2026-09-22 16:47/16:50, not held open by any process).** `bunx eslint . --ignore-pattern 'scratch-*.mjs'` exits 0, i.e. the committed tree is lint-clean. Step 1 moves them out of the tree.
- **Live editor swap file:** `adws/forge/.hitlBoardNotifier.ts.swp` is untracked, not gitignored, and held open by a running `vim` (PID 2776). `.claude/commands/commit.md` stages with `git add -A`, so it would be committed. Do **not** delete it; exclude it locally (Step 1).
- **Tooling constraint:** the repo's pre-tool-use hook (`.claude/hooks/pre-tool-use.ts`, `isDangerousRmCommand`) lowercases and whitespace-collapses the whole command text, then rejects it on `\brm\s+.*-[a-z]*r[a-z]*f` — so `rm scratch-transform.mjs` is blocked by its own file name (`-transform` matches `-[a-z]*r[a-z]*f`), and a heredoc that merely *mentions* `rm` followed by such a token is blocked too. Use `mv` to `/tmp` for the scratch scripts; never `rm`.
- **Expected-red per-issue tags, run by tag on this tree:** `@adw-816` → 34 scenarios: 15 failed, 1 undefined, 18 passed; `@adw-819` → 79 scenarios: 22 failed, 1 undefined, 56 passed; `@adw-823` → 50 scenarios: 28 failed, 3 undefined, 19 passed. Every failure asserts deleted behaviour (extraction-readiness output / `EXTRACTION_SCOPE`, the two-entry exempt set, two sanctioned sites, the in-tree `adws/providers/**` copy-out). `.github/workflows/regression.yml` runs `@regression` only; `perIssueScenarioSweep.ts` `RETENTION_DAYS = 14` after the issue's PR merges.
- **Docs-only residue still naming the old paths (out of this patch's scope, disclosed in the body):** `.adw/project.md:13,15` (`adws/github/**`, `adws/providers/**` in Relevant Files); `UBIQUITOUS_LANGUAGE.md:75` (`adws/gitContext/`); `app_docs/feature-oqb76h-gitcontext-base-path-authority.md` lines 5, 9, 19, 57, 67, 70, 72, 93, 98 (in-tree core package, extraction-readiness rule, `EXTRACTION_SCOPE`, two-entry exempt set, "exactly two PERMANENT entries"); `.adw/conditional_docs.md:282` (`adws/providers/github/domain/`).
- **Spec grep nuance:** the spec's `git grep -nE "from ['\"][^'\"]*(gitContext|adws/providers)"` prints exactly one line — `features/per-issue/step_definitions/feature-797.steps.ts:98` importing `./gitContextSharedWorld.ts`, a per-issue test helper whose *file name* contains `gitContext`. The precise check (a relative specifier resolving into either deleted directory, `adws/cost/providers/anthropic/**` excluded) prints nothing.

## Files to Modify
Use these files to implement the patch:

- **PR #843 body on GitHub** (`paysdoc/AI_Dev_Workflow`, head `chore-issue-840-adw-switchover-devplatform-library`, base `dev`) — replaced wholesale via `gh pr edit --body-file`. No title change, no labels, stays a draft.
- `/tmp/adw-q7t0yb-pr-843-body.md` — scratch file holding the new body (outside the repo; never committed).
- `scratch-analyze.mjs`, `scratch-transform.mjs` (repo root, untracked) — **moved to `/tmp/adw-q7t0yb-scratch/`** (the hook blocks `rm`); they are the only source of the `bun run lint` failure.
- `$(git rev-parse --git-path info/exclude)` (local, unversioned) — gains a `*.swp` line so the live vim swap file cannot be swept in by `git add -A`.
- `specs/patch/patch-adw-q7t0yb-adw-switchover-to-pa-rewrite-pr-843-body-landed-migration.md` — this plan (the only repo file this patch commits).

No source, test, config or doc file in the repo changes.

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Clear the worktree noise so `bun run lint` is green and nothing stray gets committed
- Move the two scratch scripts out of the tree (do not delete — the pre-tool-use hook rejects `rm`): `mkdir -p /tmp/adw-q7t0yb-scratch && mv scratch-analyze.mjs scratch-transform.mjs /tmp/adw-q7t0yb-scratch/`. Confirm with `git status --short` that neither appears any more.
- Leave `adws/forge/.hitlBoardNotifier.ts.swp` alone (live vim session). Keep it out of `git add -A`: `printf '*.swp\n' >> "$(git rev-parse --git-path info/exclude)"`, then `git check-ignore -v adws/forge/.hitlBoardNotifier.ts.swp` must print the exclude rule and `git status --short` must no longer list the file.
- `bun run lint` → exit 0.

### Step 2: Write the new body to `/tmp/adw-q7t0yb-pr-843-body.md`
Write it verbatim with the Write tool or a quoted heredoc (`cat > /tmp/adw-q7t0yb-pr-843-body.md <<'BODY_EOF' … BODY_EOF`) so backticks and `$` are not interpolated. The body:

```md
## Summary

Performs the ADW switchover to the published `@paysdoc/devplatform` library (issue #840, runbook A1). The migration landed in commit `331f701f` (`scenario-fix-agent: chore: migrate ADW to devplatform forge library`); the commits after it on this branch are review-round patches (orphan-doc deletion, this body refresh).

- **Dependency:** `@paysdoc/devplatform` pinned at exactly `1.1.0` (no caret) in `package.json` and `bun.lock`. 1.1.0 (npm, published 2026-09-22) is the first version above 1.0.0 that passes the spec's Step 1 gate: `/providers` exports `createForgeCredentials`, `/git` exports `createLiteralTokenProvider`.
- **Imports moved:** every `adws/gitContext` specifier now resolves to `@paysdoc/devplatform/git`; every `adws/providers` specifier to `@paysdoc/devplatform` (ports, domain model) or `@paysdoc/devplatform/providers` (`forgeProviders`, `createForgeCredentials`, adapters). 134 files under `adws/` and 13 BDD step-definition files touched; `adws/cost/providers/anthropic/**` (a different `providers` directory) untouched.
- **Launch boundary repointed:** `buildLaunchBoundary` (`adws/core/launchGitContext.ts`) mints the one `GitContext` from the library and takes its launch `TokenProvider` + bootstrap `GitIdentity` from the library's `createForgeCredentials`, fed ADW's env-read App config (`readGitHubAppConfig`, `adws/core/githubAppAuth.ts`). No production module imports a forge-named symbol; the only forge-name grep hit is the string set inside `adws/guard/constructionRule.ts`, which names the factories the rule forbids.
- **Directories deleted:** `adws/gitContext/` and `adws/providers/` are gone — 96 files, 37 of them under `__tests__/`; those suites moved to `paysdoc/devplatform` with the code. The three `adws/vcs/__tests__/` suites for `commitOps`/`branchOps`/`worktreeResetOps` stay, repointed at the library's `./git` barrel.
- **Guard narrowed:** `EXEMPT_PACKAGES` is the empty set — a `git`/`gh` shell-out anywhere in ADW now fails CI; the extraction-readiness rule (`adws/guard/extractionRule.ts` + its two tests) is deleted and `extraction-readiness` is no longer a `ViolationRule`; `SANCTIONED_CONSTRUCTION_SITES` lists only `adws/core/launchGitContext.ts`; the identity and construction rules are proven on imported names (`forgeProviders`, `GitContext` from the library barrels) by new `#840` cases in `adws/__tests__/checkGitGhGuard.test.ts`.
- **BDD:** `features/regression/upgrade/feature-729.feature` path references updated; the two regression and eleven per-issue step files that imported the deleted directories now import the library (cucumber loads every per-issue step file on each run, so this is what keeps `@regression` loading).
- **Docs retired:** `app_docs/feature-9gjajh-providers.md` deleted with its `.adw/conditional_docs.md` entry; the `oqb76h` GitContext doc, `README.md` and `adws/README.md` refreshed to point at the library.

Diff vs `dev`: 269 files, +2,165 / −15,938.

Parent PRD: `specs/prd/gitcontext-library-extraction.md`. Runbook: `specs/runbooks/gitcontext-extraction.md` step 7.

Plan: [specs/issue-840-adw-20l8es-adw-switchover-to-pa-sdlc_planner-devplatform-switchover.md](specs/issue-840-adw-20l8es-adw-switchover-to-pa-sdlc_planner-devplatform-switchover.md)

Implements #840 — deliberately **no** closing keyword: #840 is `hitl`; the operator closes it after runbook step 7.4.

ADW tracking ID: 20l8es-adw-switchover-to-pa

## Checklist
- [x] Implementation plan drafted and committed
- [x] `@paysdoc/devplatform` added as an exact-pinned dependency at the first published version above 1.0.0 that passes the Step 1 gate (`1.1.0`)
- [x] `adws/gitContext` imports rewritten to `@paysdoc/devplatform/git`
- [x] `adws/providers` imports rewritten to `@paysdoc/devplatform` / `@paysdoc/devplatform/providers`
- [x] `buildLaunchBoundary` repointed at library's `forgeProviders`, `createForgeCredentials` and `GitContext`
- [x] `adws/gitContext/` and `adws/providers/` deleted
- [x] Guard `EXEMPT_PACKAGES` set to empty set; extraction-readiness rule deleted
- [x] `SANCTIONED_CONSTRUCTION_SITES` updated to remove stale `adws/providers/forgeProviders.ts` entry
- [x] Identity/construction rules updated to recognise imported names
- [x] `features/regression/**/feature-729.feature` path references updated
- [x] Living docs for extracted modules retired, `conditional_docs.md` entries removed
- [x] Full unit suite, typecheck, BDD regression green
- [x] `bun run lint:docs-index` green

## Operator gate — runbook step 7.4 is yours, not the agent's
This PR stays a **draft** until a human has done the following (ADW defers auto-merge for `hitl` issues):
- [ ] Run the full suite locally from this branch: `bun run test`, `bun run test:unit`, `bun run lint:git-guard`, `bun run lint:docs-index`, `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"`.
- [ ] Trigger one live smoke workflow (a trivial chore issue on a target repo) from this PR branch and confirm it completes through PR creation.
- [ ] Tag the pre-merge commit and push the tag: `git tag pre-gitcontext-switchover <sha of the dev tip you are merging onto>` then `git push origin pre-gitcontext-switchover`.
- Then mark the PR ready for review and approve.

## Rollback — runbook step 8
A broken switchover is recovered by **hand-reverting the merge commit on `dev` and on `main`**. ADW runs on the library the moment this lands and cannot repair its own switch; the `pre-gitcontext-switchover` tag marks the last known-good commit.

## Dependency pin and Dependabot
`"@paysdoc/devplatform": "1.1.0"` — exact, no range; `bun.lock` records the 1.1.0 tarball integrity. Version bumps are Dependabot's (runbook A2 = issue #841, still open — `.github/dependabot.yml` does not exist yet). Bump PRs are merged by hand and sit outside the issue-keyed pipeline; until #841 lands, a bump is a manual edit of the pin plus `bun install`.

## Content hash / upgrade gate
This PR does **not** change ADW's framework content hash and will **not** trip the upgrade gate for registered target repos. The hash covers only the three `hashInputs:` files declared in `.claude/commands/adw_init.md` (`adw_init.md`, `document.md`, `templates/vocabulary.md.template`); none of them changes on this branch. `bunx tsx adws/core/hashComputer.ts` prints `58ba295455740726331f43cb118c3c17a6f95d844c794cc6ab9b96cc97d203d0` on both this branch and `dev`, equal to `.adw-version`. The `.adw/conditional_docs.md` edit is this repo's own living-docs index, not a hash input. (The migration plan's note that `.adw/**` edits bump the hash was wrong.)

## `patchedDependencies` dist patch — read before approving
`package.json` carries `"patchedDependencies": { "@paysdoc/devplatform@1.1.0": "patches/@paysdoc%2Fdevplatform@1.1.0.patch" }`; `bun install` applies the 118-line patch to the installed `dist/`. It backfills the port-shape additions ADW made in #844 that the published 1.1.0 predates: `Issue.createdAt`/`Issue.url` and `PullRequestRecord.updatedAt`/`PullRequestRecord.url` in `providers/types.d.ts`; the GitHub mapper emitting both; `fetchAllPRsCmd` requesting `updatedAt,url` from `gh pr list`; `JiraIssueTracker` taking `instanceUrl` in its constructor and mapping `fields.created` plus a `/browse/<key>` URL. ADW reads these fields in the plan/scenario/build agent prompts and in the HITL notifier's "newest open PR first" selection. The patch is **not upstreamed**: library `main` (v1.1.0 plus one `ci:` commit) still lacks the `Issue` fields and the Jira constructor change, and no `paysdoc/devplatform` issue exists for it. The patch is keyed to `@1.1.0`, so a bump to any other version silently stops applying it; `bunx tsc --noEmit` then fails on the missing fields — that typecheck is the tripwire, and the patch must be dropped once a library release carries the fields.

## Expected-red per-issue scenarios (not a regression)
`features/per-issue/feature-816.feature`, `feature-819.feature` and `feature-823.feature` are the frozen records of their issues and describe guard behaviour this PR deletes (the extraction-readiness rule and its `EXTRACTION_SCOPE`, the two-entry exempt set, the two sanctioned construction sites, the in-tree `adws/providers/**` copy-out). Run by tag on this branch on 2026-09-23: `@adw-816` 34 scenarios — 15 failed / 1 undefined / 18 passed; `@adw-819` 79 scenarios — 22 failed / 1 undefined / 56 passed; `@adw-823` 50 scenarios — 28 failed / 3 undefined / 19 passed. They are in neither CI (`regression.yml` runs `@regression` only) nor the acceptance criteria, and the 14-day per-issue sweep retires them. Their step-definition files load cleanly (repointed at the library), which is why the `@regression` run does not fail at load.

## Behaviour deltas stated, not hidden
- `createForgeCredentials` decides "GitHub App configured" once at boundary construction; the old in-tree `createLaunchTokenProvider` re-read `GITHUB_APP_*` per command.
- The bootstrap git identity is derived from the same env-read App config the token provider uses; the in-tree resolver read the env itself. Both are the issue body's mandated shape.

## Branch state
Cut from `dev` at `1ec1295c`; `dev` has since gained #842 (five runbook-only commits to `specs/runbooks/gitcontext-extraction.md`); `git merge-tree --write-tree origin/dev HEAD` reports no conflict.

Known docs-only residue (no code): `.adw/project.md` Relevant Files still lists `adws/github/**` and `adws/providers/**`; the `GitContext` row of `UBIQUITOUS_LANGUAGE.md` still says `adws/gitContext/`; `app_docs/feature-oqb76h-gitcontext-base-path-authority.md` keeps several narrative bullets about the in-tree core package, the extraction-readiness rule and the two-entry exempt set; `.adw/conditional_docs.md` line 282 still points the GitHub payload types at `adws/providers/github/domain/`. Follow-up material, not blockers.

## Validation evidence (this branch, 2026-09-23)
| Check | Result |
|---|---|
| `bunx tsc --noEmit` and `bunx tsc --noEmit -p adws/tsconfig.json` | both exit 0 |
| `bun run lint` | exit 0 on the committed tree |
| `bun run test:unit` | 144 files, 2313 tests, 0 failed |
| `bun run lint:git-guard` | 272 files scanned, exempt packages: none, 1 sanctioned site (`adws/core/launchGitContext.ts`), no extraction-readiness section, PASS |
| `bun run lint:docs-index` | 46 entries / 44 docs; no dangling entry, no orphan doc, no overlapping `Owns:` glob, count in [25, 60] |
| `cucumber-js --tags "@regression"` | 53 scenarios: 11 passed, 42 pending, 0 failed |
| `test ! -d adws/gitContext && test ! -d adws/providers` | directories gone |
| relative imports resolving into either deleted directory | none (the spec's looser grep prints one line, `./gitContextSharedWorld.ts`, a per-issue test helper whose file name merely contains `gitContext`) |
```

### Step 3: Push the body to the PR, leaving everything else untouched
- `gh pr edit 843 -R paysdoc/AI_Dev_Workflow --body-file /tmp/adw-q7t0yb-pr-843-body.md`
- Do **not** pass `--title`, `--add-label`, or run `gh pr ready`; the draft state, title and (empty) label set stay as they are.

### Step 4: Verify the body on GitHub
- `gh pr view 843 -R paysdoc/AI_Dev_Workflow --json isDraft,state,baseRefName --jq '[.isDraft,.state,.baseRefName]'` → `[true,"OPEN","dev"]`.
- `gh pr view 843 -R paysdoc/AI_Dev_Workflow --json body --jq .body > /tmp/adw-q7t0yb-pr-843-body.check.md`, then run the greps listed under Validation against that file.

### Step 5: Commit only this plan
- `git status --short` must show the staged deletion of `app_docs/feature-9gjajh-providers.md` (issue #1), the two `specs/patch/…q7t0yb…` plan files and nothing else — no `scratch-*.mjs`, no `.swp`.
- The commit (the pipeline's `git add -A` commit step) therefore contains only patch plans plus the issue #1 deletion. The PR body lives on GitHub and is not a tracked file.

## Validation
Execute every command to validate the patch is complete with zero regressions.

- `git status --short | grep -E 'scratch-.*\.mjs|\.swp$'` — prints nothing (scratch scripts moved out, swap file excluded locally).
- `bun run lint` — exit 0 (the only errors were in the moved scratch scripts).
- `bun run lint:git-guard && bun run lint:docs-index && bunx tsc --noEmit && bunx tsc --noEmit -p adws/tsconfig.json` — all exit 0 (guard: empty exempt set, one sanctioned site, PASS; docs-index: all checks pass).
- `bun run test:unit` — 0 failures (144 files, 2313 tests at plan time; ~5 s) and `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — 0 failed (53 scenarios, 11 passed / 42 pending at plan time; ~4 s).
- PR-body assertions on `F=/tmp/adw-q7t0yb-pr-843-body.check.md` (fetched in Step 4):
  - `gh pr view 843 -R paysdoc/AI_Dev_Workflow --json isDraft --jq .isDraft` → `true`
  - `grep -c 'BLOCKED at spec Step 1' $F` → `0`; `grep -ciE '(^|[^a-z])(closes|closed|close|fixes|fixed|fix|resolves|resolved|resolve) ([[:alnum:]._/-]+)?#[0-9]+' $F` → `0`
  - `grep -c '^Implements #840' $F` → `1`
  - `grep -c '^- \[x\]' $F` → `13` and `grep -c '^- \[ \]' $F` → `3` (only the three operator-gate items are unticked)
  - each of these greps → at least `1`: `grep -c 'pre-gitcontext-switchover' $F`; `grep -c 'hand-reverting the merge commit' $F`; `grep -c '"1.1.0"' $F`; `grep -c '#841' $F`; `grep -c '58ba295455740726331f43cb118c3c17a6f95d844c794cc6ab9b96cc97d203d0' $F`; `grep -c 'patchedDependencies' $F`; `grep -c '@adw-816' $F`; `grep -c '@adw-819' $F`; `grep -c '@adw-823' $F`

## Patch Scope
**Lines of code to change:** 0 source lines. ~130 lines of PR body replaced on GitHub; two untracked scratch scripts moved out of the tree; one line appended to the local, unversioned git exclude file; this plan file added.
**Risk level:** low — no repo source, test, config or doc changes; the PR stays a draft with no closing keyword, so nothing can auto-merge or auto-close #840.
**Testing required:** the PR-body assertions above (draft state, no BLOCKED preamble, no closing keyword, `Implements #840`, 13 ticked items, every Step 13 / dist-patch / expected-red marker present) plus the fast local gates (`lint`, `lint:git-guard`, `lint:docs-index`, both typechecks, unit suite, `@regression`) to confirm the numbers the body cites still hold.

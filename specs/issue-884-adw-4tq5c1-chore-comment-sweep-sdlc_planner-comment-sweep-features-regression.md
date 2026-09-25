# Chore: Comment sweep 16/16 — features/regression

## Metadata
issueNumber: `884`
adwId: `4tq5c1-chore-comment-sweep`
issueJson: `{"number":884,"title":"chore: comment sweep 16/16 — features/regression","body":"Sweep batch 16 of 16: features/regression (51 files, 527 comment lines at filing time). Apply the deletion rules from specs/prd/comment-debloat.md › Implementation Decisions › Deletion rules per comment kind to exactly the files listed under Touched Files. Comment-only diff. Verify with bun run lint:comment-only <every file in Touched Files>. Blocked by #853.","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-09-24T08:18:12Z"}`

## Chore Description
Final batch of the comment de-bloat sweep (parent PRD `specs/prd/comment-debloat.md`). Apply the PRD's per-kind deletion rules to the 51 files under `features/regression/` listed in the issue's Touched Files, and touch nothing else.

The only permitted diff is in comments and the blank lines they leave behind. Code, Gherkin keywords, step text, tags, Feature description prose, and DocStrings must stay byte-identical once trivia is stripped. The comment-only guard (`bun run lint:comment-only`, shipped by #853 in `adws/checkCommentOnly.ts`) proves this. It compares each file against the base ref it resolves itself (`origin/dev`). For `.ts` it compares the TypeScript token stream without trivia. For `.feature` it compares the trimmed non-blank lines, ignoring lines whose first non-whitespace character is `#`.

Rules applied:
- Delete section banners (`// ----…` blocks and `# ── … ──` / `# ════…` lines).
- Delete JSDoc that only restates the name of the field or function it sits on.
- Delete inline comments that narrate the next statement.
- Strip issue-number tags (`Issue #1`, `Issue #2`, `feature-530`, `#685`). Keep the rest only if it still carries rationale.
- Trim mixed comments to the sentences stating an invariant, an ordering constraint, or the reason for a non-obvious choice.
- Keep shebangs and every `eslint-disable*` directive unchanged. Each directive stays directly above the line it governs.
- Feature files: delete every `#` comment line. This batch keeps none of the optional "one short line under `Feature:`", because every Feature title here is self-explanatory.
- Delete stale cross-references too. Examples: `feature-509.steps.ts` and `feature-504.steps.ts` no longer exist, and the "Initialise as a bare git repo" comment is wrong because `git init` there is not `--bare`. Comments that no longer match the code break the guideline's "comment only what the code cannot say".

## Relevant Files
Use these files to resolve the chore:

- `README.md`: project overview (read at start of research).
- `.adw/coding_guidelines.md`: **Comments** rule. Comment only invariants, ordering constraints, and non-obvious reasons. No next-line narration, no banners, no issue numbers, no name-restating JSDoc.
- `specs/prd/comment-debloat.md`: *Implementation Decisions › Deletion rules per comment kind*, the source of the rules above.
- `adws/checkCommentOnly.ts`: the comment-only guard used for validation. Its `normalizeFeature` shows that a description-prose line starting with `#` counts as a comment (lines 68 and 98 of `feature-729.feature`, see below).
- `app_docs/feature-m363ky-comment-only-guard.md`: conditional doc for the comment-only guard. It applies because this chore is validated by a sweep-batch guard pass.
- `app_docs/feature-9gjajh-bdd-regression-suite.md`: conditional doc that owns `features/regression/**`. Background only; no doc change is required.

Touched Files (the only files that may change):

Feature files: delete `#` lines.
- `features/regression/hashing/feature-537.feature`: delete the 8 `# ── §N … ──` banner lines (95, 108, 126, 143, 151, 163, 179, 188).
- `features/regression/multilang/python_fixture_e2e.feature`: has no `#` lines. **No change.** It must still pass the guard.
- `features/regression/smoke/adw_chore_diff_verdicts.feature`: delete lines 4–6.
- `features/regression/smoke/adw_sdlc_happy_path.feature`: delete lines 4–7.
- `features/regression/smoke/cancel_directive.feature`: delete lines 4–11 (Smoke 4 blurb + DEFERRED-VOCAB-GAP notes).
- `features/regression/smoke/cron_trigger_spawn.feature`: delete lines 4–10.
- `features/regression/smoke/pause_resume_rate_limit.feature`: delete lines 4–12.
- `features/regression/smoke/promotion_threshold_auto_ramp.feature`: delete lines 4–14 (including the bare `#` separator lines).
- `features/regression/surfaces/row-01 … row-31, row-33, row-34, row-35` (33 files): delete the single `# Row N: …` line at line 4.
- `features/regression/surfaces/row-32-adwBuild-orchestratorLock-re-entry-edge.feature`: delete lines 4–8 (Row 32 + DEFERRED-VOCAB-GAP block).
- `features/regression/upgrade/feature-729.feature`: delete the §1 banner block (lines 140–150) and the §2 banner block (lines 161–170). Also delete lines 68 and 98. These are Feature-description prose lines that happen to start with `#685`, so Gherkin and the guard both parse them as comments. Do **not** edit any other description prose line: prose is content to the guard, so re-wrapping the sentence around line 98 would fail it.

TypeScript step definitions and support:
- `features/regression/step_definitions/world.ts`: delete the file-header JSDoc (1–9). Delete the name-restating field JSDoc: `lastExitCode`, `targetBranch`, `pythonFixture`, `scenarioProofResult`, `proofDir`, `capturedProofComment`, and `getRecordedRequests` ("Convenience: …"). Trim the rest:
  - `mockContext` → `/** Set in the @regression Before hook. */`
  - `prsByBranch` → `/** Lets phase-import When steps resolve a branch to its PR without the gh CLI, which the GitHub API mock cannot serve (no PR-list route). */` (drop "(G21)" and the "feature-530" sentence)
  - `harnessEnv` → `/** Env vars overlaid on process.env for subprocess invocations. */`
  - Keep `worktreePaths` `/** adwId → temp worktree directory path. */` unchanged; the key meaning is not in the name.
- `features/regression/support/hooks.ts`: has no comments. **No change.**
- `features/regression/step_definitions/feature-537.steps.ts`: delete the file-header JSDoc (1–13). It restates the file name and has a stale cross-reference (`feature-504.steps.ts` no longer exists) plus fixture narration. Delete all 7 `// ----` banner blocks (23–25, 41–43, 72–74, 90–92, 122–124, 143–145, 199–201). Keep `// best-effort` inside the empty `catch` (the reason the error is swallowed).
- `features/regression/step_definitions/feature-729.steps.ts`: delete the file-header JSDoc (1–10) and all 6 `// ----` banner blocks (21–23, 29–31, 60–62, 77–79, 131–133, 151–153). Trim lines 93–94 to `// frameworkRepoRoot is the ADW checkout, which holds the real command file to copy.` Delete line 116 (narration).
- `features/regression/step_definitions/pythonFixtureE2ESteps.ts`: delete the file-header JSDoc (1–15). It narrates the pipeline and wrongly says the @regression hooks set `REAL_GIT_PATH`. Delete all 9 `// ----` banner blocks (38–40, 55–57, 66–68, 92–94, 106–108, 121–123, 136–138, 152–154, 182–184).
- `features/regression/step_definitions/givenSteps.ts`:
  - Replace the file-header JSDoc (1–8) with the one invariant it carries: `// All steps are side-effect-free with respect to source files in adws/.`
  - Delete all 17 `// ----` banner blocks (23–25, 39–41, 52–54, 67–69, 92–94, 109–111, 133–135, 148–150, 164–166, 179–181, 202–204, 219–221, 258–260, 275–277, 293–295, 310–312, 328–330).
  - Keep line 31 (mock handles comment POSTs by default); delete line 32.
  - Delete lines 47–48, 99–100, 105, and 141 (narration).
  - Trim lines 155–156 to `// Recording is enabled by default on the mock server.`
  - Keep line 210 (why no state is seeded).
  - Delete lines 216–217 (stale pointer to the removed `feature-509.steps.ts`).
  - Delete line 339 (narration, and inaccurate because the repo is not bare).
- `features/regression/step_definitions/whenSteps.ts`:
  - Delete the file-header JSDoc (1–7).
  - Delete the name-restating JSDoc on `buildSubprocessEnv` (line 20) and `spawnOrchestrator` (line 28). The `// eslint-disable-next-line` on line 29 must stay directly above `function spawnOrchestrator(`.
  - Delete all 13 `// ----` banner blocks (48–50, 67–69, 91–93, 114–116, 135–137, 156–158, 177–179, 198–200, 219–221, 240–242, 261–263, 290–292, 316–318).
  - Keep line 74.
  - Trim lines 268–269 to `// Per-issue (source-inspection) scenarios: mockContext is null → no-op.` so it matches line 74.
  - Keep all four `eslint-disable-next-line` directives (13, 29, 52, 320).
  - Keep every `// ISSUE-3-CUTOVER: …` note and every `/* … */` commented-out body verbatim, including the `//` lines inside those bodies. They are preserved code plus the reason and removal condition for the `return 'pending'` stubs. The eslint-disabled helpers exist only for them.
- `features/regression/step_definitions/thenSteps.ts`:
  - Delete the file-header JSDoc (1–12). It restates the file's role, and its "do NOT read source files from adws/" claim is false for the null-`mockContext` branches of T1 and T5.
  - Delete all 21 `// ----` banner blocks (25–27, 65–67, 85–87, 113–115, 135–137, 159–161, 181–183, 200–202, 225–227, 251–253, 267–269, 294–296, 322–324, 348–350, 365–367, 389–391, 415–417, 441–443, 468–470, 493–495).
  - Keep lines 32 and 142 (why the null-`mockContext` branch exists).
  - T4: replace lines 120–123 with `// Local commits pass through to real git, so this step checks branch-name agreement only; T5 asserts the exit code.` Delete lines 129–131 (Issue #1 / Issue #2 history).
  - T6: trim lines 166–168 to `// The lock path mirrors orchestratorLock.ts; the lock is a runtime artefact, not a source file.`
  - Delete lines 325–327 (history of the removed `feature-509.steps.ts`) and 344–346 (stale pointer to that file).
  - T11: replace lines 500–502 with `// The git-remote-mock's invocation log is not readable here yet, so this step checks branch-name agreement only.`

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### 1. Confirm the baseline
- Run `git status --short` and confirm none of the 51 Touched Files already has changes. Leave the pre-existing unrelated changes (`.claude/commands/scenario_writer.md`, `README.md`) alone: do not stage, revert, or edit them.
- Line numbers in this plan refer to the files as they are on `origin/dev`. Edit bottom-up within each file, or re-locate by content, so earlier deletions do not shift later targets.

### 2. Sweep the feature files
- Apply the per-file `#`-line deletions listed under Relevant Files for `hashing/feature-537.feature`, the six `smoke/*.feature` files, all 34 `surfaces/row-*.feature` files, and `upgrade/feature-729.feature`.
- After each deletion, collapse any run of two or more blank lines into one. In the surface and smoke files, the `Scenario:`/`Background:` line should follow the `Feature:` line after one blank line (or directly, if it did so before).
- In `feature-729.feature`, delete only lines 68 and 98 within the description block. Do not re-wrap or otherwise change neighbouring prose.
- Leave `multilang/python_fixture_e2e.feature` untouched.
- Check: `grep -n '^\s*#' <each touched .feature>` prints nothing.

### 3. Sweep `world.ts`
- Apply the `world.ts` edits listed under Relevant Files. Leave `hooks.ts` untouched.

### 4. Sweep `feature-537.steps.ts`, `feature-729.steps.ts`, `pythonFixtureE2ESteps.ts`
- Apply the header, banner, and trim edits listed under Relevant Files. Leave one blank line between top-level statements and none at the start of the file.

### 5. Sweep `givenSteps.ts`
- Apply the edits listed under Relevant Files. The first line of the file becomes the one-line invariant comment, followed by a blank line and the imports.

### 6. Sweep `whenSteps.ts`
- Apply the edits listed under Relevant Files.
- Check that each `// eslint-disable-next-line @typescript-eslint/no-unused-vars` still sits directly above the line it governs: the `assert` import, `function spawnOrchestrator(`, `const ORCHESTRATOR_FILES`, and `function buildMockedWorkflowConfig(`.
- Check that every `ISSUE-3-CUTOVER` note and `/* … */` body is byte-identical to before.

### 7. Sweep `thenSteps.ts`
- Apply the edits listed under Relevant Files.

### 8. Self-review against the acceptance criteria
- `grep -nE '^\s*//\s*-{5,}|^\s*#\s*(─|═)' features/regression/step_definitions/*.ts features/regression/**/*.feature` prints nothing for the listed files.
- `grep -nE '#[0-9]+|[Ii]ssue #' features/regression/step_definitions/{feature-537.steps,feature-729.steps,givenSteps,pythonFixtureE2ESteps,thenSteps,whenSteps,world}.ts` finds no comment hits. Hits inside string literals or code are not comments and are out of scope.
- Read every surviving comment in the TS files and confirm it states an invariant, an ordering constraint, or a reason.
- `git diff --stat` lists only files from Touched Files, plus this plan in `specs/`.

### 9. Run the validation commands
- Run every command in `Validation Commands` and confirm each passes.

## Validation Commands
Execute every command to validate the chore is complete with zero regressions.

- `bun run lint:comment-only features/regression/hashing/feature-537.feature features/regression/multilang/python_fixture_e2e.feature features/regression/smoke/adw_chore_diff_verdicts.feature features/regression/smoke/adw_sdlc_happy_path.feature features/regression/smoke/cancel_directive.feature features/regression/smoke/cron_trigger_spawn.feature features/regression/smoke/pause_resume_rate_limit.feature features/regression/smoke/promotion_threshold_auto_ramp.feature features/regression/step_definitions/feature-537.steps.ts features/regression/step_definitions/feature-729.steps.ts features/regression/step_definitions/givenSteps.ts features/regression/step_definitions/pythonFixtureE2ESteps.ts features/regression/step_definitions/thenSteps.ts features/regression/step_definitions/whenSteps.ts features/regression/step_definitions/world.ts features/regression/support/hooks.ts features/regression/surfaces/row-01-adwPlan-workflowInit-happy.feature features/regression/surfaces/row-02-adwPlan-planPhase-happy.feature features/regression/surfaces/row-03-adwPlan-planPhase-error-stub-failure.feature features/regression/surfaces/row-04-adwBuild-buildPhase-happy.feature features/regression/surfaces/row-05-adwBuild-buildPhase-edge-missing-lock.feature features/regression/surfaces/row-06-adwBuild-unitTestPhase-happy.feature features/regression/surfaces/row-07-adwReview-reviewPhase-happy.feature features/regression/surfaces/row-08-adwReview-reviewPhase-error-review-rejected.feature features/regression/surfaces/row-09-adwReview-diffEvaluationPhase-happy.feature features/regression/surfaces/row-10-adwMerge-autoMergePhase-happy.feature features/regression/surfaces/row-11-adwMerge-autoMergePhase-edge-pr-not-merged.feature features/regression/surfaces/row-12-adwMerge-prPhase-happy.feature features/regression/surfaces/row-13-adwChore-workflowInit-planPhase-happy.feature features/regression/surfaces/row-14-adwChore-buildPhase-happy.feature features/regression/surfaces/row-15-adwChore-reviewPhase-happy.feature features/regression/surfaces/row-16-adwPatch-planPhase-happy.feature features/regression/surfaces/row-17-adwPatch-buildPhase-happy.feature features/regression/surfaces/row-18-adwInit-installPhase-happy.feature features/regression/surfaces/row-19-adwInit-workflowInit-edge-already-initialised.feature features/regression/surfaces/row-20-adwTest-unitTestPhase-happy.feature features/regression/surfaces/row-21-adwTest-scenarioTestPhase-happy.feature features/regression/surfaces/row-22-adwTest-scenarioProof-happy.feature features/regression/surfaces/row-23-adwTest-scenarioFixPhase-error.feature features/regression/surfaces/row-24-adwPrReview-prReviewPlanPhase-happy.feature features/regression/surfaces/row-25-adwPrReview-prReviewBuildPhase-happy.feature features/regression/surfaces/row-26-adwPrReview-commitPushPhase-happy.feature features/regression/surfaces/row-27-adwDocument-documentPhase-happy.feature features/regression/surfaces/row-29-adwSdlc-cronProbe-edge-empty-queue.feature features/regression/surfaces/row-30-adwSdlc-cronProbe-happy-dispatch.feature features/regression/surfaces/row-31-adwPlan-orchestratorLock-acquired-happy.feature features/regression/surfaces/row-32-adwBuild-orchestratorLock-re-entry-edge.feature features/regression/surfaces/row-33-adwReview-planValidationPhase-happy.feature features/regression/surfaces/row-34-adwReview-alignmentPhase-happy.feature features/regression/surfaces/row-35-adwMerge-depauditSetup-happy.feature features/regression/upgrade/feature-729.feature`: must print `PASS` for all 51 files against `origin/dev`.
- `for f in $(git diff --name-only -- 'features/regression/*.feature'); do grep -Hn '^\s*#' "$f"; done`: must print nothing.
- `bun run lint`: ESLint passes. This confirms the `eslint-disable-next-line` directives in `whenSteps.ts` still govern the right lines.
- `bun run test`: typecheck (`bunx tsc --noEmit`) passes.
- `bunx tsc --noEmit -p adws/tsconfig.json`: additional typecheck passes.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --dry-run --tags "@regression"`: Cucumber still parses every regression feature and resolves every step (no undefined or ambiguous steps). A comment-only change cannot alter behaviour, so a dry run is enough.
- `git diff --name-only`: lists only paths from Touched Files (plus the plan in `specs/` and the pre-existing unrelated changes noted in Step 1).

## Notes
- Strictly follow `.adw/coding_guidelines.md` › **Comments**. No code refactors in this batch; any code change fails the guard and the issue's "comment-only" contract.
- `feature-729.feature` lines 68 and 98 are ordinary description prose that begins with `#685`, which Gherkin treats as a comment. Deleting line 98 leaves the sentence around it reading slightly unevenly. That is accepted: fixing it would mean editing non-comment prose, which the guard forbids and this issue scopes out.
- `whenSteps.ts` `ISSUE-3-CUTOVER` markers are intentionally kept. They are a named cutover marker, not an issue-number tag like `(#794)`, and they state why the dead bodies are preserved and when to remove them. The only other reference to the marker, in `promotion_threshold_auto_ramp.feature`, is deleted in this batch.
- The DEFERRED-VOCAB-GAP notes in the smoke and row-32 feature files are deleted under the feature-file rule. The gaps they describe show in the steps themselves: the scenarios only assert pre-seeded state.
- A hook-generated `features/regression/logs/` directory may appear during the run. It is not a Touched File and must not be committed.
- The per-issue scenario for this issue, written by the scenario agent, must assert exactly one behaviour: the comment-only guard passes for the listed files against the default branch. It must not name the base ref.

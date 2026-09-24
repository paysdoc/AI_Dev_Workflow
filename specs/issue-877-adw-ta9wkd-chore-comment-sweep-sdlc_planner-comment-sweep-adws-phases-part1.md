# Chore: Comment sweep 9/16 — adws/phases (1/2)

## Metadata
issueNumber: `877`
adwId: `ta9wkd-chore-comment-sweep`
issueJson: `{"number":877,"title":"chore: comment sweep 9/16 — adws/phases (1/2)","body":"## Parent PRD\n\n`specs/prd/comment-debloat.md`\n\n## What to build\n\nSweep batch 9 of 16: **adws/phases (1/2)** (30 files, 585 comment lines at filing time).\n\nApply the deletion rules from the PRD's *Implementation Decisions › Deletion rules per comment kind* to exactly the files listed under Touched Files. Do not touch any file outside that list. Do not change any code: the only permitted diff is in comments (and the blank lines left behind).\n\nRules for this batch:\n\n- Delete section banner comments (lines of dashes or box-drawing characters).\n- Delete JSDoc blocks that only restate the name of the field or function they sit on.\n- Delete inline comments that narrate the statement directly below them.\n- Strip issue-number tags such as `(#794)` or `(issue #762)` from comments; keep the rest of the comment only if it still carries rationale.\n- Trim mixed comments to the sentences that state an invariant, an ordering constraint, or the reason for a non-obvious choice. Drop the narration sentences.\n- Keep shebang lines and `eslint-disable` directives unchanged.\n\nVerify with the comment-only guard shipped by the blocking issue:\n\n```\nbun run lint:comment-only <every file in Touched Files>\n```\n\n## Acceptance criteria\n\n- [ ] The comment-only guard passes for every file in Touched Files against the default branch (resolved by the guard, never named in the scenario).\n- [ ] No banner comments, name-restating JSDoc, next-line narration, or issue-number tags remain in the listed files.\n- [ ] Every surviving comment states an invariant, an ordering constraint, or the reason for a non-obvious choice.\n\n- [ ] `bun run test` (typecheck) passes.\n- [ ] The per-issue scenario for this issue asserts exactly one behaviour: the comment-only guard passes for the listed files against the default branch.\n\n## Blocked by\n\n- Blocked by #853\n\n## Touched Files\n\n- adws/phases/__tests__/branchNameResolution.test.ts\n- adws/phases/__tests__/decidePostReviewOutcome.test.ts\n- adws/phases/__tests__/docsSelfCheck.test.ts\n- adws/phases/__tests__/planPhase.test.ts\n- adws/phases/__tests__/progressGate.test.ts\n- adws/phases/__tests__/reviewPhaseApprovalGate.test.ts\n- adws/phases/__tests__/rotAdvisoryFormat.test.ts\n- adws/phases/__tests__/scenarioTestPhase.test.ts\n- adws/phases/__tests__/upgradeGate.test.ts\n- adws/phases/alignmentPhase.ts\n- adws/phases/autoMergePhase.ts\n- adws/phases/decidePostReviewOutcome.ts\n- adws/phases/depauditSetup.ts\n- adws/phases/diffEvaluationPhase.ts\n- adws/phases/phaseCommentHelpers.ts\n- adws/phases/planPhase.ts\n- adws/phases/prPhase.ts\n- adws/phases/prReviewPhase.ts\n- adws/phases/progressGate.ts\n- adws/phases/promotionRotAdvisory.ts\n- adws/phases/reviewPatchHelpers.ts\n- adws/phases/reviewPhase.ts\n- adws/phases/rotAdvisoryFormat.ts\n- adws/phases/scenarioFixPhase.ts\n- adws/phases/scenarioTestFixLoop.ts\n- adws/phases/scenarioTestPhase.ts\n- adws/phases/stepDefPhase.ts\n- adws/phases/upgradeGate.ts\n- adws/phases/workflowInit.ts\n- adws/phases/workflowRepoIdentity.ts\n\n## User stories addressed\n\n- User stories 12–26\n","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-09-24T08:18:05Z","comments":[],"actionableComment":null}`

## Chore Description
Batch 9 of the comment de-bloat sweep defined in `specs/prd/comment-debloat.md`. Apply the PRD's per-kind deletion rules to exactly the 30 files under `adws/phases/` listed in the issue's Touched Files. The only permitted diff is inside comments (plus the blank lines their removal leaves behind). No code, no string/template-literal content, and no file outside the list may change.

Deletion rules (from the PRD and the `Comments` bullet in `.adw/coding_guidelines.md`):
- **Banners** (lines of dashes, `=`, or box-drawing chars such as `// ── Helpers ───…`, and numbered test-section labels that restate the `describe` name below them): delete.
- **Name-restating JSDoc** (including `@param` lines that only restate the parameter name or type): delete.
- **Next-line narration** (`// Step 3: Post plan_aligning stage comment`, `// Initialize workflow context`): delete.
- **Issue-number tags** (`(#794)`, `(issue #762)`, `(#640)`, `Simulates issue #712:`), plus the equivalent history pointers in this batch (`(existing invariant from 94059b5, unchanged)`, `See PRD user story 11.`, `(criterion 1 & 4)`): strip; keep the remainder only if it still carries rationale.
- **Mixed comments**: keep only the sentences stating an invariant, an ordering constraint, or the reason for a non-obvious choice. Keep surviving sentences verbatim (the PRD puts prose rewriting out of scope); only re-wrap lines where a dropped sentence shares a physical line with a kept one, or drop a leading `- ` bullet marker when a single bullet survives.
- **Stale claims**: `Uses \`config.repoInfo\` for external repository API calls when targeting a different repo.` (planPhase, prPhase, prReviewPhase ×2) is false — `WorkflowConfig`/`PRReviewWorkflowConfig` have no `repoInfo` field (verified by grep) — so it is pure noise; delete.
- Shebangs / `eslint-disable` directives: none exist in these files (verified by grep); nothing to preserve beyond the rule.

Baseline measured at planning time: ~570 comment-marker lines across the 30 files. Five files contain zero comments (`__tests__/decidePostReviewOutcome.test.ts`, `__tests__/docsSelfCheck.test.ts`, `__tests__/planPhase.test.ts`, `__tests__/rotAdvisoryFormat.test.ts`, `depauditSetup.ts`), and three more carry only comments that already meet the bar (`__tests__/progressGate.test.ts`, `__tests__/reviewPhaseApprovalGate.test.ts`, `reviewPatchHelpers.ts`). All eight stay byte-identical; they are still passed to the guard, which reports them unchanged.

## Relevant Files
Use these files to resolve the chore:

- `specs/prd/comment-debloat.md` — parent PRD; *Implementation Decisions › Deletion rules per comment kind* is the rule source.
- `.adw/coding_guidelines.md` — the `Comments` bullet under *Process & Tooling* is the standard every surviving comment must meet.
- `adws/checkCommentOnly.ts` — the comment-only guard (`bun run lint:comment-only [--base <ref>] <files...>`). It compares the TS token stream with comments, whitespace, and JSDoc trivia dropped; any token change (including inside a string or template literal) fails the file as `code-changed`.
- `app_docs/feature-m363ky-comment-only-guard.md` — conditional doc for the guard (troubleshooting `code-changed` reports).
- `app_docs/feature-9gjajh-workflow-lifecycle-phases.md` — conditional doc owning `workflowInit.ts`, `upgradeGate.ts`, `progressGate.ts`, `depauditSetup.ts`, `phaseCommentHelpers.ts`, `workflowRepoIdentity.ts` (context for which comments are real invariants: launch-boundary ordering, upgrade-gate remote read, repo-identity precedence).
- `app_docs/feature-9gjajh-pr-and-merge-phases.md` — conditional doc for `decidePostReviewOutcome.ts`, `prPhase.ts`, `prReviewPhase.ts`, `autoMergePhase.ts`.
- `app_docs/feature-9gjajh-test-and-scenario-phases.md` — conditional doc for `scenarioTestPhase.ts`, `scenarioTestFixLoop.ts`, `scenarioFixPhase.ts`, `stepDefPhase.ts`.
- `app_docs/feature-9gjajh-build-and-plan-phases.md` — conditional doc for `planPhase.ts`, `alignmentPhase.ts`, `__tests__/planPhase.test.ts`.
- `app_docs/feature-9gjajh-review-and-diff-phases.md` — conditional doc for `reviewPhase.ts`, `diffEvaluationPhase.ts`, `reviewPatchHelpers.ts`.
- `app_docs/feature-9gjajh-promotion-system.md` — conditional doc for `promotionRotAdvisory.ts`, `rotAdvisoryFormat.ts`.

The 30 touched files (the only files that may change):
- `adws/phases/__tests__/branchNameResolution.test.ts`, `decidePostReviewOutcome.test.ts`, `docsSelfCheck.test.ts`, `planPhase.test.ts`, `progressGate.test.ts`, `reviewPhaseApprovalGate.test.ts`, `rotAdvisoryFormat.test.ts`, `scenarioTestPhase.test.ts`, `upgradeGate.test.ts`
- `adws/phases/alignmentPhase.ts`, `autoMergePhase.ts`, `decidePostReviewOutcome.ts`, `depauditSetup.ts`, `diffEvaluationPhase.ts`, `phaseCommentHelpers.ts`, `planPhase.ts`, `prPhase.ts`, `prReviewPhase.ts`, `progressGate.ts`, `promotionRotAdvisory.ts`, `reviewPatchHelpers.ts`, `reviewPhase.ts`, `rotAdvisoryFormat.ts`, `scenarioFixPhase.ts`, `scenarioTestFixLoop.ts`, `scenarioTestPhase.ts`, `stepDefPhase.ts`, `upgradeGate.ts`, `workflowInit.ts`, `workflowRepoIdentity.ts`

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

Line numbers below refer to the files as they are on the default branch (`origin/dev` = `4f61e579`) at planning time. Work each file bottom-up, or re-locate by text, so earlier deletions don't shift later line numbers. "Delete" means remove the whole comment (all lines of a JSDoc block). "Keep" means leave the listed lines verbatim. When a JSDoc block keeps only some lines, drop the others and keep the `/** … */` wrapper (collapse to a one-line `/** … */` when a single short sentence survives). After removing a comment, leave no doubled blank lines and no blank line directly after an opening `{`; when a whole module header is deleted, the file starts at its first `import`.

### 1. Guardrails before editing
- Do not touch any file outside the 30 listed. `README.md` shows as modified in the worktree from outside this chore — do not stage or edit it.
- Never edit string or template-literal content. `workflowInit.ts` `log(\`Issue: #${issueNumber}\`)`, `upgradeGate.ts` `'…no #UPG issue found yet…'`, and the `describe(...)` titles in `branchNameResolution.test.ts` that contain `(criterion 1)` / `(criterion 4)` / `(resolver-level criterion 3)` are strings, not comments — leave them.
- `upgradeGate.ts` line 67's `- #<upgNumber>` is a template placeholder, not an issue tag.

### 2. `adws/phases/workflowInit.ts`
- Delete: 1–4 (module header), 56–59 (`WorkflowConfig` JSDoc), 112–122 (`initializeWorkflow` JSDoc: narration + name-restating `@param`s), 129 (`// Pre-flight: …` — the log/error strings say it), 140, 157 (restates the thrown error message), 180, 210–211, 274, 282, 332, 340, 382, 389, 418, 438, 446, 450.
- Keep unchanged: 53 (re-export reason), 80, 82, 84–86 (why `gitContext` is optional), 143–145 (exactly-one boundary / sole identity source), 164–171 (ordering: workspace clone before any `boundary.providers` touch), 185, 188, 237, 240 (each states an "early" ordering reason), 200–203, 233 (empty-catch reason), 289, 335–336, 347, 363 (fire-and-forget is the non-obvious choice), 392.
- Lines 90–98 (`resolveWorkflowProviders`): drop the first sentence `Resolves the provider set a workflow's RepoContext must use.`; keep from `The boundary is the only source: …` through line 96 and the `@throws` line (97).
- Lines 243–248: keep; delete the trailing `(existing invariant from 94059b5, unchanged)` so line 248 ends `… created inside\n  // targetRepoWorkspacePath.`
- Lines 314–316: keep; strip ` (#794)` so the sentence ends `… instead of resolving a second set.`
- Line 357: keep; strip ` (#530)` → `// Mirror the top-level write so both stores agree on branchName for new runs.`

### 3. `adws/phases/upgradeGate.ts`
- Header 1–10: keep only line 9 → `/** All I/O is injected via UpgradeGateDeps for unit testing. */` (lines 2–7 narrate the module; the dependency-injection reason is the only rationale).
- Delete banners: 21, 55, 93, 160. Delete 146 (`// Loser path` label).
- Keep unchanged: 26–27 (main clone, not a feature worktree), 38–39 (authoritative remote read), 109, 153 (empty-catch reasons), 171–175 (why the claim is pinned to the target worktree).
- Lines 29–30 (`defaultBranch`): drop `Remote default branch name (e.g. "main", "dev").`; keep `/** Used to read \`origin/<defaultBranch>:.adw-version\` as the authoritative stored version. */`.
- Lines 57–61 (`shouldTriggerUpgrade`): drop line 58; keep lines 59–60 (null triggers an upgrade — unifying first-bootstrap and out-of-date).
- Lines 66–71 (`addDependencyToBody`): keep lines 67–68 (idempotent insert; recognised headings); drop 69–70 (restate the function's branches).

### 4. `adws/phases/progressGate.ts`
- Keep unchanged: 1–5 (pure, no I/O, no mutation; caller owns git work), 16 (seeded with build-start hash; not mutated), 20, 47, 49 (link each field to its source constant), 76 (exhaustiveness guard).
- Delete: 7 (`Discriminated decision returned by …`), 14 (`HEAD tree hash …`), 18 (`Number of progress checkpoints …`), 43 (restates the `Extract<…>` type).
- Lines 24–30 (`evaluateProgressGate`): keep only the non-novel rule (lines 26–27) without the leading `- `: `Non-novel (returned to a prior state, or nothing committed → unchanged hash still in \`seen\`, including the build-start seed) → abort: no_progress.` Drop 25, 28, 29 (the body states them).
- Lines 53–57 (`describeProgressGateAbort`): drop the first sentence (`Maps a progress-gate abort reason … corrective action.`); keep `Pure: same inputs → same string; no I/O, no mutation.` and line 56.

### 5. `adws/phases/phaseCommentHelpers.ts`
- Delete: 1–7 (module header: narration + history).
- Lines 14–19 (`formatDenialNotice`): keep; strip ` (issue #762)` from line 15 → `Formats a denial-count notice for run reporting: a bad deny rule must read as "N denials", …`.
- Lines 26–32 (`postIssueStageComment`) and 50–56 (`postPRStageComment`): drop the first line (`Formats and posts …`); keep `Errors are caught and logged to prevent workflow crashes from comment failures.` and the `@param deniedToolCallCount` text with ` (issue #762)` removed → `@param deniedToolCallCount - Optional per-run permission-denied tool-call count. Appended as a denial notice when greater than 0; omitted otherwise.`

### 6. `adws/phases/workflowRepoIdentity.ts`
- Header 1–10: drop the first sentence (`Replaces every \`?? getRepoInfo()\` wrong-repo-fallback idiom … already carries (#820).` — history + tag); keep from `` `repoContext.repoId` → `gitContext` → `targetRepo`: all three sources agree by construction … `` through line 9.
- Lines 25–30 (`requireWorkflowGitContext`): drop line 26; keep lines 27–29 (`gitContext` optional only for phase-test fixtures).

### 7. `adws/phases/planPhase.ts`
- Delete: 1–3, 27–30 (narration + stale `config.repoInfo` claim), 39, 67, 122, 137, 161 (restates `MAX_CONTINUATION_OUTPUT_LENGTH`).
- Keep unchanged: 49 (branch already created in `initializeWorkflow` — why none is created here), 103 (ordering: correct naming before resolving), 106 (why re-resolve).
- Lines 164–171 (`buildContinuationPrompt`): drop line 165; keep both `@param` entries (166–170; they carry fallback and checkpoint semantics).
- Lines 230–237 (`buildResumeInPlacePrompt`): drop line 231 (contains `(#640)`); keep 232–236 (`Reuses the git-authoritative continuation framing … declared authoritative anyway.`).
- Lines 242–248 (`shouldResumeBuildInPlace`): drop the first sentence (`Returns true when … plain plan content.`); keep from `canResume is a sound, simple trigger: …` through line 247.

### 8. `adws/phases/alignmentPhase.ts`
- Delete: 1–8 (module header; its only rationale is repeated in the function JSDoc), 76, 97, 116, 121, 182, 198, 203 (`// Step N: …` narration).
- Lines 31–36: keep only `/** Never throws — unresolvable conflicts are warnings, not errors. */`.
- Lines 60–62: keep; drop the trailing `See PRD user story 11.`

### 9. `adws/phases/autoMergePhase.ts`
- Header 1–14: keep only lines 12–13 (`Failure is non-fatal: …`); delete the numbered phase list.
- Lines 28–31 (`extractPrNumber`): keep only `/** Returns 0 if the URL is absent or unparseable. */`.
- Lines 40–44: drop line 41; keep `Always returns successfully — merge failures are logged and commented but do not propagate as thrown errors.`
- Keep unchanged: 68–69 (silent `hitl` skip and the comment-flood reason).
- Delete: 78, 90, 97.

### 10. `adws/phases/decidePostReviewOutcome.ts`
- Keep: 6 (caller obligation).
- Lines 10–18: keep only line 13 (`Performs no I/O — total function over a boolean.`) and the caller obligation from line 17 (`SDLC callers must honour skipDocAndPR by exiting before doc+PR phases.`); drop 11–12 and 15–16 (restate the two-line body).

### 11. `adws/phases/diffEvaluationPhase.ts`
- Delete: 1–9 (module header; its fail-safe sentence is kept at line 77).
- Lines 26–29: keep only `/** Returns an empty string on error or when no context is available. */`.
- Lines 40–43: keep only `/** Errors are caught and logged to prevent workflow crashes from comment failures. */`.
- Lines 73–78: keep only `/** Defaults to 'regression_possible' on any agent error (fail-safe). */`.

### 12. `adws/phases/prPhase.ts`
- Delete: 1–5, 24–27 (narration + stale `config.repoInfo`), 77, 102.
- Keep: 35 (safety-net reason), 94 (ordering: transition once the PR is open).

### 13. `adws/phases/prReviewPhase.ts`
- Delete: 1–3, 19–21 (banner), 23–26, 35–41 (narration + name-restating `@param`s), 99, 105, 169–172, 249–252 (narration + stale `config.repoInfo`), 319–322 (narration + extraction history).
- Keep: 58–60 (resume vs trigger-seed invariant), 340 (ordering), 365 (backward-compat re-export reason).

### 14. `adws/phases/promotionRotAdvisory.ts`
- Header 1–20: drop line 2 (`Promotion rot/reuse advisory.`) and the first sentence on lines 4–6 (`On a \`regression-promotion\` PR, runs … as a single PR comment.`); keep from `Advisory only — it never blocks, gates, or crashes the workflow; …` (line 6) through line 19 (two-layer split reason, 300-line reason, must-run-after-`executePRPhase` ordering).
- Keep: 33 (feature id format example).
- Delete: 38, 40 (narrate the dep fields).
- Lines 45–55 (`runPromotionRotAdvisory`): drop lines 46–48; keep 50–54 (`Never throws. …`).
- Lines 75–80 (`executePromotionRotAdvisory`): drop 76–77; keep `Catch-total — always returns a valid zero/low-cost phase result and never rejects, regardless of outcome.`

### 15. `adws/phases/rotAdvisoryFormat.ts`
- Header 1–4: keep only `/** No I/O — same input always produces the same string. */`.
- Delete: 23–27 (narrates the formatter).

### 16. `adws/phases/reviewPhase.ts`
- Header 1–10: keep only `Does not run tests, start a dev server, navigate the application, or invoke prepare_app.` (from lines 6–7) and line 9 (`The patch+retest retry loop is orchestrator-level (see executeReviewPatchCycle).`), separated by a ` *` line; drop lines 2–6 up to `returns.`
- Keep unchanged: 32–34 (why the advisory is re-exported), 37, 46.
- Lines 49–53 (`issueHasHitlLabel`): drop `True when the issue currently carries \`hitl\`.`; keep from `A tracker that refuses the label read by name answers \`true\`: …` through line 52.
- Lines 63–69 (`approvePullRequestAfterReviewPass`): drop the first sentence (`Approves the pull request … on the issue.`); keep from `Mirrors adwChore's pre-approval: …` through line 68.
- Lines 87–97 (`executeReviewPhase`): keep `Returns immediately — retries are handled by the calling orchestrator via executeReviewPatchCycle.` and the `@param scenarioProofPath` entry (95–96); drop 88, the `Calls a single review agent …` sentence (90–91), and `@param config` (94).
- Lines 194–202 (`executeReviewPatchCycle`): keep only lines 197–199 (called on blockers; orchestrator then re-runs scenarioTestPhase and executeReviewPhase); drop 195 and 201.
- Delete: 259.

### 17. `adws/phases/reviewPatchHelpers.ts`
- Keep 84–85 unchanged (reviewer contract; defensive sequencing). No edit.

### 18. `adws/phases/scenarioFixPhase.ts`
- Header 1–9: keep only lines 7–8 (`Intended to be called inside an orchestrator-level retry loop:` / `scenarioTest → [scenarioFix → scenarioTest] × MAX_TEST_RETRY_ATTEMPTS`); drop 2–5.
- Delete: 27–33 (narration + name-restating `@param`s), 120.
- Keep: 63 (snapshot so edits can be reverted), 109 (Gherkin-freeze invariant).

### 19. `adws/phases/scenarioTestFixLoop.ts`
- Header 1–12: drop lines 2–5 (history: replaced inline loops) and line 7 (`Governance added over the old loops:`); keep the four invariant bullets (lines 8–11: hard-fail on exhaustion, Gherkin freeze, post-resolve fidelity re-check, `@regression` failure is not-green).
- Delete: 67, 130, 157 (narrate the branch below).

### 20. `adws/phases/scenarioTestPhase.ts`
- Header 1–11: keep only lines 8–10 (`This is a deep module — … are hidden inside.`); drop 2–6.
- Lines 41–48: drop 42–43; keep lines 45–47 (`Returns immediately with a passing result when:` and both skip conditions).
- Delete: 72 (narrates the guard).
- Keep: 147 (why proof is surfaced on ctx), 150 (why cost is 0).

### 21. `adws/phases/stepDefPhase.ts`
- Delete: 1–5 (module header; the non-fatal sentence is kept below).
- Lines 17–22: keep only `/** This phase is non-fatal — errors are caught and logged, never thrown. */`.

### 22. Test files
- `__tests__/branchNameResolution.test.ts`:
  - Header 1–6: drop lines 2–3; keep lines 4–5 (`Uses real AgentStateManager (atomic write path exercised) and vi.mock for the agent, following the conventions in topLevelState.test.ts and gitAgent.test.ts.`).
  - Delete: 115–117 (banner with `(criterion 1 & 4)` tag), 189 (narrates the next assertion), 235, 253, 270, 291, 314 (`// Case N: …` labels restate the `describe` titles below).
  - Keep: 176 (derivation of the expected literal), 308 (why the agent is not reached), 324–325 (what the side effect simulates).
- `__tests__/scenarioTestPhase.test.ts`: delete 3 (`vi.mock` is hoisted; ordering comment is narration), 118 (narrates the mock), and the six numbered banners 122–124, 146–148, 161–163, 202–204, 240–242, 276–278 (each restates the `describe` title below it).
- `__tests__/upgradeGate.test.ts`: delete banners 11, 46, 62, 101 and line 123 (narrates the mock). Lines 119–121: drop `Simulates issue #712: ` and keep the rest verbatim (starting `// a reused worktree has old .adw-version locally, …`).
- `__tests__/progressGate.test.ts`: keep 67–68. No edit.
- `__tests__/reviewPhaseApprovalGate.test.ts`: keep 62 (`null` vs `undefined` semantics). No edit.
- `__tests__/decidePostReviewOutcome.test.ts`, `__tests__/docsSelfCheck.test.ts`, `__tests__/planPhase.test.ts`, `__tests__/rotAdvisoryFormat.test.ts`, and `adws/phases/depauditSetup.ts`: no comments — no change.

### 23. Self-audit
- Grep the 30 files for leftover issue tags, commit-hash pointers, banners, and stale claims (see Validation Commands). Zero hits expected.
- Re-read every surviving comment and confirm it states an invariant, an ordering constraint, or a non-obvious reason. Delete any that only narrates.
- `git diff --stat` must list only files from the Touched Files list (plus this spec).

### 24. Run the Validation Commands
- Execute every command below; all must pass.
- If the guard reports `code-changed` for a file, `git diff origin/dev -- <file>`, find the non-comment edit, and restore it; do not "fix" by editing code.

## Validation Commands
Execute every command to validate the chore is complete with zero regressions.

- `bun run lint:comment-only adws/phases/__tests__/branchNameResolution.test.ts adws/phases/__tests__/decidePostReviewOutcome.test.ts adws/phases/__tests__/docsSelfCheck.test.ts adws/phases/__tests__/planPhase.test.ts adws/phases/__tests__/progressGate.test.ts adws/phases/__tests__/reviewPhaseApprovalGate.test.ts adws/phases/__tests__/rotAdvisoryFormat.test.ts adws/phases/__tests__/scenarioTestPhase.test.ts adws/phases/__tests__/upgradeGate.test.ts adws/phases/alignmentPhase.ts adws/phases/autoMergePhase.ts adws/phases/decidePostReviewOutcome.ts adws/phases/depauditSetup.ts adws/phases/diffEvaluationPhase.ts adws/phases/phaseCommentHelpers.ts adws/phases/planPhase.ts adws/phases/prPhase.ts adws/phases/prReviewPhase.ts adws/phases/progressGate.ts adws/phases/promotionRotAdvisory.ts adws/phases/reviewPatchHelpers.ts adws/phases/reviewPhase.ts adws/phases/rotAdvisoryFormat.ts adws/phases/scenarioFixPhase.ts adws/phases/scenarioTestFixLoop.ts adws/phases/scenarioTestPhase.ts adws/phases/stepDefPhase.ts adws/phases/upgradeGate.ts adws/phases/workflowInit.ts adws/phases/workflowRepoIdentity.ts` — the guard passes for all 30 files against the default branch.
- `F="adws/phases/__tests__/branchNameResolution.test.ts adws/phases/__tests__/progressGate.test.ts adws/phases/__tests__/reviewPhaseApprovalGate.test.ts adws/phases/__tests__/scenarioTestPhase.test.ts adws/phases/__tests__/upgradeGate.test.ts adws/phases/alignmentPhase.ts adws/phases/autoMergePhase.ts adws/phases/decidePostReviewOutcome.ts adws/phases/diffEvaluationPhase.ts adws/phases/phaseCommentHelpers.ts adws/phases/planPhase.ts adws/phases/prPhase.ts adws/phases/prReviewPhase.ts adws/phases/progressGate.ts adws/phases/promotionRotAdvisory.ts adws/phases/reviewPatchHelpers.ts adws/phases/reviewPhase.ts adws/phases/rotAdvisoryFormat.ts adws/phases/scenarioFixPhase.ts adws/phases/scenarioTestFixLoop.ts adws/phases/scenarioTestPhase.ts adws/phases/stepDefPhase.ts adws/phases/upgradeGate.ts adws/phases/workflowInit.ts adws/phases/workflowRepoIdentity.ts"; grep -nE '^\s*(//|/?\*).*(#[0-9]+|issue #|94059b5|criterion [0-9]|user story)' $F` — must print nothing (no issue tags or history pointers left in comments).
- `grep -nE '^\s*//\s*([-=─━═]{3,}|── |[0-9]+\. [A-Z]|Case [0-9]|Step [0-9]|Loser path)' $F` (reusing `$F` above) — must print nothing (no banners, numbered section labels, or step narration).
- `grep -n 'config.repoInfo' adws/phases/planPhase.ts adws/phases/prPhase.ts adws/phases/prReviewPhase.ts` — must print nothing (stale claim removed).
- `git diff --name-only origin/dev -- . ':!README.md' ':!specs/'` — must list only files from Touched Files.
- `bun run lint` — linter passes.
- `bunx tsc --noEmit` — root typecheck passes.
- `bunx tsc --noEmit -p adws/tsconfig.json` — adws typecheck passes.
- `bun run test` — package `test` script (typecheck) passes.
- `bun run test:unit -- adws/phases` — phase unit tests still pass.
- `bun run build` — build passes.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-877"` — the per-issue scenario (guard passes for the listed files against the default branch) passes.

## Notes
- Strictly adhere to `.adw/coding_guidelines.md`; its `Comments` bullet is the acceptance bar for every surviving comment.
- The guard drops comments and whitespace trivia, so any accidental edit to a string, template literal, import, or identifier fails the file as `code-changed`. The guard resolves the default branch itself; do not pass `--base` in the scenario.
- Keep surviving sentences verbatim; the PRD puts rewriting rationale prose out of scope. Re-wrapping is allowed only where a dropped sentence shares a physical line with a kept one (e.g. collapsing a multi-line JSDoc to a one-line `/** … */`), and when stripping a tag or pointer mid-sentence (`(#794)`, `(existing invariant from 94059b5, unchanged)`, `Simulates issue #712: `).
- Comments that document an empty `catch {}` (`workflowInit.ts` 233, `upgradeGate.ts` 109 and 153) stay: they explain why the error is swallowed.
- `reviewPhase.ts` 32–34 and `promotionRotAdvisory.ts` header both mention the 300-line guideline; both stay — one explains the re-export site, the other carries the must-run-after-`executePRPhase` ordering constraint in the same sentence.
- The eight unchanged files are in the list only because the batch was sized by directory; they must still be passed to the guard and will pass unchanged.
- `README.md` is pre-modified in this worktree by an earlier step (directory tree listing); it is out of scope for this chore.
- No new files besides this plan. No docs change is needed: the conditional docs describe behaviour, not comments.

# Chore: Comment sweep 11/16 — adws (top-level orchestrators and scripts)

## Metadata
issueNumber: `879`
adwId: `85tnep-chore-comment-sweep`
issueJson: `{"number":879,"title":"chore: comment sweep 11/16 — adws","body":"## Parent PRD\n\n`specs/prd/comment-debloat.md`\n\n## What to build\n\nSweep batch 11 of 16: **adws** (23 files, 804 comment lines at filing time).\n\nApply the deletion rules from the PRD's *Implementation Decisions › Deletion rules per comment kind* to exactly the files listed under Touched Files. Do not touch any file outside that list. Do not change any code: the only permitted diff is in comments (and the blank lines left behind).\n\nRules for this batch:\n\n- Delete section banner comments (lines of dashes or box-drawing characters).\n- Delete JSDoc blocks that only restate the name of the field or function they sit on.\n- Delete inline comments that narrate the statement directly below them.\n- Strip issue-number tags such as `(#794)` or `(issue #762)` from comments; keep the rest of the comment only if it still carries rationale.\n- Trim mixed comments to the sentences that state an invariant, an ordering constraint, or the reason for a non-obvious choice. Drop the narration sentences.\n- Keep shebang lines and `eslint-disable` directives unchanged.\n- Orchestrator entrypoint headers: keep the usage line and the environment-variable list; delete the numbered workflow/phase list.\n\nVerify with the comment-only guard shipped by the blocking issue:\n\n```\nbun run lint:comment-only <every file in Touched Files>\n```\n\n## Acceptance criteria\n\n- [ ] The comment-only guard passes for every file in Touched Files against the default branch (resolved by the guard, never named in the scenario).\n- [ ] No banner comments, name-restating JSDoc, next-line narration, or issue-number tags remain in the listed files.\n- [ ] Every surviving comment states an invariant, an ordering constraint, or the reason for a non-obvious choice.\n\n- [ ] `bun run test` (typecheck) passes.\n- [ ] The per-issue scenario for this issue asserts exactly one behaviour: the comment-only guard passes for the listed files against the default branch.\n\n## Blocked by\n\n- Blocked by #853\n\n## Touched Files\n\n- adws/adwBuild.tsx\n- adws/adwBuildHelpers.ts\n- adws/adwChore.tsx\n- adws/adwClearComments.tsx\n- adws/adwDocument.tsx\n- adws/adwMerge.tsx\n- adws/adwPatch.tsx\n- adws/adwPlan.tsx\n- adws/adwPlanBuild.tsx\n- adws/adwPlanBuildDocument.tsx\n- adws/adwPlanBuildReview.tsx\n- adws/adwPlanBuildTest.tsx\n- adws/adwPlanBuildTestReview.tsx\n- adws/adwPrReview.tsx\n- adws/adwSdlc.tsx\n- adws/adwTest.tsx\n- adws/adwUpgrade.tsx\n- adws/checkGitGhGuard.ts\n- adws/checkLivingDocsIndex.ts\n- adws/healthCheck.tsx\n- adws/healthCheckChecks.ts\n- adws/index.ts\n- adws/workflowPhases.ts\n\n## User stories addressed\n\n- User stories 12–26\n","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-09-24T08:18:07Z","comments":[],"actionableComment":null}`

## Chore Description
Batch 11 of the comment de-bloat sweep defined in `specs/prd/comment-debloat.md`. Apply the PRD's per-kind deletion rules to exactly the 23 top-level `adws/` files listed in the issue's Touched Files: the 16 orchestrator entrypoints (`adw*.tsx`), `adwBuildHelpers.ts`, the two CI guard scripts (`checkGitGhGuard.ts`, `checkLivingDocsIndex.ts`), the health check pair (`healthCheck.tsx`, `healthCheckChecks.ts`), and the two barrels (`index.ts`, `workflowPhases.ts`). The only permitted diff is inside comments (plus the blank lines their removal leaves behind). No code, no string/template-literal content, and no file outside the list may change.

Deletion rules (from the PRD and the `Comments` bullet in `.adw/coding_guidelines.md`):
- **Orchestrator entrypoint headers**: keep the shebang, the `Usage:` line(s) and the `Environment Requirements:` list (heading + bullets) verbatim. Delete the title line (`ADW Build - AI Developer Workflow Implementation Phase`, etc.), the numbered `Workflow:` list, and any `Prerequisites:` block. Keep any other header sentence only when it states an invariant or a non-obvious choice (called out per file below).
- **Banners** (`// ---…`, `// ── Result type ───…`, and export-list section labels such as `// Configuration`, `// Agents module - …`): delete.
- **Name-restating JSDoc** (`/** Main orchestrator workflow. */`, `/** Parses command line arguments. */`, `/** Outcome of executeMerge. */`, `@param` lines that restate the parameter): delete.
- **Next-line narration** (`// 1. Read and validate top-level state`, `// Unit tests`, `// Check for remote`, `// Re-run scenario tests to verify patch didn't break scenarios`): delete.
- **Issue-number tags and history pointers** (`(#527)`, `(#524/#530)`, `(issue #840)`, `(#769)`, `(#795)`, `(#822)`, `(#763)`, `before #822`, `Conscious reversal of #460:`, `the #729 …`, `#627 …`, `(User Story 22)`): strip; keep the remainder only if it still carries rationale.
- **Mixed comments**: keep only the sentences stating an invariant, an ordering constraint, or the reason for a non-obvious choice. Keep surviving sentences verbatim (the PRD puts prose rewriting out of scope). Permitted edits to a surviving sentence: removing a tag/pointer, removing a leading step number (`3. `, `5b. `, `5c. `, `7. `) or leading narration clause that precedes the kept rationale on the same comment, re-capitalising the new first word, and re-wrapping/re-indenting the lines (`//    ` continuation indent → `// `).
- **Stale claims** (verified against the code at planning time — delete, don't fix):
  - `adwPlanBuildTest.tsx` 7–8 `Identical workflow to adwPlanBuild.tsx, distinguished only by the OrchestratorId …` — false: it also runs `executeStepDefPhase`, `runScenarioTestFixLoop`, and `executeProofPublishPhase`.
  - `adwPlanBuildTestReview.tsx` 7–8 `Identical workflow to adwPlanBuildReview.tsx …` — false: it also runs `executeStepDefPhase`, `runScenarioTestFixLoop`, and `executeProofPublishPhase`.
  - `workflowPhases.ts` 8–9 `Located at adws/ level (not in core/) because it imports from agents/, github/, triggers/, and core/.` — false: the file only re-exports from `./phases`, and `adws/github/` no longer exists.
  - `checkGitGhGuard.ts` banner `Pure scan core — no I/O` — false: `scanFiles` reads from disk.
- **Shebangs**: every `adw*.tsx` and `healthCheck.tsx` starts with `#!/usr/bin/env bunx tsx` — keep line 1 byte-identical. No `eslint-disable` directives exist in these files (verified by grep).

Baseline measured at planning time: ~800 comment-marker lines across the 23 files (heaviest: `adwUpgrade.tsx` 143, `checkGitGhGuard.ts` 55, `healthCheckChecks.ts` 49, `checkLivingDocsIndex.ts` 45, `adwMerge.tsx` 43, `adwChore.tsx` 41, `healthCheck.tsx` 41). Every file has at least one edit.

No test or step definition asserts on comment text in these files (verified by grep over `adws/**/__tests__`, `features/**/step_definitions`, `test/`): the only source-text read (`features/regression/step_definitions/thenSteps.ts` on `adwSdlc.tsx`) checks for the code token `handleAuthRequiredPause(`.

## Relevant Files
Use these files to resolve the chore:

- `specs/prd/comment-debloat.md` — parent PRD; *Implementation Decisions › Deletion rules per comment kind* is the rule source, including the orchestrator-header rule.
- `.adw/coding_guidelines.md` — the `Comments` bullet is the standard every surviving comment must meet.
- `adws/checkCommentOnly.ts` — the comment-only guard (`bun run lint:comment-only [--base <ref>] <files...>`). It compares the TS token stream with comments and whitespace trivia dropped; any token change (including inside a string or template literal) fails the file as `code-changed`. Shebang lines are part of the token stream — leave them alone.
- `app_docs/feature-m363ky-comment-only-guard.md` — conditional doc for the guard (troubleshooting `code-changed` reports).
- `app_docs/feature-9gjajh-feature-orchestrators.md` — conditional doc owning `adwBuild`, `adwPlan`, `adwTest`, `adwMerge`, `adwChore`, `adwPatch`, `adwPrReview`, `adwDocument`, `adwUpgrade`, `adwClearComments`, `adwBuildHelpers.ts`, `index.ts` (context for which comments are real invariants: merge stage transitions, upgrade idempotency/claim ownership, chore pre-approval race).
- `app_docs/feature-9gjajh-sdlc-orchestrators.md` — conditional doc owning `adwSdlc`, `adwPlanBuild`, `adwPlanBuildDocument`, `adwPlanBuildReview`, `adwPlanBuildTest`, `adwPlanBuildTestReview`, `workflowPhases.ts`.
- `app_docs/feature-9gjajh-health-check.md` — conditional doc owning `healthCheck.tsx`, `healthCheckChecks.ts` (launch-boundary try/catch and provider-mint failure path).
- `app_docs/feature-oqb76h-gitcontext-base-path-authority.md` — conditional doc owning `checkGitGhGuard.ts` (three rules, empty `EXEMPT_PACKAGES`).
- `app_docs/feature-9gjajh-cost-api-worker.md` — conditional doc owning `checkLivingDocsIndex.ts` (credential-free CI gate; dead-glob warning rationale).

The 23 touched files (the only files that may change):
- `adws/adwBuild.tsx`, `adws/adwBuildHelpers.ts`, `adws/adwChore.tsx`, `adws/adwClearComments.tsx`, `adws/adwDocument.tsx`, `adws/adwMerge.tsx`, `adws/adwPatch.tsx`, `adws/adwPlan.tsx`, `adws/adwPlanBuild.tsx`, `adws/adwPlanBuildDocument.tsx`, `adws/adwPlanBuildReview.tsx`, `adws/adwPlanBuildTest.tsx`, `adws/adwPlanBuildTestReview.tsx`, `adws/adwPrReview.tsx`, `adws/adwSdlc.tsx`, `adws/adwTest.tsx`, `adws/adwUpgrade.tsx`
- `adws/checkGitGhGuard.ts`, `adws/checkLivingDocsIndex.ts`, `adws/healthCheck.tsx`, `adws/healthCheckChecks.ts`, `adws/index.ts`, `adws/workflowPhases.ts`

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

Line numbers below refer to the files as they are on the default branch (`origin/dev` = `f27a9eea`) at planning time. Work each file bottom-up, or re-locate by text, so earlier deletions don't shift later line numbers. "Delete" means remove the whole comment (all lines of a JSDoc block). "Keep" means leave the listed lines verbatim. When a JSDoc block keeps only some lines, drop the others and keep the `/** … */` wrapper (collapse to a one-line `/** … */` when a single short sentence survives). After removing a comment, leave no doubled blank lines and no blank line directly after an opening `{`; when a whole module header is deleted, the file starts at its first `import`.

The canonical orchestrator header after this sweep is:

```ts
#!/usr/bin/env bunx tsx
/**
 * Usage: bunx tsx adws/<script>.tsx <args…>
 *
 * Environment Requirements:
 * - ANTHROPIC_API_KEY: Anthropic API key
 * - …
 */
```

plus any per-file invariant sentences listed below, each separated from the usage/env blocks by a ` *` line.

### 1. Guardrails before editing
- Do not touch any file outside the 23 listed.
- Never edit string or template-literal content. These look like comments or tags but are code: `log('===================================', …)` banners in `adwBuildHelpers.ts`, `adwChore.tsx`, `adwDocument.tsx`, `adwPlanBuildReview.tsx`, `adwPlanBuildTestReview.tsx`, `adwSdlc.tsx`; `'='.repeat(60)` / `'-'.repeat(60)` in `healthCheck.tsx`; `` `Issue #${issueNumber} …` `` log strings in every orchestrator; `'${...}'` in `checkGitGhGuard.ts` 157; `(#796)` inside the string at `checkGitGhGuard.ts` 217; the `Closes #${issueNumber}` / `Implements #${issueNumber}` strings in `adwUpgrade.tsx` 150–151; the `'## Chore Escalation …'` lines in `adwChore.tsx`.
- `Closes #<issueNumber>`, `Implements #<issueNumber>`, and `#<N>` in `adwUpgrade.tsx` comments are placeholders, not issue tags.
- Keep line 1 (`#!/usr/bin/env bunx tsx`) of every `.tsx` entrypoint byte-identical.

### 2. Single-phase orchestrators: `adwBuild.tsx`, `adwPlan.tsx`, `adwTest.tsx`, `adwPlanBuild.tsx`, `adwPlanBuildDocument.tsx`
- `adws/adwBuild.tsx`:
  - Header 2–20: delete line 3 (title) and its trailing ` *` line 4, 7–12 (`Workflow:` list), 13–15 (`Prerequisites:` — the check at 58–62 enforces it with its own error message). Keep 5 (usage) and 16–19 (env list).
  - Delete 38–40 (`Main orchestrator workflow.`).
  - Keep 58 unchanged (`must remain before acquire` is an ordering constraint).
- `adws/adwPlan.tsx`: header — delete 3–4, 7–11; keep 5 and 12–15. Delete 31–33 (`Main planning workflow.`).
- `adws/adwTest.tsx`: header — delete 3–4, 7–11; keep 5 and 12–15. Delete 30–32.
- `adws/adwPlanBuild.tsx`: header — delete 3–4, 7–14; keep 5 and 15–18. Delete 37–39.
- `adws/adwPlanBuildDocument.tsx`: header — delete 3–4, 7–15; keep 5 and 16–19. Delete 39–41.

### 3. Scenario/review orchestrators: `adwPlanBuildTest.tsx`, `adwPlanBuildReview.tsx`, `adwPlanBuildTestReview.tsx`, `adwSdlc.tsx`, `adwChore.tsx`, `adwPrReview.tsx`
- `adws/adwPlanBuildTest.tsx`: header — delete 3–4, 7–9 (stale "Identical workflow" claim), 10–19 (`Workflow:` list); keep 5 and 20–24. Delete 46–48.
- `adws/adwPlanBuildReview.tsx`:
  - Header — delete 3–4, 7–18; keep 5 and 19–23.
  - Delete 49–51, 77 (`// Scenario test phase — proof path needed for review`), 81 (`// Review → patch+retest retry loop …`), 96 (`// Re-run scenario tests …`).
- `adws/adwPlanBuildTestReview.tsx`:
  - Header — delete 3–4, 7–9 (stale "Identical workflow" claim), 10–22; keep 5 and 23–28.
  - Delete 57–59, 88, 104.
- `adws/adwSdlc.tsx`:
  - Header — delete 3–4, 7–19; keep 5 and 20–25.
  - Delete 58–60, 89, 105, 134–135 (`// Review passed — proceed …` / `// Document phase: no screenshots dir needed …`).
  - Lines 142–143: drop the narration `Write awaiting_merge and persist costs.`; keep the rest so the comment reads:
    ```ts
      // Do NOT call completeWorkflow —
      // that overwrites the stage with 'completed'. adwMerge.tsx handles completion after merge.
    ```
- `adws/adwChore.tsx`:
  - Header — delete 3–4, 7–20 (numbered list incl. the `→ if "regression_possible"` continuation); keep 5 and 21–26.
  - Delete 55–58 (`postEscalationComment` JSDoc restates the name and the comment body strings), 78–80, 117 (`// Review → patch+retest retry loop …`), 131 (`// Re-run scenario tests …`).
  - Keep 108–109 (diff evaluation is worktree-dependent; runs before PR) and 137 (document phase must run before PR).
  - Lines 143–145: drop the first sentence (`Pre-merge approval (chore unified path): approve the PR unless the human has signalled hitl on the issue at this moment.`); keep the rest, re-wrapped:
    ```ts
      // Race accepted — a human can add hitl between this approval and the next cron tick;
      // the merge gate is permissive in that case (rule 3).
    ```
    (`(rule 3)` is a merge-gate rule reference, not an issue tag.)
- `adws/adwPrReview.tsx`:
  - Header — delete 3–4 and 8–19 (`Workflow:` list incl. its continuation line 10); keep 5–6 (both usage forms) and 20–24.
  - Delete 97 (`// Unit tests`), 102, 116.

### 4. `adws/adwPatch.tsx` and `adws/adwDocument.tsx`
- `adws/adwPatch.tsx`:
  - Header — delete 3–4, 7–13; keep 5 and 14–17.
  - Lines 40–43: drop line 41; keep `/** This makes executeBuildPhase usable in the standard pipeline (it reads from the spec file). */`.
  - Line 56: strip ` before #822` → `// selfHost pinned to true = the un-threaded default this call had; only gitContext is new, so the guardrails decision is unchanged.`
  - Delete 74 (restates the JSDoc reason and narrates the write), 85–87.
- `adws/adwDocument.tsx`:
  - Header — delete 3–4, 7–11; keep 5 and 12–14.
  - Delete 32–34, 48–50.
  - Line 78: same edit as `adwPatch.tsx` 56 (strip ` before #822`).

### 5. `adws/adwClearComments.tsx`
- Header 2–9: delete line 3 (title) and 4, and line 5 (`Removes all comments from a GitHub issue.` — the usage text says it); keep line 6 (`Useful for resetting an issue when a workflow has gone wrong.` — why the script exists) and line 8 (usage), separated by ` *`.
- Keep 22 (why the tracker is a bound provider).
- Delete 25–27, 39–41, 101–103.
- Lines 67–72: keep only `/** Continues deleting even if individual deletions fail. */`; drop 68 and both `@param` lines.

### 6. `adws/adwMerge.tsx`
- Header 2–18: delete line 3 (title) and 4, 7–16 (`Workflow:` list); keep 5 (usage) and 17 (`Does NOT use initializeWorkflow() — reads state directly, no worktree setup at startup.`), separated by ` *`.
- Delete 31 (`// Maximum PR-resolution attempts before escalating to merge_blocked (#527)` — restates the constant name; escalation is visible at its use).
- Delete 42 (`/** Outcome of executeMerge. */`), 74 (`buildMergeBlockedComment` JSDoc), 98, 128, 152, 181, 257.
- Keep unchanged: 48 (DI reason), 88–89 (exported for unit testing; side effects injected), 234 (every forge dep sourced from the launch boundary), 294 (direct-execution guard reason).
- Lines 110–111: strip the step label and tags → 
  ```ts
    // Top-level state is the canonical persistence target;
    // orchestrator state is the fallback for older runs / defense-in-depth.
  ```
- Line 163: strip the step label → `// Closed without merge — discard (terminal, operator intent)`.
- Lines 171–173: drop `5b. Unified gate — defer when hitl is on the issue AND the PR is not approved.`; keep the two invariant lines with `//` re-indented:
  ```ts
    // Stateless: every cron tick re-evaluates the current label state and PR approval.
    // No state write, no comment, log only — avoids flooding the issue while waiting.
  ```
- Lines 216–220: drop `Merge failed after retries.` and the history pointers; keep:
  ```ts
    // merge_failed escalates to the human-recoverable merge_blocked instead of terminal
    // discarded. Anti-loop intent preserved: merge_blocked recovers only via explicit
    // ## Retry, never automatically. pr_closed remains discarded.
  ```

### 7. `adws/adwUpgrade.tsx`
- Header 2–26: delete line 3 (title) and 4, 7–16 (`Workflow:` list), the `On success: …` sentence (19–21 up to `PR body.`), and 25 (`Uses runWithRawOrchestratorLifecycle (lock → heartbeat → run → cleanup).`). Resulting header:
  ```ts
  /**
   * Usage: bunx tsx adws/adwUpgrade.tsx <issueNumber> [adw-id] [--target-repo owner/repo] [--clone-url <url>]
   *
   * On LLM failure: posts a non-workflow comment to the tracking issue and exits 0 (handled failure).
   * The .github/adw.yml file lives outside .adw/ so /adw_init regeneration cannot clobber the opt-in signal.
   *
   * Does NOT call initializeWorkflow() — joins the adwMerge.tsx exception list.
   */
  ```
- Delete banners 65, 76, 133, 235, 452, 514 (and the blank line each leaves doubled).
- Delete 67 (`/** Outcome of executeUpgrade. */`), 78 (`/** Parameters passed to the runInitCommand dep. */`), 135 (`/** Builds the upgrade PR title. */`), 228–230 (`Builds the escalation Slack alert.`), 516 (`/** Main entry point. */`).
- Lines 86–91: strip ` (#822)` from line 88; keep the rest verbatim.
- Keep 95 (DI reason), 116 (non-fast-forward = another orchestrator owns the claim), 237–240 (exported for unit testing; side effects injected), 476, 549–550, 554.
- Lines 99–104: drop the sentence `Fixes the stale-worktree non-fast-forward that #627 only parks.`; keep the reconcile description (100–101) and `Hard reset is safe — the upgrade worktree is a throwaway regen target with no un-pushed work.`
- Line 111: strip ` (#763)` → `/** Copies the starter guardrails \`settings.json\` into the worktree, skipping if one already exists. */`.
- Lines 140–147: drop line 141 (`Builds the upgrade PR body.`); keep both bullets (142–146).
- Lines 159–165: drop 160–161; keep the `MUST NOT …` sentence with ` (User Story 22)` stripped (ends `… as an in-progress issue.`).
- Lines 178–183 and 192–197: drop the first line (`Builds the … comment body (non-workflow, non-ADW).`) and the ` *` spacer; keep the `MUST NOT … same contract as buildUpgradeFailureComment.` sentence.
- Lines 209–213: drop line 210; keep `First line deliberately differs from UPGRADE_FAILURE_SIGNATURE so it cannot self-inflate the failure count.`
- Keep unchanged: 249–250 (entry gate / idempotent re-dispatch), 273–277 (idempotency guard), 280–284 (wontfix escape hatch), 297–298 (ordering: failure cap after PR guard), 302 and 303 (trailing ordering / best-effort comments), 396–402, 410–411.
- Line 257: strip the step number → `// Compute runtime framework hash (single source of truth for branch name + .adw-version)`.
- Delete 270 (`// 2. Derive the claim branch name`), 346 (`// 5. LLM failure — …`), 378 (`// 6. Write .adw-version, commit the regen, push`).
- Lines 312–317: drop `3. Check out the existing remote claim branch, then reconcile it to the live remote claim tip.` and the `(#627 then parks it)` pointer; keep, re-indented:
  ```ts
    // A reused worktree may sit on a superseded claim commit (a prior claim cycle
    // re-created the branch with a new nonce); regenerating on that stale base
    // produces a push that can never fast-forward. Resetting to origin/<claim-branch>
    // makes the regen fast-forwardable. Hard reset is safe: the upgrade worktree is a
    // throwaway regen target.
  ```
- Lines 330–331: strip `4. ` and re-indent → `// Copy adw_init.md into the worktree so the /adw_init slash command resolves,` / `// then run it. The copy is gitignored so it stays out of the upgrade PR.`
- Lines 355–359: drop the `5b. Validity gate: verify that …` sentence (355–356, it narrates `verifyAdwRegen`); keep from `A legitimate no-op (byte-identical .adw/ regen) passes …` through `… re-runs regen).`, re-indented to `// `.
- Lines 373–374: strip `5c. ` and re-indent → `// Copy the starter guardrails settings.json into the worktree (skip if the target` / `// repo already has one) so it rides into the same regen commit as everything else.`
- Lines 383–386: strip `the #729 ` → `// A commit failure (e.g. the gitignored-exclude class, or any other git error)`; keep 384–386.
- Line 419: strip `7. ` → `// Open PR — no workflow comment; the PR is the success signal`.
- Lines 430–432: keep only line 432, re-indented → `// hitl: false (default, absent, or malformed) → auto-merge (best-effort, non-fatal).`

### 8. `adws/adwBuildHelpers.ts`, `adws/workflowPhases.ts`, `adws/index.ts`
- `adws/adwBuildHelpers.ts`: delete 1–10 (module header lists the file's exports), 27–29, 39–41. Lines 15–18: keep only `/** Returns 0 if the URL is absent or unparseable. */`.
- `adws/workflowPhases.ts`: delete 1–10 (narration + stale location rationale). File starts at `export {`.
- `adws/index.ts`: delete every comment — 1–5 (header), 7, 9, 14, 20, 30, 33, 35 (export-list section labels), 45–46, 65 (contains `#662`), 71, 82. File starts at `export {`; keep one blank line between consecutive `export` statements.

### 9. `adws/checkGitGhGuard.ts`
- Header 1–20: delete 2–6 (restates the three rules listed below it), the `(#769)` and `(#795)` tags on 10–11, and 13–16 (the `EXEMPT_PACKAGES` invariant is stated on the constant itself at 43–49). Resulting header:
  ```ts
  /**
   * Three independent rules:
   *
   *  - 'git-gh-shellout' — implemented in this file (`walkNode`/`extractGitGhCommand`).
   *  - 'cwd-derived-identity' — `adws/guard/identityRule.ts`.
   *  - 'unsanctioned-construction' — `adws/guard/constructionRule.ts`.
   *
   * Run via: bunx tsx adws/checkGitGhGuard.ts
   * Exits 0 if no violations found, 1 if any violations are detected.
   */
  ```
- Delete banners 32–34, 60–62, 66–68, 107–109 (the stale `Pure scan core — no I/O`), 140, 162–164.
- Delete 36 (restates `EXEMPT_DIR_NAMES`), 52 (restates `isExemptPackage`), 57 (restates the regex).
- Keep 39–40 (why `features` and `test` are exempt), 70 (exported for tests; mirrors the CLI walk), 77 (why the empty `EXEMPT_PACKAGES` check stays), 166 (why construction scan is separate), 225.
- Lines 43–49: strip ` (issue #840)` from line 45 → ` * deliberately empty: the git core and the GitHub forge adapter`; keep the rest verbatim.
- Lines 111–115: drop line 112 (`Scans collected source files for direct git/gh shell-out calls.` — also incomplete: it runs all three rules); keep 113–114.

### 10. `adws/checkLivingDocsIndex.ts`
- Header 1–20: delete line 2 (title) and 3; drop the first sentence on 4–5 (`` `bun run lint:docs-index`, wired into … on every `pull_request` and `push`. ``); keep from `Credential-free: …` through `… never drift apart.` (5–10, re-wrapped); drop the first sentence of 12–14 (`A dangling entry or any judgement-required violation … fails the gate.` — the `failed` expression states it); keep `A dead \`Owns:\` glob is a non-fatal WARNING — … within one cadence.`; keep 18–19 (run/exit contract).
- Delete banners 33–35, 51–53, 83–85, 92–94, 169–171.
- Keep 39, 42–48 (depth semantics of the two ignore sets and why), 61, 180.

### 11. `adws/healthCheck.tsx`
- Header 2–12: delete line 3 (title) and 4, 7–11 (numbered check list); keep only line 5 (usage) → `/**\n * Usage: bunx tsx adws/healthCheck.tsx <issueNumber>\n */`.
- Delete 28 (`// Re-export for any external consumers`), 41–43, 52–54, 73–75, 90–92.
- Keep 107–109 (construct once; why try/catch; failure semantics) and 115–117 (why the provider mint has its own try/catch).
- Delete the section-label narration: 137, 162, 175, 180, 193, 212, 224, 241, 257, 273, 283.

### 12. `adws/healthCheckChecks.ts`
- Delete 1–6 (module header), and the name-restating JSDoc 15–17, 25–27, 37–39, 48–50, 86–88, 143–145, 174–176, 220–222, 254–256.
- Delete the next-line narration: 92, 103, 112, 122, 125, 164, 205, 226, 230, 234, 238.
- Keep 118 (`/* no remotes or not a repo — degrade gracefully */` explains the empty catch).
- Line 180: drop the narration, keep the reason → `// Indirect variable avoids guard false-positive on 'gh' literal`.
- Lines 193–196: drop `Check authentication via the code host port.`; keep from `GitHubCodeHost.getAuthenticatedUser() already returns null on failure …` through `… uncaught stack trace.`, re-wrapped.

### 13. Self-audit
- Grep the 23 files for leftover issue tags, history pointers, banners, numbered workflow lists, and stale claims (see Validation Commands). Zero hits expected.
- Re-read every surviving comment and confirm it states an invariant, an ordering constraint, a non-obvious reason, or is an orchestrator usage line / env list. Delete any that only narrates.
- Confirm line 1 of each `.tsx` entrypoint is still the shebang.
- `git diff --stat origin/dev` must list only files from the Touched Files list (plus this spec).

### 14. Run the Validation Commands
- Execute every command below; all must pass.
- If the guard reports `code-changed` for a file, `git diff origin/dev -- <file>`, find the non-comment edit, and restore it; do not "fix" by editing code.

## Validation Commands
Execute every command to validate the chore is complete with zero regressions.

- `bun run lint:comment-only adws/adwBuild.tsx adws/adwBuildHelpers.ts adws/adwChore.tsx adws/adwClearComments.tsx adws/adwDocument.tsx adws/adwMerge.tsx adws/adwPatch.tsx adws/adwPlan.tsx adws/adwPlanBuild.tsx adws/adwPlanBuildDocument.tsx adws/adwPlanBuildReview.tsx adws/adwPlanBuildTest.tsx adws/adwPlanBuildTestReview.tsx adws/adwPrReview.tsx adws/adwSdlc.tsx adws/adwTest.tsx adws/adwUpgrade.tsx adws/checkGitGhGuard.ts adws/checkLivingDocsIndex.ts adws/healthCheck.tsx adws/healthCheckChecks.ts adws/index.ts adws/workflowPhases.ts` — the guard passes for all 23 files against the default branch.
- `F="adws/adwBuild.tsx adws/adwBuildHelpers.ts adws/adwChore.tsx adws/adwClearComments.tsx adws/adwDocument.tsx adws/adwMerge.tsx adws/adwPatch.tsx adws/adwPlan.tsx adws/adwPlanBuild.tsx adws/adwPlanBuildDocument.tsx adws/adwPlanBuildReview.tsx adws/adwPlanBuildTest.tsx adws/adwPlanBuildTestReview.tsx adws/adwPrReview.tsx adws/adwSdlc.tsx adws/adwTest.tsx adws/adwUpgrade.tsx adws/checkGitGhGuard.ts adws/checkLivingDocsIndex.ts adws/healthCheck.tsx adws/healthCheckChecks.ts adws/index.ts adws/workflowPhases.ts"; bash -c "grep -nE '^\s*(//|/?\*).*(#[0-9]+|issue #|[Uu]ser [Ss]tory [0-9])' $F"` — must print nothing (no issue tags or PRD pointers left in comments).
- `bash -c "grep -nE '^\s*(//|/?\*)\s*([-=─━═]{3,}|── |[0-9]+[a-z]?\. [A-Z]|Workflow:|Prerequisites:|Main (orchestrator|entry|planning|document|health))' $F"` (reusing `$F` above) — must print nothing (no banners, numbered step/workflow lists, or name-restating `main` JSDoc).
- `bash -c "grep -nE 'Identical workflow|Located at adws/ level|Pure scan core' $F"` — must print nothing (stale claims removed).
- `bash -c 'for f in adws/adw*.tsx adws/healthCheck.tsx; do head -1 "$f" | grep -qx "#!/usr/bin/env bunx tsx" || echo "shebang lost: $f"; done'` — must print nothing.
- `git diff --name-only origin/dev -- . ':!specs/'` — must list only files from Touched Files.
- `bun run lint` — linter passes.
- `bunx tsc --noEmit` — root typecheck passes.
- `bunx tsc --noEmit -p adws/tsconfig.json` — adws typecheck passes.
- `bun run test` — package `test` script (typecheck) passes.
- `bun run test:unit -- adws/__tests__` — top-level unit tests (`adwMerge`, `adwUpgrade`, `checkGitGhGuard`, `checkLivingDocsIndex`, `healthCheckChecks`) still pass.
- `bun run lint:git-guard` — the git/gh guard still passes after its own comments are trimmed.
- `bun run build` — build passes.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-879"` — the per-issue scenario (guard passes for the listed files against the default branch) passes.

## Notes
- Strictly adhere to `.adw/coding_guidelines.md`; its `Comments` bullet is the acceptance bar for every surviving comment.
- The guard drops comments and whitespace trivia, so any accidental edit to a string, template literal, import, identifier, or the shebang fails the file as `code-changed`. The guard resolves the default branch itself; do not pass `--base` in the scenario.
- Keep surviving sentences verbatim; the PRD puts rewriting rationale prose out of scope. The only textual edits allowed inside a kept comment are those listed in the Chore Description (tag/pointer removal, leading step-number or narration-clause removal, re-capitalisation, re-wrapping/re-indenting).
- The orchestrator headers keep their `Usage:` and `Environment Requirements:` text even where it has drifted from `parseOrchestratorArguments`' `usagePattern` (e.g. `adwClearComments.tsx` omits `[--repo owner/repo]`); correcting it is prose rewriting and out of scope.
- `adwMerge.tsx` and `adwUpgrade.tsx` deliberately keep matching comments on their parallel structures (DI interface JSDoc, `exported for unit testing`, `buildDefault…Deps` JSDoc, the direct-execution guard) so the two raw-lifecycle orchestrators stay symmetrical.
- `checkGitGhGuard.ts` 77 says a future `EXEMPT_PACKAGES` entry "would take effect", while 43–49 say nothing may be added; both are kept verbatim — the first explains why the dead check stays, the second states the policy.
- No new files besides this plan. No docs change is needed: the conditional docs describe behaviour, not comments.

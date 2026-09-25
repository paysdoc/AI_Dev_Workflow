# Chore: Comment sweep 10/16 — adws/phases (2/2)

## Metadata
issueNumber: `878`
adwId: `dlk0br-chore-comment-sweep`
issueJson: `{"number":878,"title":"chore: comment sweep 10/16 — adws/phases (2/2)","body":"## Parent PRD\n\n`specs/prd/comment-debloat.md`\n\n## What to build\n\nSweep batch 10 of 16: **adws/phases (2/2)** (30 files, 585 comment lines at filing time).\n\nApply the deletion rules from the PRD's *Implementation Decisions › Deletion rules per comment kind* to exactly the files listed under Touched Files. Do not touch any file outside that list. Do not change any code: the only permitted diff is in comments (and the blank lines left behind).\n\nRules for this batch:\n\n- Delete section banner comments (lines of dashes or box-drawing characters).\n- Delete JSDoc blocks that only restate the name of the field or function they sit on.\n- Delete inline comments that narrate the statement directly below them.\n- Strip issue-number tags such as `(#794)` or `(issue #762)` from comments; keep the rest of the comment only if it still carries rationale.\n- Trim mixed comments to the sentences that state an invariant, an ordering constraint, or the reason for a non-obvious choice. Drop the narration sentences.\n- Keep shebang lines and `eslint-disable` directives unchanged.\n\nVerify with the comment-only guard shipped by the blocking issue:\n\n```\nbun run lint:comment-only <every file in Touched Files>\n```\n\n## Acceptance criteria\n\n- [ ] The comment-only guard passes for every file in Touched Files against the default branch (resolved by the guard, never named in the scenario).\n- [ ] No banner comments, name-restating JSDoc, next-line narration, or issue-number tags remain in the listed files.\n- [ ] Every surviving comment states an invariant, an ordering constraint, or the reason for a non-obvious choice.\n\n- [ ] `bun run test` (typecheck) passes.\n- [ ] The per-issue scenario for this issue asserts exactly one behaviour: the comment-only guard passes for the listed files against the default branch.\n\n## Blocked by\n\n- Blocked by #853\n\n## Touched Files\n\n- adws/phases/__tests__/branchIdentityFallback.test.ts\n- adws/phases/__tests__/gherkinFreeze.test.ts\n- adws/phases/__tests__/orchestratorLock.test.ts\n- adws/phases/__tests__/prReviewCompletion.test.ts\n- adws/phases/__tests__/promotionRotAdvisory.test.ts\n- adws/phases/__tests__/reviewPhase.test.ts\n- adws/phases/__tests__/scenarioTestFixLoop.test.ts\n- adws/phases/__tests__/workflowInit.test.ts\n- adws/phases/__tests__/workflowRepoIdentity.test.ts\n- adws/phases/__tests__/worktreeSetup.test.ts\n- adws/phases/authPause.ts\n- adws/phases/branchIdentityFallback.ts\n- adws/phases/branchNameResolution.ts\n- adws/phases/buildPhase.ts\n- adws/phases/docsSelfCheck.ts\n- adws/phases/documentPhase.ts\n- adws/phases/gherkinFreeze.ts\n- adws/phases/index.ts\n- adws/phases/installPhase.ts\n- adws/phases/orchestratorLock.ts\n- adws/phases/planValidationPhase.ts\n- adws/phases/prReviewCompletion.ts\n- adws/phases/proofPublishPhase.ts\n- adws/phases/scenarioPhase.ts\n- adws/phases/scenarioProof.ts\n- adws/phases/sdlcReviewHandoff.ts\n- adws/phases/stackCoherenceReporter.ts\n- adws/phases/unitTestPhase.ts\n- adws/phases/workflowCompletion.ts\n- adws/phases/worktreeSetup.ts\n\n## User stories addressed\n\n- User stories 12–26\n","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-09-24T08:18:06Z","comments":[],"actionableComment":null}`

## Chore Description
Batch 10 of the comment de-bloat sweep defined in `specs/prd/comment-debloat.md`. Apply the PRD's per-kind deletion rules to exactly the 30 files under `adws/phases/` listed in the issue's Touched Files. The only permitted diff is inside comments, plus the blank lines their removal leaves behind. No code, no string or template-literal content, and no file outside the list may change.

Deletion rules (from the PRD and the `Comments` bullet in `.adw/coding_guidelines.md`):
- **Banners** (lines of dashes, `─`, or `──` label lines such as `// ─── runWithOrchestratorLifecycle ───…`, `// ── executePromotionRotAdvisory: … ──…`, and `// --- Unit tests gate … ---`): delete, including the label text between the rule lines.
- **Name-restating JSDoc** (including `@param` lines that only restate the parameter name or type): delete.
- **Next-line narration** (`// Read plan content`, `// Step 3: Post plan_validating stage comment`, `// 1. Parse the registry`): delete.
- **Issue-number tags** (`(#794)`, `(issue #762)`, `(#640)`, `(#763)`, `(#822)`, `(issue #524)`, `#796 hardens …`, `preserving the #267 invariant`) and equivalent history pointers (`See PRD user story 11.`, `criterion 3`, `E4:`, `has been relocated to …`, `(resume-in-place is a later slice)`, `(merged replacement for the two previous helper functions)`): strip. Keep the rest only if it still carries rationale.
- **Mixed comments**: keep only the sentences that state an invariant, an ordering constraint, or the reason for a non-obvious choice. Keep surviving sentences verbatim, because the PRD puts prose rewriting out of scope. Re-wrap lines only where a dropped sentence or stripped tag shares a physical line with kept text. When a single sentence survives in a JSDoc block, collapse the block to a one-line `/** … */`.
- **Stale claims**: delete comments that are false against the current code:
  - `Uses \`config.repoInfo\` for external repository API calls when targeting a different repo.` appears in `buildPhase.ts`, `documentPhase.ts`, `prReviewCompletion.ts`, and `unitTestPhase.ts`. `WorkflowConfig` and `PRReviewWorkflowConfig` have no `repoInfo` field (verified by grep).
  - The `index.ts` header cites `github/` and `triggers/` imports; `adws/github/` no longer exists, and the module sits in `adws/phases/`, not "adws/ level".
  - The `branchNameResolution.ts` header's three-step `Priority:` line omits the deterministic fallback; the function JSDoc has the correct four-step list.
- Shebangs and `eslint-disable` directives: none exist in these 30 files (verified by grep), so there is nothing to preserve beyond the rule.

Baseline measured at planning time: about 590 comment-marker lines across the 30 files. Four files contain zero comments: `__tests__/gherkinFreeze.test.ts`, `__tests__/reviewPhase.test.ts`, `__tests__/workflowRepoIdentity.test.ts`, and `stackCoherenceReporter.ts`. One more carries only a comment that already meets the bar: `__tests__/prReviewCompletion.test.ts`. All five stay byte-identical. They are still passed to the guard, which reports them unchanged.

## Relevant Files
Use these files to resolve the chore:

- `specs/prd/comment-debloat.md`: the parent PRD. Its *Implementation Decisions › Deletion rules per comment kind* section is the rule source.
- `.adw/coding_guidelines.md`: the `Comments` bullet under *Process & Tooling* is the standard every surviving comment must meet.
- `adws/checkCommentOnly.ts`: the comment-only guard (`bun run lint:comment-only [--base <ref>] <files...>`). It compares the TS token stream with comments, whitespace, and JSDoc trivia dropped. Any token change, including inside a string or template literal, fails the file as `code-changed`.
- `app_docs/feature-m363ky-comment-only-guard.md`: conditional doc for the guard, used when troubleshooting `code-changed` reports.
- `app_docs/feature-9gjajh-workflow-lifecycle-phases.md`: conditional doc for `orchestratorLock.ts`, `branchNameResolution.ts`, `authPause.ts`, `gherkinFreeze.ts`, `index.ts`, `workflowCompletion.ts`, and `__tests__/workflowRepoIdentity.test.ts`. It gives context for which comments are real invariants: lock contract, branch-name resolution cascade, and pause semantics.
- `app_docs/feature-9gjajh-pr-and-merge-phases.md`: conditional doc for `prReviewCompletion.ts`, `sdlcReviewHandoff.ts`, and the `executeSdlcReviewFailedHandoff` routing.
- `app_docs/feature-9gjajh-promotion-system.md`: conditional doc for `__tests__/promotionRotAdvisory.test.ts`.

The 30 touched files (the only files that may change):
- `adws/phases/__tests__/`: `branchIdentityFallback.test.ts`, `gherkinFreeze.test.ts`, `orchestratorLock.test.ts`, `prReviewCompletion.test.ts`, `promotionRotAdvisory.test.ts`, `reviewPhase.test.ts`, `scenarioTestFixLoop.test.ts`, `workflowInit.test.ts`, `workflowRepoIdentity.test.ts`, `worktreeSetup.test.ts`
- `adws/phases/`: `authPause.ts`, `branchIdentityFallback.ts`, `branchNameResolution.ts`, `buildPhase.ts`, `docsSelfCheck.ts`, `documentPhase.ts`, `gherkinFreeze.ts`, `index.ts`, `installPhase.ts`, `orchestratorLock.ts`, `planValidationPhase.ts`, `prReviewCompletion.ts`, `proofPublishPhase.ts`, `scenarioPhase.ts`, `scenarioProof.ts`, `sdlcReviewHandoff.ts`, `stackCoherenceReporter.ts`, `unitTestPhase.ts`, `workflowCompletion.ts`, `worktreeSetup.ts`

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

Line numbers below refer to the files as they are on the default branch (`origin/dev` = `f27a9eea`, identical to this branch's HEAD at planning time). Work each file bottom-up, or re-locate by text, so earlier deletions don't shift later line numbers.

Terms used below:
- **Delete** means remove the whole comment, including every line of a JSDoc block.
- **Keep** means leave the listed lines verbatim.
- When a JSDoc block keeps only some lines, drop the others and keep the `/** … */` wrapper. Collapse it to a one-line `/** … */` when a single short sentence survives.
- For a trailing comment (`code; // …`), remove only the `// …` text and its leading spaces; the code on that line is untouched.

After removing a comment, leave no doubled blank lines and no blank line directly after an opening `{`. When a whole module header is deleted, the file starts at its first `import`.

### 1. Guardrails before editing
- Do not touch any file outside the 30 listed.
- Never edit string or template-literal content. The following look like comment material but are strings, so leave them:
  - the `describe(...)` titles `'initializeWorkflow determinism — criterion 3 (issue #524)'` and `'…providers.issueTracker (#844)'` in `workflowInit.test.ts`;
  - the `(E4a)`…`(E4e)` / `#267` `describe` titles in `worktreeSetup.test.ts`;
  - the `log('===================================', 'warn')` lines in `sdlcReviewHandoff.ts`, which are not banners.
- `gherkinFreeze.test.ts`, `reviewPhase.test.ts`, `workflowRepoIdentity.test.ts`, and `stackCoherenceReporter.ts` have no comments. `prReviewCompletion.test.ts` line 18 is kept. Make no edit to these five files.

### 2. `adws/phases/authPause.ts`
- Delete: 1–4 (module header: name plus a "mirrors" pointer) and 12–17 (`handleAuthRequiredPause` JSDoc; it narrates the body line by line).
- Keep unchanged: 53–56 (caller contract, and why state is rewritten "without triggering comments or Slack").

### 3. `adws/phases/branchIdentityFallback.ts`
- Header 1–10: drop lines 2–7. Keep lines 8–9 in a block: `All I/O is behind an injectable \`deps\` object so the logic is unit-testable without a live git repo or a real agents/ directory.`
- Delete: 21 (restates `BranchIdentityFallbackDeps`), 25 and 27 (restate `listAdwIds` and `readTopLevelState`), and 47–50 (name-restating plus the "mirrors … (#822)" history).
- Keep: 23 (names the two branch sources) and 120 (the tie-break rule the comparator encodes).
- Lines 69–76 (`findExistingBranchForIssue`): keep only lines 74–75 (`A different classifier prefix (re-classification) produces no match here, which causes the caller to fall through to LLM generation — the intended new-branch behaviour.`). Drop 70–73.
- Lines 91–99 (`recoverAdwIdForBranch`): keep only lines 97–98 (`The branch name does not embed the adwId, so this persisted-state reverse-lookup is the only reliable mechanism.`). Drop 92–96, which narrate the algorithm; the tie-break is kept at 120.

### 4. `adws/phases/branchNameResolution.ts`
- Header 1–12: drop line 2 (name) and line 4 (stale three-step `Priority:`). Keep lines 5–7 (persisted once and reused; LLM at most once per adwId) and lines 9–11 with ` (issue #524)` stripped, so the sentence ends `… instead of silently forking into an orphan worktree.` Keep the blank ` *` separator between the two kept paragraphs.
- Delete: 23 (restates `readPersistedBranchName`).
- Keep unchanged: 28 (merge semantics plus atomic write), 76–80 (why the slug-free fallback exists; auth re-throw), 95 (why state is re-read), and 133–137 (`@internal` test-only export).
- Lines 66–68: drop the first sentence (`Deterministic fallback: find an existing branch that belongs to this issue without relying on the LLM.`). Keep the ordering sentence, re-wrapped: `// Inserted between recovery-comment reuse and LLM generation so a lost-comment run` / `// reuses the existing branch, not a new one.`
- Lines 110–122 (`resolveWorkflowBranchName`): drop line 111 and the blank ` *` after it. Keep 113–121 (four-step priority; persisted immediately; LLM at most once).

### 5. `adws/phases/buildPhase.ts`
- Delete: 1–3 (module header).
- Lines 33–39: drop line 34 (`Executes the Build phase: …`) and line 38 (stale `config.repoInfo`). Keep 35–37 (token-limit recovery and the `MAX_CONTEXT_RESETS` bound).
- Lines 72–75: keep, and strip ` (#640)` so line 72 begins `// Resume-in-place recognition instruction: on a cross-orchestrator resume,`.
- Delete: 50, 60, 112, 128, 157, 163, 261, 282 (next-line narration).
- Keep: 193 (why the running total is updated: the next `build_progress` comment) and 231 (ordering: commit if dirty, then evaluate the progress gate).

### 6. `adws/phases/docsSelfCheck.ts`
- Delete banners: 7–9, 35–37, 58–60, 99–101.
- Delete step narration: 110, 119, 130, 133, 146.
- Keep: 115 and 126 (empty-`catch` reasons).

### 7. `adws/phases/documentPhase.ts`
- Delete: 1–5 (module header) and 23–29 (`executeDocumentPhase` JSDoc: narration, stale `config.repoInfo`, name-restating `@param`s).
- Delete: 115 and 118 (next-line narration).
- Keep: 97–99 (non-fatal self-check, and why it is skipped without a `repoContext`).

### 8. `adws/phases/gherkinFreeze.ts`
- Header 1–6: drop line 2 and the blank ` *` after it. Keep lines 4–5 (fs at the edges; the permit/reject decision lives in `resolveFreezeGuard.ts`).
- Keep: 26 (empty-`catch` reason).

### 9. `adws/phases/index.ts`
- Delete: 1–10 (module header). It is narration plus stale claims: `github/` is gone, and the module is not at adws/ level. The file then starts at its first `export`.

### 10. `adws/phases/installPhase.ts`
- Delete: 1–6 (module header; its non-fatal sentence is kept at line 98).
- Lines 20–25 (`extractInstallContext`): keep only line 22 (`Pairs tool_use (Read/Bash) with their tool_result content.`) and line 24 (`Returns empty string if no context could be extracted.`). Drop 21 and 23.
- Lines 95–101: keep only `/** This phase is non-fatal — errors are caught and logged, never thrown. */`.
- Keep: 80 (empty-`catch` reason).

### 11. `adws/phases/orchestratorLock.ts`
- Header 1–12: drop line 2 (`Orchestrator-lifetime spawn lock helper.`) and the blank ` *` after it. Keep lines 4–11 (call-site contract, and why the lock survives abnormal exits).
- Keep unchanged:
  - 29–38: lifecycle ordering, return-value caller obligation, and the `process.exit` NOTE.
  - 56–59: why the raw variant exists (orchestrators without `WorkflowConfig`).

### 12. `adws/phases/planValidationPhase.ts`
- Delete:
  - 1–4 (module header) and 28–31 (JSDoc narrating the phase).
  - 60, 69, 78, 83, 132, 142, 152, 157, 211, 214, 219, 284 (`// Step N: …` and next-line narration).
  - 113: it narrates the `return`, and wrongly calls it "a failed validation result".
- Keep: 184 (`Degrade gracefully: …`, the reason for the synthesized result).

### 13. `adws/phases/prReviewCompletion.ts`
- Delete: 1–6 (module header), 59 (narration), and 94–97 (`handlePRReviewWorkflowError` JSDoc: narration plus stale `config.repoInfo`).
- Keep: 20 (backward-compatibility reason).
- Lines 24–25: drop line 24. Keep line 25 (`// D1 posting is now handled per-phase by runPhase via tracker.commit().`), which explains why no D1 write happens here.
- Lines 44–50 (`completePRReviewWorkflow`): drop 45–46. Keep 47–49 (terminal-only: commit+push lives in `executePRReviewCommitPushPhase`; the `awaiting_merge` handoff reason).

### 14. `adws/phases/proofPublishPhase.ts`
- Header 1–6: keep only `/** Non-fatal — any error is logged and swallowed; the workflow continues. */`.
- Lines 14–19: keep only `/** Returns immediately with zero cost when ctx.scenarioProof or ctx.prUrl are absent. */`.

### 15. `adws/phases/scenarioPhase.ts`
- Delete: 1–5 (module header; its non-fatal sentence is kept at line 21).
- Lines 19–24: keep only `/** This phase is non-fatal — errors are caught and logged, never thrown. */`.
- Lines 30–33: keep, and strip the trailing ` See PRD user story 11.` from line 31 so it ends `… become its own future promotion candidate.`

### 16. `adws/phases/scenarioProof.ts`
- Delete: 1–7 (module header), 17 (restates `MAX_OUTPUT_LENGTH`), 20–22, 34 (`Process exit code.`), 50–52, 77, 82, and 211 (narration).
- Line 30: keep only the second sentence → `/** False when skipped. */`.
- Keep: 24, 26 (tag format examples), 32 (truncation), 36, 38–42, 44, 46, 55, 57, 59, 120, 127, and 242 (why a stale report is removed).
- Lines 63–67 (`shouldRunScenarioProof`): drop line 64. Keep 65–66 (absent/empty → callers fall back to code-diff proof).
- Lines 176–188 (`runScenarioProof`): drop 177–179 (narration plus blank), 181, 185, 186, 187 (name-restating `@param`s). Keep the `@param` lines 180 (guard-check only), 182 (`{tag}` placeholder), 183 (`{issueNumber}` substitution), and 184 (`scenario_proof.md` target).

### 17. `adws/phases/sdlcReviewHandoff.ts`
- Header 1–9: drop line 2 plus the blank after it, and line 8 (`Mirrors the completePRReviewWorkflow pattern …`) plus the blank before it. Keep lines 4–6 (why the handoff is its own module: phase-importable by the BDD scenario without spawning an orchestrator).
- Lines 23–29: drop 24–25 and the blank ` *` line. Keep 27–28 (caller condition; why no cost/metadata is persisted here).

### 18. `adws/phases/unitTestPhase.ts`
- Delete: 1–10 (module header; it duplicates the function JSDoc and `adwYmlConfig.ts`).
- Lines 33–42 (`executeUnitTestPhase`): drop line 34, line 41 (stale `config.repoInfo`), and the blank ` *` lines around them. Keep 36–37 (opt-out default) and 39 (why BDD is not run here).
- Delete: 63 (`// --- Unit tests gate … ---` banner).
- Keep: 129–132 (why the label-write error is swallowed).

### 19. `adws/phases/workflowCompletion.ts`
- Delete: 1–5 (header narration plus the "relocated" history).
- Lines 22–27 (`completeWorkflow`): drop line 23 and the blank ` *` after it. Keep the `@param deniedToolCallCount` entry with ` (issue #762)` stripped, re-wrapped as `@param deniedToolCallCount - Optional aggregate per-run permission-denied tool-call` / `  count, surfaced in the completion comment when greater than 0.`
- Keep: 38 (why no CSV is written here).
- Delete: 43, 87, and 125 (next-line narration).
- Lines 70–73: keep only `/** Called by runPhase() when a RateLimitError is caught. */` (caller contract; verified in `adws/core/phaseRunner.ts`).
- Lines 107–109: drop the first sentence (`Enqueue for probe + resume.`). Keep the rest, re-wrapped:
  - `// Persist --target-repo so the respawned orchestrator targets the correct repo —`
  - `// without this, resume defaults to the cron host's repo and dies silently in detached/stdio:ignore.`
  - Wrap to about 100 columns as the file does.
- Lines 141–144: keep only `/** Optionally persists accumulated token counts so cost data survives the crash. */`.
- Lines 177–181 (`handlePhaseTimeout`): drop the first sentence (`Handles an agent watchdog timeout: … and exits 0.`) and the stale ` (resume-in-place is a later slice)`. Keep `/** The next cron tick recovers the run via reset-from-remote takeover. */`.
- Lines 205–214 (`handleWorkflowDiscarded`): drop 206–207 (narration). Keep 208–209 (why exit 0) and the NOTE at 211–213 (the handler is uninvoked, verified by grep; any future caller must await it), with the blank ` *` separator.

### 20. `adws/phases/worktreeSetup.ts`
- Delete:
  - 1–3 (module header).
  - 102–104, 115–117, 176: these restate `copyDirContents`, `getTrackedBasenames`, and `StarterSettingsResult`.
- Keep: 11 (ties the list to what `/adw_init` must produce).
- Lines 21–28 (`ensureGitignoreEntry`): keep only lines 23–24 (creates the file if absent; idempotent). Drop 22 and the `@param` lines 25–27.
- Lines 52–59 (`ensureGitignoreEntries`): keep only lines 54–55 (a single write with one header, and why). Drop 53 and 56–58.
- Lines 84–87: keep only `/** Returns \`false\` if the file doesn't exist, has no frontmatter, or the \`target\` field is absent/false. */`.
- Lines 126–129: keep only `/** E.g., for \`.claude/skills/\` returns \`{'tdd', 'refactor', ...}\`. */`.
- Keep unchanged: 145–151 (why the file is copied and then gitignored; why the helper is separate).
- Line 161: strip ` (#763)` → `/** Pure skip-if-exists decision for the starter guardrails settings copy. */`.
- Lines 166–170: drop the first sentence (`Decides whether … into a target worktree.`). Keep `An owner who already has a \`.claude/settings.json\` has opinions — the copy is always skipped, never merged or overwritten.`, re-wrapped.
- Lines 182–190: keep. Strip ` (#762)` from line 183 and ` (#763)` from line 189, re-wrapping only the affected lines.
- Lines 206–215 (`verifyAdwRegen`): keep 207–211 (ordering: verification before the version stamp is written; the two gate conditions). Drop 213–214 (restate the return type) and the blank ` *` before them.
- Lines 235–243 (`copyClaudeAssetsToWorktree`): drop 236–237 and the blank ` *` after them. The "always overwriting" contract is lost with the history parenthetical; the policy lines carry the invariant. Keep 239–242, with line 239 trimmed to ` * Post-copy gitignore policy:`.

### 21. Test files
- `__tests__/branchIdentityFallback.test.ts`:
  - Delete banners: 9–11, 35–37, 90–92.
  - Keep: 66 (why the classifier mismatch is set up) and the trailing comment on 141 (why `lastActivity` is null).
- `__tests__/orchestratorLock.test.ts`: delete banners 40 and 99.
- `__tests__/promotionRotAdvisory.test.ts`: delete banners 30 and 83. Each restates the `describe` title below it.
- `__tests__/scenarioTestFixLoop.test.ts`: delete line 3 (`// Mock modules before importing the loop`). `vi.mock` is hoisted, so this is narration.
- `__tests__/workflowInit.test.ts`:
  - Header 1–8: keep only the invariant sentence with `Regression test for criterion 3 (issue #524): ` stripped. The kept text starts `Two initializeWorkflow calls with the same adwId/issueNumber/issueType and a branch-name agent that would return divergent slugs MUST result in exactly one branch being created and the agent being invoked exactly once.`; capitalize the first word only. Drop lines 6–7 (`canonical home` meta-note).
  - Delete banners: 12–14, 125–127, 218–220, 317–319.
  - Delete: 59 (trailing `// not set in test environment`), 118 (narration plus a criterion reference), 260 (trailing `// second call reuses first`), the trailing comments on 301 and 302 (they restate line 299), and 307 (narrates the assertion).
  - Keep: the trailing comment on 24 (why `accessSync` is stubbed), 121 (why `runCommitAgent` is mocked), 204–206 (why `mockReset` as well as `clearAllMocks`), the trailing comment on 231 (why `branchB` is never consumed), 239 (invariant the assertion pins), and 299 (why the second call finds a worktree).
  - Lines 79–81: keep, and strip ` (#794)` so line 81 ends `… assert the boundary-providers passthrough deterministically.`
  - Lines 358–361: strip the leading `#796 hardens the wrong-repo invariant: ` and capitalize the next word. The kept text is `// A contradicting caller-supplied identity is refused (resolveWorkflowProviders throws, caught by initializeWorkflow's surrounding try/catch) rather than served a second, ad-hoc-bound workspace — bindWorkspaceContext is never called and cfg.repoContext falls back to undefined.`, re-wrapped across the same number of lines or fewer.
- `__tests__/worktreeSetup.test.ts`:
  - Delete: 1–6 (header: `E4:` label, narration, and a `#267` pointer; the invariant is stated in `worktreeSetup.ts` and in the `describe` title).
  - Delete banners: 28–30, 48–50, 69–71, 96–98, 122–124, 138–140, 154–156, 177–179, 240–242, 257–259.
  - Delete: the trailing `// guard: skip if file absent in this checkout` on 77.
  - Keep: 75 (the fixture relies on `install.md` being `target:true`), 163 (what the pre-track simulates), and 172 (why the entry must not be gitignored).

### 22. Self-audit
- Grep the 30 files for leftover issue tags, history pointers, banners, and stale claims (see Validation Commands). Expect zero hits in comments. The only `#NNN` hits allowed are inside `describe(...)` string titles.
- Re-read every surviving comment and confirm it states an invariant, an ordering constraint, or a non-obvious reason. Delete any that only narrates.
- `git diff --name-only origin/dev` must list only files from the Touched Files list, plus this spec.

### 23. Run the Validation Commands
- Execute every command below; all must pass.
- If the guard reports `code-changed` for a file, run `git diff origin/dev -- <file>`, find the non-comment edit, and restore it. Do not "fix" it by editing code.

## Validation Commands
Execute every command to validate the chore is complete with zero regressions.

- The guard must pass for all 30 files against the default branch:
  ```
  bun run lint:comment-only adws/phases/__tests__/branchIdentityFallback.test.ts adws/phases/__tests__/gherkinFreeze.test.ts adws/phases/__tests__/orchestratorLock.test.ts adws/phases/__tests__/prReviewCompletion.test.ts adws/phases/__tests__/promotionRotAdvisory.test.ts adws/phases/__tests__/reviewPhase.test.ts adws/phases/__tests__/scenarioTestFixLoop.test.ts adws/phases/__tests__/workflowInit.test.ts adws/phases/__tests__/workflowRepoIdentity.test.ts adws/phases/__tests__/worktreeSetup.test.ts adws/phases/authPause.ts adws/phases/branchIdentityFallback.ts adws/phases/branchNameResolution.ts adws/phases/buildPhase.ts adws/phases/docsSelfCheck.ts adws/phases/documentPhase.ts adws/phases/gherkinFreeze.ts adws/phases/index.ts adws/phases/installPhase.ts adws/phases/orchestratorLock.ts adws/phases/planValidationPhase.ts adws/phases/prReviewCompletion.ts adws/phases/proofPublishPhase.ts adws/phases/scenarioPhase.ts adws/phases/scenarioProof.ts adws/phases/sdlcReviewHandoff.ts adws/phases/stackCoherenceReporter.ts adws/phases/unitTestPhase.ts adws/phases/workflowCompletion.ts adws/phases/worktreeSetup.ts
  ```
- Set `F` to the 26 files that have comments. The following grep must print nothing: no issue tags or history pointers left in comments.
  ```
  F="adws/phases/__tests__/branchIdentityFallback.test.ts adws/phases/__tests__/orchestratorLock.test.ts adws/phases/__tests__/prReviewCompletion.test.ts adws/phases/__tests__/promotionRotAdvisory.test.ts adws/phases/__tests__/scenarioTestFixLoop.test.ts adws/phases/__tests__/workflowInit.test.ts adws/phases/__tests__/worktreeSetup.test.ts adws/phases/authPause.ts adws/phases/branchIdentityFallback.ts adws/phases/branchNameResolution.ts adws/phases/buildPhase.ts adws/phases/docsSelfCheck.ts adws/phases/documentPhase.ts adws/phases/gherkinFreeze.ts adws/phases/index.ts adws/phases/installPhase.ts adws/phases/orchestratorLock.ts adws/phases/planValidationPhase.ts adws/phases/prReviewCompletion.ts adws/phases/proofPublishPhase.ts adws/phases/scenarioPhase.ts adws/phases/scenarioProof.ts adws/phases/sdlcReviewHandoff.ts adws/phases/unitTestPhase.ts adws/phases/workflowCompletion.ts adws/phases/worktreeSetup.ts"; grep -nE '^\s*(//|/?\*).*(#[0-9]+|issue #|criterion [0-9]|user story|E4:|has been relocated|later slice|previous helper functions)' $F
  ```
- Reusing `$F`, the next grep must print nothing: no banners, numbered step labels, or trailing narration left.
  ```
  grep -nE '^\s*//\s*([-=─━═]{3,}|── |─── |--- |[0-9]+\. [A-Z]|Step [0-9])|// (second call reuses first|first call: no existing|second call: worktree exists|guard: skip if file absent|not set in test environment)' $F
  ```
- The stale `config.repoInfo` claim must be gone. This must print nothing:
  ```
  grep -n 'config.repoInfo' adws/phases/buildPhase.ts adws/phases/documentPhase.ts adws/phases/prReviewCompletion.ts adws/phases/unitTestPhase.ts
  ```
- `git diff --name-only origin/dev -- . ':!specs/'` must list only files from Touched Files.
- `bun run lint`: the linter passes.
- `bunx tsc --noEmit`: the root typecheck passes.
- `bunx tsc --noEmit -p adws/tsconfig.json`: the adws typecheck passes.
- `bun run test`: the package `test` script (typecheck) passes.
- `bun run test:unit -- adws/phases`: the phase unit tests still pass.
- `bun run build`: the build passes.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-878"`: the per-issue scenario passes. It asserts that the guard passes for the listed files against the default branch.

## Notes
- Strictly adhere to `.adw/coding_guidelines.md`. Its `Comments` bullet is the acceptance bar for every surviving comment.
- The guard drops comments and whitespace trivia, so any accidental edit to a string, template literal, import, or identifier fails the file as `code-changed`. When removing a trailing `// …` comment (`workflowInit.test.ts` 59, 260, 301, 302; `worktreeSetup.test.ts` 77), delete only the comment and the spaces before it. The guard resolves the default branch itself, so do not pass `--base` in the scenario.
- Keep surviving sentences verbatim, because the PRD puts rewriting rationale prose out of scope. Re-wrapping is allowed in only three cases:
  - a dropped sentence shares a physical line with a kept one (for example, collapsing a multi-line JSDoc to a one-line `/** … */`);
  - a tag or history pointer is stripped mid-sentence (`(#794)`, `(issue #524)`, `See PRD user story 11.`, `#796 hardens the wrong-repo invariant: `, `— preserving the #267 invariant`);
  - the first word needs capitalizing after a stripped leading prefix.
- Comments that explain an empty `catch {}` stay, because they say why the error is swallowed: `docsSelfCheck.ts` 115 and 126, `installPhase.ts` 80, and `gherkinFreeze.ts` 26.
- `index.ts`, `authPause.ts`, `documentPhase.ts`, `planValidationPhase.ts`, `scenarioPhase.ts`, `unitTestPhase.ts`, `workflowCompletion.ts`, `buildPhase.ts`, `prReviewCompletion.ts`, `scenarioProof.ts`, `installPhase.ts`, and `worktreeSetup.ts` lose their whole module header. None of them carries an invariant that is not restated closer to the code.
- The five unchanged files are in the list only because the batch was sized by directory. They must still be passed to the guard, and they will pass unchanged.
- The only new file is this plan. No docs change is needed: the conditional docs describe behaviour, not comments.

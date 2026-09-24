# Chore: Comment sweep 12/16 — adws/agents

## Metadata
issueNumber: `880`
adwId: `ls3bsq-chore-comment-sweep`
issueJson: `{"number":880,"title":"chore: comment sweep 12/16 — adws/agents","body":"## Parent PRD\n\n`specs/prd/comment-debloat.md`\n\n## What to build\n\nSweep batch 12 of 16: **adws/agents** (31 files, 797 comment lines at filing time).\n\nApply the deletion rules from the PRD's *Implementation Decisions › Deletion rules per comment kind* to exactly the files listed under Touched Files. Do not touch any file outside that list. Do not change any code: the only permitted diff is in comments (and the blank lines left behind).\n\nRules for this batch:\n\n- Delete section banner comments (lines of dashes or box-drawing characters).\n- Delete JSDoc blocks that only restate the name of the field or function they sit on.\n- Delete inline comments that narrate the statement directly below them.\n- Strip issue-number tags such as `(#794)` or `(issue #762)` from comments; keep the rest of the comment only if it still carries rationale.\n- Trim mixed comments to the sentences that state an invariant, an ordering constraint, or the reason for a non-obvious choice. Drop the narration sentences.\n- Keep shebang lines and `eslint-disable` directives unchanged.\n\nVerify with the comment-only guard shipped by the blocking issue:\n\n```\nbun run lint:comment-only <every file in Touched Files>\n```\n\n## Acceptance criteria\n\n- [ ] The comment-only guard passes for every file in Touched Files against the default branch (resolved by the guard, never named in the scenario).\n- [ ] No banner comments, name-restating JSDoc, next-line narration, or issue-number tags remain in the listed files.\n- [ ] Every surviving comment states an invariant, an ordering constraint, or the reason for a non-obvious choice.\n\n- [ ] `bun run test` (typecheck) passes.\n- [ ] The per-issue scenario for this issue asserts exactly one behaviour: the comment-only guard passes for the listed files against the default branch.\n\n## Blocked by\n\n- Blocked by #853\n\n## Touched Files\n\n- adws/agents/__tests__/claudeAgent.test.ts\n- adws/agents/__tests__/gitAgent.test.ts\n- adws/agents/__tests__/refactorAgent.test.ts\n- adws/agents/__tests__/rotAnalysisAgent.test.ts\n- adws/agents/__tests__/scenarioFidelityAgent.test.ts\n- adws/agents/agentProcessHandler.ts\n- adws/agents/alignmentAgent.ts\n- adws/agents/bddScenarioRunner.ts\n- adws/agents/buildAgent.ts\n- adws/agents/claudeAgent.ts\n- adws/agents/commandAgent.ts\n- adws/agents/dependencyExtractionAgent.ts\n- adws/agents/diffEvaluatorAgent.ts\n- adws/agents/documentAgent.ts\n- adws/agents/gitAgent.ts\n- adws/agents/index.ts\n- adws/agents/installAgent.ts\n- adws/agents/jsonlParser.ts\n- adws/agents/patchAgent.ts\n- adws/agents/planAgent.ts\n- adws/agents/prAgent.ts\n- adws/agents/refactorAgent.ts\n- adws/agents/resolutionAgent.ts\n- adws/agents/reviewAgent.ts\n- adws/agents/rotAnalysisAgent.ts\n- adws/agents/scenarioAgent.ts\n- adws/agents/scenarioFidelityAgent.ts\n- adws/agents/stepDefAgent.ts\n- adws/agents/testAgent.ts\n- adws/agents/testRetry.ts\n- adws/agents/validationAgent.ts\n\n## User stories addressed\n\n- User stories 12–26\n","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-09-24T08:18:08Z","comments":[],"actionableComment":null}`

## Chore Description
Batch 12 of the comment de-bloat sweep defined in `specs/prd/comment-debloat.md`. Apply the PRD's per-kind deletion rules to exactly the 31 files under `adws/agents/` listed in the issue's Touched Files. The only permitted diff is inside comments (plus the blank lines their removal leaves behind). No code, no string/template-literal content, and no file outside the list may change.

Deletion rules (from the PRD and the updated `Comments` entry in `.adw/coding_guidelines.md`):
- **Banners** (lines of dashes / box-drawing chars, and `// X Agent` group labels that only restate the module named by the export's `from` clause): delete.
- **Name-restating JSDoc** (including `@param`/`@returns` lines that only restate the parameter name or type): delete.
- **Next-line narration** (`// Log final summary` above `log(...)`): delete.
- **Issue-number tags** (`(#822)`, `(issue #762)`, `(#797 …)`): strip; keep the remainder only if it still carries rationale.
- **Mixed comments**: keep only the sentences stating an invariant, an ordering constraint, or the reason for a non-obvious choice. Keep surviving sentences verbatim (the PRD puts prose rewriting out of scope); only re-wrap lines where a dropped sentence shares a physical line with a kept one.
- **Stale claims**: comments that state a hard-coded model (`Uses 'opus' model …`, `Uses 'sonnet' model …`) are false — the code calls `getModelForCommand` — so they are pure noise; delete.
- Shebangs / `eslint-disable` directives: none exist in these files (verified by grep); nothing to preserve beyond the rule.

Baseline measured at planning time: ~780 comment-marker lines across the 31 files; `__tests__/refactorAgent.test.ts`, `__tests__/rotAnalysisAgent.test.ts`, and `__tests__/scenarioFidelityAgent.test.ts` contain zero comments and stay byte-identical (they are still passed to the guard, which reports them as unchanged).

## Relevant Files
Use these files to resolve the chore:

- `specs/prd/comment-debloat.md` — parent PRD; *Implementation Decisions › Deletion rules per comment kind* is the rule source.
- `.adw/coding_guidelines.md` — the `Comments` bullet under *Process & Tooling* is the standard every surviving comment must meet.
- `adws/checkCommentOnly.ts` — the comment-only guard (`bun run lint:comment-only`). It compares the TS parser's leaf-token stream with comments, whitespace, and JSDoc nodes dropped; any token change (including inside a template literal) fails the file as `code-changed`.
- `app_docs/feature-m363ky-comment-only-guard.md` — conditional doc for the guard (troubleshooting `code-changed` reports).
- `app_docs/feature-9gjajh-claude-agents-core.md` — conditional doc owning `claudeAgent.ts`, `commandAgent.ts`, `gitAgent.ts`, `agentProcessHandler.ts`, `jsonlParser.ts`, `index.ts` (context for which comments are real invariants: guardrails injection, auto-memory disable, process-group kill).
- `app_docs/feature-9gjajh-plan-and-build-agents.md` — conditional doc for `planAgent.ts`, `alignmentAgent.ts`, `buildAgent.ts`, `installAgent.ts`.
- `app_docs/feature-9gjajh-pr-and-document-agents.md` — conditional doc for `prAgent.ts`, `documentAgent.ts`, `dependencyExtractionAgent.ts`.
- `app_docs/feature-9gjajh-review-and-patch-agents.md` — conditional doc for `reviewAgent.ts`, `diffEvaluatorAgent.ts`, `patchAgent.ts`, `refactorAgent.ts`, `resolutionAgent.ts`, `validationAgent.ts`.
- `app_docs/feature-9gjajh-scenario-and-stepdef-agents.md` — conditional doc for `bddScenarioRunner.ts`, `scenarioAgent.ts`, `scenarioFidelityAgent.ts`, `stepDefAgent.ts`, `testAgent.ts`, `testRetry.ts`.
- `app_docs/feature-9gjajh-promotion-system.md` — conditional doc covering `rotAnalysisAgent.ts`.

The 31 touched files (the only files that may change):
- `adws/agents/__tests__/claudeAgent.test.ts`, `adws/agents/__tests__/gitAgent.test.ts`, `adws/agents/__tests__/refactorAgent.test.ts`, `adws/agents/__tests__/rotAnalysisAgent.test.ts`, `adws/agents/__tests__/scenarioFidelityAgent.test.ts`
- `adws/agents/agentProcessHandler.ts`, `alignmentAgent.ts`, `bddScenarioRunner.ts`, `buildAgent.ts`, `claudeAgent.ts`, `commandAgent.ts`, `dependencyExtractionAgent.ts`, `diffEvaluatorAgent.ts`, `documentAgent.ts`, `gitAgent.ts`, `index.ts`, `installAgent.ts`, `jsonlParser.ts`, `patchAgent.ts`, `planAgent.ts`, `prAgent.ts`, `refactorAgent.ts`, `resolutionAgent.ts`, `reviewAgent.ts`, `rotAnalysisAgent.ts`, `scenarioAgent.ts`, `scenarioFidelityAgent.ts`, `stepDefAgent.ts`, `testAgent.ts`, `testRetry.ts`, `validationAgent.ts` (all under `adws/agents/`)

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

Line numbers below refer to the files as they are on the default branch at planning time. "Delete" means remove the whole comment (all lines of a JSDoc block). "Keep" means leave the listed lines verbatim. When a JSDoc block keeps only some lines, drop the others and keep the `/** … */` wrapper (collapse to a one-line `/** … */` when a single sentence survives). After removing a comment, leave no double blank lines and no trailing blank line directly after an opening `{`.

### 1. Guardrails before editing
- Do not touch any file outside the 31 listed. `README.md` and `.claude/commands/scenario_writer.md` show as modified in the worktree from outside this chore — do not stage or edit them.
- Never edit string or template-literal content. In `buildAgent.ts`, lines 56–57 (`**URL:** ${pr.url}`, `**Branch:** ${pr.sourceBranch}`) and 115–116 (`**Title:**`, `**URL:**`) are markdown inside template literals, not comments. In `gitAgent.ts`, the `#126` on line 154 is an example of a malformed commit prefix, not an issue tag.

### 2. `adws/agents/claudeAgent.ts`
- Delete: 1–3 (module header), 32–35 (`savePrompt` JSDoc), 46 (`delay` JSDoc), 97 (`// Build the prompt …`), 107 (`// Write initial state …`), 142 (`(#797 plan agent re-ran …)` anecdote line), 204 (`// Mirror the watchdog setup …`), 231 (`// Retry once on expired OAuth token …`).
- Lines 27–28: delete the first sentence (`AgentResult, RateLimitError, and AuthRequiredError live in types/agentTypes.ts.`); keep `// Re-exported here for backward compatibility.`
- Lines 51–55 (`AgentLaunchContext`): drop `Launch-boundary facts threaded into a spawned agent.` and the `(#822)` tag; keep the sentence ``` `gitContext` narrows to `mainRepoPath` only — the seam a spawned agent needs to learn its main repo path without constructing a GitContext of its own.```
- Lines 62–81 (`runClaudeAgentWithCommand` JSDoc): keep `The command is passed as a CLI argument rather than via stdin.`, the `@param args` line, and the `@param launchContext` text with both `(issue #762)` and `(issue #822)` removed. Delete the first sentence and every other `@param` line.
- Lines 156–158: strip `(issue #762)`; keep the rest (target-repo-only + fail-safe rationale).
- Keep unchanged: 17, 98, 136, 138–141, 143, 152, 167–169, 184–186, 193, 226, 232, 238.

### 3. `adws/agents/commandAgent.ts`
- Delete: 1–13 (module header; retry counts restate `MAX_RETRIES`/`MAX_CONSECUTIVE_IDENTICAL_ERRORS`), 32–34 (`OutputValidationError`), 44–48 (`CommandAgentConfig`), 50, 52, 54 (field docs for `command`, `agentName`, `outputFileName`), 70–72 (`CommandAgentOptions`), 74, 76, 78, 80, 82, 84, 86, 88 (field docs for `args` … `phaseName`), 103–105 (`buildRetryPrompt`), 128–131 (`runRetryLoop`), 159, 186, 212–224 (`runCommandAgent`), 256.
- Lines 24–27 (`ExtractionResult`): keep only `Replaces bare throws so the retry loop can distinguish parse failures from code errors.`
- Lines 56–60 (`extractOutput`): drop the first line; keep `Must return ExtractionResult<T> — never throw.` and `When omitted, parsed is undefined on the result and no retry loop runs.`
- Lines 62–66 (`outputSchema`): drop `Optional JSON Schema object for validating extractOutput results.`; keep the `When provided alongside extractOutput …` sentence.
- Line 90 (`subprocessEnv`): keep.
- Line 92 (`launchContext`): strip ` (issue #762)`; keep the rest.
- Lines 96–100 (`CommandAgentResult`): keep only `When T is void, parsed is undefined.`

### 4. `adws/agents/agentProcessHandler.ts`
- Delete: 1–6, 17, 43–46, 82, 93, 150, 165, 173, 182, 312.
- Keep: 24–27 (`toOldModelUsageMap` backward-compatibility reason).

### 5. `adws/agents/gitAgent.ts`
- Delete: 1–4, 97–100, 109–112, 118–120, 140–143, 163, 169–178.
- Lines 12–16 (`formatBranchNameArgs`): drop `Formats structured args for the /generate_branch_name skill.`; keep the sentence explaining why `issueClass` is unused (it is `void`ed in the body).
- Lines 25–28 (`extractSlugFromOutput`): keep only `The skill returns ONLY the slug — strips whitespace and backticks.`
- Line 36 (`@deprecated`): keep.
- Lines 39–48 (`runGenerateBranchNameAgent`): keep only lines 41–42 (does NOT run git operations; branch creation happens in the orchestrator).
- Lines 83–84: keep.
- Lines 130–133 (`extractCommitMessageFromOutput`): keep only `The skill returns ONLY the commit message.`
- Lines 152–157 (regex pattern examples): keep.

### 6. `adws/agents/index.ts`
- Delete: 1–4 (module header) and every `// <Name> Agent …` group label on lines 6, 14, 24, 34, 40, 49, 55, 61, 68, 76, 81, 86, 91, 96, 101, 108, 113, 122, 129, 136, 143, 149 (each restates the module in the following `from` clause). Leave single blank lines between export blocks.

### 7. `adws/agents/jsonlParser.ts`
- Keep lines 1–6 unchanged: the block states why the file exists (backward-compatible re-export barrel for the parser that lives in `adws/core/claudeStreamParser.ts`).

### 8. `adws/agents/planAgent.ts`
- Delete: 1–4, 13–16, 48–52, 59, 66, 80–85, 91, 112–117, 142, 146, 167, 170–172, 184–186, 205–215, 233–243, 278.
- Lines 95–100 (`planFileExists`): keep only `Returns true if the file exists and has content.`
- Lines 128–135 (`correctPlanFileNaming`): keep only lines 130–131 (the agent sometimes swaps `$1`/`$2`, producing `issue-{adwId}-adw-{issueNumber}-...`).
- Line 161 (empty-catch reason): keep.

### 9. `adws/agents/alignmentAgent.ts`
- Delete: line 2 of the header (keep 3–4 inside the `/** */`), 17 (`changes` field), 19 (`summary` field), 34–36, 47–50, 105–108.
- Keep: 13, 15, 131.
- Lines 71–76 (`parseAlignmentResult`): drop line 72; keep 73–75.

### 10. `adws/agents/buildAgent.ts`
- Delete: 1–5, 32–43, 78–91. Do not touch template-literal lines 56–57, 115–116.

### 11. `adws/agents/bddScenarioRunner.ts`
- Delete: 1–7, 11–13, 15, 17, 19, 21.
- Lines 25–39 (`runScenariosByTag`): keep only the `@param tagCommand` lines (33–34) and the `@param env` lines (37–38); delete the rest.

### 12. `adws/agents/dependencyExtractionAgent.ts`
- Delete: 1–4, 16–21, 53–61.

### 13. `adws/agents/diffEvaluatorAgent.ts`
- Header 1–9: keep only lines 7–8 (fallback to `regression_possible` lives at phase level).
- Delete: 29–32.
- Lines 51–56: keep only the `@param options` line (55).

### 14. `adws/agents/documentAgent.ts`
- Delete: 1–4, 37–47.
- Lines 15–18: keep only `The skill returns ONLY the path to the created documentation file.`

### 15. `adws/agents/installAgent.ts`
- Delete: 1–4.
- Lines 15–25: keep only line 17 (`CWD is set to the worktree so the agent reads files from the target repo.`).

### 16. `adws/agents/patchAgent.ts`
- Delete: 1–4.
- Lines 11–26: keep only lines 15–16 (dynamic per-issue output file name is why it cannot use `CommandAgentConfig`). Drop the stale `Uses 'opus' model` sentence and all `@param` lines.

### 17. `adws/agents/prAgent.ts`
- Delete: 1–5, 10–12, 28–31, 35, 38, 52.
- Lines 70–84 (`runPullRequestAgent`): keep line 72 (caller pushes the branch and creates the PR) and the `@param repoOwner`/`@param repoName` lines (82–83, cross-repo reason); delete the rest.

### 18. `adws/agents/refactorAgent.ts`
- Delete: 1–4.
- Lines 11–17: keep only lines 14–16 (forwards the description verbatim, and why).

### 19. `adws/agents/resolutionAgent.ts`
- Delete: 1–4, 41–43, 55–58.
- Lines 84–88: keep only line 87 (`On exhaustion, throws OutputValidationError; …`).

### 20. `adws/agents/reviewAgent.ts`
- Header 1–8: keep only lines 5–7 (passive-judge invariant).
- Lines 15–18 and 27–30: keep only `Matches the JSON output structure defined in .claude/commands/review.md` in each.
- Delete: 38–40, 42, 46, 74–76, 103–114.
- Keep: 44 (`passed` = no blocker issues).
- Lines 88–91 (`formatReviewArgs`): keep only line 90 (positional arg mapping).

### 21. `adws/agents/rotAnalysisAgent.ts`
- Delete: 1–7, 38, 54, 72–76.
- Lines 106–111: keep only the `@param feature` (id format example) and `@param options` lines.

### 22. `adws/agents/scenarioAgent.ts`
- Delete: 1–4.
- Lines 17–27: keep only line 19 (CWD rationale).

### 23. `adws/agents/scenarioFidelityAgent.ts`
- Header 1–6: keep only lines 4–5 (reuse of the `validationAgent` rail, re-pointed).

### 24. `adws/agents/stepDefAgent.ts`
- Delete: 1–4, 38–41.
- Lines 64–75: keep only line 66 (CWD rationale).

### 25. `adws/agents/testAgent.ts`
- Delete: 1–4, 33–35, 37, 39, 41, 63–66, 90–93, 104–111, 143–151, 162, 182–191, 201, 214. (Lines 106/145/184 state hard-coded models that the code no longer uses.)
- Lines 20–23 (`TestResult`): keep only `Matches the JSON output structure defined in .claude/commands/test.md`.
- Keep: 43 (`applicationTestcaseCount` semantics), 70 (no array vs empty array), 208 (why `applicationUrl` is in the payload).

### 26. `adws/agents/testRetry.ts`
- Delete: 1–4, 40, 42, 44, 68, 80.
- Keep: 38 (continuation number is 1-based), 72, 86–87.
- Line 46: strip ` (issue #762)`; keep the rest.
- Lines 50–53: keep only `Derives pass/fail from the JUnit report emitted to \`unitReportPath\`.`

### 27. `adws/agents/validationAgent.ts`
- Delete: 1–3, 46–48, 77–79, 93–95, 105–108.
- Keep: 67 (empty-catch reason).
- Lines 136–140: keep only line 139 (`On exhaustion, throws OutputValidationError; …`).

### 28. Test files
- `__tests__/claudeAgent.test.ts`: delete 199 (`// First call: authExpired`) and 209 (`// Retry also fails with authExpired`). Keep 19, the trailing comment on 39, 65, 79, 87–89, 92, 141, 205.
- `__tests__/gitAgent.test.ts`: keep 6, 101, 118 (all state intent/rationale).
- `__tests__/refactorAgent.test.ts`, `__tests__/rotAnalysisAgent.test.ts`, `__tests__/scenarioFidelityAgent.test.ts`: no comments — no change.

### 29. Self-audit
- Grep the 31 files for leftover issue tags and banners (see Validation Commands). Zero hits expected, except `gitAgent.ts` line containing `/bug: #126:`, which is a commit-prefix example.
- Re-read every surviving comment and confirm it states an invariant, an ordering constraint, or a non-obvious reason. Delete any that only narrates.
- `git diff --stat` must list only files from the Touched Files list.

### 30. Run the Validation Commands
- Execute every command below; all must pass.

## Validation Commands
Execute every command to validate the chore is complete with zero regressions.

- `bun run lint:comment-only adws/agents/__tests__/claudeAgent.test.ts adws/agents/__tests__/gitAgent.test.ts adws/agents/__tests__/refactorAgent.test.ts adws/agents/__tests__/rotAnalysisAgent.test.ts adws/agents/__tests__/scenarioFidelityAgent.test.ts adws/agents/agentProcessHandler.ts adws/agents/alignmentAgent.ts adws/agents/bddScenarioRunner.ts adws/agents/buildAgent.ts adws/agents/claudeAgent.ts adws/agents/commandAgent.ts adws/agents/dependencyExtractionAgent.ts adws/agents/diffEvaluatorAgent.ts adws/agents/documentAgent.ts adws/agents/gitAgent.ts adws/agents/index.ts adws/agents/installAgent.ts adws/agents/jsonlParser.ts adws/agents/patchAgent.ts adws/agents/planAgent.ts adws/agents/prAgent.ts adws/agents/refactorAgent.ts adws/agents/resolutionAgent.ts adws/agents/reviewAgent.ts adws/agents/rotAnalysisAgent.ts adws/agents/scenarioAgent.ts adws/agents/scenarioFidelityAgent.ts adws/agents/stepDefAgent.ts adws/agents/testAgent.ts adws/agents/testRetry.ts adws/agents/validationAgent.ts` — comment-only guard against the default branch; must print `✔ PASS` for 31 files.
- `grep -nE '(#[0-9]+\)|issue #[0-9]+|\(#[0-9]+)' adws/agents/*.ts adws/agents/__tests__/*.ts | grep -E '^\S+:[0-9]+:\s*(//|/?\*)'` — must print nothing (no issue tags left in comments).
- `grep -nE '^\s*//\s*([-=─━═]{3,}|[A-Z][A-Za-z ]+ Agent\b)' adws/agents/*.ts adws/agents/__tests__/*.ts` — must print nothing (no banners or group labels).
- `grep -cE '^\s*(//|/\*|\*)' adws/agents/index.ts` — must print `0` (every `index.ts` group label, including `// BDD Scenario Runner` and `// Test Retry …`, is gone).
- `git diff --name-only origin/dev -- . ':!README.md' ':!.claude/commands/scenario_writer.md' ':!specs/'` — must list only files from Touched Files.
- `bun run lint` — linter passes.
- `bunx tsc --noEmit` — root typecheck passes.
- `bunx tsc --noEmit -p adws/tsconfig.json` — adws typecheck passes.
- `bun run test` — package `test` script (typecheck) passes.
- `bun run test:unit -- adws/agents` — agent unit tests still pass.
- `bun run build` — build passes.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-880"` — the per-issue scenario (guard passes for the listed files against the default branch) passes.

## Notes
- Strictly adhere to `.adw/coding_guidelines.md`; its `Comments` bullet is the acceptance bar for every surviving comment.
- The guard drops JSDoc nodes and comment/whitespace trivia, so any accidental edit to a string, template literal, import, or identifier fails the file as `code-changed`. If a file fails, `git diff` it against `origin/dev` and restore the non-comment tokens; do not "fix" by editing code.
- Keep surviving sentences verbatim; the PRD puts rewriting rationale prose out of scope. Re-wrapping is allowed only where a dropped sentence shares a physical line with a kept one (e.g. collapsing a multi-line JSDoc to a one-line `/** … */`).
- Comments that document an empty `catch {}` (`claudeAgent.ts` 152, `planAgent.ts` 161, `validationAgent.ts` 67) stay: they explain why the error is swallowed.
- The three zero-comment test files are in the list only because the batch was sized by directory; they must still be passed to the guard and will pass unchanged.
- No new files besides this plan. No docs change is needed: the conditional docs describe behaviour, not comments.

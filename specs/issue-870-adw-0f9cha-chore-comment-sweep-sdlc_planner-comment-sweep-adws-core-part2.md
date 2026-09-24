# Chore: Comment sweep 2/16 — adws/core (2/3)

## Metadata
issueNumber: `870`
adwId: `0f9cha-chore-comment-sweep`
issueJson: `{"number":870,"title":"chore: comment sweep 2/16 — adws/core (2/3)","parentPrd":"specs/prd/comment-debloat.md","blockedBy":[853],"touchedFiles":48}`

## Chore Description
This is sweep batch 2 of 16 from the comment de-bloat PRD (`specs/prd/comment-debloat.md`). Its blocker, #853, has merged (commit `34901ec0`). That merge shipped:
- the new `**Comments**` entry in `.adw/coding_guidelines.md`
- the comment-only guard `adws/checkCommentOnly.ts`, run as `bun run lint:comment-only`

Apply the PRD's *Deletion rules per comment kind* to the 48 files under **Touched Files**, and to no other file:

| Comment kind | Action |
|---|---|
| Section banners (`// ----`, `// ── X ──`, `// --- X ---`) | Delete |
| JSDoc that only restates the field or function name, including `@param`/`@returns` lines that restate the signature | Delete |
| Inline narration of the next statement | Delete |
| Issue-number tags (`(#794)`, `(issue #762)`, `Since #791,`, `per #797`) | Strip. Keep the rest of the comment only if rationale remains. |
| Mixed comments | Keep only the sentences that state an invariant, an ordering constraint, or the reason for a non-obvious choice |
| Shebangs, `eslint-disable` directives | Keep. None exist in this batch. |

**Hard constraint: comments only.** No token of code may change. String and template literals are code, for example `'Failed to fetch issue #42: boom'` in `issueRecord.test.ts` and the `**Labels:**` template text in `issueClassifier.ts`. The guard compares each file's TypeScript token stream (trivia dropped) against the default branch, so any code edit fails it. Blank lines left behind are free, but collapse runs of blank lines to one so the files stay tidy.

The sweep only trims and deletes. It does not reword the prose it keeps (PRD › Out of Scope). The small exceptions are:
- the grammar fix needed when a leading `Since #NNN,` is stripped (capitalise the next word)
- turning a multi-line JSDoc that now has one sentence into a one-line `/** … */`

Measured at planning time: 925 comment lines across the 48 files. 13 test files and 2 source files contain no comments at all. They stay byte-identical and are included only because the guard runs over the full list.

## Relevant Files
Use these files to resolve the chore:

- `specs/prd/comment-debloat.md`: parent PRD. *Implementation Decisions › Deletion rules per comment kind* is the rule set. *Out of Scope* forbids rewriting kept prose.
- `.adw/coding_guidelines.md`: the `**Comments**` entry under Process & Tooling is the acceptance bar for every surviving comment.
- `adws/checkCommentOnly.ts`: the comment-only guard used for verification. Use it as-is; do not edit it.
- `app_docs/feature-m363ky-comment-only-guard.md` (conditional doc): explains the guard's `code-changed` / `absent-at-base` / … violation reasons if a file fails.
- `eslint.config.js`: extends `eslint.configs.recommended`, which enables `no-empty`. An empty `catch {}` block is allowed only if it contains a comment. This matters for `hungOrchestratorDetector.ts:119`.
- The 48 Touched Files (per-file directives in Step 2 and Step 3).

No new files. No docs updates: the owning `app_docs/*` describe behaviour, and behaviour does not change.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### 1. Baseline
- Confirm the guard exists and runs: `bun run lint:comment-only adws/core/adwId.ts` should PASS on the untouched file.
- The working tree already has unrelated modifications to `README.md` and `.claude/commands/scenario_writer.md`. Do not touch or revert them as part of this chore.

### 2. Test files (`adws/core/__tests__/`)
Line numbers are from the pre-sweep file.

- **No change (zero comments):**
  - `adwVersion.test.ts`, `environment.test.ts`, `issueRecord.test.ts`, `prReviewInvocation.test.ts`
  - `promotionSweepDecider.test.ts`, `providerConfig.test.ts`, `resolveFreezeGuard.test.ts`, `resolveResumeSpawn.test.ts`
  - `sshCloneUrl.test.ts`, `stepDefDetection.test.ts`, `testVerdict.test.ts`, `upgradeFailureCap.test.ts`
  - `workspaceTrust.test.ts`
- `adwLabels.test.ts`: delete the 4 `// ── … ──` banners (lines 8, 14, 70, 106).
- `adwYmlConfig.test.ts`: delete the 6 `// ── … ──` banners (lines 17, 61, 116, 166, 217, 225).
- `docsIndexHealth.test.ts`: keep the three trailing fixture comments (lines 25, 28, 221). They explain why each fixture row exists.
- `githubAppAuth.test.ts`: in the header (lines 1–7), delete the first sentence (`#701 export-surface assertions, relocated … re-export shim).`). Keep `Verifies that the deleted writers are gone and the surviving exports resolve.` and `Intentionally behavioural — no source-text inspection.`
- `hashComputer.test.ts`:
  - Delete the helper JSDoc on `makeMemDeps`, `makeAdwInit`, and `abs` (lines 9, 25, 32).
  - Delete the 7 `// ── §N … ──` banners (lines 37, 64, 89, 119, 150, 162, 171).
  - Keep line 53 (`Independently compute: sorted order is alpha < beta`).
- `issueClassifier.test.ts`: delete the four `// Test A/B/C/D: …` labels (lines 34, 45, 90, 102). They restate the `describe`/`it` titles.
- `stateHelpers.test.ts`:
  - Header (lines 1–5): delete the first sentence. Strip `#529 ` from the second so it reads `Covers the regression where a failed init-orchestrator shadows the real sdlc-orchestrator when an adwId is reused across two runs.`
  - Delete line 68 (narration).
  - Keep line 81 `// no orchestratorScript`.
- `upgradeClaim.test.ts`: delete the 8 `// ── … ──` banners (lines 12, 38, 59, 88, 118, 183, 203, 216).
- `workspaceBinding.test.ts`: delete the 2 `// ── … ──` banners (lines 13, 63).

### 3. Source files (`adws/core/`)

- **No change (zero comments):** `resolveFreezeGuard.ts`, `resolveVerdict.ts`.

#### `adwId.ts`
- Delete the file header (lines 1–6: "Extracted from utils.ts …" is history).
- Delete both 3-line `// ----` banners.
- Delete the `slugify` JSDoc (it narrates the body).
- In `generateAdwId`'s JSDoc, keep only the `Note: The \`adw-\` prefix is NOT included here because …` sentence. Delete the summary and format lines.

#### `claudeStreamParser.ts`
- Delete the file header (narration plus "Moved from …" history).
- Delete all six 3-line `// ----` banners.
- Delete these name-restating JSDoc blocks:
  - `TextContentBlock`, `ToolUseContentBlock`, `ToolResultContentBlock`
  - `ContentBlock`, `JsonlAssistantMessage`, `JsonlResultMessage`, `JsonlMessage`
  - `ProgressInfo`, `ProgressCallback`, `JsonlParserState`
  - `extractTextFromAssistantMessage`, `countErroredToolResultBlocks`, `extractToolUseFromMessage`, `parseJsonlOutput`
- Strip ` (issue #762)` from the `is_error` field doc (line 37) and from the `deniedToolCallCount` doc (line 121). Keep the rest of both.
- Keep these field docs: `tokenEstimate`, `primaryModel`, `lineBuffer`, and the five `*Detected` / `rateLimitRejected` flag docs.
- In `parseJsonlOutput`:
  - Delete narration lines 179, 196, 249, 262, 268.
  - Keep line 183 (the partial-line invariant).
  - Delete the `// --- Structured detection: … ---` lines (201, 209, 217).
  - Keep lines 202–204 (why `tool_result` is counted in two shapes).

#### `docsGuards.ts`
- Lines 1–2: keep the first sentence (`Module docs are current-state references; 400 lines is a generous ceiling signalling genuine bloat.`). Delete `Intentionally a defined constant — easy to retune.`
- Delete the three 3-line `// ----` banners.
- Keep the comments on `ownershipRoot`, `isSegmentPrefix`, `checkBloat`, and `checkRegrowth`.

#### `guardrailsGate.ts`
- Header: strip ` (issue #762)`. Keep the rest.
- Delete the JSDoc on `GuardrailsDecision`, `GuardrailsGateInput`, `GuardrailsGateDeps`, and `productionGuardrailsGateDeps`.
- `resolveGuardrailsDecision` JSDoc: delete the first sentence. Keep `Guard-clause chain, evaluated in order:`, the numbered list, and `Only once all four pass …`.
- Delete the `// ----` Production dependency wiring banner.
- Keep the JSDoc on `notifyProbeFailureOnce`, `resetGuardrailsAlertMemo`, `setGuardrailsGateDepsForTesting`, and `resolveGuardrailsDecisionForSpawn`.

#### `hashComputer.ts`
- Header: delete the title line `hashComputer — framework content hash.`. Keep the two paragraphs below it.
- Delete the JSDoc on `HashComputerDeps`, `parseHashInputs`, `readHashInput`, and `computeFrameworkHash`. The ordering invariant survives at the sort.
- Keep lines 129–132 and line 144 (CLI-guard reason).

#### `hungOrchestratorDetector.ts`
- Header: delete the title line and the first paragraph (lines 2–6). They duplicate `findHungOrchestrators`' JSDoc. Keep the `No kills, no state writes …` paragraph.
- Delete the three 3-line `// ----` banners.
- Keep the `findHungOrchestrators` JSDoc.
- **Keep line 119** (`// Skip any entry that causes an unexpected error`). It sits alone in an empty `catch {}`, and `no-empty` fails lint without it.

#### `issueClassifier.ts`
- Delete the file header.
- Delete the JSDoc on `IssueClassificationResult`, `classifyWithIssueCommand`, and `classifyGitHubIssue`.
- Keep the JSDoc on `ClassifiableIssue` and `ClassifyIssueForTriggerDeps`.
- `classifyIssueForTrigger` JSDoc:
  - Delete the first two sentences and the `@param`/`@returns` lines.
  - Keep the chokepoint paragraph with ` (#618)` stripped.
- Inline lines 133–137:
  - Delete the sentence `Enforced here (all four triggers funnel through this chokepoint) so a caller that omits labelRouting cannot silently fall through to the LLM.` It duplicates the JSDoc.
  - Keep the first sentence and the `Multiple conflicting adw:<type> labels …` sentence.
- Keep line 154 (retry-path reason) and line 209 (backward-compatible re-export).

#### `jsonParser.ts`
- Delete the file header.
- `extractJson` JSDoc: keep only `Handles cases where the output contains additional text around the JSON.`
- `extractJsonArray` JSDoc: keep that same sentence plus `@returns Parsed array of type T, or empty array on failure`.

#### `launchGitContext.ts`
- **Header:**
  - Keep paragraph 1.
  - Paragraph 2: strip `Since #791, ` and capitalise the next word (`The built context …`).
  - Delete paragraph 3 (lines 11–17: `Since #794` / `Since #823` history).
- **`LaunchGitContextDeps`:**
  - Delete the interface JSDoc.
  - Delete the `resolveGitIdentity` field doc.
  - For `getRepoInfo`, `frameworkRepoRoot`, `targetReposDir`, `platform`, and `loadProviderConfig`, keep only the `Defaults to …` sentence.
  - `forgeProviders`: delete `Assembles the bound provider triple.` and keep the rest.
  - `forgeDeps`: delete the first sentence (`Builds ADW's ForgeProviderDeps … for the selected forges.`). Keep `Defaults to buildAdwForgeDeps from ./forgeWiring.` and the thunk-timing sentences.
  - Keep `resolveToken`, `tokenProvider`, and `forgeCredentials` whole.
- `launchCredentialsOptions` JSDoc: change `preserves #819 parity:` to `preserves parity:`. Keep the rest.
- `resolveLaunchCredentials` JSDoc: delete the first sentence. Keep the injection/mint-order sentences.
- `buildLaunchGitContext` JSDoc: keep only `Building a context this way performs no provider-config read and gains no new failure mode.`
- Keep whole:
  - `LAUNCH_CREDENTIAL_FORGE`, `tokenProviderFromResolver`
  - `LaunchBoundary` and its two field docs
  - `freezeBoundary`, `buildLaunchBoundary`
  - the inline lines 228–233 (ordering constraint)

#### `pauseQueue.ts`
- Header: delete the title line. Keep the concurrency paragraph.
- Delete the JSDoc on `PAUSE_QUEUE_PATH` and `PausedWorkflow`.
- `PausedWorkflow` field docs:
  - Delete: `adwId`, `issueNumber`, `orchestratorScript`, `pausedAtPhase`, `pauseReason`, `branchName`.
  - Keep: `pausedAt`, `lastProbeAt` (ISO 8601), `probeFailures`, `worktreePath` (absolute), `extraArgs`.
- Function JSDoc:
  - `readPauseQueue` → `/** Returns an empty array if the file is missing or unreadable. */`
  - `writePauseQueue`: keep whole (atomicity).
  - `appendToPauseQueue` → `/** Skips duplicates by adwId. */`
  - `removeFromPauseQueue`: delete.
  - `updatePauseQueueEntry` → `/** No-op if not found. */`

#### `phaseRunner.ts`
- Delete the file header.
- Delete the JSDoc on `PhaseResult`, `PhaseFn`, `CostTracker`, `accumulate`, and `persist`.
- Keep line 74.
- `commit` → `/** Errors are swallowed so cost failures never abort a workflow. */`
- `recordCompletedPhase` → `/** Reads existing metadata to avoid clobbering other fields. */`
- `runPhase` JSDoc: keep only the `Catches RateLimitError …` and `When phaseName is provided …` sentences.
- Lines 123–125: delete line 123. Keep 124–125.
- Keep lines 131, 136, 182, 192, and 233.
- Delete line 144.
- `runPhasesSequential`: keep only `Each phase sees the updated config.totalModelUsage from the previous phase.`
- `runPhasesParallel`: keep only `Use only when the phases have no data dependency on each other.`

#### `prReviewInvocation.ts`
- Header:
  - Strip ` (#820, FINDING 4)`.
  - Delete the trailing clause `— the three branches and their message texts are verbatim from the legacy \`resolvePrReviewInvocation\``, so that sentence ends at `process.exit`.
- Keep the `resolvePrReviewInvocation` JSDoc.

#### `promotionIssueBody.ts`
- Header: change `a #734-shaped precise relocation instruction` to `a precise relocation instruction`.
- Keep the `specs/issue-734-…` path. It is a file reference, not a tag.
- Keep the rest of the header.

#### `promotionReconcileLink.ts`
- Delete the `labels` field doc (`From \`gh --json labels\`.`).
- Keep everything else.

#### `promotionTagState.ts`
- No change. Every comment states an invariant or a reason. "PRD user stories 16-17" are not issue numbers.

#### `providerConfig.ts`
- Header: delete the last sentence (`Moved out of the now-deleted … (#819); … (#823).`).
- Delete the `ProviderConfig` JSDoc.
- `parseCodeHostForge` / `parseIssueTrackerForge`: delete the first sentence. Keep `Case-insensitive. Throws, …`.
- `loadProviderConfig`: keep only `Returns GitHub defaults when the file is absent or sections are missing.`

#### `slackNotifier.ts`
- Header → `/** No-throw at boundary — failures are logged but never propagate. */`

#### `stageClassifier.ts`
- Header:
  - Delete the title line `Stage classification taxonomy for recovery routing.`
  - Delete the `This module is behavior-preserving … Subsequent PRD slices may reclassify …` paragraph.
  - Keep the six-classes paragraph, the table, and the dynamic-string rationale.
- `classifyStage`: delete `Exhaustive classifier over the closed WorkflowStage union.` Keep the rest.
- `classifyStageString`:
  - Trim the second paragraph to `Handles dynamic phaseRunner strings (…) that are not WorkflowStage literals.` Drop the `centralizing … previously scattered …` history.
  - Keep the first line and the precedence list.

#### `targetRepoManager.ts`
- **Header:**
  - Delete line 2 (`… — shim adapter (issue #700).`).
  - Delete paragraph 4–10 (absorbed/fixing history).
  - Paragraph 12–15 becomes: `The core clones exactly the URL it is handed, so this shim is the site that hands it a ready one: it converts a published HTTPS clone URL to SSH (\`convertToSshUrl\`) before calling into the core.`
  - Paragraph 17–19: strip `Since #846 ` and capitalise (`It also grants …`).
  - Keep `Zero raw git/gh strings remain in this file.`
- Delete both 3-line `// ----` banners.
- Delete the `getTargetRepoWorkspacePath` JSDoc.
- Delete line 45 (`Re-export utilities at the stable paths`).
- Keep the `cloneTargetRepo` JSDoc, including `@deprecated`.
- `ensureTargetRepoWorkspace` JSDoc:
  - Delete the first two sentences (narration).
  - Keep the `getDefaultBranch` ordering paragraph.
  - Trust paragraph: `Since #846, also grants` → `Also grants`. Keep the rest.
  - Keep `Returns the absolute workspace path.`

#### `testVerdict.ts`
- `computeTestVerdict` JSDoc: delete `Pure function: maps … → verdict. No I/O — directly unit-testable.` Keep the branch table.

#### `unaddressedComments.ts`
- Header: delete paragraph 1 (history ending `(#820)`). Keep paragraph 2.
- Keep the `ADW_COMMIT_PATTERN` JSDoc.
- `getLastAdwCommitTimestamp` → `/** Returns null if no ADW commits are found. */`
- Delete the JSDoc on `UnaddressedCommentCandidate` and `UnaddressedCommentReads`.
- `readUnaddressedComments`: keep the first two sentences and end at `timestamp.` Drop the `— the same laziness the legacy composite had …` clause.

#### `upgradeFailureCap.ts`
- Delete the file header.
- `UPGRADE_FAILURE_SIGNATURE` → `/** First line of the comment buildUpgradeFailureComment emits. */`
- Delete the JSDoc on `IssueCommentRecord` and `countUpgradeFailureComments`.
- `isUpgradeFailureComment`: delete the first paragraph. Keep the `Deliberately excludes …` paragraph.

#### `workflowCommentParsing.ts`
- Delete the file header. It points at the deleted `github/workflowCommentsBase.ts`.
- Delete these JSDoc blocks:
  - `STAGE_HEADER_MAP`, `ADW_COMMENT_PATTERN`, `ADW_SIGNATURE_PATTERN`
  - `isAdwComment`, `isActionableComment`, `isCancelComment`, `isRetryComment`
  - `truncateText`, `extractBranchNameFromComment`, `extractPrUrlFromComment`, `detectRecoveryState`
- Keep these whole: `STAGE_ORDER`, `ADW_SIGNATURE`, `formatModelName`, `formatRunningTokenFooter`, `ACTIONABLE_COMMENT_PATTERN`, `CANCEL_COMMENT_PATTERN`.
- `RETRY_COMMENT_PATTERN`: delete `Pattern matching the \`## Retry\` heading.` Keep the recovery semantics.
- Trim to one sentence each:
  - `extractActionableContent` → `Returns null if no heading or empty content.`
  - `parseWorkflowStageFromComment` → `Returns null if not a workflow comment.`
  - `extractAdwIdFromComment` → `Matches the \`{random}-{slug}\` format produced by generateAdwId.`
  - `extractLatestAdwId` → `Scans issue comments newest-to-oldest and returns the first adw-id found.`
  - `extractPlanPathFromComment` → `Pattern: \`specs/issue-{number}-plan.md\``

#### `workspaceTrust.ts`
- **Header:**
  - Strip ` (issue #846)`.
  - In the "This lives in `adws/core/` …" sentence, delete the clause `, and that library is deleted by #840`. The sentence then reads `… — workspace trust is a Claude-Code concern, not a git one — and not on the per-spawn path …`.
  - Keep everything else.
- Delete the three 3-line `// ----` banners.
- Delete the `fsDeps` and `log` field docs. Keep `homedir`.
- Keep the `withTrustedProject` JSDoc.
- `claudeConfigPath`: delete `Resolves the \`~/.claude.json\` path.` Keep the `homedir` / `$HOME` reason.
- `ensureWorkspaceTrusted`: delete the first line. Keep the never-throws / atomic-write paragraph.

### 4. Residue scan
- Rerun the banner and issue-tag greps from Validation Commands. Both must print nothing.
- Reread each edited file's surviving comments against the `**Comments**` guideline.

### 5. Run the Validation Commands
- Run every command below. All must succeed.
- If the guard reports `code-changed` for a file, `git diff` that file, find the non-comment edit, and restore it.

## Validation Commands
Execute every command to validate the chore is complete with zero regressions.

- Comment-only guard over every Touched File (default branch resolved by the guard). This is the acceptance check:
  ```
  bun run lint:comment-only adws/core/__tests__/adwLabels.test.ts adws/core/__tests__/adwVersion.test.ts adws/core/__tests__/adwYmlConfig.test.ts adws/core/__tests__/docsIndexHealth.test.ts adws/core/__tests__/environment.test.ts adws/core/__tests__/githubAppAuth.test.ts adws/core/__tests__/hashComputer.test.ts adws/core/__tests__/issueClassifier.test.ts adws/core/__tests__/issueRecord.test.ts adws/core/__tests__/prReviewInvocation.test.ts adws/core/__tests__/promotionSweepDecider.test.ts adws/core/__tests__/providerConfig.test.ts adws/core/__tests__/resolveFreezeGuard.test.ts adws/core/__tests__/resolveResumeSpawn.test.ts adws/core/__tests__/sshCloneUrl.test.ts adws/core/__tests__/stateHelpers.test.ts adws/core/__tests__/stepDefDetection.test.ts adws/core/__tests__/testVerdict.test.ts adws/core/__tests__/upgradeClaim.test.ts adws/core/__tests__/upgradeFailureCap.test.ts adws/core/__tests__/workspaceBinding.test.ts adws/core/__tests__/workspaceTrust.test.ts adws/core/adwId.ts adws/core/claudeStreamParser.ts adws/core/docsGuards.ts adws/core/guardrailsGate.ts adws/core/hashComputer.ts adws/core/hungOrchestratorDetector.ts adws/core/issueClassifier.ts adws/core/jsonParser.ts adws/core/launchGitContext.ts adws/core/pauseQueue.ts adws/core/phaseRunner.ts adws/core/prReviewInvocation.ts adws/core/promotionIssueBody.ts adws/core/promotionReconcileLink.ts adws/core/promotionTagState.ts adws/core/providerConfig.ts adws/core/resolveFreezeGuard.ts adws/core/resolveVerdict.ts adws/core/slackNotifier.ts adws/core/stageClassifier.ts adws/core/targetRepoManager.ts adws/core/testVerdict.ts adws/core/unaddressedComments.ts adws/core/upgradeFailureCap.ts adws/core/workflowCommentParsing.ts adws/core/workspaceTrust.ts
  ```
- No other files changed: `git diff --name-only origin/dev -- adws` lists only Touched Files.
- No banners remain; must print nothing:
  `grep -nE '^\s*//\s*(-{3,}|─{2,}|={3,})' <Touched Files>`
- No issue-number tags remain in comments; must print nothing:
  `grep -nE '^\s*(//|/?\*).*(#[0-9]{2,}|issue #)' <Touched Files>`
- `bun run lint`: ESLint. Catches an emptied `catch {}` (`no-empty`).
- `bun run test`: typecheck (`bunx tsc --noEmit`). This is the issue's acceptance command.
- `bunx tsc --noEmit -p adws/tsconfig.json`: additional type check.
- `bun run test:unit`: Vitest. The 22 swept test files must still pass.
- `bun run lint:git-guard`: git/gh guard over `adws/**`. This is a regression check; comment edits cannot trip it.
- `bun run build`

## Notes
- **Coding guidelines.** `.adw/coding_guidelines.md` › `**Comments**`: comment only invariants, ordering constraints, and reasons for non-obvious choices. No next-line narration, no banners, no issue numbers, no name-restating JSDoc. This is the test every surviving comment must meet. No code refactoring is in scope: the guard forbids any non-comment change.
- **Guard mechanics.**
  - The guard reads each file at `origin/<default branch>` via `GitContext.show`.
  - It resolves the default branch through `buildLaunchBoundary(null).providers.codeHost.getDefaultBranch()` and fetches it first, so it needs forge auth.
  - Never pass a hardcoded `--base` in the per-issue scenario. The issue requires the default branch to be resolved by the guard.
- **Per-issue scenario.** The scenario for #870 asserts exactly one behaviour: the comment-only guard passes for the 48 listed files against the default branch. The step definition should call the guard's importable runner (`runCommentOnlyCheck` from `adws/checkCommentOnly.ts`) with the file list and assert `exitCode === 0`. Mirror the shape of `features/per-issue/step_definitions/feature-853.steps.ts`.
- **Judgement calls resolved here.** Where a rationale is duplicated between a module header and a function JSDoc (`guardrailsGate.ts`, `hungOrchestratorDetector.ts`, `hashComputer.ts`, `issueClassifier.ts`), the plan keeps one copy. Follow the per-file directives as written; do not re-litigate them.
- **Stale references.** Some kept comments mention modules that were deleted, such as `adws/gitContext/repoWorkspace.ts` in `targetRepoManager.ts` and `workspaceTrust.ts`. Leave their wording as-is. Rewriting kept prose is out of scope per the PRD.
- **Merge path.** The batch auto-merges on the guard. No `hitl` label. Git history is the recovery path for any over-trim.

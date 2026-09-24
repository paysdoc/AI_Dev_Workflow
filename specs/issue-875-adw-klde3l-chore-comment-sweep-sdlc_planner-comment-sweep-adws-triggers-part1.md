# Chore: Comment sweep 7/16 — adws/triggers (1/2)

## Metadata
issueNumber: `875`
adwId: `klde3l-chore-comment-sweep`
issueJson: `{"number":875,"title":"chore: comment sweep 7/16 — adws/triggers (1/2)","parentPrd":"specs/prd/comment-debloat.md","blockedBy":[853],"touchedFiles":35}`

## Chore Description
This is sweep batch 7 of 16 from the comment de-bloat PRD (`specs/prd/comment-debloat.md`). Its blocker, #853, has merged. That merge shipped:
- the `**Comments**` entry in `.adw/coding_guidelines.md`
- the comment-only guard `adws/checkCommentOnly.ts`, run as `bun run lint:comment-only`

Apply the PRD's *Deletion rules per comment kind* to the 35 files under **Touched Files**, and to no other file:

| Comment kind | Action |
|---|---|
| Section banners (`// ── X ──`, `// ─── X ───`, `// ─ X ─`, `// --- X ---`) | Delete |
| JSDoc that only restates the field or function name, including `@param`/`@returns` lines that restate the signature | Delete |
| Inline narration of the next statement | Delete |
| Issue-number tags (`(#822)`, `(issue #565)`, `per slice #463`, `Regression for #398/#399:`) | Strip. Keep the rest of the comment only if rationale remains. |
| Mixed comments | Keep only the sentences that state an invariant, an ordering constraint, or the reason for a non-obvious choice |
| Entry-script headers (`trigger_cron.ts`, `trigger_shutdown.ts`) | Keep the usage line. Delete the numbered step list. |
| Shebangs, `eslint-disable` directives | Keep. `trigger_shutdown.ts` line 1 is a shebang. No `eslint-disable` directives exist in this batch. |

**Hard constraint: comments only.** No token of code may change. String and template literals are code. Examples in this batch:
- the `it('… (regression #398/#399)', …)` title in `triggerCronAwaitingMerge.test.ts`
- the `#700` fixture strings in `regionOverlapSignals.test.ts`
- the `log(\`Cancel #${issueNumber}: …\`)` messages in `cancelHandler.ts`

The guard compares each file's TypeScript token stream (trivia dropped) against the default branch, so any code edit fails it. Blank lines left behind are free, but collapse runs of blank lines to one so the files stay tidy.

The sweep only trims and deletes. It does not reword the prose it keeps (PRD › Out of Scope). The small exceptions are:
- the grammar fix needed when a stripped tag leaves a dangling clause (end the sentence with a period, or capitalise the next word)
- dropping a list number (`6. `) from a step comment whose sibling steps were deleted
- turning a multi-line JSDoc that now has one sentence into a one-line `/** … */`

Measured at planning time: about 874 comment lines across the 35 files. `concurrencyGuard.test.ts`, `cronRepoResolver.test.ts`, and `spawnGate.ts` have no comments. They stay byte-identical and are listed only because the guard runs over the full list.

## Relevant Files
Use these files to resolve the chore:

- `specs/prd/comment-debloat.md`: parent PRD. *Implementation Decisions › Deletion rules per comment kind* is the rule set. *Out of Scope* forbids rewriting kept prose.
- `.adw/coding_guidelines.md`: the `**Comments**` entry under Process & Tooling is the acceptance bar for every surviving comment.
- `adws/checkCommentOnly.ts`: the comment-only guard used for verification. Use it as-is; do not edit it.
- `app_docs/feature-m363ky-comment-only-guard.md` (conditional doc): explains the guard's `code-changed` / `absent-at-base` / … violation reasons if a file fails.
- `eslint.config.js`: extends `eslint.configs.recommended`, which enables `no-empty` without `allowEmptyCatch`. An empty `catch {}` or loop body `{}` is allowed only if it contains a comment. Several comments in this batch are the only content of such a block and must stay (listed per file below).
- `features/per-issue/step_definitions/feature-853.steps.ts`: the shape the per-issue scenario's step definition should mirror.
- The 35 Touched Files (per-file directives in Step 2 and Step 3).

No new files. No docs updates: the owning `app_docs/*` describe behaviour, and behaviour does not change.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### 1. Baseline
- Confirm the guard exists and runs: `bun run lint:comment-only adws/triggers/spawnGate.ts` should PASS on the untouched file. It did at planning time.
- `origin/dev` moved to `dab70ca3` (#892, adws/core part 1) after this branch was cut. That merge touched no file in `adws/triggers/`, so the guard's base for this batch matches the branch point.
- The working tree already has an unrelated modification to `README.md`. Do not touch, revert, or reformat it as part of this chore. The previous batch needed a follow-up patch to restore README entries lost in a sweep.

### 2. Test files (`adws/triggers/__tests__/`)
Line numbers are from the pre-sweep file.

- **No change (zero comments):** `concurrencyGuard.test.ts`, `cronRepoResolver.test.ts`.
- `cronIssueListing.test.ts`: no change. Lines 65–66 explain what the assertion proves.
- `cronStageResolver.test.ts`:
  - Delete the 5 `// ── … ──` banners (lines 10, 50, 99, 140, 148).
  - Keep line 40 (why the fixture resolves to `latest-adw-id`).
- `docsIndexSweep.test.ts`:
  - Delete the 3 banners (lines 3, 9, 19).
  - Keep the `makeFakeBoundary` JSDoc (line 30). It states why no `SweepBase` is prepared.
- `issueOpenedRouter.test.ts`: delete the 5 banners (lines 13, 44, 76, 108, 164).
- `pauseQueueScanner.test.ts`:
  - Delete the banners at lines 4, 74, 86, 115, 265.
  - Delete the `makeFakeChild` JSDoc (line 104). It restates the name.
  - Delete line 121 (`Default: worktree exists`, narration).
  - Keep line 124. The parenthetical ties the default to `makeEntry`'s adwId.
  - Delete lines 135–137 (banner plus `issue #797` bug history).
  - Keep lines 186, 225, 250 (timer ordering relative to the readiness window).
  - Delete lines 351–353 (banner with `#565 / #701`, auth-model history, and a restatement of the test titles).
  - Keep lines 359 and 385. They explain why the expected repo differs from the cwd fallback.
- `perIssueScenarioSweep.test.ts`:
  - Delete the 7 banners (lines 3, 21, 32, 71, 96, 269, 377).
  - Keep the `makeFakeGitContext` JSDoc (line 43). It states the never-touch-base-dependent-defaults invariant.
- `perIssueSweepPersist.test.ts`: delete the 7 banners (lines 3, 9, 70, 155, 257, 309, 342). Lines 257 and 309 also carry `#810` tags.
- `regionOverlapSignals.test.ts`:
  - Delete the 4 banners (lines 21, 63, 71, 92).
  - Keep lines 27, 29, 31. They explain why each assertion shape proves the insertion point. `#700` in line 29 is the fixture issue, not a history tag.
  - Delete lines 58, 106, 109, 111, 121. Each narrates the next statement.
- `spawnGate.test.ts`: no change. Lines 59, 128, 141 each explain why the fixture is shaped that way.
- `takeoverHandler.integration.test.ts`:
  - Header (lines 1–8): delete the title line `Integration test: abandoned takeover end-to-end against a fixture state file.` and the blank ` *` after it. Keep the `Uses a real tmpDir …` paragraph.
  - Keep line 151.
- `takeoverHandler.test.ts`:
  - Keep line 1 (all-I/O-injected invariant) and line 63 (reason for the default probe).
  - Delete the 12 `// ─── … ───` banners: lines 75, 102, 124, 159, 184, 209, 341, 456, 468, 483, 493, 641.
  - Delete the 6 `// ─ … ─` sub-banners: lines 212, 271, 297, 496, 557, 583.
  - Keep lines 393 and 615.
  - Lines 701–705: delete line 701 (banner with `(story 10)`) and the bare `//` on line 702. Keep lines 703–705.
  - Delete the 2 `// ── buildDefaultTakeoverDeps — … ──` banners (lines 784, 832).
- `triggerCronAwaitingMerge.test.ts`:
  - Delete the 7 banners (lines 5, 36, 95, 154, 238, 300, 342).
  - Line 7: delete the trailing `// 60 s grace period used across all tests`. Leave the code untouched.
  - Keep the trailing comments on lines 15 and 61. They say why each timestamp was chosen.
  - Keep the `noProcessed` JSDoc (line 30). It states the never-share-instances invariant.
  - Lines 75–78: strip `Regression for #398/#399: ` and capitalise, so it opens `When this same cron process originally spawned …`. Keep the rest.
  - Keep lines 140–141, 179, 281, 289.
  - Delete line 221 (`List-level regression for #398/#399.`). Nothing remains once the tag is stripped.

### 3. Source files (`adws/triggers/`)

- **No change (zero comments):** `spawnGate.ts`.

#### `cancelHandler.ts`
- Delete the file header (lines 1–8). The title is noise, and the sequence summary narrates the function body.
- Keep the `MutableProcessedSets` JSDoc. It gives the reason the sets are mutable.
- `handleCancelDirective` JSDoc:
  - Delete the summary line and the numbered 1–6 list.
  - Delete `@param issueNumber`, `@param comments`, and `@param boundary`. They restate the signature.
  - Keep `@param cwd … (undefined = local repo)`, `@param processedSets … omit on webhook path`, and `@returns true on completion (errors are logged but do not throw)`.
- Delete the step comments at lines 49, 56, 61, 71, 82 (narration).
- Lines 64–65: strip ` (#822)`. Keep the rest.
- Line 91: drop the `6. ` prefix so it reads `// Remove from cron dedup sets so issue re-spawns next cycle`.
- Delete the `killOrchestratorProcess` JSDoc (lines 101–104). It narrates the body.
- Delete line 141 (narration).
- **Keep line 144** (`// spin — …`). It is the only content of the `while` body, and `no-empty` fails lint without it.

#### `cronIssueListing.ts`
- Header:
  - Delete the first line (`The cron's open-issue listing, extracted out of trigger_cron.ts.`) and the blank ` *` after it.
  - In paragraph 2, delete the clause ` — the same finding #796 recorded for initializeWorkflow`, so the sentence ends `… cannot be driven from a step definition.`
  - Keep `Extracting it here also keeps trigger_cron.ts, …`.
- Keep the `RawIssue` JSDoc. It names the consumer.
- Delete the `listCronOpenIssues` JSDoc. It restates the name.

#### `cronRepoResolver.ts`
- Header: delete `Cron repo identity resolution.` and the blank ` *` after it. Keep the `Extracted from trigger_cron.ts so …` reason.
- `resolveCronRepo`: delete the first line. Keep `When \`--target-repo\` is present, uses that; otherwise calls \`fallback\`.`
- `buildCronTargetRepoArgs`: delete the summary line, the blank, and the `@param repoInfo` / `@param targetRepo` lines. Keep `@param fallbackCloneUrl - Called when targetRepo is null …`.

#### `cronStageResolver.ts`
- Header:
  - Delete the title line.
  - Keep the `Extracted from trigger_cron.ts so …` paragraph.
  - Delete the `Replaces comment-header parsing …` paragraph and its three bullets (lines 7–10). The no-adw-id/no-state-file semantics survive on `StageResolution.stage`.
- Delete the `StageResolution` interface JSDoc. Keep all three field docs (their null semantics).
- `getLastActivityFromState`: delete the first line. Keep `Considers both startedAt and completedAt …` and `Returns null if …`.
- Keep the `isActiveStage` JSDoc whole. It is rationale.
- `resolveIssueWorkflowStage`: delete the summary, the 1–3 list, and `@param comments`. Keep `@param readState - Injectable state reader (defaults to AgentStateManager.readTopLevelState)`.

#### `docsIndexSweep.ts`
- Header:
  - Delete paragraph 1 (lines 2–4, `Docs-index sweep — full repair + reconcile lifecycle, cron-dispatched via …`) and the blank after it.
  - Keep paragraph 2 (never-a-direct-commit and violations-never-auto-repaired invariants).
  - Keep paragraph 3 (non-fatal and no-repo-identity invariants).
  - Keep the `Invoke by hand:` usage line.
- Keep the `reconcileReport` JSDoc.
- `runDocsIndexSweep`: delete `Runs one docs-index sweep pass: read → assess → repair-and-persist → reconcile-report.` Keep `Never throws. Returns \`EMPTY_REPORT\` when …`.
- Delete the `// ── CLI entry point ──` banner (line 220).

#### `docsIndexSweepDefaults.ts`
- Header:
  - Delete the first sentence (`Production dependency implementations for … when no override is injected.`).
  - Keep `Split out to keep … mirroring \`promotionSweepDefaults.ts\`.`
  - Keep paragraph 2.
- Keep the `DOCS_INDEX_SWEEP_SPEC` JSDoc.
- `makeDocsIndexSweepDefaults`: delete the first sentence (`Builds the seven production defaults … called at most once by the caller).`). Keep the `countBand` sentence.

#### `issueDependencies.ts`
- Header:
  - Delete the title line and the `Parses \`## Dependencies\` sections …` paragraph.
  - Keep `Extraction order:`, its 1–3 list, and `This eliminates unnecessary LLM calls on every 20s poll cycle.`
- Keep the `DEPENDENCY_KEYWORDS` and `dependencyCache` JSDoc (the "preceding" semantics and the key format).
- Delete the `hashBody` JSDoc.
- `parseDependencies` JSDoc → `/** Used as a fallback when LLM-based extraction fails. */`
- Delete inline lines 48, 53, 64, 70 (narration).
- `parseKeywordProximityDependencies`: keep only `Looks for \`#N\` references preceded (within 10 words) by a dependency keyword.` and `Also handles the \`## Blocked by\` heading section.`
- Delete lines 91 and 96 (narration).
- Keep line 104. It explains the magic number 80.
- Delete the `extractDependencies` JSDoc. Its strategy list duplicates the header's extraction order, and its `@param`s restate the signature.
- Delete lines 137, 144, 156 (narration).
- Keep line 147. It gives the reason for the count.
- `findOpenDependencies` JSDoc → `/** Does NOT resolve transitive dependencies. */`

#### `issueEligibility.ts`
- Header: delete `Shared issue eligibility checker.` and the blank after it. Keep the `Combines … Used by both webhook and cron triggers.` paragraph.
- Delete the `EligibilityProviders` and `EligibilityResult` JSDoc.
- `checkIssueEligibility`: delete the first line. Keep the 1–3 list (evaluation order).
- Delete lines 36 and 46. The order is stated in the JSDoc.

#### `pauseQueueScanner.ts`
- Header:
  - Delete the title line, the blank, and `Called from trigger_cron.ts on every N poll cycles.`
  - Keep the `Runs a cheap …`, `On success: …`, and `On repeated unknown failure: …` lines.
- Keep the `READINESS_WINDOW_MS` and `RATE_LIMIT_STRINGS` JSDoc.
- Delete the `containsRateLimitText` JSDoc.
- `resolveEntryRepoInfo`: strip the trailing `\n * (issue #565)`, so the sentence ends `… to the cron host's own repo.` Keep the rest.
- Keep the `resolveEntryBoundary` JSDoc.
- `postEntryStageComment`: keep paragraph 1. Delete paragraph 2 (`Fixes a latent wrong-repo bug: …`, history).
- `probeRateLimit`: delete the first line. Keep `Returns 'clear' …`.
- Delete the `worktreeExists` JSDoc.
- Keep the `awaitChildReadiness` JSDoc.
- Delete the `resumeWorkflow` JSDoc.
- Delete lines 144, 189, 222 (narration).
- Keep lines 157–159.
- Lines 185–186: change `The brief gap is acceptable per slice #463.` to `The brief gap is acceptable.` Keep line 185.
- Lines 195–196: delete `Spawn orchestrator detached. `. Keep `Resolve the orchestrator script against REPO_ROOT so …`.
- Keep lines 211, 217, 229.
- **Keep line 237** (`/* fd already closed on child side */`). It is the only content of an empty `catch {}`.
- `scanPauseQueue`: delete the first line, the blank, and `@param cycleCount`. Keep `Only runs the probe every PROBE_INTERVAL_CYCLES cycles to avoid hammering the API.`
- Delete line 265 (narration).

#### `perIssueSweepPersist.ts`
- Header:
  - Delete paragraph 1 (lines 2–4, title).
  - Keep paragraph 2.
  - Paragraph 3: keep the `SweepPersistSpec` sentence. Delete the `\`persistRemovalViaPr\` — … is now a one-line wrapper …` sentence (history).
  - Keep paragraph 4.
- Keep the `SWEEP_BRANCH` JSDoc.
- Delete the `SWEEP_COMMIT_MESSAGE` JSDoc (`Unchanged from the pre-#758 …`: tag plus history).
- Delete the `SweepPersistSpec` and `PER_ISSUE_SWEEP_SPEC` JSDoc.
- Keep the `SweepBase` JSDoc (per-cycle lifetime).
- Keep the `findOpenSweepPr` field doc (null semantics). Delete the `openPr` field doc.
- `prepareSweepBase`: change the last sentence to `\`spec\` defaults to the per-issue sweep's own branch/PR copy.` (drop ` so every pre-#810 caller is unaffected`). Keep the rest.
- **Keep line 85.** It is the only content of an empty `catch {}`.
- Keep the `persistCommitViaPr` JSDoc.
- Delete the `persistRemovalViaPr` JSDoc (history).
- Keep the `cleanupSweepBase` JSDoc.
- **Keep lines 167 and 172.** Each is the only content of an empty `catch {}`.

#### `promotionSweepDefaults.ts`
- Header:
  - Delete the first sentence of paragraph 1.
  - Keep `Split out to keep … under the file-length guideline.`
  - Keep paragraphs 2 and 3.
- Delete the `makeDefaultDeps` JSDoc. The no-additional-GitContext invariant is already in the header.
- Keep the `tagAndCommit` JSDoc.
- Delete the `fileIssue` JSDoc.

#### `regionOverlap.ts`
- Header: delete `Pure decision module for region-overlap serialization.` and the blank after it. Keep the rest.
- Keep the `normalizePath` and `parseRelevantFilesSection` JSDoc (normalisation contract and accepted headings).
- Keep lines 64, 67, 78 (accepted line formats and the first-token reason).
- Delete the `pathsOverlap` JSDoc.
- `decideSerialization`: delete the first sentence. Keep the tie-break list and `A candidate with an empty path signal is never serialized …`.
- Delete line 128 (narration).
- `scanPostPlanOverlaps`: keep only `Advisory — never a hard block.`

#### `regionOverlapSignals.ts`
- Header: delete `Side-effecting boundary for region-overlap serialization.` and the blank after it. Keep the rest.
- Keep the `REGION_OVERLAP_MARKER`, `RegionOverlapRegistrationDeps`, `buildBlockedByBody`, and `registerRegionOverlapBlocker` JSDoc.
- Delete the `blockedByRef` and `formatRegionOverlapComment` JSDoc.
- Keep the trailing comment on line 83.

#### `retryHandler.ts`
- Header: delete `Handles the \`## Retry\` directive for human-gated issues.` and the blank after it. Keep the rest.
- `handleRetryDirective` JSDoc → `/** Returns true only when a reset was performed. */`. The header already owns the recovery-path table and the no-op rule.

#### `takeoverHandler.ts`
- Header: strip ` (#639)` from item 6 (`cap automatic resumes: within budget →`). Keep everything else, including the title line. "Single decision tree for every candidate" is the invariant.
- Keep the `EvaluateCandidateInput` and `buildDefaultTakeoverDeps` JSDoc.
- **Keep line 97** (only content of an empty `catch {}`).
- Keep lines 141–143 and 158.
- Delete lines 171–172 (`Branch 1: …` narration).
- Keep line 179.
- Delete line 182.
- Keep line 185 (lock-stays-held invariant).
- Delete lines 191, 198, 208 (narration).
- Delete lines 213–215 (`Branch 6: …`, `#639`, `#638`). The header's item 6 carries the rule.
- Delete line 231.
- Keep line 237.
- **Keep line 241** (only content of an empty `catch {}`).
- Keep lines 244 and 248.

#### `trigger_cron.ts`
- Header (entry script): delete `CRON trigger for ADW (AI Developer Workflow).` and the blank after it. Keep the `Acts as a backlog sweeper: …` paragraph and the `Start with: bunx tsx adws/triggers/trigger_cron.ts` usage line.
- Delete line 60 (narration).
- Keep lines 63–64 and 67–68.
- Delete line 73 (`Context-only view — … (#794).`, history).
- Keep the `getCronProviders` JSDoc.
- Delete the `buildTargetRepoArgs` JSDoc.
- Keep whole:
  - `runHungDetectorSweep`, `boundPerIssueSweep` (and trailing line 122), `boundPromotionSweep`, `boundDocsIndexSweep`
  - `runPerIssueScenarioSweepTick`, `runPromotionSweepTick`, `runDocsIndexSweepTick`
- `runGuardedTick`: strip ` (#812)`. Keep the rest.
- `handleAuthGateTick`: delete the first line. Keep the two `Returns …` lines.
- Keep line 276.
- **Keep lines 288 and 292.** Each is the only content of an empty `catch {}`.
- `checkAndTrigger`: delete `Checks for eligible issues and triggers ADW workflows for each. `. Keep `Boundary defaults to …; exported so tests can drive one tick against a fake boundary.`
- Delete lines 320, 324, 329 (narration).
- Lines 334–336: delete the first sentence. Keep `The cadence gate, the no-launch-context skip, and the non-fatal swallow all live inside runPerIssueScenarioSweepTick.`
- Lines 339–341: delete `Run the promotion sweep every … 20s tick).` Keep `The gate and the non-fatal swallow both live inside runPromotionSweepTick.`
- Lines 344–346: delete `Run the docs-index health sweep every … promotion sweep).` Keep `The gate and the non-fatal swallow both live inside runDocsIndexSweepTick.`
- Keep lines 355–357, 368–369, and 397–401. `#UPG` is a placeholder name, not an issue number.
- Keep line 411.
- Delete line 427 (narration).
- Keep lines 435, 439–441, 459–462, 466, 475, 482–485, 537–539, and 550–554.
- Delete the `checkPRsForReviewComments` JSDoc.

#### `trigger_shutdown.ts`
- **Keep line 1** (shebang) unchanged.
- Header (entry script) → `/**\n * Usage: bunx tsx adws/triggers/trigger_shutdown.ts\n */`. Delete the title, the `Terminates all running …` intro, and the numbered 1–3 list.
- Delete the `shutdownCronProcesses` and `shutdownWebhookProcesses` JSDoc.
- **Keep line 56** (`/* ignore */`, only content of an empty `catch {}`).
- Keep lines 66 and 93.
- Delete the `// --- Main ---` banner (line 99).

#### `webhookHandlers.ts`
- Delete the file header (lines 1–7). It lists handlers the file shows and carries extraction history.
- `extractIssueNumberFromBranch`: delete the first line. Keep the branch-format and `Returns null …` lines.
- Delete the 4 `// ── … ──` banners (lines 31, 77, 137, 222).
- Lines 66–68: strip ` (#822)`. Keep the rest.
- `handlePullRequestEvent`: delete `Handles pull_request.closed webhook events.` Keep the two bullets.
- Delete line 95 (duplicates the JSDoc's merged-PR bullet) and line 101 (narration).
- Keep line 111.
- `handleIssueClosedEvent`: delete `Handles issues.closed webhook events.` Keep the bullets.
- Delete lines 166, 180, 190, 209. They narrate, or duplicate the JSDoc's grace-period bullet.
- Line 194: strip ` (#524/#530)`, so it reads `// Remote branch deletion — top-level state is canonical; orchestrator is fallback.`
- Keep line 211.
- `resolvePrReviewSpawn`: delete the first line. Keep the other two.

#### `webhookRepoResolver.ts`
- Header: delete the title line and the blank after it. Keep the `Extracted from trigger_webhook.ts so … Mirrors cronRepoResolver.ts.` paragraph.
- Delete the `WebhookRepoResolution` JSDoc.
- `parseRepoFullName`: delete the first line. Strip ` (#821)` from the second. Keep the rest.
- `resolveWebhookRepo`: delete the first line. Keep `Returns null …` and `Pure: no I/O, …`.
- Keep the `buildEventBoundary` and `selfHostBoundary` JSDoc.

#### `webhookSignature.ts`
- `validateWebhookSignature` JSDoc → `/** Uses constant-time comparison to prevent timing attacks. */`

### 4. Residue scan
- Rerun the banner and issue-tag greps from Validation Commands.
- The banner grep must print nothing.
- The issue-tag grep may print only `regionOverlapSignals.test.ts:29`. The `#700` there is the fixture issue number.
- Reread each edited file's surviving comments against the `**Comments**` guideline.
- Confirm every empty `catch {}` / loop body named above still contains its comment.

### 5. Run the Validation Commands
- Run every command below. All must succeed.
- If the guard reports `code-changed` for a file, `git diff` that file, find the non-comment edit, and restore it.

## Validation Commands
Execute every command to validate the chore is complete with zero regressions.

- Comment-only guard over every Touched File (default branch resolved by the guard). This is the acceptance check:
  ```
  bun run lint:comment-only adws/triggers/__tests__/concurrencyGuard.test.ts adws/triggers/__tests__/cronIssueListing.test.ts adws/triggers/__tests__/cronRepoResolver.test.ts adws/triggers/__tests__/cronStageResolver.test.ts adws/triggers/__tests__/docsIndexSweep.test.ts adws/triggers/__tests__/issueOpenedRouter.test.ts adws/triggers/__tests__/pauseQueueScanner.test.ts adws/triggers/__tests__/perIssueScenarioSweep.test.ts adws/triggers/__tests__/perIssueSweepPersist.test.ts adws/triggers/__tests__/regionOverlapSignals.test.ts adws/triggers/__tests__/spawnGate.test.ts adws/triggers/__tests__/takeoverHandler.integration.test.ts adws/triggers/__tests__/takeoverHandler.test.ts adws/triggers/__tests__/triggerCronAwaitingMerge.test.ts adws/triggers/cancelHandler.ts adws/triggers/cronIssueListing.ts adws/triggers/cronRepoResolver.ts adws/triggers/cronStageResolver.ts adws/triggers/docsIndexSweep.ts adws/triggers/docsIndexSweepDefaults.ts adws/triggers/issueDependencies.ts adws/triggers/issueEligibility.ts adws/triggers/pauseQueueScanner.ts adws/triggers/perIssueSweepPersist.ts adws/triggers/promotionSweepDefaults.ts adws/triggers/regionOverlap.ts adws/triggers/regionOverlapSignals.ts adws/triggers/retryHandler.ts adws/triggers/spawnGate.ts adws/triggers/takeoverHandler.ts adws/triggers/trigger_cron.ts adws/triggers/trigger_shutdown.ts adws/triggers/webhookHandlers.ts adws/triggers/webhookRepoResolver.ts adws/triggers/webhookSignature.ts
  ```
- No other files changed: `git diff --name-only origin/dev -- adws` lists only Touched Files.
- No banners remain; must print nothing:
  `grep -nE '^\s*//\s*(-{3,}|─{1,}|={3,})' <Touched Files>`
- No issue-number tags remain in comments. The only permitted hit is `adws/triggers/__tests__/regionOverlapSignals.test.ts:29` (fixture `#700`):
  `grep -nE '^\s*(//|/?\*).*(#[0-9]{2,}|issue #)' <Touched Files>`
- `bun run lint`: ESLint. Catches an emptied `catch {}` or loop body (`no-empty`).
- `bun run test`: typecheck (`bunx tsc --noEmit`). This is the issue's acceptance command.
- `bunx tsc --noEmit -p adws/tsconfig.json`: additional type check.
- `bun run test:unit`: Vitest. The 14 swept test files must still pass.
- `bun run lint:git-guard`: git/gh guard over `adws/**`. This is a regression check; comment edits cannot trip it.
- `bun run build`

## Notes
- **Coding guidelines.** `.adw/coding_guidelines.md` › `**Comments**`: comment only invariants, ordering constraints, and reasons for non-obvious choices. No next-line narration, no banners, no issue numbers, no name-restating JSDoc. This is the test every surviving comment must meet. No code refactoring is in scope: the guard forbids any non-comment change.
- **Guard mechanics.**
  - The guard reads each file at `origin/<default branch>` via `GitContext.show`.
  - It resolves the default branch through the launch boundary's code host and fetches it first, so it needs forge auth.
  - Never pass a hardcoded `--base` in the per-issue scenario. The issue requires the default branch to be resolved by the guard.
- **Per-issue scenario.** The scenario for #875 asserts exactly one behaviour: the comment-only guard passes for the 35 listed files against the default branch. The step definition should call the guard's importable runner (`runCommentOnlyCheck` from `adws/checkCommentOnly.ts`) with the file list and assert `exitCode === 0`. Mirror the shape of `features/per-issue/step_definitions/feature-853.steps.ts`.
- **`no-empty` keepers.** These comments are the sole content of an empty block and must survive:
  - `cancelHandler.ts:144`
  - `pauseQueueScanner.ts:237`
  - `perIssueSweepPersist.ts:85, 167, 172`
  - `takeoverHandler.ts:97, 241`
  - `trigger_cron.ts:288, 292`
  - `trigger_shutdown.ts:56`
- **Judgement calls resolved here.** Where a rationale is duplicated between a module header and a function JSDoc or inline comment, the plan keeps one copy:
  - `cancelHandler.ts`, `issueDependencies.ts`, `retryHandler.ts`: the copy on the function (cancel) or in the header (dependencies, retry)
  - `takeoverHandler.ts`: the header decision tree
  - `promotionSweepDefaults.ts`: the header
  - `webhookHandlers.ts`: the handler JSDoc bullets
  
  Follow the per-file directives as written; do not re-litigate them.
- **Stale prose.** Some kept comments are slightly out of date. For example, `retryHandler.ts`'s header lists three recovery paths while older text elsewhere listed two, and `parseDependencies`' "fallback" note predates the keyword-proximity path. Leave the wording as-is. Rewriting kept prose is out of scope per the PRD.
- **Merge path.** The batch auto-merges on the guard. No `hitl` label. Git history is the recovery path for any over-trim.

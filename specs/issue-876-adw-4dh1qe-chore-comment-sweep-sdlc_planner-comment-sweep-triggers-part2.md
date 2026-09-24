# Chore: Comment sweep 8/16 — adws/triggers (2/2)

## Metadata
issueNumber: `876`
adwId: `4dh1qe-chore-comment-sweep`
issueJson: `{"number":876,"title":"chore: comment sweep 8/16 — adws/triggers (2/2)","parentPrd":"specs/prd/comment-debloat.md","blockedBy":[853],"touchedFiles":34}`

## Chore Description
This is sweep batch 8 of 16 from the comment de-bloat PRD (`specs/prd/comment-debloat.md`). Its blocker, #853, has merged. That merge shipped:
- the `**Comments**` entry in `.adw/coding_guidelines.md`
- the comment-only guard `adws/checkCommentOnly.ts`, run as `bun run lint:comment-only`

Apply the PRD's *Deletion rules per comment kind* to the 34 files under **Touched Files**, and to no other file:

| Comment kind | Action |
|---|---|
| Section banners (`// ----`, `// ── X ──`) | Delete |
| JSDoc that only restates the field or function name, including `@param`/`@returns` lines that restate the signature | Delete |
| Inline narration of the next statement | Delete |
| Issue-number tags (`(#794)`, `(issue #762)`, `#734-shaped`, `bug #499`) and review-finding tags (`(Finding 1/2)`, `(Bug C′)`) | Strip. Keep the rest of the comment only if rationale remains. |
| Mixed comments | Keep only the sentences that state an invariant, an ordering constraint, or the reason for a non-obvious choice |
| Entrypoint headers | Keep the usage line and the options list |
| Shebangs, `eslint-disable` directives | Keep. `cloudflareTunnel.tsx` and `trigger_webhook.ts` have shebangs on line 1. There are no `eslint-disable` directives. |

**Hard constraint: comments only.** No token of code may change. String and template literals are code. Several `describe`/`it` titles carry issue tags, for example `'… (#653)'` in `cronIssueFilter.test.ts`, `'… (#769)'`, `'… (#810)'` and `'runGuardedTick (#812)'` in `trigger_cron.test.ts`, `'… (issue #530)'` in `webhookHandlers.test.ts`, and `'… the #638/#639 collision shape'` in `regionOverlap.test.ts`. Leave them exactly as they are. The guard compares each file's TypeScript token stream (trivia dropped) against the default branch, so any code edit fails it. Blank lines left behind are free, but collapse runs of blank lines to one so the files stay tidy.

The sweep only trims and deletes. It does not reword the prose it keeps (PRD › Out of Scope). The small exceptions are:
- dropping an issue tag from mid-sentence (for example `#734-shaped promotion issue` becomes `promotion issue`)
- turning a multi-line JSDoc that now has one sentence into a one-line `/** … */`
- starting a kept comment at the first kept sentence when the line it shared with a deleted sentence is cut

Measured at planning time: 898 comment lines across the 34 files. Every file is byte-identical to `origin/dev`. `mergeDispatchGate.test.ts` has no comments. It stays byte-identical and is included only because the guard runs over the full list.

Scanner false positives to ignore: `cloudflareTunnel.tsx:154` (`` `http://localhost:${…}` ``) and `webhookRepoResolver.test.ts:52` (`` `https://github.com/${…}` ``) are template literals, not comments.

## Relevant Files
Use these files to resolve the chore:

- `specs/prd/comment-debloat.md`: parent PRD. *Implementation Decisions › Deletion rules per comment kind* is the rule set. *Out of Scope* forbids rewriting kept prose.
- `.adw/coding_guidelines.md`: the `**Comments**` entry under Process & Tooling is the acceptance bar for every surviving comment.
- `adws/checkCommentOnly.ts`: the comment-only guard used for verification. Use it as-is; do not edit it. `runCommentOnlyCheck` is its importable runner.
- `app_docs/feature-m363ky-comment-only-guard.md` (conditional doc): explains the guard's `code-changed` / `absent-at-base` / … violation reasons if a file fails.
- `features/per-issue/step_definitions/feature-853.steps.ts`: the shape the per-issue scenario step for #876 should mirror.
- `eslint.config.js`: `eslint.configs.recommended` enables `no-empty`. An empty `catch {}` block is allowed only if it contains a comment. This matters for `autoMergeHandler.ts:60`, `cronProcessGuard.ts:56` and `trigger_webhook.ts:97`. Keep all three.
- The 34 Touched Files (per-file directives in Step 2 and Step 3).

No new files. No docs updates: the owning `app_docs/*` describe behaviour, and behaviour does not change.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

Line numbers are from the pre-sweep file. Edit each file bottom-up, or re-locate by text, so earlier deletions do not shift later targets.

### 1. Baseline
- Confirm the guard exists and runs: `bun run lint:comment-only adws/triggers/concurrencyGuard.ts` should PASS on the untouched file.

### 2. Test files (`adws/triggers/__tests__/`)

- **No change (zero comments):** `mergeDispatchGate.test.ts`.
- **Banners only.** Delete every `// ── … ──` / `// ────` line and nothing else:
  - `autoMergeHandler.test.ts`: lines 80–82 and 114–116. Each is a 3-line box.
  - `cronLabelEligibility.test.ts`: lines 7, 31, 115.
  - `issueClosedUnblockRouter.test.ts`: lines 42, 59, 96, 111, 128, 144, 162.
  - `promotionSweepDefaults.test.ts`: lines 3, 19, 75, 100, 121, 144, 175, 196, 221, 247, 281.
  - `retryHandler.test.ts`: line 25.
  - `upgradeRedrive.test.ts`: lines 17, 43, 86.
- `cancelHandler.test.ts`:
  - Delete 5 (`Mock all external dependencies before importing …`), 164, 171, 196, 198, 205 (trailing `// all return same id`), and 210. All are narration of the next statement or assertion.
  - Keep 109 (explains the two-call `mockIsProcessAlive` sequence) and 190 (explains the fixture).
- `cronIssueFilter.test.ts`:
  - Delete the 9 banners: 33, 70, 107, 147, 215, 277, 319, 345, 385. Line 385 also carries `(#653)`.
  - Delete 149 (restates `freshResolution`).
  - Keep 154, 299 and 314.
- `devServerJanitor.test.ts`:
  - Delete the banners 17, 22, 56, 120, 168, 250, 329, 594, 683. Lines 250 and 594 also carry `(#812)`.
  - Delete the trailing narration at 181 (`// default: processes exist`), 346 (`// no processes`) and 487 (`// no matching state files`).
  - Delete the full-line narration at 354 and 590.
  - Delete 497 (`// Regression: bug #499 — …`). Without the tag it only repeats the `it` title.
  - For the block at 654–658: delete 654 (banner). Keep 655 as-is. Cut 656 to `// The janitor delegates to that function.` Delete 657–658 (the numbered list).
  - Keep 19–20, 50–51, 107, 204–205, 471, 562–563.
- `regionOverlap.test.ts`:
  - Delete the 5 banners: 11, 41, 86, 139, 246.
  - Keep the trailing 238–240 and 289. They explain the expected anchor/deferral and the pair count.
- `scanAuthQueue.test.ts`: delete 135 (narration).
- `trigger_cron.test.ts`:
  - Header 1–12: delete the first line and the `Tests that checkAndTrigger / runHungDetectorSweep:` list (lines 2–9). Keep only `Module-level side effects in trigger_cron.ts (resolveCronRepo, activateGitHubAppAuth, registerAndGuard, setInterval) are stubbed via vi.mock so the import is stable.` as the JSDoc body.
  - At 16–18, delete the dash lines 16 and 18. Keep 17 (`Mock all module-level side-effect dependencies BEFORE any import of trigger_cron`) because it is an ordering constraint.
  - Delete 98–100, 108–110 and 124–126 (banner boxes / narration).
  - Delete 193 and 195 (assertion narration).
  - At 208–211, delete the dash lines 208 and 211. Strip ` (#769)` from 209 so it reads `// Tick seams — both dispatch an injected, nullable bound thunk rather`. Keep 210.
- `webhookEventBoundary.test.ts`: keep all comments (11–13, 153, 169). The `/* never settles */` at 169 documents the executor's intent.
- `webhookGatekeeper.test.ts`: in the header (1–8), delete line 2 (`Tests for the adw:upgrade short-circuit … (Bug C′).`) and the blank ` *` line after it. Keep the `The #UPG tracking issue …` paragraph (`#UPG` is not an issue number). Keep 12–13.
- `webhookHandlers.test.ts`:
  - Delete the banners 13, 79, 143.
  - Delete 266 (narration).
  - Keep 188, 208, 263, 275, 281.
- `webhookRepoResolver.test.ts`:
  - Header 1–6: delete line 2 (`Unit tests for …`) and line 5 (`Mirrors launchGitContext.test.ts + feature-664.feature §1–§5.`). Keep `All I/O is behind injected seams — no real gh/git calls, no network.` The remaining JSDoc has one sentence, so collapse it to a one-line `/** … */`.
  - Delete the banners 105, 148, 177, 212, 231, 269, 330, 355, 366, and the empty `//` at 367. The `describe` titles already carry the `§N` labels.
  - Delete the narration at 88, 182, 263, 279.
  - Keep 54 (trailing `// stash for test helpers`), 69, 248, 368–374.

### 3. Source files (`adws/triggers/`)

#### `autoMergeHandler.ts`
- Delete the file header (1–6).
- 16–19 (`checkMergeConflicts`): keep only `/** Performs a dry-run merge to detect conflicts without modifying the working tree. */`.
- Keep 30. It explains why a clean dry-run merge is still aborted. Delete 34 (narration).
- 40–43 (`resolveConflictsViaAgent`): keep only `/** Initiates a real merge (with conflict markers) then invokes the /resolve_conflict agent. */`.
- Delete 52 and 56 (narration).
- **Keep 60.** It is the only content of an empty `catch {}`.
- Delete 91–94 (`pushBranchChanges`) and 106–109 (`isMergeConflictError`). Both restate the name.
- Keep 122–126 (`syncWorktreeToOriginHead`).
- 135–142 (`mergeWithConflictResolution`): keep only `/** Core retry loop: resolve conflicts → push → merge. */`. Drop the `Extracted so …` sentence and `@returns`.
- Delete 157. It duplicates the `syncWorktreeToOriginHead` JSDoc.

#### `cloudflareTunnel.tsx`
- Keep the shebang (line 1).
- Header 2–16:
  - Delete line 3 (`Cloudflare Tunnel Script for ADW Webhook Server`) and line 5 (`Automates creation and running …`).
  - Keep `Exposes the local ADW webhook server to the internet so GitHub can deliver webhook events to the local ADW instance.`
  - Keep the `Usage:` line and the `Options:` list.

#### `concurrencyGuard.ts`
- Delete the file header (1–6). Its in-progress definition is kept at 27–31.
- Delete 15–17 (`fetchOpenIssuesWithComments`).
- 27–31: delete `Counts the number of in-progress issues for a repository.` Keep the `An issue is "in progress" when …` definition.
- 49–53: delete the first sentence. Keep `Exported (with the production cap factored out) so tests can pin the threshold without depending on the frozen, env-derived MAX_CONCURRENT_PER_REPO constant.`
- Delete 64.

#### `cronIssueFilter.ts`
- Header 1–9: delete line 2 (`Cron issue evaluation and filtering logic.`) and the `Evaluates whether …` paragraph (7–8). Keep the `Extracted from trigger_cron.ts so the logic is testable …` paragraph.
- Delete the JSDoc at 17, 28, 38, 45 (restate the type name). Delete 34 as well: the name says it, and its `(set for awaiting_merge issues)` is inaccurate because the retriable and phase_timeout paths also set `adwId`.
- Keep 32.
- Keep 52–61 (`ProcessedSets`). It is the single authoritative copy of the spawn-dedup contract.
- 66–92 (`evaluateIssue`):
  - Delete the first line (`Determines if …`).
  - Keep the `awaiting_merge bypasses the grace period …` paragraph.
  - Delete the whole `processed.spawns is a fresh-spawn …` paragraph. It duplicates `ProcessedSets` and carries `(issue #653)`.
  - Delete the `@param` lines for `issue`, `now`, `processed`, `gracePeriodMs` and `resolveStage`.
  - Keep `@param cancelledThisCycle` and `@param labelRecovery`. Both state invariants.
- 106–112: keep `Resolve stage first so we can dispatch to the right dedup set.` Delete the next sentence (`The spawn dedup (processed.spawns) is applied ONLY … (retriable / phase_timeout).`), which duplicates `ProcessedSets`. Keep `An issue this process originally spawned legitimately re-enters the filter …` through the end.
- 115–116: delete the first sentence (`awaiting_merge bypasses grace period — spawn merge orchestrator immediately.`). Keep `Dedup is handled by shouldDispatchMerge (spawn lock on disk), not an in-memory set.`
- Keep 124–125, 130–131, 136–137, 142–143.
- Delete 148 (narration of the `??` fallback).
- 156–164: strip ` (issue #653)` so the sentence reads `… or it strands for the cron's entire lifetime. The on-disk spawnGate …`. Keep the rest.
- 168–170: delete the first sentence (`Apply the label-recovery gate only when …`). Keep `Issues with a non-null adwId bypass the gate and reach the existing takeover machinery (evaluated by evaluateCandidate).`
- Keep 182.
- 192–195: strip ` (issue #637)` so it ends `… and strands forever.` Keep the rest.
- Delete 199 (`Unknown stage — exclude`).
- Keep 203–209 (`resolveTouchedFilesFromBody`).
- 214–226 (`filterEligibleIssues`):
  - Delete `Filters and sorts issues for backlog sweep processing.` and `Builds an annotation list of excluded issues for verbose logging.`
  - Keep `Returns eligible issues (with action metadata) sorted oldest-first.`
  - In the second paragraph, keep `A cross-issue region-overlap pass is applied to the eligible spawn candidates after per-issue filtering.` and `Overlapping pairs are serialized: … recorded in \`overlapDeferrals\`.`
  - Delete the `resolveTouchedFiles defaults to …` sentence and the `Tests may inject …` sentence. Both duplicate 203–209.
- Delete 255 (narration).

#### `cronLabelEligibility.ts`
- Header 1–15: delete lines 2–6 (title, `Determines whether …`, `Mirrors the pure-decision + DI pattern …`) and the blank ` *` after them. Keep the second paragraph, stripping ` (#754)` so it reads `… exactly as the webhook opened-path and comment-path do. Only a reserved, …`.
- Delete the banners 23, 39, 47, 76.
- Keep 35.
- 49–61 (`decideLabelRecovery`): delete `Pure eligibility decision from pre-computed signals.` Keep the `Guard clauses in strict precedence order:` block. Delete the `A truly-unlabeled fresh issue …` paragraph, which duplicates the header and carries `(#754)`.
- Delete 78–81 (`evaluateLabelRecovery`, narration).

#### `cronProcessGuard.ts`
- Header 1–8: delete `Cron Process Guard` and `Provides persistent PID-file-based duplicate cron prevention.` Keep `Stores the PID and repo key … so that duplicate detection survives webhook server restarts.`
- Delete 22, 27, 32 and 50. They restate the name; the header already gives the path format.
- 39: keep only `/** Returns null if missing or malformed. */`.
- **Keep 56.** It is the only content of an empty `catch {}`.
- 60–63: delete the first line. Keep `Removes stale PID files (dead processes) automatically.` as a one-line JSDoc.
- 73–78 (`tryExclusiveCreate`): delete the first sentence and the `Returns \`true\` …` line. Keep the `Returns \`false\` … (EEXIST — another process got there first).` and `Re-throws any unexpected filesystem error.` lines.
- Keep 91–98 (`registerAndGuard`).
- Delete 100, 103, the trailing 107 and 108, and 111 (narration).
- Keep 116.

#### `devServerJanitor.ts`
- Header 1–18. The final header is:
  ```
  /**
   * Scans target repository worktrees for dev server processes left behind by
   * SIGKILL'd or crashed orchestrators.
   *
   * Structure walked: {targetReposDir}/{owner}/{repo}/, where repo is treated as
   * an ADW target repo only when it carries BOTH a `.git` entry and the `.adw`
   * marker directory written by adw_init — TARGET_REPOS_DIR may be a general
   * projects folder shared with non-ADW repos, not an ADW-only directory.
   */
  ```
  - Delete line 2 (title).
  - Delete the kill-decision sentences, which duplicate `shouldCleanWorktree`.
  - Strip ` (#812)`.
  - Delete the `A failure listing one repo's worktrees …` sentence, which duplicates 151–160.
  - Delete the `Entry point:` / `All OS-touching operations …` lines.
- Delete the 6 dash banner boxes: 30–32, 37–39, 77–79, 147–149, 209–211, 279–281.
- Keep 34. Delete the trailing `// 30 minutes` at 35.
- Delete 41, 43, 45, 49.
- In `JanitorDeps`:
  - Delete 51, 53, 57, 59, 65, 67, 69, 73.
  - Keep 55 (`.adw` marker meaning), 61 (exclusion invariant), 63 (distinguishes `readTopLevelStateRaw` from `readTopLevelState`) and 71 (`SIGTERM → SIGKILL`).
- 81–88 (`extractIssueNumberFromDirName`): delete the first line and the blank ` *` after it. Keep the branch-format ownership line, the example, and `@returns` (it states the trailing-hyphen requirement).
- 96–105 (`findActiveAdwIdForIssue`): delete the first sentence and `@returns`. Keep the tie-break paragraph.
- 122–133 (`shouldCleanWorktree`): delete `Pure kill decision function.` and all four `@param` lines. Keep the `Returns true (should clean) unless:` list.
- Delete 140 (narration). Keep 142.
- 151–160: strip ` (#812)`. Keep the rest.
- Delete 173–179 (`discoverTargetRepoWorktrees`). It restates the name, duplicates the header structure, and carries `(#812)`.
- Keep 240 and 243.
- 276: delete `Production dependencies.` Keep `Exported frozen so tests and step definitions can spread it and override only the network- and process-touching members.`
- Delete 283–296 (`runJanitorPass`). Its numbered list is narration and step 1 is stale; the `@param` lines restate the signature.
- Delete 308, 313, 334 (`Step N:` narration).

#### `issueClosedUnblockRouter.ts`
- Header 1–8:
  - Delete line 2 (`Pure selection + DI orchestration …`), the blank ` *`, and the `Mirrors \`issueOpenedRouter.ts\`'s pure-decision + DI pattern.` sentence.
  - Keep from `Selects dependents via \`extractDependencies\` …` to the end, stripping ` (issue #753)` so it ends `… is unblocked when its blocker closes.`
  - `#N` is a placeholder, not an issue number; keep it.
- Delete the banners 18, 31, 38, 58, 75.
- Delete 33 and 77–80. Both restate their target.

#### `issueOpenedRouter.ts`
- Delete the file header (1–6).
- Delete the banners 19, 27, 34, 43, 55, 73, 95.
- 45–47: keep only `/** opt-out takes unconditional precedence. */`.
- 57–60: delete the first line. Keep `/** Accepts only array entries that are objects with a string \`name\`. */`.
- Keep 136 (`// route.kind === 'infer'`). It marks the only remaining union case.

#### `mergeDispatchGate.ts`
- Header 1–8: delete `Lock-aware merge dispatch gate.` and the blank ` *`. Keep the `Replaces the process-lifetime … Set with a spawn-lock check so that …` paragraph.
- Delete 15.
- 26–38: delete the first line and the three `@param` lines. Keep the `Decision table:` block.
- Keep 48 and 56.
- Delete 70. It duplicates the decision table's dead-PID row.

#### `perIssueScenarioSweep.ts`
- Keep the header 1–14.
- 31–36: delete `Pure staleness predicate.` Keep the `filePath` paragraph.
- Keep 60–67.
- 76–81: delete the first sentence (`Finds the merge date … body marker.`), which duplicates 84–86. Keep `Returns null if no merged PR links the issue, or on any lookup failure.`
- Keep 84–86, 97, 115–120, 144–155.
- 106: keep only `/** Fail-safe: null on any error. */`.

#### `promotionSweep.ts`
- Header 1–33:
  - Strip the `#734-shaped` tags. Line 13 becomes `one path (never \`git add -A\`) and files exactly one`, and the next line starts `promotion issue carrying …`. The `redrive` bullet becomes `… still qualifying: re-files exactly one issue.`
  - Keep the rest, including the `Invoke by hand:` usage line.
- Delete the banners 74, 89, 234, 276. Keep 277–279.
- Keep 112.
- Delete 129 (`fileIssueFor`). It restates the name and carries `#734`.
- 143 (`attemptOriginate`) and 166 (`attemptRedrive`): keep only `/** Never throws — swallows and logs. */`.

#### `scanAuthQueue.ts`
- Header 1–9: delete line 2 (`scanAuthQueue — …`) and the blank ` *`. Keep `Called by trigger_cron.ts when the auth gate is absent …` and the numbered steps. They are ordering plus reasons.
- 53–58: delete the `Walks agents/* …` sentence, which duplicates the header. Keep `/** @returns count of orchestrators successfully re-triggered */`.
- Delete 86. It duplicates header step 1.

#### `trigger_webhook.ts`
- Keep the shebang (line 1).
- Header 3–9: keep only the usage line, as `/** Start with: bunx tsx adws/triggers/trigger_webhook.ts */`.
- 11–15: strip ` (issue #647, fix #3 — defensive only)` so it ends `… this line codifies that implicit contract at the entrypoint.` Keep the rest.
- Keep 36, 72–77, 132, 150–151, 154–155, 184, 360.
- Delete 91 (narration).
- **Keep 97.** It is the only content of an empty `catch {}`.
- 207–208: strip ` (Finding 1/2)` so it ends `… to the self-host identity.`
- 323–327: strip ` (#776)` so it ends `… which is the bug.`

#### `upgradeRedrive.ts`
- Header 1–22:
  - Delete line 2 (`upgradeRedrive — …`) and the blank ` *`.
  - Delete the `This module adds an independent cron pass: … for a stranded \`#UPG\`.` sentence. Start the kept text at `The predicate mirrors \`adwUpgrade\`'s own entry gate …`.
  - Delete the final `All I/O is injected via UpgradeRedriveDeps for unit testing.` line.
  - Keep the rest. `#UPG` is not an issue number.
- Delete the banners 31, 48, 77, 155.
- Keep 33.
- 36–40: delete the first line. Keep `Tolerant of case in the heading; returns null when absent or malformed (e.g. empty backticks).`
- 63–67: delete the first sentence. Keep `Order matters only for issues …`.
- Keep 79–80 and 106–108.
- Delete 87 and 117–121. Both restate their target.
- 137–142: delete the first sentence. Keep `Safe to call every cron tick — …`.

#### `webhookEventBoundary.ts`
- Header 1–8: delete line 2 and the blank ` *`. Strip ` (issue #776)` so it reads `… so the webhook process survives it. Pure context/formatting helpers …`.
- Keep the trailing 14 and 15. They document the fallback value domain.
- 25: keep only `/** Never throws — undefined on bad JSON or a non-object result. */`.
- 41: keep only `/** Pure — survives a hostile or truncated body. */`.
- Delete 69.
- 74: keep only `/** Makes no claim about the HTTP response. */`.
- 85–89: delete `Logs and Slack-alerts a contained webhook failure.` Keep from `Contractually never throws …` to the end.
- Keep 103–104.

#### `webhookGatekeeper.ts`
- Delete the file header (1–6).
- Delete 24 (import-line comment; duplicated at 98).
- 29–37: delete the first line and the blank ` *`. Keep the REPO_ROOT paragraph.
- Keep 40 and 82–90.
- 61–65: delete the first line. Keep `Accepts an optional pre-computed decision …`.
- 98–100: keep `Enforce the takeover decision before any spawn.` Delete the rest, which duplicates 61–65.
- Delete 119, 129, 171, 174, the trailing 183, 200–203, 239–241.
- 154: keep only `/** Isolated from its spawn so the write is exercisable on its own. */`.

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
  bun run lint:comment-only adws/triggers/__tests__/autoMergeHandler.test.ts adws/triggers/__tests__/cancelHandler.test.ts adws/triggers/__tests__/cronIssueFilter.test.ts adws/triggers/__tests__/cronLabelEligibility.test.ts adws/triggers/__tests__/devServerJanitor.test.ts adws/triggers/__tests__/issueClosedUnblockRouter.test.ts adws/triggers/__tests__/mergeDispatchGate.test.ts adws/triggers/__tests__/promotionSweepDefaults.test.ts adws/triggers/__tests__/regionOverlap.test.ts adws/triggers/__tests__/retryHandler.test.ts adws/triggers/__tests__/scanAuthQueue.test.ts adws/triggers/__tests__/trigger_cron.test.ts adws/triggers/__tests__/upgradeRedrive.test.ts adws/triggers/__tests__/webhookEventBoundary.test.ts adws/triggers/__tests__/webhookGatekeeper.test.ts adws/triggers/__tests__/webhookHandlers.test.ts adws/triggers/__tests__/webhookRepoResolver.test.ts adws/triggers/autoMergeHandler.ts adws/triggers/cloudflareTunnel.tsx adws/triggers/concurrencyGuard.ts adws/triggers/cronIssueFilter.ts adws/triggers/cronLabelEligibility.ts adws/triggers/cronProcessGuard.ts adws/triggers/devServerJanitor.ts adws/triggers/issueClosedUnblockRouter.ts adws/triggers/issueOpenedRouter.ts adws/triggers/mergeDispatchGate.ts adws/triggers/perIssueScenarioSweep.ts adws/triggers/promotionSweep.ts adws/triggers/scanAuthQueue.ts adws/triggers/trigger_webhook.ts adws/triggers/upgradeRedrive.ts adws/triggers/webhookEventBoundary.ts adws/triggers/webhookGatekeeper.ts
  ```
- No other `adws` files changed: `git diff --name-only origin/dev -- adws` lists only Touched Files.
- No banners remain; must print nothing:
  `grep -nE '^\s*//\s*(-{3,}|─{2,}|={3,})' <Touched Files>`
- No issue-number tags remain in comments; must print nothing:
  `grep -nE '^\s*(//|/?\*).*(#[0-9]{2,}|issue #|Finding [0-9])' <Touched Files>`
  Hits inside `describe`/`it` string literals are code and do not match this pattern.
- `bun run lint`: ESLint. Catches an emptied `catch {}` (`no-empty`).
- `bun run test`: typecheck (`bunx tsc --noEmit`). This is the issue's acceptance command.
- `bunx tsc --noEmit -p adws/tsconfig.json`: additional type check.
- `bun run test:unit`: Vitest. The 17 swept test files must still pass.
- `bun run lint:git-guard`: git/gh guard over `adws/**`. This is a regression check; comment edits cannot trip it.
- `bun run build`

## Notes
- **Coding guidelines.** `.adw/coding_guidelines.md` › `**Comments**`: comment only invariants, ordering constraints, and reasons for non-obvious choices. No next-line narration, no banners, no issue numbers, no name-restating JSDoc. This is the test every surviving comment must meet. No code refactoring is in scope: the guard forbids any non-comment change.
- **Guard mechanics.**
  - The guard reads each file at `origin/<default branch>` via `GitContext.show`.
  - It resolves the default branch through the launch boundary's code host and fetches it first, so it needs forge auth.
  - Never pass a hardcoded `--base` in the per-issue scenario. The issue requires the default branch to be resolved by the guard.
- **Per-issue scenario.** The scenario for #876 asserts exactly one behaviour: the comment-only guard passes for the 34 listed files against the default branch. The step definition should call `runCommentOnlyCheck` from `adws/checkCommentOnly.ts` with the file list and assert `exitCode === 0`. Mirror the shape of `features/per-issue/step_definitions/feature-853.steps.ts`.
- **Judgement calls resolved here.** Where a rationale is duplicated, the plan keeps exactly one copy:
  - spawn dedup: `ProcessedSets` in `cronIssueFilter.ts`
  - unlabeled-issue rule: the header of `cronLabelEligibility.ts`
  - `.adw` marker / fault isolation: `devServerJanitor.ts` header plus the `discoverRepoWorktrees` JSDoc
  - pre-computed decision: the `classifyAndSpawnWorkflow` JSDoc in `webhookGatekeeper.ts`

  Follow the per-file directives as written; do not re-litigate them.
- **Placeholders are not issue tags.** `#UPG`, `#N` and `owner/repo#N` are placeholders. Keep them.
- **Merge path.** The batch auto-merges on the guard. No `hitl` label. Git history is the recovery path for any over-trim.

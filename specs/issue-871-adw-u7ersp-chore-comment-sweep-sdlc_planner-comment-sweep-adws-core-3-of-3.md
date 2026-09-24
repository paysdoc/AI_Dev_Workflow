# Chore: Comment sweep 3/16 — adws/core (3/3)

## Metadata
issueNumber: `871`
adwId: `u7ersp-chore-comment-sweep`
issueJson: `{"number":871,"title":"chore: comment sweep 3/16 — adws/core (3/3)","body":"## Parent PRD\n\n`specs/prd/comment-debloat.md`\n\n## What to build\n\nSweep batch 3 of 16: **adws/core (3/3)** (47 files, 925 comment lines at filing time).\n\nApply the deletion rules from the PRD's *Implementation Decisions › Deletion rules per comment kind* to exactly the files listed under Touched Files. Do not touch any file outside that list. Do not change any code: the only permitted diff is in comments (and the blank lines left behind).\n\nRules for this batch:\n\n- Delete section banner comments (lines of dashes or box-drawing characters).\n- Delete JSDoc blocks that only restate the name of the field or function they sit on.\n- Delete inline comments that narrate the statement directly below them.\n- Strip issue-number tags such as `(#794)` or `(issue #762)` from comments; keep the rest of the comment only if it still carries rationale.\n- Trim mixed comments to the sentences that state an invariant, an ordering constraint, or the reason for a non-obvious choice. Drop the narration sentences.\n- Keep shebang lines and `eslint-disable` directives unchanged.\n\nVerify with the comment-only guard shipped by the blocking issue:\n\n```\nbun run lint:comment-only <every file in Touched Files>\n```\n\n## Acceptance criteria\n\n- [ ] The comment-only guard passes for every file in Touched Files against the default branch (resolved by the guard, never named in the scenario).\n- [ ] No banner comments, name-restating JSDoc, next-line narration, or issue-number tags remain in the listed files.\n- [ ] Every surviving comment states an invariant, an ordering constraint, or the reason for a non-obvious choice.\n\n- [ ] `bun run test` (typecheck) passes.\n- [ ] The per-issue scenario for this issue asserts exactly one behaviour: the comment-only guard passes for the listed files against the default branch.\n\n## Blocked by\n\n- Blocked by #853\n\n## Touched Files\n\n(47 files — see Relevant Files below)\n\n## User stories addressed\n\n- User stories 12–26\n","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-09-24T08:17:58Z","comments":[],"actionableComment":null}`

## Chore Description
Batch 3 of the 16-batch comment-debloat sweep defined in `specs/prd/comment-debloat.md`. It covers the final third of `adws/core`: 24 unit-test files under `adws/core/__tests__/` and 23 source modules under `adws/core/`. The comment rule in `.adw/coding_guidelines.md` (shipped by #853) is applied retroactively to exactly these 47 files:

> Comment only what the code cannot say: invariants, ordering constraints, and the reason a non-obvious choice was made. Never restate what the next line does, never add section banners, never cite issue numbers (git blame carries history). Do not JSDoc a field or function whose name already says what it is.

The only permitted diff is inside comments plus the blank lines they leave behind. The comment-only guard (`adws/checkCommentOnly.ts`, run as `bun run lint:comment-only`) enforces this: it tokenises each file with the TypeScript parser, drops all trivia (comments, whitespace, JSDoc nodes), and compares the result against the default branch (`origin/<default>`, resolved by the guard itself). Any token change fails the file with `code-changed`.

Survey at plan time (all 47 files exist, none contain a shebang, `eslint-disable`, or `@ts-*` directive):

| Kind | Where |
|---|---|
| Banner lines (`// ----`, `// ── … ──`, `// ─── … ───`) | `config.ts`, `docsIndexReportBody.ts`, `environment.ts`, `logger.ts`, `modelRouting.ts`, `projectConfig.ts`, `upgradeClaim.ts`, `utils.ts`, `adwLabels.ts`; tests `conditionalDocsRegistry`, `processLiveness`, `remoteReconcile`, `slackNotifier`, `upgradeClaim.integration` |
| Issue-number / story tags | `adwLabels.ts` (`#820`, `#821`, `User Story 12/13`), `guardrailsProbe.ts` (`issue #762`), `issueRecord.ts` (`#844` ×2), `localRepoIdentity.ts` (`#844`, `@adw-779`/`@adw-844`), `__tests__/workflowMapping.test.ts` (`#547`), `__tests__/slackNotifier.test.ts` (`Fix #2`) |
| Name-restating JSDoc | heavy in `config.ts`, `environment.ts`, `projectConfig.ts`, `modelRouting.ts`, `orchestratorCli.ts`, `logger.ts`, `utils.ts`, `workflowMapping.ts`, `orchestratorLib.ts` |
| Next-line narration | `modelRouting.ts` map group labels, `projectConfig.ts` loader (`// commands.md`, `// file missing — keep empty`), `orchestratorCli.ts`, `environment.ts`, most test files |
| No comments at all (no edit expected) | tests `docsIndexReportBody`, `guardrailsGate`, `localRepoIdentity`, `promotionReconcileLink`, `promotionTagState`, `repoIdentityCrossCheck`, `resolvePrReviewTarget`, `resumePolicy`, `stackCoherenceCheck`, `targetRepoManager`, `unaddressedComments`, `workflowCommentParsing`; sources `repoIdentityCrossCheck.ts`, `resolvePrReviewTarget.ts` |

## Relevant Files
Use these files to resolve the chore:

- `specs/prd/comment-debloat.md` — parent PRD; *Implementation Decisions › Deletion rules per comment kind* is the authoritative rule set; *Out of Scope* forbids rewriting kept prose.
- `.adw/coding_guidelines.md` — the `Comments` bullet (line 62) is the keep/delete test for every surviving comment.
- `adws/checkCommentOnly.ts` — the comment-only guard used for validation (read-only; not in the touched list).
- `app_docs/feature-m363ky-comment-only-guard.md` — documents the guard's usage and failure reasons.
- `app_docs/feature-9gjajh-test-report-and-verdict.md` — owns `testReportParser.ts` / its tests / `resolveVerdict.test.ts`; context for which parser comments are load-bearing (entity-expansion limit, bare `<failure/>` semantics).
- `app_docs/feature-9gjajh-hash-and-versioning.md` — owns `upgradeClaim.ts` and `upgradeClaim.integration.test.ts`; context for the nonce and detached-worktree rationale that must survive.
- `app_docs/feature-9gjajh-pr-and-merge-phases.md` — owns `resolvePrReviewTarget.ts` / tests and `unaddressedComments.test.ts` (both comment-free; no edit expected).

Touched files (the ONLY files that may change):

Tests (`adws/core/__tests__/`):
- `authGate.test.ts` — 8 inline comments; mostly narration (`// Should not throw`, `// Small delay…`, `// File should be parseable`). Keep only ones carrying a reason the assertion can't show (e.g. line 167 "regardless of which write won the race" states the invariant under test — keep); delete the rest.
- `claudeStreamParser.test.ts` — 6 narration comments (chunk-splitting play-by-play, `// empty chunk`). Keep line 4 only if trimmed to the reason (avoid filesystem side effects); delete narration.
- `conditionalDocsRegistry.test.ts` — 11 banner blocks (`// ---- / // §N Title / // ----`): delete all three lines of each. Line 168 (serializer normalises to one blank line) is an invariant — keep.
- `heartbeat.test.ts` — header JSDoc: keep the fake-timers / real-state-manager sentences only if they state a non-obvious choice; drop "Contract tests for the heartbeat module."
- `processLiveness.test.ts` — delete the four `// ─── … ───` banners and line 156 narration. Keep the stat-line format comment (lines 5–8) and the nested-comm comment (102–103): they explain the field-22 layout the fixture depends on.
- `projectConfig.test.ts` — delete line 172 narration.
- `remoteReconcile.test.ts` — delete the seven `// ── … ──` banners. Keep the re-verification sequence comments (97, 134–138, 151, 163): they state the expected read-count/flap invariant being tested.
- `resolveVerdict.test.ts` — 5 case-label comments; delete any that merely restate the adjacent `it(...)` title, keep only ones adding a rule the title omits (e.g. "Gaming guard … regardless of budget").
- `slackNotifier.test.ts` — delete the banner block (24–26, including `Fix #2`) and line 39 (`RED before Fix #2`), which is history.
- `testReportParser.test.ts` — keep the entity-expansion rationale (150–151, 165–168, 180–183, 186, 194–195); delete pure narration (160, 212) if the assertion shows it.
- `upgradeClaim.integration.test.ts` — delete the `// ── §N … ──` banners and step narration (98, 101, 130, 141, 157, 160, 178, 216, 233). Trim the file header to the sentences about using a real bare repo / real GitContext without credentials; drop the "satisfies the AC requirement" sentence. Keep the `buildGitContext` JSDoc sentence on the `getDefaultBranchFn` seam (why no network). Keep the §5 leftover-branch rationale (256–260) but drop the "(Bug B)" banner.
- `workflowMapping.test.ts` — strip `(#547)`; keep the rest (explains why `/adw_init` falls back).
- `docsIndexReportBody.test.ts`, `guardrailsGate.test.ts`, `localRepoIdentity.test.ts`, `promotionReconcileLink.test.ts`, `promotionTagState.test.ts`, `repoIdentityCrossCheck.test.ts`, `resolvePrReviewTarget.test.ts`, `resumePolicy.test.ts`, `stackCoherenceCheck.test.ts`, `targetRepoManager.test.ts`, `unaddressedComments.test.ts`, `workflowCommentParsing.test.ts` — no comments; leave untouched (still passed to the guard).

Sources (`adws/core/`):
- `adwLabels.ts` — header: drop entirely (history: "Moved out of … (#820) … until #821"; "pure constants" is visible). Delete two `// ── … ──` banners. Strip "(User Story 12/13)" from the advisory-label JSDoc, keep the rest (why detection keys off the issue label). Keep the promotion-candidate exclusion rationale (17–24) and the `scenarioAuthoringSkipReason` two-reasons JSDoc. Delete "Pure function — no I/O, no logging." restating JSDoc on `readAdwLabelNames`-style readers if the rest only restates the name; delete line 108 and 135 if name-restating; keep 140 (fallback colour) and 146–149 (lenient matching rule).
- `agentTimeouts.ts` — header: keep the env-var override format line (non-inferable naming rule); drop "Mirrors the structure of modelRouting.ts". Keep lines 11–12 (why computed independently of config.ts). Delete line 16 narration. Trim map JSDoc (19–23) to the "visibly extensible" reason or delete. Keep the lookup-order JSDoc (ordering constraint).
- `config.ts` — delete every `// ---- / // Title / // ----` banner and `// Heartbeat constants`. Header: drop the module-summary and "re-exported for backward compatibility" narration; keep the pointer that env concerns live in `environment.ts` only if it states a boundary rule. Delete constant JSDoc that restates the name + default already visible in the initializer (retry counts, currencies, token totals, cost breakdowns). Keep the "≈ once per day at 20s POLL_INTERVAL_MS" and "Generous so the sweep's git/gh actions … do not run every 20s tick" reasons; keep "six missed ticks" on the stale threshold.
- `docsIndexReportBody.ts` — delete three banner blocks. Header: keep the reconcile-via-marker-plus-fingerprint and "No I/O" boundary sentences; drop the filename restatement. Keep the order-independent fingerprint invariant (45), the `hitl`/`adw:none` label rationale (73–78), the uppercase/absent⇒open field note (119), and the "lowest-numbered OPEN" rule (127). Delete name-restating JSDoc (29 if it only restates, 109).
- `environment.ts` — delete six banners and line 41 narration and the 70/77/86 narration inside `resolveClaudeCodePath`. Header: keep only the "secret accessors live here rather than in config.ts so … imported without side-effects" reason. Keep REPO_ROOT rationale (17–19), `assertRepoRootCwd` rationale, stderr-not-`log` rationale (32–33), and the cache-keyed-on-live-env-var sentences of `resolveClaudeCodePath`. Delete name-restating JSDoc on every provider secret/path constant (105–160) except where it carries behaviour (keep "Empty string disables D1 writes"; keep "needs api scope" only if treated as a non-inferable requirement). Keep the allowlist/"prevents leaking secrets" reason on `buildSafeEnv`-style helper.
- `guardrailsProbe.ts` — header: strip "(issue #762)"; keep the subprocess-isolation and at-most-once-per-process reasons. Keep the never-throws/fail-open and lazy `REPO_ROOT` rationale. Delete `/** Outcome of a guardrails probe run. */`. Keep the memoisation reason and the test-only seam note.
- `issueRecord.ts` — header is history (#844, "Before #844 …"); delete it, or keep only the one-sentence invariant that `Issue` carries `createdAt`/`url` for byte-stable port crossing without issue tags. Keep the "No additional error wrap … would double the prefix" reason.
- `localRepoIdentity.ts` — header: strip "(#844)" and the "replaces … so the only production import …" history; keep the SSH-normalisation rationale (8–14) and the `platform: Platform.GitHub` convention paragraph (16–19). Delete line 27 if it only restates the default. Keep `normaliseSshRemote` JSDoc. In the reader JSDoc, drop the `@adw-779`/`@adw-844` tag reference but keep "one try/catch spans both … same message" reason.
- `logger.ts` — delete four banners, header, `// ANSI color codes`, and the setter/getter/reset JSDoc that restate names (keep "Intended for test isolation only" on the reset). Trim `log` JSDoc to the non-obvious behaviour (adwId inclusion, errors in red) or delete if judged inferable.
- `modelRouting.ts` — delete four banners and the header's history ("Extracted from config.ts to keep the god module under 300 lines"). Delete the type JSDoc that restates the flag name. Delete the category group-label comments inside all four maps (`// Classification`, `// Scenario writing`, `// Install and prime`, …). Keep only parentheticals that justify a non-obvious tier choice, e.g. "no downgrade" in the fast/cheap maps and "mirrors validate_plan_scenarios" — reduce each to that reason. Keep the effort-support-by-model table and the "must stay in sync with SLASH_COMMAND_MODEL_MAP" invariant. Delete helper JSDoc that restates the name (`isFastMode`-style detector); keep the `/fast`/`/cheap` selection rule once where it is not obvious.
- `orchestratorCli.ts` — this is a library, not an entrypoint, so the orchestrator-header rule does not apply. Delete the header, the `{@link}`-only interface JSDoc (16–18, 26–28), `printUsage` JSDoc, and `@param`/`@returns` lines restating types, plus "Moved from utils.ts" history and inline narration (172, 175). Keep "(mutates the array)" and "Exits with an error if …" side-effect notes.
- `orchestratorLib.ts` — delete header history ("Extracted from adwPlan.tsx…"); keep the `shouldExecuteStage` / next-stage fallback-rule sentences ("Returns 'starting' if …") only where they state non-obvious behaviour.
- `orchestratorNames.ts` — keep the circular-import reason (why this module is split out); drop "Static orchestrator name / script mappings." and "Extracted from" phrasing only as far as the remaining sentence still reads.
- `processLiveness.ts` — keep the PID-reuse rationale and platform-support block in the header; drop the name line. Keep all `/proc/<pid>/stat` field-layout comments (34–43): they are the invariant behind index 19. Keep the two exported-function JSDocs (null/false contracts for Windows).
- `projectConfig.ts` — delete five banners, the header (restates the file list the loader shows), and the loader narration (`// commands.md` … `// scenarios.md`, `// file missing — keep empty` ×3, `// First row is the header — skip it`). Delete field JSDoc that only restates the field name or source filename; keep ones with a default/absence rule (`Absent ⇒ undefined (legacy behaviour)`, `Defaults to 'features/step_definitions'`, `Empty string ⇒ default .ts extensions`, `Defaults to 'cli'`). Keep the `parseUnitTestsEnabled` two-formats JSDoc, the providers lowercasing/URL-case rule, and the review-proof fallback rule.
- `stackCoherenceCheck.ts` — keep ordering comments (24, 35, 52). Delete section labels `// Gherkin-mandate check` / `// Language-coherence check` if the called function names already say it.
- `testReportParser.ts` — keep entity-limit rationale (24–27), bare-`<failure/>` JSDoc and pending-is-skipped rationale, and parse-error logging rationale (127–129). Keep field note on `message` (undefined for passed/skipped). Line 63 may stay if it explains the string shape.
- `upgradeClaim.ts` — delete four `// ── … ──` banners and `// best-effort` only if the empty catch is self-evident (keep otherwise — it explains a swallowed error). Keep the nonce-correctness paragraph and winner/loser protocol in the header; drop generic "All I/O is injected … unit-testable" only if judged narration. Keep `gitErrorText`, non-fast-forward, exported-for-integration-tests, and detached-worktree rationale comments.
- `utils.ts` — delete two banners, the header (split history), and `// Re-export from focused modules`. Keep the non-retryable-errors JSDoc sentence (throws immediately without backoff); trim `execWithRetry` JSDoc to the non-obvious bits (synchronous sleep via Atomics, default `maxAttempts` 3) and drop `@param`/`@returns` restatements. Delete `ensureLogsDirectory` JSDoc if name-restating.
- `workflowMapping.ts` — delete header except the fallback-to-`adws/adwPlanBuildTest.tsx` rule if not visible in code; delete the function JSDoc (`@param`/`@returns` restate).
- `workspaceBinding.ts` — keep: header and both JSDocs state invariants (reads through the GIVEN context, never mints a second provider set, refuses a foreign `repoId` before touching providers). Only trim "as today" wording if it is narration; otherwise leave unchanged.
- `repoIdentityCrossCheck.ts`, `resolvePrReviewTarget.ts` — no comments; leave untouched.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### 1. Confirm baseline and scope
- Run `git fetch origin` and confirm the guard passes on the untouched tree: `bun run lint:comment-only <all 47 files>` must print `✔ PASS`.
- Do not touch `.claude/commands/scenario_writer.md` (pre-existing unrelated modification) or any file outside the 47 listed.

### 2. Sweep the test files (`adws/core/__tests__/`)
- Apply the per-file guidance in *Relevant Files › Tests* in this order: `conditionalDocsRegistry`, `processLiveness`, `remoteReconcile`, `slackNotifier`, `upgradeClaim.integration` (banner-heavy), then `authGate`, `claudeStreamParser`, `heartbeat`, `projectConfig`, `resolveVerdict`, `testReportParser`, `workflowMapping`.
- When a banner block is deleted, also delete the blank line it leaves so at most one blank line separates top-level statements.
- Leave the 12 comment-free test files untouched.

### 3. Sweep the banner-heavy sources
- `config.ts`, `environment.ts`, `projectConfig.ts`, `modelRouting.ts`, `logger.ts`, `utils.ts`, `docsIndexReportBody.ts`, `upgradeClaim.ts`, `adwLabels.ts`: remove every banner, then apply the JSDoc/narration guidance above.
- In `modelRouting.ts`, edit only comment text inside the four map literals — do not reorder, re-indent, or touch any key/value.

### 4. Strip issue-number tags
- `adwLabels.ts` (`#820`, `#821`, `User Story 12/13`), `guardrailsProbe.ts` (`issue #762`), `issueRecord.ts` (`#844`), `localRepoIdentity.ts` (`#844`, `@adw-779`/`@adw-844`), `__tests__/workflowMapping.test.ts` (`#547`), `__tests__/slackNotifier.test.ts` (`Fix #2`).
- Where the remaining text is pure history ("Before #844 this was …", "Moved out of …"), delete the sentence; keep only sentences that still carry rationale.

### 5. Sweep the remaining sources
- `agentTimeouts.ts`, `guardrailsProbe.ts`, `issueRecord.ts`, `localRepoIdentity.ts`, `orchestratorCli.ts`, `orchestratorLib.ts`, `orchestratorNames.ts`, `processLiveness.ts`, `stackCoherenceCheck.ts`, `testReportParser.ts`, `workflowMapping.ts`, `workspaceBinding.ts` per the guidance above.
- Kept comments are trimmed, never reworded: delete whole sentences; do not rewrite surviving prose (PRD *Out of Scope*).
- When trimming a multi-line JSDoc down to one sentence, a single-line `/** … */` is fine; when a JSDoc loses all content, delete the whole block.

### 6. Self-check the sweep
- `grep -nE '^\s*//\s*(-{3,}|─{3,}|═{3,})|//\s*──' <all 47 files>` returns nothing (no banners).
- `grep -nE '(//|\*).*(#[0-9]{2,}|issue [0-9]{2,}|@adw-[0-9]+|User Stor(y|ies) [0-9])' <all 47 files>` returns nothing (no issue tags).
- `git diff --stat` lists only files from the Touched Files list; `git diff` shows only `-` comment/blank lines and at most comment-only `+` lines (trimmed JSDoc).

### 7. Run the Validation Commands
- Execute every command in *Validation Commands*; all must succeed.

## Validation Commands
Execute every command to validate the chore is complete with zero regressions.

- `bun run lint:comment-only adws/core/__tests__/authGate.test.ts adws/core/__tests__/claudeStreamParser.test.ts adws/core/__tests__/conditionalDocsRegistry.test.ts adws/core/__tests__/docsIndexReportBody.test.ts adws/core/__tests__/guardrailsGate.test.ts adws/core/__tests__/heartbeat.test.ts adws/core/__tests__/localRepoIdentity.test.ts adws/core/__tests__/processLiveness.test.ts adws/core/__tests__/projectConfig.test.ts adws/core/__tests__/promotionReconcileLink.test.ts adws/core/__tests__/promotionTagState.test.ts adws/core/__tests__/remoteReconcile.test.ts adws/core/__tests__/repoIdentityCrossCheck.test.ts adws/core/__tests__/resolvePrReviewTarget.test.ts adws/core/__tests__/resolveVerdict.test.ts adws/core/__tests__/resumePolicy.test.ts adws/core/__tests__/slackNotifier.test.ts adws/core/__tests__/stackCoherenceCheck.test.ts adws/core/__tests__/targetRepoManager.test.ts adws/core/__tests__/testReportParser.test.ts adws/core/__tests__/unaddressedComments.test.ts adws/core/__tests__/upgradeClaim.integration.test.ts adws/core/__tests__/workflowCommentParsing.test.ts adws/core/__tests__/workflowMapping.test.ts adws/core/adwLabels.ts adws/core/agentTimeouts.ts adws/core/config.ts adws/core/docsIndexReportBody.ts adws/core/environment.ts adws/core/guardrailsProbe.ts adws/core/issueRecord.ts adws/core/localRepoIdentity.ts adws/core/logger.ts adws/core/modelRouting.ts adws/core/orchestratorCli.ts adws/core/orchestratorLib.ts adws/core/orchestratorNames.ts adws/core/processLiveness.ts adws/core/projectConfig.ts adws/core/repoIdentityCrossCheck.ts adws/core/resolvePrReviewTarget.ts adws/core/stackCoherenceCheck.ts adws/core/testReportParser.ts adws/core/upgradeClaim.ts adws/core/utils.ts adws/core/workflowMapping.ts adws/core/workspaceBinding.ts` — must print `✔ PASS` for 47 files.
- `bun run lint` — ESLint passes.
- `bun run test` — root typecheck (`bunx tsc --noEmit`) passes.
- `bunx tsc --noEmit -p adws/tsconfig.json` — adws typecheck passes.
- `bun run test:unit` — vitest suite passes (touched test files still run identically).
- `bun run build` — build passes.

## Notes
- Strictly follow `.adw/coding_guidelines.md`; its `Comments` bullet is the keep/delete test. The PRD's *Out of Scope* forbids improving kept prose — trim by deleting whole sentences, never rephrase, and never change what a surviving JSDoc says.
- The guard ignores all trivia, so blank-line changes cannot fail it — but any accidental edit to code (a trailing comma, an import, a string that happens to contain `//`, a template literal) will. Be careful in `modelRouting.ts` (comments sit between map entries), `processLiveness.ts` / `testReportParser.ts` (comments inside function bodies), and any line with a trailing `// …` after code: delete only from `//` to end-of-line, leaving the code and its trailing whitespace-free end.
- `//` inside string literals (URLs such as `https://…` in `environment.ts`/`localRepoIdentity.ts`) is code, not a comment — do not touch.
- No shebangs, `eslint-disable`, or `@ts-*` directives exist in these files; if one is encountered, keep it unchanged.
- `orchestratorCli.ts` is a shared library, not an orchestrator entrypoint, so the PRD's "keep usage line and env-var list" header rule does not apply to it.
- The per-issue BDD scenario (one behaviour: comment-only guard passes for the listed files against the default branch) is authored by the scenario agent, not in this plan; it must not name the default branch.
- Do not stage or commit `.claude/commands/scenario_writer.md`; it is an unrelated pre-existing working-tree change.

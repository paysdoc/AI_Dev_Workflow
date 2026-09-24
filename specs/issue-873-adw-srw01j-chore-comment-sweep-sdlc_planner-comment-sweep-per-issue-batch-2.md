# Chore: Comment sweep 5/16 — features/per-issue (2/3)

## Metadata
issueNumber: `873`
adwId: `srw01j-chore-comment-sweep`
issueJson: `{"number":873,"title":"chore: comment sweep 5/16 — features/per-issue (2/3)","body":"## Parent PRD\n\n`specs/prd/comment-debloat.md`\n\n## What to build\n\nSweep batch 5 of 16: **features/per-issue (2/3)** (13 files, 863 comment lines at filing time).\n\nApply the deletion rules from the PRD's *Implementation Decisions › Deletion rules per comment kind* to exactly the files listed under Touched Files. Do not touch any file outside that list. Do not change any code: the only permitted diff is in comments (and the blank lines left behind).\n\nRules for this batch:\n\n- Delete section banner comments (lines of dashes or box-drawing characters).\n- Delete JSDoc blocks that only restate the name of the field or function they sit on.\n- Delete inline comments that narrate the statement directly below them.\n- Strip issue-number tags such as `(#794)` or `(issue #762)` from comments; keep the rest of the comment only if it still carries rationale.\n- Trim mixed comments to the sentences that state an invariant, an ordering constraint, or the reason for a non-obvious choice. Drop the narration sentences.\n- Keep shebang lines and `eslint-disable` directives unchanged.\n- Feature files: delete every `#` comment line, except at most one short line directly under `Feature:` when the domain term is not self-evident.\n\nVerify with the comment-only guard shipped by the blocking issue:\n\n```\nbun run lint:comment-only <every file in Touched Files>\n```\n\n## Acceptance criteria\n\n- [ ] The comment-only guard passes for every file in Touched Files against the default branch (resolved by the guard, never named in the scenario).\n- [ ] No banner comments, name-restating JSDoc, next-line narration, or issue-number tags remain in the listed files.\n- [ ] Every surviving comment states an invariant, an ordering constraint, or the reason for a non-obvious choice.\n- [ ] Every listed `.feature` file has no `#` comment lines beyond at most one short line under `Feature:`.\n- [ ] `bun run test` (typecheck) passes.\n- [ ] The per-issue scenario for this issue asserts exactly one behaviour: the comment-only guard passes for the listed files against the default branch.\n\n## Blocked by\n\n- Blocked by #853\n\n## Touched Files\n\n- features/per-issue/feature-818.feature\n- features/per-issue/feature-820.feature\n- features/per-issue/feature-821.feature\n- features/per-issue/step_definitions/cron-launch-context-ctx.ts\n- features/per-issue/step_definitions/feature-533-then.steps.ts\n- features/per-issue/step_definitions/feature-533.steps.ts\n- features/per-issue/step_definitions/feature-794.steps.ts\n- features/per-issue/step_definitions/feature-796.steps.ts\n- features/per-issue/step_definitions/feature-819.steps.ts\n- features/per-issue/step_definitions/feature-821.steps.ts\n- features/per-issue/step_definitions/feature-823-workspace.steps.ts\n- features/per-issue/step_definitions/feature-844.steps.ts\n- features/per-issue/step_definitions/gitContextSharedWorld.ts\n\n## User stories addressed\n\n- User stories 12–26\n","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-09-24T08:18:01Z","comments":[],"actionableComment":null}`

## Chore Description
Batch 5 of the 16-batch comment de-bloat sweep defined in `specs/prd/comment-debloat.md`. It strips agent-authored comment noise from 13 files under `features/per-issue/` (3 feature files, 10 step-definition modules), applying the PRD's *Deletion rules per comment kind*:

- **Banners** (`// -----`, `// ── … ──`, `# ── … ──`): delete.
- **JSDoc that restates the name** of the field/function it sits on: delete.
- **Narration** of the statement directly below: delete.
- **Issue-number tags** (`#817`, `(#823)`, `#820 §4:`, `#821 (dcdd8622)`): strip; keep the remainder only if it still carries rationale.
- **Mixed comments**: keep only the sentences that state an invariant, an ordering constraint, or the reason for a non-obvious choice.
- **Shebangs / `eslint-disable` / `@ts-*` directives**: keep unchanged. None exist in these 13 files (verified by grep).
- **Feature files**: delete every `#` comment line, except at most one short line directly under `Feature:`.

This is a comment-only change. The `adws/checkCommentOnly.ts` guard (`bun run lint:comment-only`) enforces it. For `.ts` files the guard compares the parser's non-trivia token stream, so any code-token change fails. For `.feature` files it compares the non-blank, non-`#` trimmed lines, including doc-string content, so any change to a tag, keyword, step, table row, doc string, or the free-text feature description fails.

Measured comment lines right now (they match the 863 at filing time):

| File | Total lines | Comment lines |
|---|---|---|
| feature-818.feature | 636 | 117 (`#`) |
| feature-820.feature | 558 | 165 (`#`) |
| feature-821.feature | 547 | 128 (`#`) |
| cron-launch-context-ctx.ts | 28 | 16 |
| feature-533-then.steps.ts | 159 | 3 |
| feature-533.steps.ts | 140 | 40 |
| feature-794.steps.ts | 520 | 77 |
| feature-796.steps.ts | 1077 | 96 |
| feature-819.steps.ts | 544 | 55 |
| feature-821.steps.ts | 619 | 67 |
| feature-823-workspace.steps.ts | 48 | 5 |
| feature-844.steps.ts | 725 | 82 |
| gitContextSharedWorld.ts | 115 | 12 |

## Relevant Files
Use these files to resolve the chore:

- `README.md`: project overview. Its current bullet on the comment-only guard describes the tool used to verify this chore.
- `.adw/coding_guidelines.md`: the **Comments** entry is the standard every surviving comment must meet: only invariants, ordering constraints, or reasons for non-obvious choices; no restating the next line, no banners, no issue numbers, no JSDoc on self-describing names.
- `specs/prd/comment-debloat.md`: parent PRD. *Implementation Decisions › Deletion rules per comment kind* is the rule set for this chore.
- `adws/checkCommentOnly.ts`: the comment-only guard (`bun run lint:comment-only [--base <ref>] <files...>`). It defines exactly what counts as "code" for `.ts` and `.feature` files. With no `--base`, it resolves the default branch via the launch boundary's code host and fetches `origin/<default>`.
- `eslint.config.js`: extends `eslint.configs.recommended`, so `no-empty` is active. An empty `catch {}` whose only content is a comment errors if that comment is deleted. This constrains two comments in `feature-794.steps.ts` (see below).
- `package.json`: scripts `lint:comment-only`, `lint` (`eslint .`), `test` (`bunx tsc --noEmit`).
- The 13 Touched Files (the only files this chore may modify):
  - `features/per-issue/feature-818.feature`
  - `features/per-issue/feature-820.feature`
  - `features/per-issue/feature-821.feature`
  - `features/per-issue/step_definitions/cron-launch-context-ctx.ts`
  - `features/per-issue/step_definitions/feature-533-then.steps.ts`
  - `features/per-issue/step_definitions/feature-533.steps.ts`
  - `features/per-issue/step_definitions/feature-794.steps.ts`
  - `features/per-issue/step_definitions/feature-796.steps.ts`
  - `features/per-issue/step_definitions/feature-819.steps.ts`
  - `features/per-issue/step_definitions/feature-821.steps.ts`
  - `features/per-issue/step_definitions/feature-823-workspace.steps.ts`
  - `features/per-issue/step_definitions/feature-844.steps.ts`
  - `features/per-issue/step_definitions/gitContextSharedWorld.ts`

No conditional doc in `.adw/conditional_docs.md` owns `features/per-issue/**`. `app_docs/feature-9gjajh-bdd-regression-suite.md` owns only `features/regression/**`, so no extra docs are needed.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

General rules for every step:
- Touch only comment text and the blank lines that deleting it leaves behind. Never edit a code token, string literal, template literal, regex, Gherkin keyword, tag, step text, table row, doc string, or free-text feature description.
- Where a deletion leaves two or more consecutive blank lines, collapse them to one. The guard ignores blank lines, so this is safe.
- Line numbers below refer to the files as they are on the branch now. Work each file from the bottom up so earlier line numbers stay valid, or match on the comment text.
- When trimming, keep the surviving sentence's wording (the PRD forbids rewriting prose it keeps). Only drop sentences, drop issue tags, and fix the leftover punctuation.

### 1. Feature files: delete every `#` comment line
Applies to `feature-818.feature` (117 lines), `feature-820.feature` (165 lines) and `feature-821.feature` (128 lines).
- Every `#` line in these files is an indented (2-space) block-comment line outside any doc string. This was verified: no `#` line sits inside a `"""`/`` ``` `` block. Delete all of them: the `# ── §N … ──` banners, the `#` spacer lines, and every multi-line `#` essay above a scenario.
- Do NOT add a line under `Feature:`. None of these files has a `#` line there today. The line after each `Feature:` title is free-text Gherkin description, which the guard treats as content.
- Do NOT touch the free-text description under `Feature:` (for example the "Issue #818 is the third slice…" and "── WHAT "FOR FORGE OPERATIONS" MEANS… ──" paragraphs in 820/821). It is Gherkin description, not a `#` comment. Editing it changes the normalised form and fails the guard. It is out of scope for this batch.
- Collapse the runs of blank lines this leaves between scenarios to a single blank line.
- Check: `grep -cE '^[[:space:]]*#' features/per-issue/feature-8{18,20,21}.feature` prints `0` for each file.

### 2. `step_definitions/cron-launch-context-ctx.ts`
- Lines 1–16 (header JSDoc): drop the name-restating first sentence ("Shared cron launch-context flag for cron-tick BDD step definitions.") and the precedent narration ("Same precedent as takeover-probe-ctx.ts — …"). Keep the rationale and the invariant:
  - why this module exists: the Given "the cron holds no launch context" is registered once in feature-769.steps.ts, because Cucumber treats identical literal registrations as globally ambiguous, so this module is the seam feature-769 writes and feature-810 reads;
  - `null` means no launch-context Given ran; both consuming files' After hooks call `resetCronLaunchContext()` so scenarios stay independent.

### 3. `step_definitions/feature-533-then.steps.ts`
- Lines 6–8: delete the banner (`// ----`, `// Then — claude-cli-stub invocation recording assertions`, `// ----`).

### 4. `step_definitions/feature-533.steps.ts`
- Lines 1–20 (header JSDoc): delete all of it. It restates the file's role and gives a stale step→file lookup table, with no invariant or reason.
- Banners at 33–35, 43–45, 72–74 and 129–131: delete.
- JSDoc at 37, 40, 76, 90, 97 and 117: these restate the name of the field or function below. Delete.
- Line 136: trim to the reason for the early `'pending'` return. mockContext is set only for per-issue scenarios, which stay pending until CUTOVER. Keep the wording and drop only the leading "Per-issue scenarios:" label if it doesn't read.
- Line 138 (`// No-op for source-inspection scenarios (mockContext null).`): delete. This removes the trailing comment in a non-empty function body, so no lint impact.

### 5. `step_definitions/feature-794.steps.ts`
- Lines 1–22 (header JSDoc): delete the "BDD step definitions for feature-794.feature" line, the one-line summary and the §1–§12 index. Keep only the rationale paragraph at 19–21 (driven through `LaunchGitContextDeps` injection seams; no framework source file is read as text; every assertion targets an object the system produces). Drop "exactly as feature-660/feature-700/feature-791 drive it".
- Line 42 (`// ── World state ──`) and line 131 (`// ── Shared helpers ──`): delete the banners.
- Line 67 (JSDoc on `declaredPlatform`): strip `#817 seam:`. Keep the invariant: when undeclared, `deps.platform` is omitted, so the boundary defaults to `Platform.GitHub`. You may also drop the "folded into … by makeDeps()" narration.
- Lines 113–118: delete. This is history of a removed workaround (#823) and describes code that no longer exists.
- Line 149: keep ("Records at most one read per call; the last configured answer repeats forever." is an invariant).
- Lines 173–174: strip `#823's`. Keep the reason: record AND delegate, because recording alone would blind the "no board manager for a gitlab code host" row to the library's real shape.
- Lines 183–184: keep (reason: a fixture GitLab config keeps scenarios free of real env reads).
- Line 193 trailing `// triggers the memoised mint on first access`: keep. It explains a non-obvious `void` expression.
- Line 201: keep (reason: real git binary, so a mock `git` on PATH doesn't affect worktree setup).
- Line 206: restates `initialiseRepo…`. Delete.
- Every `// ── §… ──` section banner at 216, 224, 230, 247, 258, 272, 301, 311, 329, 337, 381, 412 and 430: delete.
- Lines 421 and 426 sit alone inside `catch {}` blocks. **They must stay.** ESLint `no-empty` (from `eslint.configs.recommended`) errors on an empty block. Keep 421 ("Frozen — throws under ES module strict mode. Swallow; the Then step verifies identity below.") and 426 ("Same — swallow and verify.") unchanged.
- Lines 479–480 (the "§12 reuses … no new step definitions" navigation note): delete.
- Lines 482–493: delete both banner lines. Strip `(#817)`. Delete "No `@adw-794` phrase text changes." and "whose makeDeps() never set deps.platform before now" (history). Keep the rationale: feature-817.steps.ts reuses this file's Given/When steps; registering new "declares the platform" phrases here would be an AmbiguousStepDefinition, so the declaration is an exported setter and the read an exported accessor; per-scenario resets are the caller's responsibility, so the undeclared-platform row still exercises `deps.platform ?? Platform.GitHub`.
- Lines 495 and 500 (JSDoc on the setter/accessor): they restate the function names. Delete.
- Lines 505–510: delete both banner lines and strip `(#823)`. Keep the reason: feature-823.steps.ts reuses this world and needs its own reset/accessor, because this file's Before/After are tag-scoped to `@adw-794` and never run for `@adw-823` scenarios.
- Lines 512 and 517 (JSDoc on the reset/accessor): delete, since the preceding seam comment now carries the reason. If the "mirrors this file's own `Before` body" clause seems load-bearing, keep only that clause (it's an invariant: reset must match `Before`).

### 6. `step_definitions/feature-796.steps.ts`
- Lines 1–26 (header JSDoc): delete the title line, the summary, the §1–§9 index and the "Driven through … exactly as feature-794.steps.ts" paragraph. Keep only the invariant paragraph at 22–25: the fixture repository "adw-fixture/void-796" is never real, and every `targetReposDir`/`frameworkRepoRoot` is a throwaway mkdtemp dir, so an un-migrated git operation fails locally and fast instead of hitting the network.
- Lines 69 and 72 (`// ── … ──`): delete the banners.
- `Fixture` field JSDoc at 92, 94, 96, 98, 103, 105, 108, 110 and 112: strip the leading tags (`#820 §4:`, `#820 §7:`, `#821:`, `#844:`, `#848:`). Keep the rest, since each states field semantics the name doesn't (map direction, lazy-create/idempotency, open+closed+merged store, default-when-unset, refusal behaviour, "as GitHub does with ADW's PAT-served approval").
- Lines 178–182 (JSDoc on `world796()`): strip `(#820)` and drop "the same pattern as feature-816.steps.ts's `resetGuardFixtureTree`". Keep the invariant: returns the SAME mutable object every call; callers read/write it directly and never clone it.
- Line 233 (`// ── Shared helpers ──`): delete.
- Line 281 (JSDoc on `FORGE_SEMANTIC_METHODS`): delete. It gives provenance with stale line numbers, and the name already says what the set is.
- Line 292 (JSDoc on `watchGitContext`): trim to the non-obvious half ("everything else forwards silently"), or delete if that reads as restating. Implementer's judgement.
- Line 305 (JSDoc on `makeStubGitContext`): keep only the reason it exists (scenarios with no real GitContext to watch, the auto-merge phase config), or delete. Implementer's judgement.
- Lines 325–326: strip `(#844)`. Keep the invariant: this mirrors the real GitHub tracker's wrap exactly, and `fetchIssueRecord` doesn't wrap it again, so this IS the message the caller sees.
- Line 513 (JSDoc on `buildRecordingBoundary`): restates the name. Delete.
- Line 545 (JSDoc on `claimBranchName`): keep only "deterministic per run" if kept at all; otherwise delete.
- Lines 554–561 (JSDoc on `setClaimBranchOverride`): keep. It explains why a frozen override exists (the real name embeds a per-commit hash that literal Gherkin can't match) and the ordering rule (scenarios that drive the real upgrade orchestrator must leave it unset; pass null to restore). Drop only the "(feature-820 §10)" cross-reference if desired.
- Every `// ── … ──` section banner at 620, 639, 665, 673, 681, 708, 725, 758, 767, 815, 826, 882, 912, 935, 963, 985, 1003, 1028 and 1049: delete.
- Lines 690–697 (JSDoc on `noteBranchHasNoPullRequest`): keep the reason. The phrase is already registered by feature-527.steps.ts, and re-registering it would be an AmbiguousStepDefinition, so feature-527 calls this exported hook. Drop the "(G20, mock-server PR fixture setup …)" parenthetical.
- Lines 789–793: strip `#821 (dcdd8622)`. Keep the reason: `executeAutoMergePhase` skips with no provider call when `gitContext` is falsy, every scenario from this fixture stops at the hitl-label gate, so a non-functional stub is enough; scenarios that need to watch it override it via the "…watched for forge-semantic calls" Given.
- Line 818: keep (reason for resetting the count).
- Lines 877–878: keep (invariant: `resolveWorkflowProviders` throws before reading `boundary.providers`, so the count must stay zero).
- Lines 1075–1077 (the "§9 reuses …" navigation note): delete.

### 7. `step_definitions/feature-819.steps.ts`
- Lines 1–18 (header JSDoc): delete the title, the summary paragraph and the file-reuse narration. Keep the two rationale sentences: §1–§5 drive a real `GitContext` over a recording `exec` that is pattern-matched, never call-order-matched, and never a fake adapter; and because these scenarios carry `@adw-819`, not `@adw-816`, feature-816's tag-scoped hooks never run, so this file forces fixture-tree isolation from its own hooks.
- Every banner block (`// ----` + title + `// ----`) at 41–43, 129–131, 155–157, 252–254, 287–289, 335–337, 387–389 and 486–488: delete all three lines of each.
- Line 79 (JSDoc on `ghFailure`): keep. It explains why the message goes on `.stderr` (it mimics real gh child-process failures; see `stderrOf`).
- Lines 240–242: keep (reason the extra gh-issue-view rule is scripted).
- Lines 506–511: delete both banner lines and strip `(#823)`. Keep the reason: feature-823.steps.ts reuses this seam and needs its own accessors, because this file's Before/After are tag-scoped to `@adw-819`.
- Lines 513, 518 and 523 (JSDoc on `getRecordingSeam`, `getMintedProviders`, `resetRecordingSeam`): delete as name-restating. From 513 you may keep only "Throws if no seam has been set up yet this scenario", and from 523 only "mirrors this file's own `Before` body", if you judge them to be invariants.

### 8. `step_definitions/feature-821.steps.ts`
- Lines 1–32 (header JSDoc): delete the title, the summary and the §1–§11 index. Keep, with `#821` stripped:
  - `Before`/`After` are tag-scoped to `@adw-821` because feature-796's hooks are scoped to `@adw-796` and do not fire here;
  - `dispatchWebhookEvent` and `checkAndTrigger` are driven directly, and §5 calls classification/label persistence directly, because `classifyAndSpawnWorkflow`'s `spawnDetached` can't be exercised safely from a BDD step (no module mocking). Drop "exactly as feature-542.steps.ts's own docblock explains".
- Line 74 (`// ── §821-local world state … ──`), line 162 (`// ── Shared helpers ──`) and the `// ── §N … ──` banners at 200, 261, 295, 347, 356, 404, 455, 520, 548 and 573: delete.
- Line 131 (JSDoc on `WEBHOOK_FIXTURE_REPO`): keep the reason (its cron PID file is written first so `ensureCronProcess` sees a live cron and never spawns one). Drop "The one repository §1/§11 name —".
- Line 164 (JSDoc on `captureConsoleLogs`): keep only "(the ADW logger's only sink)" as the reason, or delete. Implementer's judgement.
- Lines 218–219: keep (reason the cancel directive is used).
- Lines 264–265: keep. This is the only content of a no-op step body and gives the reason it's a marker.
- Lines 318–327 (`// TODO:` block): keep. It records a known, deliberate divergence between the scenario's expected values and `mapArtifactsToStage`'s real output. This is the reason the step asserts real output. Keep it verbatim; the source-file line references in it are part of that rationale.
- Lines 338–340: keep the reason (branchExistsOnRemote is pinned true because the fixture has no real remote). Drop "— same technique feature-820/797's own reconcile scenarios use."
- Line 602 trailing comment: keep. `#UPG` is a fixture label, not an issue tag.
- Lines 616–619 (the "§11 reuses …" navigation note): delete.

### 9. `step_definitions/feature-823-workspace.steps.ts`
- Lines 1–5 (header JSDoc): delete. It restates the file's role and points to its sibling entry file, which the imports already show.

### 10. `step_definitions/feature-844.steps.ts`
- Lines 1–30 (header JSDoc): delete the title, the summary and the §1–§7 index. Keep, with no issue numbers:
  - `Before`/`After` are tag-scoped to `@adw-844` because feature-796's hooks are scoped to `@adw-796`; this file resets the shared world and the guard fixture tree from its own hooks;
  - §7's guard/type-check phrases have no other surviving registration, so this file is the one that supplies them (drop "which six other per-issue files still attribute them to" and "verified clean against `--tags @adw-844 --dry-run` first").
- Every banner block at 57–59, 119–122, 151–153, 182–184, 285–287, 414–416, 550–552, 588–590 and 691–693: delete. For 119–122, keep "Never a real network call" as a one-line invariant above the fetch stub if it still reads cleanly; otherwise delete it too.
- Lines 265–267: keep (reason for translating through the catalogue).
- Lines 481–499: delete both banner lines and the `§4 —` title. Strip `(#795)` and `(#769)`. Keep the jurisdiction rationale: the two rules inspect the same argument position; the construction rule defers on `isIdentityReadComposite` so the explicit-root half can be written; every other construction is still flagged by callee name. The "reuse feature-816.steps.ts's Given/When/Then verbatim" sentence is navigation: drop it.
- Lines 695–696 (the "reused from feature-810.steps.ts" navigation note): delete.

### 11. `step_definitions/gitContextSharedWorld.ts`
- Lines 1–5 (header JSDoc): keep only the reason the module exists: feature-659 and feature-662 share one `W` and `makeSpyExec`, so no step definition is duplicated. Drop "Shared world state for GitContext BDD step definitions."
- Line 32 (JSDoc on `responseMap`): keep. The invariant is that the spy reads it by reference at call time.
- Lines 55–59 (JSDoc on `makeSpyExec`): drop "Spy factory.". Keep the invariant (responseMap is read at call time, so Givens that run after spy creation still configure responses) and the fallback to `defaultStdout`.
- Line 107 (JSDoc on `makeNoOpFsDeps`): trim to the reason ("all paths are imaginary") or delete. Implementer's judgement.

### 12. Final audit of all 13 files
- `grep -nE '#[0-9]{3}' <each .ts file>` returns no comment line that still carries an issue tag. String literals like `` `Failed to fetch issue #${issueNumber}…` `` and step text are code and must stay.
- `grep -nE '^\s*//\s*(-{5,}|─{3,})|── ' <each .ts file>` returns no banner line.
- `grep -cE '^[[:space:]]*#' features/per-issue/feature-8{18,20,21}.feature` returns `0` for each.
- Re-read every surviving comment. Each must state an invariant, an ordering constraint, or the reason for a non-obvious choice. Delete any that don't.
- `git status` must list only the 13 Touched Files as modified by this chore. The pre-existing uncommitted edits to `README.md` and `.claude/commands/scenario_writer.md` in this worktree are not part of this chore. Don't stage or commit them.

### 13. Run the Validation Commands
- Run every command in `Validation Commands` below. All must exit 0.

## Validation Commands
Execute every command to validate the chore is complete with zero regressions.

- `bun run lint:comment-only features/per-issue/feature-818.feature features/per-issue/feature-820.feature features/per-issue/feature-821.feature features/per-issue/step_definitions/cron-launch-context-ctx.ts features/per-issue/step_definitions/feature-533-then.steps.ts features/per-issue/step_definitions/feature-533.steps.ts features/per-issue/step_definitions/feature-794.steps.ts features/per-issue/step_definitions/feature-796.steps.ts features/per-issue/step_definitions/feature-819.steps.ts features/per-issue/step_definitions/feature-821.steps.ts features/per-issue/step_definitions/feature-823-workspace.steps.ts features/per-issue/step_definitions/feature-844.steps.ts features/per-issue/step_definitions/gitContextSharedWorld.ts`: the guard must print `✔ PASS` for all 13 files against the default branch it resolves itself. If default-branch resolution isn't possible locally (no forge credentials), fall back to the same command prefixed with `--base origin/dev` after `git fetch origin dev`.
- `bun run lint`: ESLint must pass. This catches the `no-empty` hazard from deleting the only comment in a `catch {}`.
- `bun run test`: typecheck (`bunx tsc --noEmit`) must pass.
- `bunx tsc --noEmit -p adws/tsconfig.json`: the additional typecheck must pass.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --dry-run --tags "@adw-819 or @adw-821 or @adw-823 or @adw-844 or @adw-848"`: confirms that every step-definition module still loads and phrase registration is unchanged (no undefined or ambiguous steps introduced). The feature files for 533/794/796 have already been retired by the per-issue sweep, so their step modules are exercised through these consumers.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-873"`: runs this issue's per-issue scenario (the comment-only guard passes for the listed files against the default branch), once the scenario phase has authored it.

## Notes
- Strictly follow `.adw/coding_guidelines.md` → **Comments**: comment only what the code cannot say; no restating the next line, no banners, no issue numbers, no JSDoc on self-describing names.
- **Scope is exactly the 13 Touched Files.** The `@adw-873` per-issue scenario (`features/per-issue/feature-873.feature` and its step definition) is authored by the pipeline's scenario phase, not by this build. Its single behaviour is that the comment-only guard passes for the 13 listed files against the default branch. The default branch is resolved by the guard (`runCommentOnlyCheck` with `baseRef: null`) and never named in the scenario.
- **Feature descriptions are not comments.** The long free-text paragraphs under each `Feature:` line in 818/820/821 (including the `── … ──` headings inside them) are Gherkin description. The guard treats them as content, so this batch must leave them byte-for-byte unchanged apart from whitespace. Only `#` lines are in scope.
- **`no-empty` lint trap.** `eslint.configs.recommended` enables `no-empty`. The comments inside the two `catch {}` blocks at `feature-794.steps.ts:420–427` must survive. The no-op Given body at `feature-821.steps.ts:263–266` is a function, not a block statement, so `no-empty` doesn't apply there, but its comment is kept anyway as rationale.
- The guard ignores blank lines and whitespace in both kinds, so collapsing leftover blank lines is safe. Reflowing a kept comment is also safe, but the PRD says not to rewrite kept prose, so only delete sentences and tags.
- Trimming judgement in mixed comments is deliberately unsupervised (PRD *Merge policy*). Where this plan says "implementer's judgement", either outcome is acceptable as long as the surviving text meets the guideline.
- Stray gitignored hook-log directories (`features/per-issue/logs/`, `features/per-issue/step_definitions/logs/`) may exist in this worktree from planning-time tool runs. They're ignored by `**/logs/` in `.gitignore` and must not be committed.

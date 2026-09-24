# Chore: Comment sweep 6/16 — features/per-issue (3/3)

## Metadata
issueNumber: `874`
adwId: `9zbe07-chore-comment-sweep`
issueJson: `{"number":874,"title":"chore: comment sweep 6/16 — features/per-issue (3/3)","body":"## Parent PRD\n\n`specs/prd/comment-debloat.md`\n\n## What to build\n\nSweep batch 6 of 16: **features/per-issue (3/3)** (13 files, 860 comment lines at filing time).\n\nApply the deletion rules from the PRD's *Implementation Decisions › Deletion rules per comment kind* to exactly the files listed under Touched Files. Do not touch any file outside that list. Do not change any code: the only permitted diff is in comments (and the blank lines left behind).\n\nRules for this batch:\n\n- Delete section banner comments (lines of dashes or box-drawing characters).\n- Delete JSDoc blocks that only restate the name of the field or function they sit on.\n- Delete inline comments that narrate the statement directly below them.\n- Strip issue-number tags such as `(#794)` or `(issue #762)` from comments; keep the rest of the comment only if it still carries rationale.\n- Trim mixed comments to the sentences that state an invariant, an ordering constraint, or the reason for a non-obvious choice. Drop the narration sentences.\n- Keep shebang lines and `eslint-disable` directives unchanged.\n- Feature files: delete every `#` comment line, except at most one short line directly under `Feature:` when the domain term is not self-evident.\n\nVerify with the comment-only guard shipped by the blocking issue:\n\n```\nbun run lint:comment-only <every file in Touched Files>\n```\n\n## Acceptance criteria\n\n- [ ] The comment-only guard passes for every file in Touched Files against the default branch (resolved by the guard, never named in the scenario).\n- [ ] No banner comments, name-restating JSDoc, next-line narration, or issue-number tags remain in the listed files.\n- [ ] Every surviving comment states an invariant, an ordering constraint, or the reason for a non-obvious choice.\n- [ ] Every listed `.feature` file has no `#` comment lines beyond at most one short line under `Feature:`.\n- [ ] `bun run test` (typecheck) passes.\n- [ ] The per-issue scenario for this issue asserts exactly one behaviour: the comment-only guard passes for the listed files against the default branch.\n\n## Blocked by\n\n- Blocked by #853\n\n## Touched Files\n\n- features/per-issue/feature-797.feature\n- features/per-issue/feature-810.feature\n- features/per-issue/feature-812.feature\n- features/per-issue/feature-817.feature\n- features/per-issue/feature-844.feature\n- features/per-issue/feature-846.feature\n- features/per-issue/feature-848.feature\n- features/per-issue/step_definitions/feature-812.steps.ts\n- features/per-issue/step_definitions/feature-816.steps.ts\n- features/per-issue/step_definitions/feature-820.steps.ts\n- features/per-issue/step_definitions/feature-823-assembly.steps.ts\n- features/per-issue/step_definitions/feature-823-copyout.steps.ts\n- features/per-issue/step_definitions/feature-848.steps.ts\n\n## User stories addressed\n\n- User stories 12–26\n","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-09-24T08:18:02Z","comments":[],"actionableComment":null}`

## Chore Description
This is batch 6 of the 16-batch comment de-bloat sweep defined in `specs/prd/comment-debloat.md`, and the last of the three `features/per-issue/` batches. It strips agent-authored comment noise from 13 files: 7 feature files and 6 step-definition modules. It applies the PRD's *Deletion rules per comment kind*:

- **Banners** (`// -----`, `// ── … ──`, `# ── … ──`, `# ══════ … ══`): delete.
- **JSDoc that restates the name** of the field or function it sits on: delete.
- **Narration** of the statement directly below: delete.
- **Issue-number tags** (`(#816)`, `(issue #812)`, `#848:`, `#796`, `(#812 note: …)`): strip them, and keep the rest of the comment only if it still carries rationale.
- **Mixed comments**: keep only the sentences that state an invariant, an ordering constraint, or the reason for a non-obvious choice.
- **Shebangs, `eslint-disable` and `@ts-*` directives**: keep unchanged. A grep confirmed none of the 13 files has any.
- **Feature files**: delete every `#` comment line, except at most one short line directly under `Feature:`.

The change touches comments only. The `adws/checkCommentOnly.ts` guard (`bun run lint:comment-only`) enforces this:
- For `.ts` files it compares the parser's non-trivia token stream, so any change to a code token fails.
- For `.feature` files it compares the trimmed lines that are neither blank nor `#` lines, outside doc strings. It keeps doc-string content verbatim. So any change to a tag, keyword, step, table row, doc string or free-text description fails.

Comment lines measured now (total 860, the same as at filing time):

| File | Total lines | Comment lines |
|---|---|---|
| feature-797.feature | 422 | 74 (`#`) |
| feature-810.feature | 584 | 131 (`#`) |
| feature-812.feature | 268 | 66 (`#`) |
| feature-817.feature | 621 | 120 (`#`) |
| feature-844.feature | 689 | 148 (`#`) |
| feature-846.feature | 82 | 0 |
| feature-848.feature | 133 | 17 (`#`) |
| feature-812.steps.ts | 552 | 91 |
| feature-816.steps.ts | 175 | 53 |
| feature-820.steps.ts | 960 | 104 |
| feature-823-assembly.steps.ts | 85 | 11 |
| feature-823-copyout.steps.ts | 75 | 6 |
| feature-848.steps.ts | 133 | 39 |

## Relevant Files
Use these files to resolve the chore:

- `README.md`: project overview. Its bullet on the "Comment-discipline guideline and guard" describes the tool that verifies this chore.
- `.adw/coding_guidelines.md`: the **Comments** entry is the standard every surviving comment must meet. Comment only invariants, ordering constraints, or reasons for non-obvious choices. Never restate the next line, add banners, cite issue numbers, or JSDoc a self-describing name.
- `specs/prd/comment-debloat.md`: the parent PRD. Its *Implementation Decisions › Deletion rules per comment kind* section is this chore's rule set.
- `app_docs/feature-m363ky-comment-only-guard.md`: guard documentation (listed in `.adw/conditional_docs.md` for comment-only guard work).
- `adws/checkCommentOnly.ts`: the comment-only guard (`bun run lint:comment-only [--base <ref>] <files...>`). It defines exactly what counts as code in `.ts` and `.feature` files. Without `--base` it resolves the default branch itself and fetches `origin/<default>`.
- `eslint.config.js`: extends `eslint.configs.recommended`, which turns on `no-empty` without `allowEmptyCatch`. A `catch {}` whose only content is a comment becomes a lint error if that comment is deleted. This constrains seven comments (see the steps below).
- `package.json`: provides the scripts `lint:comment-only`, `lint` (`eslint .`) and `test` (`bunx tsc --noEmit`).
- `specs/issue-873-adw-srw01j-chore-comment-sweep-sdlc_planner-comment-sweep-per-issue-batch-2.md`: the plan for the previous per-issue batch. Follow its conventions for consistency.
- The 13 Touched Files are the only files this chore may modify:
  - `features/per-issue/feature-797.feature`
  - `features/per-issue/feature-810.feature`
  - `features/per-issue/feature-812.feature`
  - `features/per-issue/feature-817.feature`
  - `features/per-issue/feature-844.feature`
  - `features/per-issue/feature-846.feature`
  - `features/per-issue/feature-848.feature`
  - `features/per-issue/step_definitions/feature-812.steps.ts`
  - `features/per-issue/step_definitions/feature-816.steps.ts`
  - `features/per-issue/step_definitions/feature-820.steps.ts`
  - `features/per-issue/step_definitions/feature-823-assembly.steps.ts`
  - `features/per-issue/step_definitions/feature-823-copyout.steps.ts`
  - `features/per-issue/step_definitions/feature-848.steps.ts`

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

General rules for every step:
- Change only comment text and the blank lines its deletion leaves behind. Never edit a code token, string literal, template literal, regex, Gherkin keyword, tag, step text, table row, doc string or free-text feature description.
- Where a deletion leaves two or more blank lines in a row, collapse them to one. The guard ignores blank lines.
- Line numbers below are for the files as they stand on the branch now. Either work each file from the bottom up, or match on the comment text.
- When trimming, keep the wording of the sentences that survive; the PRD forbids rewriting kept prose. Only drop whole sentences, clauses and tags, and fix the punctuation left behind.
- Drop cross-references to step files that no longer exist, because they are stale navigation, not rationale. These are `feature-776.steps.ts`, `feature-504.steps.ts`, `feature-691.steps.ts`, `feature-762.steps.ts` and `feature-770.steps.ts`.

### 1. Feature files: delete every `#` comment line
This applies to `feature-797.feature` (74 lines), `feature-810.feature` (131), `feature-812.feature` (66), `feature-817.feature` (120), `feature-844.feature` (148) and `feature-848.feature` (17).
- Delete every line matching `^[[:space:]]*#`. That covers the `# ── §N … ──` and `# ══════ §N … ══` banners, the bare `#` spacer lines, and every multi-line `#` essay above a section or scenario. A check confirmed that none of these files has a `#` line inside a `"""` or ```` ``` ```` doc string.
- **Two `#`-leading lines sit inside a free-text feature description:**
  - `feature-797.feature:123` (`      #795 landed; \`checkGitGhGuard.ts\` today runs …`)
  - `feature-844.feature:171` (`      #812, #816 and #821 and are attributed in those files' header comments to`)

  The Gherkin parser and the guard (`trimmed.startsWith('#')` outside a doc string) both classify these lines as comments. They are already absent from the parsed description, so deleting them changes nothing the guard or Cucumber sees, and it satisfies the acceptance criterion "no `#` comment lines". Delete them. Do NOT splice their text onto the neighbouring description line: that edits a content line and fails the guard.
- Do NOT add a line under `Feature:`. None of these files has a `#` line there today. The indented paragraph after each `Feature:` title is Gherkin free-text description, which the guard treats as content.
- Leave every other line of each free-text description under `Feature:` unchanged, including the `• …` bullets and the "Issue #NNN is …" paragraphs. They are description, not `#` comments, and they are out of scope for this batch.
- Collapse the runs of blank lines left between sections and scenarios to one blank line.
- `feature-846.feature` has no `#` lines. Leave it untouched; it is listed only so the guard covers it.
- Check: `grep -cE '^[[:space:]]*#' features/per-issue/feature-{797,810,812,817,844,846,848}.feature` prints `0` for every file.

### 2. `step_definitions/feature-812.steps.ts`
- Lines 1–20 (header JSDoc):
  - Delete lines 2–4 (title and summary with `(issue #812)`).
  - Delete lines 17–19 ("Steps NOT defined here" lookup table, which points at a deleted `feature-504.steps.ts`).
  - Keep the §1–§3 rationale (lines 6–12): the real `runJanitorPass` / `discoverTargetRepoWorktrees` run over a throwaway `targetReposDir` with only the network- and OS-touching `DEFAULT_DEPS` members stubbed, and `readdirTargetRepos`, `isGitRepo` and `hasAdwMarker` stay real so the marker-gate predicate under test is genuine.
  - Lines 14–15: keep "§4 spawns the REAL entrypoint … as a subprocess". Drop ", mirroring features/per-issue/step_definitions/feature-776.steps.ts".
- Line 37 (`// features/per-issue/step_definitions → repo root`): narrates the path constant below. Delete.
- Lines 40–41: keep (reason for `setDefaultTimeout(60_000)`).
- Delete these banner blocks entirely: 47–49, 103–105, 164–166, 211–213, 226–228, 289–292, 346–348, 432–434, 489–491 and 509–511.
- Lines 330–332: keep the reason for the negative-PID group kill. Drop "(mirrors feature-776)".
- **Leave the `catch { /* … */ }` comments at lines 99, 333, 336, 339, 342 and 403 unchanged** (`best effort`, `already dead`, `never created`, `fresh`). Deleting them makes the catch block empty and breaks ESLint `no-empty`. They also state why the error is swallowed.
- Line 350 (`/** Mirrors cronProcessGuard.ts's own path derivation … */`): keep. It states an invariant: the path must match `cronProcessGuard.ts`.
- Line 365 (`/** Real liveness proof: signal 0 to the PID recorded by the process itself (not the bunx wrapper). */`): keep. It explains the non-obvious choice of PID.
- Lines 390–400 (JSDoc on `spawnCron`):
  - Drop the narration "Spawns the real cron entrypoint".
  - Keep the reasons: pinned via `--target-repo` to a private repo key so it never contends with a real cron's PID file; a syntactically complete PAT satisfies GitContext's construction-time validate-and-discard probe without a real GitHub call; the GitHub App is deliberately left unconfigured; `CLAUDE_CODE_PATH` points at the stub so the probes resolve in milliseconds.
  - Drop "mirror feature-776's "working" mode" and the stale line reference "(gitContext.ts:141-156)".
- Lines 416–417: keep (reason for `detached: true`).
- Lines 437–441: keep the rationale (why a non-array `extraArgs` is the lever: it throws before any fs/network call, is never swallowed, and reaches `runGuardedTick` every cycle). Strip `#812 note:` from the parenthetical, keeping "this lever is NOT one the janitor's own isolation could swallow".
- Lines 481–486 (the only content of a no-op Given body): keep the reason it is a no-op. The spawned cron gets no App credentials, and the marker gate means App-token resolution is never attempted for an unmarked repo. The body is a function, not a block statement, so `no-empty` does not apply; the comment stays anyway as rationale.
- Lines 502–505: keep (why the `POLL:` line proves the janitor pass ran).
- Line 521: keep (reason for the 300 ms settle).
- Lines 532–534: keep (the crash shape being asserted).

### 3. `step_definitions/feature-816.steps.ts`
- Lines 1–30 (header JSDoc):
  - Delete lines 2–5 (title and summary with `(#816)`).
  - Delete lines 14–17 (§7–§8 reuse note naming `feature-769.steps.ts` / the deleted `feature-504.steps.ts`).
  - Keep lines 7–12: the real CLI is spawned so that a rule not wired into collection fails, and driving `scanFiles`/`scanExtractionScope` in-process would pass vacuously. Drop the cross-reference "— see the feature file's "load-bearing trap" note", because that `#` note no longer exists after the earlier batch.
  - Keep lines 19–29 (PASS is asserted on stdout, not exit code, because of the stale-transitional-entry ratchet). Strip `#796` ("the pre-existing stale-transitional-entry ratchet"). Drop "(see the plan's ADW-WARNING)".
- Banner blocks 61–63, 74–76 and 102–104: delete.
- Lines 87–90: keep (why `NODE_OPTIONS` is cleared for the child).
- Lines 152–159: delete both banner lines and strip `(#817)`. Keep the reason: `feature-817.steps.ts` reuses the Given/When/Then above but is not tagged `@adw-816`, so these hooks never run for its scenarios, and the two exports let it force isolation itself without touching step text.
- Line 161 (JSDoc on `resetGuardFixtureTree`): trim to "Safe to call with no prior fixture tree." (an invariant), or delete. Implementer's judgement.
- Line 172 (JSDoc on `getGuardStdout`): keep. "(+ stderr on failure)" says something the name does not.

### 4. `step_definitions/feature-820.steps.ts`
- Lines 1–39 (header JSDoc):
  - Delete lines 2–5 (title and summary with `(#820)`) and the §1–§11 index at lines 7–17.
  - Lines 19–23: drop "Reuses feature-796's recording-boundary harness (`world796()`) throughout — every phrase feature-796/794/691/504/797 already registers is reused, never redefined." Keep the reason that `Before`/`After` are tag-scoped to `@adw-820` (feature-796's hooks are scoped to `@adw-796` and do not fire here), so this file resets the shared world and cleans up its own agent-state dirs.
  - Lines 25–29: keep the reason (routing through `test/mocks/claude-cli-stub.ts` makes the agent calls real subprocess spawns of a fast, canned stub). Drop "exactly as feature-762.steps.ts does".
  - Lines 31–38: keep all of it. It is an ordering invariant: the R2 env vars must be non-empty before the process starts because `environment.ts` freezes them at first import.
- Lines 83–89 (JSDoc on `FROZEN_CLAIM_BRANCH`): keep. It explains why the hash is frozen and the scoping rule.
- Line 93 (`// ── §820-local world state … ──`): delete.
- Lines 170–176 (JSDoc on `setReconciledStage`): keep the reason (cross-file setters let feature-821's When steps drive this file's Then phrases without redefining them). Drop "(feature-796's `noteBranchHasNoPullRequest` precedent)".
- Line 187: strip `#848: `. Keep "lets a sibling step file reset this file's local state and stub from its own hooks."
- Line 193: strip `#848: `. Keep "the configuration the last "a workflow configuration bound to that boundary …" step built.", since it names which step populates it.
- Lines 205–212 (JSDoc on `writeReviewPassManifest`): keep. It gives the reason for the cwd-relative manifest fallback.
- Lines 257–263:
  - Delete the banner line 257.
  - Keep lines 258–263 (bound to the recording providers so every phase reads the same identity `resolveWorkflowRepoId` would resolve; registered as `w.autoMergeConfig` so feature-796's reused assertion is meaningful).
  - Drop the lead-in "Minimal-but-real WorkflowConfig," if the rest still reads.
- Delete the section banners at 332, 395, 503, 555, 627, 671, 742 and 898.
- Line 534 (only content of a no-op Given body): keep. It says why it is a marker.
- Lines 586–590:
  - Drop the navigation clause "'a state file for adw id {string} recording branch {string}' is already registered by feature-797.steps.ts — reused, not redefined here".
  - Keep the cleanup invariant: that registration's adwId is swept by the After hook through the fixed `FIXED_ADW_ID` entry, because it writes into feature-797's own world, not `world796()`.
  - If the surviving clause no longer reads as a sentence, delete the whole block. Implementer's judgement.
- Lines 713–717:
  - Delete the banner line 713.
  - Keep lines 714–716 (the label write is re-composed here because `executeUnitTestPhase` runs the real /test agent with retries and cannot be driven hermetically).
  - Drop "— the same reasoning feature-770's step definitions document for the sibling verdict-to-comment mapping."
- **Line 732 (the only content of a `catch {}`): leave it unchanged.** `no-empty` hazard.
- Lines 825–830: delete the banner line 825 and the bare `//` line 826. Keep lines 827–830 (why the ports come through `forgeProviders()` over a GitContext whose exec is never invoked).
- Lines 840–841: keep (why the token must be non-empty).
- Lines 956–960 (the "§11 reuses …" navigation note naming deleted files): delete.

### 5. `step_definitions/feature-823-assembly.steps.ts`
- Lines 1–5 (header JSDoc): delete. It only restates the file's role and names its sibling entry file, which the imports already show.
- Banner blocks 16–18 and 70–72: delete.

### 6. `step_definitions/feature-823-copyout.steps.ts`
- Lines 1–5 (header JSDoc): delete. It restates the file's role and names its sibling entry file.
- Line 20 (JSDoc on `copyDirEntry`): keep. It explains the non-obvious duplication: `feature-797.steps.ts`'s `copyDirExcluding` is not exported, so this is a local copy.

### 7. `step_definitions/feature-848.steps.ts`
- Lines 1–33 (header JSDoc):
  - Delete lines 2–27: the title, the reused-phrase lookup table, and the paragraph that depends on "any phrase above" and counts the new phrases.
  - Keep lines 29–32: the `@adw-796` and `@adw-820` Before/After hooks are tag-scoped and do not fire for `@adw-848`, so this file owns its own reset/cleanup over the shared `world796()` state and feature-820's local state (through `resetFeature820State` and `currentWorkflowConfig`).
- Banners at 44, 56, 81, 91 and 115: delete.
- Line 49 (JSDoc on `stopLogCapture`): trim to "Idempotent." (an invariant the callers in `Before`/`After`/Then rely on), or keep as is. Implementer's judgement.

### 8. Final audit of all 13 files
- `grep -nE '#[0-9]{3}' features/per-issue/step_definitions/feature-{812,816,820,823-assembly,823-copyout,848}.steps.ts` must return no comment line that still carries an issue tag. Hits in string literals and step text are code and must stay. Examples: `` `issue #${issueNumber}` `` and `'PR #'` in `feature-848.steps.ts`.
- `grep -nE '^\s*//\s*(-{5,}|─{3,}|══)|── ' features/per-issue/step_definitions/feature-{812,816,820,823-assembly,823-copyout,848}.steps.ts` must return no banner line.
- `grep -cE '^[[:space:]]*#' features/per-issue/feature-{797,810,812,817,844,846,848}.feature` must return `0` for each file.
- Re-read every surviving comment. Each must state an invariant, an ordering constraint, or the reason for a non-obvious choice. Delete any that don't, unless it is the sole content of a `catch {}` block.
- `git status` must list only the 13 Touched Files as modified, plus this plan file. Do not stage or commit stray gitignored `logs/` directories.

### 9. Run the Validation Commands
- Run every command in `Validation Commands` below. All must exit 0.

## Validation Commands
Execute every command to validate the chore is complete with zero regressions.

- `bun run lint:comment-only features/per-issue/feature-797.feature features/per-issue/feature-810.feature features/per-issue/feature-812.feature features/per-issue/feature-817.feature features/per-issue/feature-844.feature features/per-issue/feature-846.feature features/per-issue/feature-848.feature features/per-issue/step_definitions/feature-812.steps.ts features/per-issue/step_definitions/feature-816.steps.ts features/per-issue/step_definitions/feature-820.steps.ts features/per-issue/step_definitions/feature-823-assembly.steps.ts features/per-issue/step_definitions/feature-823-copyout.steps.ts features/per-issue/step_definitions/feature-848.steps.ts`: the guard must report PASS for all 13 files against the default branch it resolves itself. If it cannot resolve the default branch locally (no forge credentials), run `git fetch origin dev`, then run the same command with `--base origin/dev` placed before the file list.
- `bun run lint`: ESLint must pass. This catches the `no-empty` hazard of deleting the only comment in a `catch {}`.
- `bun run test`: the typecheck (`bunx tsc --noEmit`) must pass.
- `bunx tsc --noEmit -p adws/tsconfig.json`: the additional typecheck must pass.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --dry-run --tags "@adw-797 or @adw-810 or @adw-812 or @adw-816 or @adw-817 or @adw-820 or @adw-823 or @adw-844 or @adw-846 or @adw-848"`: confirms that every edited feature file still parses and every step module still loads, with no undefined or ambiguous steps introduced.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-874"`: runs this issue's per-issue scenario once the scenario phase has written it. The scenario checks that the comment-only guard passes for the listed files against the default branch.

## Notes
- Strictly follow `.adw/coding_guidelines.md` → **Comments**. Comment only what the code cannot say. Never restate the next line, add banners, cite issue numbers, or JSDoc a self-describing name.
- **Scope is exactly the 13 Touched Files.** The pipeline's scenario phase writes the `@adw-874` per-issue scenario (`features/per-issue/feature-874.feature` and its step definition); this build does not. That scenario tests one behaviour: the comment-only guard passes for the 13 listed files against the default branch. The guard resolves the default branch itself (`baseRef: null`), so the scenario never names it.
- **Feature descriptions are not comments.** The long free-text paragraphs under each `Feature:` line are Gherkin description, including their `• …` bullets and "Issue #NNN" prose. The guard treats them as content, so they must stay byte-for-byte unchanged apart from whitespace. The only exceptions are the two `#`-leading lines at `feature-797.feature:123` and `feature-844.feature:171`. Gherkin already parses those as comments, so they are deleted like every other `#` line.
- **`no-empty` lint trap.** `eslint.configs.recommended` enables `no-empty`, and `allowEmptyCatch` is off. Seven comments must survive:
  - the six `catch { /* … */ }` comments in `feature-812.steps.ts` (lines 99, 333, 336, 339, 342 and 403);
  - the comment inside the `catch {}` at `feature-820.steps.ts:731–733`.

  The no-op Given bodies at `feature-812.steps.ts:480–487` and `feature-820.steps.ts:533–535` are functions, not block statements, but their comments are kept anyway as rationale.
- The guard ignores blank lines and whitespace for both file kinds, so collapsing leftover blank lines is safe. Do not reflow kept comments: the PRD says not to rewrite kept prose, so only delete sentences, clauses and tags.
- Trimming judgement in mixed comments is deliberately unsupervised (PRD *Merge policy*). Where this plan says "implementer's judgement", either outcome is fine as long as the surviving text meets the guideline.
- `feature-846.feature` has no comment lines today. It needs no edit, and it passes the guard trivially.

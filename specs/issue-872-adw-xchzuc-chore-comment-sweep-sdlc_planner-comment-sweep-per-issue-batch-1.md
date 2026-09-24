# Chore: Comment sweep 4/16 — features/per-issue (1/3)

## Metadata
issueNumber: `872`
adwId: `xchzuc-chore-comment-sweep`
issueJson: `{"number":872,"title":"chore: comment sweep 4/16 — features/per-issue (1/3)","body":"## Parent PRD\n\n`specs/prd/comment-debloat.md`\n\n## What to build\n\nSweep batch 4 of 16: **features/per-issue (1/3)** (13 files, 864 comment lines at filing time).\n\nApply the deletion rules from the PRD's *Implementation Decisions › Deletion rules per comment kind* to exactly the files listed under Touched Files. Do not touch any file outside that list. Do not change any code: the only permitted diff is in comments (and the blank lines left behind).\n\nRules for this batch:\n\n- Delete section banner comments (lines of dashes or box-drawing characters).\n- Delete JSDoc blocks that only restate the name of the field or function they sit on.\n- Delete inline comments that narrate the statement directly below them.\n- Strip issue-number tags such as `(#794)` or `(issue #762)` from comments; keep the rest of the comment only if it still carries rationale.\n- Trim mixed comments to the sentences that state an invariant, an ordering constraint, or the reason for a non-obvious choice. Drop the narration sentences.\n- Keep shebang lines and `eslint-disable` directives unchanged.\n- Feature files: delete every `#` comment line, except at most one short line directly under `Feature:` when the domain term is not self-evident.\n\nVerify with the comment-only guard shipped by the blocking issue:\n\n```\nbun run lint:comment-only <every file in Touched Files>\n```\n\n## Acceptance criteria\n\n- [ ] The comment-only guard passes for every file in Touched Files against the default branch (resolved by the guard, never named in the scenario).\n- [ ] No banner comments, name-restating JSDoc, next-line narration, or issue-number tags remain in the listed files.\n- [ ] Every surviving comment states an invariant, an ordering constraint, or the reason for a non-obvious choice.\n- [ ] Every listed `.feature` file has no `#` comment lines beyond at most one short line under `Feature:`.\n- [ ] `bun run test` (typecheck) passes.\n- [ ] The per-issue scenario for this issue asserts exactly one behaviour: the comment-only guard passes for the listed files against the default branch.\n\n## Blocked by\n\n- Blocked by #853\n\n## Touched Files\n\n- features/per-issue/feature-816.feature\n- features/per-issue/feature-819.feature\n- features/per-issue/feature-823.feature\n- features/per-issue/step_definitions/feature-533-given.steps.ts\n- features/per-issue/step_definitions/feature-797.steps.ts\n- features/per-issue/step_definitions/feature-810.steps.ts\n- features/per-issue/step_definitions/feature-817.steps.ts\n- features/per-issue/step_definitions/feature-818.steps.ts\n- features/per-issue/step_definitions/feature-823-probes.steps.ts\n- features/per-issue/step_definitions/feature-823.steps.ts\n- features/per-issue/step_definitions/feature-846.steps.ts\n- features/per-issue/step_definitions/takeover-probe-ctx.ts\n- features/per-issue/support/feature-846-ensure-driver.ts\n\n## User stories addressed\n\n- User stories 12–26\n","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-09-24T08:17:59Z","comments":[],"actionableComment":null}`

## Chore Description
Batch 4 of the 16-batch comment de-bloat sweep defined in `specs/prd/comment-debloat.md`. The sweep removes low-value comments from exactly 13 files under `features/per-issue/` (3 `.feature` files and 10 TypeScript step-definition/support files) using the PRD's *Deletion rules per comment kind*. The same rule now lives in `.adw/coding_guidelines.md` › **Comments**.

The only permitted diff is comment removal or trimming, plus the blank lines those removals leave behind. No code, no Gherkin step text, no Feature/Scenario description prose, no tags, and no string or template literal content may change. The comment-only guard shipped by #853 (`adws/checkCommentOnly.ts`, run as `bun run lint:comment-only`) proves this. It compares each file's parser token stream (TS) or its trimmed non-`#`, non-blank lines (feature files) against the default branch.

Measured comment-ish lines at planning time (lines starting with `#`, `//`, `/*` or `*`):

| File | Lines | Comment lines | Dominant kinds |
|---|---|---|---|
| `feature-816.feature` | 493 | ~103 `#` | `# ── §N … ──` banners + multi-line `#` rationale blocks above scenarios |
| `feature-819.feature` | 866 | ~122 `#` | same, plus 2 description lines that start with `#817`/`#647` |
| `feature-823.feature` | 825 | ~213 `#` | same, plus 1 description line that starts with `#821`; 4 `## …` lines inside DocStrings |
| `step_definitions/feature-533-given.steps.ts` | 251 | 9 | 3 dash banner blocks |
| `step_definitions/feature-797.steps.ts` | 985 | 74 | long file-header JSDoc, `// ── §N ──` banners, a few inline comments |
| `step_definitions/feature-810.steps.ts` | 1266 | 93 | header JSDoc, `// ══════ …` / `// ── Given ──` banners, inline rationale |
| `step_definitions/feature-817.steps.ts` | 196 | 58 | header JSDoc with `(#817)`, dash banners, `Cross-file seam (#823)` block, 2 one-line JSDoc |
| `step_definitions/feature-818.steps.ts` | 611 | 81 | header JSDoc with `(#818)`, 24 banner lines, inline `(#819)` |
| `step_definitions/feature-823-probes.steps.ts` | 31 | 4 | file-header JSDoc that only names the file's role |
| `step_definitions/feature-823.steps.ts` | 122 | 34 | header JSDoc (file index + reuse rationale), dash banners |
| `step_definitions/feature-846.steps.ts` | 304 | 45 | header JSDoc, 18 banner lines (`// World`, `// Scenario 1 — …`), 2 one-line JSDoc |
| `step_definitions/takeover-probe-ctx.ts` | 31 | 7 | header JSDoc, 2 trailing field comments |
| `support/feature-846-ensure-driver.ts` | 26 | 16 | header JSDoc carrying real rationale + usage line |

## Relevant Files
Use these files to resolve the chore:

- `specs/prd/comment-debloat.md`: parent PRD. *Implementation Decisions › Deletion rules per comment kind* (line ~64) is the rulebook. *Out of Scope* forbids rewriting kept prose and changing what surviving JSDoc says.
- `.adw/coding_guidelines.md`: the **Comments** bullet under *Process & Tooling* is the standing rule every surviving comment must satisfy.
- `adws/checkCommentOnly.ts`: the comment-only guard. Read it to see what counts as "content" and would therefore fail the guard:
  - TS: every parser leaf token counts, including string and template literal text. JSDoc nodes and comment trivia do not.
  - Feature: every trimmed non-blank line counts unless its first non-whitespace character is `#` and it sits outside a `"""`/```` ``` ```` DocString.
- `app_docs/feature-m363ky-comment-only-guard.md`: guard docs (conditional-docs match: "When troubleshooting a comment de-bloat sweep batch's guard pass/fail"). Covers base-ref resolution (`origin/<default branch>` via the code host) and the violation reasons.
- `package.json`: `lint:comment-only` (`bunx tsx adws/checkCommentOnly.ts`), `test` (`bunx tsc --noEmit`), `lint` (`eslint .`).
- `features/per-issue/feature-816.feature`: touched. Delete `#` comment lines only.
- `features/per-issue/feature-819.feature`: touched. Delete `#` comment lines only.
- `features/per-issue/feature-823.feature`: touched. Delete `#` comment lines only, but keep DocString content.
- `features/per-issue/step_definitions/feature-533-given.steps.ts`: touched.
- `features/per-issue/step_definitions/feature-797.steps.ts`: touched.
- `features/per-issue/step_definitions/feature-810.steps.ts`: touched.
- `features/per-issue/step_definitions/feature-817.steps.ts`: touched.
- `features/per-issue/step_definitions/feature-818.steps.ts`: touched.
- `features/per-issue/step_definitions/feature-823-probes.steps.ts`: touched.
- `features/per-issue/step_definitions/feature-823.steps.ts`: touched.
- `features/per-issue/step_definitions/feature-846.steps.ts`: touched.
- `features/per-issue/step_definitions/takeover-probe-ctx.ts`: touched.
- `features/per-issue/support/feature-846-ensure-driver.ts`: touched.

Explicitly NOT touched, even though they contain matching comments: `feature-794.steps.ts`, `feature-816.steps.ts`, `feature-819.steps.ts` (they hold their own `Cross-file seam (#8xx)` blocks), every other per-issue file, and the pre-existing uncommitted edits to `.claude/commands/scenario_writer.md` and `README.md` in this worktree. Those two edits are not part of this chore. Do not stage or commit them.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### 1. Record the baseline and ground rules
- Run `bun run lint:comment-only <the 13 files>` before editing. It must pass trivially, which confirms the guard resolves the base ref in this environment. If default-branch resolution fails because provider config is unavailable, run `git fetch origin dev` and use `--base origin/dev` for local runs only.
- Edit by hand with the Edit tool, one comment block at a time. Do NOT use `sed`/regex stripping of `//…` or `#…`. The TS files contain `//` inside string/template literals (e.g. `` `http://127.0.0.1:${serverPort}` `` in `feature-818.steps.ts:198`, `https://github.com/...` in `feature-797.steps.ts:310`, `https://example.test/...` in `feature-810.steps.ts:686`). `feature-823.feature` has `## Code Host` / `## Issue Tracker` lines inside DocStrings at ~254, 272, 301, 318. Blind stripping would corrupt both.
- When a deletion leaves two or more consecutive blank lines, collapse them to one. Leave no blank line directly after an opening `{` or before a closing `}`. Blank lines are trivia to the guard.
- Keep shebangs and `eslint-disable` directives. None exist in these 13 files at planning time. Re-check with `grep -n 'eslint-disable\|^#!'` before finishing.
- Keep surviving comment text verbatim apart from the stripped issue tags and dropped sentences. The PRD's *Out of Scope* forbids rewording kept prose.

### 2. Sweep the three feature files
For each of `feature-816.feature`, `feature-819.feature`, `feature-823.feature`:
- Delete every line whose first non-whitespace character is `#` and that sits outside a DocString. This covers the `# ── §N … ──` section banners, the `#` spacer lines, and the multi-line `#` rationale blocks above scenarios.
- Also delete the Feature-description lines that happen to start with `#` and are therefore already Gherkin comments. Leave the rest of their sentence untouched:
  - `feature-819.feature:7` (`#817/#818 widened. After it, …`)
  - `feature-819.feature:103` (`#647 fixed so the orchestrator …`)
  - `feature-823.feature:28` (`#821 covered their own structural criteria: …`)
  - Do NOT re-flow or edit the neighbouring description lines to repair the sentence. They are guard content, so any edit fails the guard with `code-changed`.
- Do NOT touch any of the following. All of it is content to the guard:
  - the free-text Feature description prose under `Feature:`, including its `Issue #816 is …` sentences and the non-`#` `── WHY AC2 … ──` headings inside the description
  - tags, `Scenario`/`Scenario Outline`/`Background`/`Rule` lines, and step lines
  - `Examples` tables
  - anything between `"""`/```` ``` ```` delimiters, in particular the `## Code Host` / `## Issue Tracker` lines in `feature-823.feature`
- Do not add a line under `Feature:`. Each file already carries a long description, so no domain term needs a one-line gloss. The single-line allowance goes unused.
- After each file, run `grep -nE '^\s*#' <file>`. The only hits allowed are lines inside DocStrings, which means only the four `##` lines in `feature-823.feature`.

### 3. Sweep the small TS files
- `step_definitions/feature-533-given.steps.ts`: delete the three dash-banner blocks at lines 10–12, 150–152, and 200–202, each with its label line (`// Given — …`).
- `step_definitions/feature-823-probes.steps.ts`: delete the header JSDoc (lines 1–4). It only names the file's role and its sibling entry file, which the filename already says.
- `step_definitions/takeover-probe-ctx.ts`:
  - Header JSDoc: keep only the invariant sentence ("Reset to null in each takeover Given step so scenarios are independent."). Drop "Shared probe context for takeover BDD step definitions." (restates the name) and the two lines narrating which files read/write it.
  - Keep `// null = default healthy (gate passes)` on `probe`. It states a non-obvious meaning of `null`.
  - Delete `// incremented by the When step when resetWorktree is called` on `resetCalls`. It restates the field name.
- `support/feature-846-ensure-driver.ts`:
  - Keep the rationale. `TARGET_REPOS_DIR` is bound at import time, so the driver runs as a child process with `HOME`/`TARGET_REPOS_DIR` overridden. It lives outside every `cucumber.js` import glob, so it is never auto-loaded.
  - Keep the usage/stdout contract lines: `Usage: …`, and the fact that the last stdout line is the JSON while earlier lines may be log output.
  - Drop only the opening "Child-process driver for feature-846.feature." line, which restates the filename.
- `step_definitions/feature-823.steps.ts`:
  - Header JSDoc: delete the file index (lines 2–9, "entry file … sibling files … list"), which narrates layout. Also delete the restated feature title (lines 11–13).
  - Keep the reuse-isolation rationale (lines 15–23): the rows carry only `@adw-823`, the reused files' tag-scoped hooks never run, and that is why this file calls their reset/accessor exports.
  - Delete the three dash-banner blocks (42–44, 76–78, 97–100). The 97–100 block's "forcing isolation from every reused file's own hooks" point is already carried by the kept header sentence, so drop it.
- `step_definitions/feature-817.steps.ts`:
  - Header JSDoc: delete "BDD step definitions for feature-817.feature" and the feature summary paragraph (lines 4–7, including `(#817)`).
  - Keep the rationale paragraphs, trimmed to their "why":
    - §1/§5 reuse and why this file's own Before/After call `resetGuardFixtureTree`/`getGuardStdout`, since the @adw-816 hooks never run
    - the type-probe harness writes the probe as a direct child of `adws/` so `../` resolves like a real module, and compiles via a temp tsconfig because a bare file argument discards `compilerOptions`
    - §4 goes through feature-794's setter/accessor seam
  - Delete the §6 paragraph. It only lists reused phrases.
  - Delete all dash-banner blocks (45–47, 67–69, 83–85, 155–157, 169–171).
  - Keep the inline comment at ~109–111, which gives the reason `NODE_OPTIONS` is cleared.
  - For the `Cross-file seam (#823)` banner block at 181–186: remove the dash lines and the `(#823)` tag. Keep the rationale sentence as a plain `//` comment: feature-823 reuses this harness and needs its own accessor/reset because this file's @adw-817-scoped hooks never run for @adw-823.
  - Delete the one-line JSDoc at 188 ("The last type-probe compile's exit code and captured stdout…"), which restates the accessor.
  - Keep the one at 193 only for its "mirrors this file's own `cleanupProbe`" clause, if that still reads as a reason. Otherwise delete it.

### 4. Sweep the large TS files
Apply the same rules to each file. Work top to bottom and re-run the guard on the file when done.
- `step_definitions/feature-797.steps.ts`:
  - Header JSDoc: delete the §1–§8 table-of-contents lines, which narrate structure the file's own layout shows.
  - Keep the paragraphs that explain non-obvious choices: why §2–§6 share one boundary world built through the real `buildLaunchBoundary`, and why it deliberately does NOT reuse feature-796's near-identical Given. Trim them to those reasons.
  - Delete all `// ── … ──` banner lines (100, 149, 176, 492, 499, 523, 562, 585, 599, 659, 762, 798, 862, 921, 969).
  - Delete `// Per-scenario result slots` (~384), which is narration.
  - Keep `// Real ls-remote target: …` (~777) only if it states why a real branch is pushed. Otherwise delete it.
  - Keep the rationale at ~974–975 ("so a parse failure surfaces here rather than being silently skipped").
  - Review the other six `/**` blocks. Delete any that restate the helper name, and keep those that carry a reason.
- `step_definitions/feature-810.steps.ts`:
  - Header JSDoc: delete "Step definitions for feature-810.feature" and "Organised into the same seven sections". Keep the "self-contained module-private `ctx`, does NOT reach into any other feature's step defs" invariant.
  - Delete the "Registered phrases reused" list, which is a cross-reference index rather than a reason.
  - Delete every `// ══════ … ══════` and `// ── Given/When/Then ──` banner (42, 77, 173, 181, 239, 320, and any further ones).
  - Keep the Regex-vs-Cucumber-Expression rationale at ~155–157 and the fixture-default rationale at ~105–106.
  - Delete the `// no-op: …` lines at ~121 and ~129 only if the function body makes the no-op evident. Keep them if the body is empty and the comment explains why that is correct.
  - Review the six `/**` blocks. Keep ~288 only if the band sizing is non-obvious from the name.
- `step_definitions/feature-818.steps.ts`:
  - Header JSDoc: strip `(#818)` and drop the feature summary sentence. Keep the §1–§5 rationale: a real HTTP recorder with the injected instanceUrl, a child process because the env reads are load-time constants, and default transports so the shipped path is exercised. Keep the §6 hook-isolation rationale.
  - Delete the §7 phrase-reuse list.
  - Delete all 24 banner lines and their label lines.
  - At ~91, strip `(#819)` and keep the rest only if it states why the port factories need the caller's GitContext here.
  - Review the remaining `/**` blocks with the name-restating rule.
- `step_definitions/feature-846.steps.ts`:
  - Header JSDoc: drop "Step definitions for feature-846.feature". Keep the reasons: a child-process driver against temp HOME/TARGET_REPOS_DIR, a real bare remote rather than a stub, `HOME` overridden because `os.homedir()` honours it, and `TARGET_REPOS_DIR` because it binds at import time.
  - Delete all 18 banner lines with their labels (`// World`, `// Git + fs helpers`, `// Background`, `// When / shared Then`, `// Scenario 1/2/3 — …`).
  - Trim the one-line JSDoc at ~79 to its reason: a filesystem path passes through `convertToSshUrl` untouched, so clone/fetch stays local and network-free. Drop the "Seeds a real bare remote + one commit…" narration.
  - Trim the one at ~115 to the reason the workspace path is taken from the LAST stdout line (the driver's own logs precede it).

### 5. Final content audit across all 13 files
- `grep -nE '(#[0-9]{2,}|issue #[0-9]+)' <13 files>`: no hits may remain in a comment. Hits in Gherkin description prose and step text are content and must stay. For TS, the check applies to `//`/`/* */` comments only.
- `grep -nE '^\s*(//|\*)\s*(-{5,}|─{3,}|═{3,}|={5,})' <10 TS files>`: must return nothing.
- Read every surviving comment once. Each must state an invariant, an ordering constraint, or the reason for a non-obvious choice. Delete any that doesn't.
- `grep -n 'eslint-disable\|^#!' <10 TS files>`: output is unchanged from before the sweep (empty at planning time).
- `git diff --stat` touches exactly the 13 listed files, plus this plan and whatever the scenario/step-def agents add for `@adw-872`. Nothing else.

### 6. Run the validation commands
- Run every command in `Validation Commands` and confirm each exits 0.

## Validation Commands
Execute every command to validate the chore is complete with zero regressions.

- `bun run lint:comment-only features/per-issue/feature-816.feature features/per-issue/feature-819.feature features/per-issue/feature-823.feature features/per-issue/step_definitions/feature-533-given.steps.ts features/per-issue/step_definitions/feature-797.steps.ts features/per-issue/step_definitions/feature-810.steps.ts features/per-issue/step_definitions/feature-817.steps.ts features/per-issue/step_definitions/feature-818.steps.ts features/per-issue/step_definitions/feature-823-probes.steps.ts features/per-issue/step_definitions/feature-823.steps.ts features/per-issue/step_definitions/feature-846.steps.ts features/per-issue/step_definitions/takeover-probe-ctx.ts features/per-issue/support/feature-846-ensure-driver.ts`: must print `✔ PASS` and exit 0 (the base ref resolves to `origin/<default branch>`).
- `grep -nE '^\s*#' features/per-issue/feature-816.feature features/per-issue/feature-819.feature`: must return nothing.
- `grep -nE '^\s*#' features/per-issue/feature-823.feature`: must return only the four DocString `## Code Host` / `## Issue Tracker` lines.
- `bun run test`: typecheck (`bunx tsc --noEmit`).
- `bunx tsc --noEmit -p adws/tsconfig.json`: additional type check.
- `bun run lint`: ESLint over the repo.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --dry-run --tags "@adw-816 or @adw-819 or @adw-823 or @adw-533 or @adw-797 or @adw-810 or @adw-817 or @adw-818 or @adw-846"`: the swept feature files still parse, and every step still matches a definition from the swept step files (no undefined or ambiguous steps).
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-872"`: the per-issue scenario for this issue passes.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"`: zero regressions.

## Notes
- Strictly follow `.adw/coding_guidelines.md`, in particular the **Comments** rule: comment only invariants, ordering constraints, and the reason a non-obvious choice was made; no restating the next line, no section banners, no issue numbers, no JSDoc on a self-describing name. The sweep only removes comments. It does not refactor code, so the other guidelines do not apply to this diff.
- Feature-file trap: Gherkin's free-text description under `Feature:` is not a comment, and the guard treats it as content. Only lines beginning with `#` are comments. The three `#8xx`/`#647`-leading description lines are Gherkin comments already, so deleting them passes the guard even though it leaves a gap in the surrounding prose. The PRD accepts that ("the sweep trims and deletes; it does not improve the prose it keeps").
- TS trap: string and template literal text is content. Comment-like text inside a literal must stay, and so must `//` inside URLs.
- JSDoc that survives keeps its wording (PRD *Out of Scope*). Only whole sentences are dropped, and inline issue tags are stripped.
- The per-issue scenario (`features/per-issue/feature-872.feature`, tagged `@adw-872`) and its step definition come from the scenario-writer and step-definition agents, not from this plan. It must assert exactly one behaviour: the comment-only guard passes for the 13 listed files against the default branch. The step must let the guard resolve the base ref itself (no `--base`, no hardcoded branch name). Those new files are not in Touched Files and are not subject to the sweep.
- If the guard reports `code-changed` for a file, diff that file with `git diff -U0 <file>` and look for an accidental edit to a string, step line, description line, or DocString line. Restore that edit rather than weakening the guard.
- Do not commit the pre-existing unrelated worktree modifications (`.claude/commands/scenario_writer.md`, `README.md`).

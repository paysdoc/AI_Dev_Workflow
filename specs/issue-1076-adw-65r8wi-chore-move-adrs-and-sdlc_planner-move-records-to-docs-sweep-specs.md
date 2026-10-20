# Chore: Move ADRs and PRDs to `docs/`, delete historical plans and patch notes

## Metadata
issueNumber: `1076`
adwId: `65r8wi-chore-move-adrs-and`
issueJson: `{"number":1076,"title":"chore: move ADRs and PRDs to docs/, delete historical plans and patch notes","body":"## Parent PRD\n\n`specs/prd/specs-worktree-only-and-docs-relocation.md` (this issue moves it to `docs/prd/specs-worktree-only-and-docs-relocation.md`).\n\n## What to build\n\nThe record move and the historical sweep, in one PR, per the PRD's \"Directory layout\", \"Reference rewrite\" and \"Historical sweep and sequencing\" sections.\n\n1. Move `specs/adr/` to `docs/adr/` (including its README index) and `specs/prd/` to `docs/prd/`.\n2. Rewrite every reference to the old paths: TypeScript (the decisions module and docs-index gate derive the record directory from one constant), prompts and skills (`document`, `write-an-adr`, `write-a-prd`, `prd-to-issues`), feature files, the feature-940 steps that copy the real record directory, the 229 `../specs/adr/` links in `app_docs/`, both READMEs, and the `.adw/conditional_docs.md` entry that owns `specs/**` (becomes `docs/**`).\n3. Rewrite the provenance `source:` line in ADR-0051 to name the runbook's last tracked path.\n4. Delete every tracked `specs/issue-*.md`, everything under `specs/patch/`, `specs/runbooks/` and `specs/ADW_PYTHON_SUPPORT_RECOMMENDATION.md`.\n\nDo not add `specs/` to any `.gitignore`: that ships at runtime in a later issue, because the pipeline host runs main and still commits plans.\n\n**Operator step after merge (why this is HITL):** release main from dev and restart the pipeline host the same day, before the next daily docs-index sweep. The sweep runs main's code, which hardcodes `specs/adr/`, against dev's content, and would file a false \"unknown decision record\" issue. If the release cannot follow within a day, first ship a small change that lets the decisions module accept both directories, release that, then merge this.\n\n## Acceptance criteria\n\n- [ ] `docs/adr/` and `docs/prd/` exist with every record; `specs/adr/` and `specs/prd/` are gone\n- [ ] `bun run lint:docs-index` green, with every Decisions entry resolving under `docs/adr/`\n- [ ] `git grep -n 'specs/adr\\|specs/prd\\|specs/runbooks'` returns nothing outside git history and closed-issue text quoted inside plan files that this PR deletes\n- [ ] No tracked file under `specs/` except this issue's own plan file\n- [ ] Unit suite, typecheck, BDD regression green\n\n## Blocked by\n\nNone - can start immediately. Human merge: see operator step.\n\n## Touched Files\n\n- specs/adr/** → docs/adr/**\n- specs/prd/** → docs/prd/**\n- specs/issue-*.md, specs/patch/**, specs/runbooks/**, specs/ADW_PYTHON_SUPPORT_RECOMMENDATION.md (deleted)\n- adws/core/docsDecisions.ts\n- adws/core/docsIndexHealth.ts\n- adws/checkLivingDocsIndex.ts\n- features/per-issue/step_definitions/feature-940-checkout.steps.ts\n- .claude/commands/document.md\n- .claude/skills/write-an-adr/SKILL.md\n- .claude/skills/write-a-prd/SKILL.md\n- .claude/skills/prd-to-issues/SKILL.md\n- .adw/conditional_docs.md\n- app_docs/*.md\n- README.md\n- adws/README.md\n\n## User stories addressed\n\n- User stories 4, 5, 6, 7, 8, 9, 10, 11, 21, 22, 23, 24, 25","state":"OPEN","author":"paysdoc","labels":["hitl","adw:chore"],"createdAt":"2026-10-20T15:36:31Z","comments":[],"actionableComment":null}`

## Chore Description
Split `specs/` by lifetime, step one of the PRD `specs/prd/specs-worktree-only-and-docs-relocation.md` (moved by this chore to `docs/prd/`). The durable design records move to a new top-level `docs/` parent. Every historical per-run working file is deleted from the tree.

Today `git ls-files specs` lists 839 files:
- 502 plans, `specs/issue-*.md`
- 248 patch notes, `specs/patch/*.md`
- 65 ADR files: 64 records plus `README.md`, the index
- 21 PRDs under `specs/prd/`
- `specs/runbooks/gitcontext-extraction.md`
- `specs/ADW_PYTHON_SUPPORT_RECOMMENDATION.md`, the stray grill note
- `specs/prd-cost-module-revamp.md`. This is a PRD ("# PRD: Cost Module Revamp") that ADR-0018 and ADR-0026 cite as provenance. It is durable, so it moves to `docs/prd/cost-module-revamp.md`. It cannot stay: it matches the `specs/prd` acceptance grep and breaks "no tracked file under `specs/`".

After this chore:
- `docs/adr/` holds the 64 records and `README.md`.
- `docs/prd/` holds all 22 PRDs.
- The only tracked file under `specs/` is this plan.
- No tracked file outside git history mentions `specs/adr`, `specs/prd` or `specs/runbooks`.
- The docs-index gate (`adws/core/docsDecisions.ts`, `adws/core/docsIndexHealth.ts`, `adws/checkLivingDocsIndex.ts`) takes the record directory from one exported constant, `DECISION_RECORD_DIR = 'docs/adr'`. It reports a record left under `specs/adr/` as unknown.

Explicitly NOT in scope:
- No `specs/` line in any `.gitignore`. A later issue ships it at runtime.
- No change to plan-locating helpers (`adws/agents/planAgent.ts`), `SPECS_DIR`, the planner prompts' `specs/` output paths, or `.claude/commands/patch.md`'s `specs/patch/` path.
- No change to closed issues.
- Plan-file provenance lines in ADRs stay as written. Examples are `source: specs/issue-163-…md` and ADR-0043's `specs/ADW_PYTHON_SUPPORT_RECOMMENDATION.md`. They name historical paths that live in git history and are outside the acceptance grep. Only ADR-0051's runbook line is rewritten, as the issue asks.

**Operator step (HITL, record in the PR body):** after merge, release main from dev and restart the pipeline host the same day, before the next daily docs-index sweep. Main's sweep code hardcodes `specs/adr/`. Run against dev's content, it would file a false "unknown decision record" issue.

## Relevant Files
Use these files to resolve the chore:

- `README.md`: project overview. Line 23 is the gate description. Lines 150–151 link the coordination PRD and ADR index. Line 707 is the `docsDecisions.ts` tree comment. Lines 1322–1329 are the `specs/` directory tree, which needs a `docs/` block and lines removed for deleted files.
- `adws/README.md`: line 367 links the coordination PRD as `../specs/prd/…`. Line 803 says "records in `specs/adr/`".
- `.adw/coding_guidelines.md`: comment discipline. Comments state invariants only, with no issue numbers.
- `.adw/conditional_docs.md`: lines 593–597, the entry for `app_docs/feature-9gjajh-specs-and-prd.md`. It owns `specs/**`, which becomes `docs/**`, and its condition text names `specs/`.
- `adws/core/docsDecisions.ts`: `ADR_FILE_RE` (line 21) and `ADR_LINK_TARGET_RE` (line 22) hardcode `specs\/adr\/`. Doc comments at lines 4, 28 and 108 name `specs/adr/`. The new constant goes here.
- `adws/core/docsIndexHealth.ts`: line 267, the `unknown-decision` message, says "which has no file in specs/adr/".
- `adws/checkLivingDocsIndex.ts`: line 13 (header comment) and line 151 (check label `'Decisions: every listed record exists in specs/adr/'`).
- `adws/core/__tests__/fixtures/decisionDocs.ts`: `ADR_44` and `ADR_53` constants under `specs/adr/`.
- `adws/core/__tests__/docsDecisions.test.ts`: 21 `specs/adr` mentions in test names and inputs. Gains an old-directory case.
- `adws/core/__tests__/docsDecisionViolations.test.ts`: 5 mentions.
- `adws/core/__tests__/docsIndexHealth.test.ts`: 3 mentions, including the `formatViolation` expected strings.
- `adws/core/__tests__/docsIndexHealthDecisions.test.ts`: 3 mentions. Gains an old-directory case.
- `adws/core/__tests__/docsIndexReportBody.test.ts`: 1 mention.
- `adws/triggers/__tests__/docsIndexSweepDecisions.test.ts`: 1 mention.
- `adws/__tests__/checkLivingDocsIndex.test.ts`: `EXISTS_LABEL` plus 7 fixture paths and links.
- `features/per-issue/step_definitions/feature-940-checkout.steps.ts`: line 78 copies the real `specs/adr` into the fixture.
- `features/per-issue/step_definitions/feature-940-gate.steps.ts`: lines 65, 86 and 91. They build fixture links and records under `specs/adr` and remove that directory for "has no ADR directory".
- `features/regression/envelope/feature-909.feature`, `features/regression/hashing/feature-537.feature`, `features/regression/labels/feature-932.feature`, `features/regression/pause-queue/feature-902.feature`, `feature-910.feature`, `feature-911.feature`, `features/regression/rate-limit/feature-907.feature`, `feature-912.feature`, `features/regression/retry-directive/feature-908.feature`, `features/regression/review/feature-937.feature`: feature-description prose citing `specs/prd/…` or `specs/adr/…`. Text only; no step changes.
- `.claude/commands/document.md`: 8 `specs/adr/` mentions (lines 6, 65, 76, 79, 82, 133, 150, 153). Line 133 is the link template `../specs/adr/<NNNN>-<slug>.md`.
- `.claude/skills/write-an-adr/SKILL.md`: lines 3, 12, 18 and 21.
- `.claude/skills/write-a-prd/SKILL.md`: line 3 (`specs/prd/`) and line 24 (`specs/prd directory`, no trailing slash).
- `.claude/skills/prd-to-issues/SKILL.md`: line 69.
- `app_docs/*.md`: 47 files and 231 lines with `specs/adr/` or `specs/prd/`, nearly all `../specs/adr/` links in `## Decisions` sections.
- `app_docs/feature-9gjajh-specs-and-prd.md`: the module doc for the moved directory. It describes `specs/` as the plan archive and names `ADW_PYTHON_SUPPORT_RECOMMENDATION.md` (line 11). It must be rewritten to describe `docs/`.
- `app_docs/feature-9gjajh-root-config.md`: line 16 says "The `specs/` directory holds implementation plans and PRDs". This becomes false.
- `specs/adr/**` (→ `docs/adr/**`): 42 internal `specs/adr|specs/prd` mentions, mostly provenance `source:` lines and README prose. ADR-0018 and ADR-0026 cite `specs/prd-cost-module-revamp.md`. ADR-0051 line 11 is `source: specs/runbooks/gitcontext-extraction.md`.
- `specs/prd/**` (→ `docs/prd/**`): no internal old-path mentions.
- `specs/prd-cost-module-revamp.md` (→ `docs/prd/cost-module-revamp.md`).
- `junit-report.xml`: a tracked, stale vitest artifact (last committed in `bac6ec62`). Its testcase names contain `specs/adr/` 8 times. vitest writes it only when `ADW_UNIT_TEST_REPORT_PATH` is set.
- `docs/prd/specs-worktree-only-and-docs-relocation.md` (after the move): the parent PRD, for the "Directory layout", "Reference rewrite" and "Historical sweep and sequencing" sections.

### New Files
- `docs/adr/` (via `git mv specs/adr docs/adr`)
- `docs/prd/` (via `git mv specs/prd docs/prd`)
- `docs/prd/cost-module-revamp.md` (via `git mv specs/prd-cost-module-revamp.md docs/prd/cost-module-revamp.md`)

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### 1. Move the records with history preserved
- `mkdir -p docs`
- `git mv specs/adr docs/adr`
- `git mv specs/prd docs/prd`
- `git mv specs/prd-cost-module-revamp.md docs/prd/cost-module-revamp.md`
- Confirm with `git ls-files docs/adr | wc -l` (expect 65) and `git ls-files docs/prd | wc -l` (expect 22).

### 2. Delete the historical working files
- Delete every tracked plan except this issue's own:
  `git ls-files 'specs/issue-*.md' | grep -v '^specs/issue-1076-adw-65r8wi-chore-move-adrs-and-sdlc_planner-' | xargs git rm -q`
- `git rm -rq specs/patch specs/runbooks specs/ADW_PYTHON_SUPPORT_RECOMMENDATION.md`
- `git ls-files specs` must print only `specs/issue-1076-adw-65r8wi-chore-move-adrs-and-sdlc_planner-move-records-to-docs-sweep-specs.md`.

### 3. Rewrite ADR-0051's runbook provenance line and the cost-PRD citations
- In `docs/adr/0051-forge-agnostic-core-and-devplatform-dependency.md`, line 11, replace `source: specs/runbooks/gitcontext-extraction.md` with:
  `source: "gitcontext-extraction.md runbook, deleted from the tree; last tracked version at commit bccaa006"`
  `bccaa006` is the last commit that touched the runbook (`git log -1 --format=%h -- specs/runbooks/gitcontext-extraction.md`). The literal old path cannot appear, because the acceptance grep forbids `specs/runbooks` in tracked files. The commit plus file name is the last tracked location: `git show bccaa006:specs/runbooks/gitcontext-extraction.md` recovers it.
- In `docs/adr/0018-unit-tests-restored-alongside-bdd.md` (lines 7 and 28) and `docs/adr/0026-cost-computed-locally-persisted-in-d1.md` (line 7), replace `specs/prd-cost-module-revamp.md` with `docs/prd/cost-module-revamp.md`. Do this before step 4. The generic `specs/prd/` rewrite does not match `specs/prd-` (no slash).

### 4. Mechanically rewrite every remaining old-path reference
- Run over every tracked file still containing an old path, excluding this plan file:
  `git grep -l 'specs/adr\|specs/prd' -- ':!specs/' | xargs sed -i '' -e 's#specs/adr#docs/adr#g' -e 's#specs/prd#docs/prd#g'`
  (macOS `sed -i ''`; on Linux use `sed -i`.)
  This covers `docs/adr/**` (provenance lines, README index prose), `app_docs/*.md` (the `../specs/adr/` Decisions links become `../docs/adr/`), `README.md`, `adws/README.md`, `.claude/commands/document.md`, the three skills (including the slash-less `specs/prd directory` on `write-a-prd/SKILL.md:24`), the ten regression `.feature` files, the TypeScript tests and fixtures, the feature-940 gate steps' string paths, and `junit-report.xml`.
- Rewrite the two `join(…, 'specs', 'adr')` calls by hand. sed does not catch them.
  - `features/per-issue/step_definitions/feature-940-checkout.steps.ts:78`: `cpSync(join(REPO_ROOT, 'docs', 'adr'), join(root, 'docs', 'adr'), { recursive: true });`
  - `features/per-issue/step_definitions/feature-940-gate.steps.ts:91`: `rmSync(join(requireRoot(), 'docs', 'adr'), { recursive: true, force: true });`
- Review the diff of `adws/core/docsDecisions.ts`. The regexes are handled in step 5 and must not be left as a half-rewritten `docs\/adr` regex literal. Either revert sed's touch on that file before step 5 or overwrite it in step 5.

### 5. Derive the record directory from one constant in the decisions module
- In `adws/core/docsDecisions.ts`:
  - Add `export const DECISION_RECORD_DIR = 'docs/adr';` next to the regex constants.
  - Replace the two regex literals with regexes built from it. The constant holds only letters and `/`, so it needs no escaping inside `RegExp`:
    - `const ADR_FILE_RE = new RegExp(`^${DECISION_RECORD_DIR}/(\\d{4})-[^/]+\\.md$`);`
    - `const ADR_LINK_TARGET_RE = new RegExp(`(?:^|/)${DECISION_RECORD_DIR}/(\\d{4})-[^/]+\\.md$`);`
  - Doc comments on lines 4, 28 and 108 say `docs/adr/`. Step 4's sed already did this; check it.
- In `adws/core/docsIndexHealth.ts`, import `DECISION_RECORD_DIR` from `./docsDecisions` and build the `unknown-decision` message from it:
  `` `unknown decision record: ${violation.docPath} lists ${violation.adr}, which has no file in ${DECISION_RECORD_DIR}/` ``
  The output text equals `…no file in docs/adr/`.
- In `adws/checkLivingDocsIndex.ts`, import `DECISION_RECORD_DIR` (via `./core/docsDecisions` or whatever path the file already uses for core imports) and build the check label as `` `Decisions: every listed record exists in ${DECISION_RECORD_DIR}/` ``. Line 13's header comment reads `docs/adr/` (sed in step 4).
- Do not add explanatory comments citing this issue (`.adw/coding_guidelines.md` → Comments).

### 6. Update and extend the unit tests
- After step 4, tests and fixtures reference `docs/adr/…` throughout. Check that expected strings still match:
  - `adws/core/__tests__/docsIndexHealth.test.ts:265`: `'…which has no file in docs/adr/'`
  - `adws/__tests__/checkLivingDocsIndex.test.ts:145`: `EXISTS_LABEL = 'Decisions: every listed record exists in docs/adr/'`
  - `adws/core/__tests__/docsDecisions.test.ts:120`: `'app_docs/docs/adr/0044-x.md'`
- Add to `adws/core/__tests__/docsDecisions.test.ts`, in the `findAdrNumbers` describe block, a case where a record left in the old directory is not a record:
  `expect(findAdrNumbers(['specs/adr/0044-a.md'])).toEqual(new Set())` (or `.size` 0, matching the file's style).
- Add a case to `parseDecisionLinks`: a `../specs/adr/0044-x.md` link is not a decision link (`[]`).
- Add a case to `adws/core/__tests__/docsIndexHealthDecisions.test.ts`: a tree whose only record is `specs/adr/0044-living-docs-per-module.md`, with an entry whose `Decisions:` block lists `0044`, yields an `unknown-decision` violation for `0044`. Follow the file's existing tree/registry builder style.

### 7. Rewrite the conditional-docs entry and the two module docs that describe `specs/`
- `.adw/conditional_docs.md`, the `app_docs/feature-9gjajh-specs-and-prd.md` entry:
  - `Owns:` `specs/**` → `docs/**`
  - Condition → `When working on architecture decision records in \`docs/adr/\` or product requirements documents in \`docs/prd/\``
- `app_docs/feature-9gjajh-specs-and-prd.md`: rewrite it as the current-state doc for `docs/`, keeping the filename so the index entry stays valid.
  - Overview: `docs/adr/` holds one MADR record per design decision with `README.md` as the index, written by the `write-an-adr` skill. `docs/prd/` holds PRDs written by `write-a-prd` and cited by `prd-to-issues`. The docs-index gate resolves every `Decisions:` number against `docs/adr/` through `DECISION_RECORD_DIR` in `adws/core/docsDecisions.ts`.
  - Remove the bullets about per-issue plan files, `ADW_PYTHON_SUPPORT_RECOMMENDATION.md`, and the "accumulates plans" gotcha.
  - Note that `specs/` stays the per-run working directory for plans: the planner writes there and the plan-locating helpers search there.
  - Keep it concise and current-state, matching sibling app_docs. Do not add a `## Decisions` section unless the entry carries a `Decisions:` block. It carries none today.
- `app_docs/feature-9gjajh-root-config.md:16`: change "The `specs/` directory holds implementation plans and PRDs." to say `specs/` holds per-run implementation plans and `docs/` holds ADRs and PRDs.

### 8. Update the README directory tree
- `README.md` lines ~1322–1329: replace the `specs/` block with a `docs/` block and a reduced `specs/` block, e.g.:
  ```
  docs/                   # Durable design records
  ├── adr/                # Architecture Decision Records, one per design decision (index: docs/adr/README.md)
  └── prd/                # Product requirement documents
  specs/                  # Per-run implementation plans written by the plan agent
  ```
  Drop the `ADW_PYTHON_SUPPORT_RECOMMENDATION.md`, `prd-cost-module-revamp.md`, `patch/`, `runbooks/` and `issue-*.md` lines. Place `docs/` in the tree's existing ordering (alphabetical among top-level entries, before `features/` if that is the convention there).
- Verify lines 23, 150, 151 and 707 now say `docs/adr/` / `docs/prd/` (step 4) and that the relative links (`docs/prd/orchestrator-coordination-resilience.md`, `docs/adr/README.md`) resolve.
- Verify `adws/README.md:367` links `../docs/prd/orchestrator-coordination-resilience.md`.

### 9. Confirm nothing dangles
- `git grep -n 'specs/adr\|specs/prd\|specs/runbooks'` must print nothing. Any hit is a missed reference: fix it.
- `git grep -n 'prd-cost-module-revamp\|ADW_PYTHON_SUPPORT_RECOMMENDATION\.md' -- ':!docs/adr/0043-*'` must print nothing outside the ADR-0043 provenance lines. Those are deliberately left as historical paths.
- `git ls-files specs` must print only this plan file.
- `ls docs/adr docs/prd` must list 65 and 22 entries.
- `git grep -n "'specs', *'adr'"` must print nothing.

### 10. Run the validation commands
- Run every command in `Validation Commands` and fix any failure before finishing.

## Validation Commands
Execute every command to validate the chore is complete with zero regressions.

- `git grep -n 'specs/adr\|specs/prd\|specs/runbooks'`: must print nothing (exit 1).
- `git ls-files specs`: must print exactly `specs/issue-1076-adw-65r8wi-chore-move-adrs-and-sdlc_planner-move-records-to-docs-sweep-specs.md`.
- `test "$(git ls-files docs/adr | wc -l | tr -d ' ')" = 65 && test "$(git ls-files docs/prd | wc -l | tr -d ' ')" = 22 && test ! -e specs/adr && test ! -e specs/prd`
- `bun run lint:docs-index`: green, with every Decisions entry resolving under `docs/adr/`.
- `bun run lint`
- `bunx tsc --noEmit`
- `bunx tsc --noEmit -p adws/tsconfig.json`
- `bun run build`
- `bun run test:unit`
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-1076"`: per-issue scenarios for this issue, if any were written.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"`

## Notes
- Strictly follow `.adw/coding_guidelines.md`. In particular: no comments restating code or citing issue numbers, and keep the constant-derived regexes plain (no new helper for a single use).
- **HITL operator step.** The pull request body must state it: after merge, release main from dev and restart the pipeline host the same day, before the next daily docs-index sweep. The sweep runs main's code (hardcoded `specs/adr/`) against dev's content and would otherwise file a false "unknown decision record" issue. If a same-day release is impossible, first ship a change letting the decisions module accept both directories, then merge this.
- Do NOT add `specs/` to any `.gitignore`. The runtime worktree-setup change in a later issue does that.
- This plan file is the one tracked file allowed under `specs/`. The `':!specs/'` pathspec in step 4 keeps the sed off it, so its quoted issue text, which mentions the old paths, stays verbatim. The acceptance criterion allows exactly that.
- `specs/prd-cost-module-revamp.md` is a PRD, not a working file. Moving it to `docs/prd/cost-module-revamp.md` follows the `docs/prd/` naming (no `prd-` prefix) and keeps the ADR-0018/0026 provenance links resolvable.
- Other ADR provenance lines that name deleted plan files are left unchanged: `specs/issue-*.md` in ADRs 0002–0007 and others, and ADR-0043's `specs/ADW_PYTHON_SUPPORT_RECOMMENDATION.md`. They record where reasoning came from and resolve in git history. The issue asks only for the ADR-0051 runbook line, the one that matches the acceptance grep.
- `junit-report.xml` is a stale tracked vitest artifact. Rewriting its 8 `specs/adr/` testcase names with sed keeps the grep clean without regenerating it. Do not set `ADW_UNIT_TEST_REPORT_PATH` to overwrite it.
- In-flight branches keep their own plan file when dev merges in: a merge deletes only files that dev deleted and the branch did not touch.
- `app_docs/` does not interact with `docs/`. The feature-doc regex in `docsIndexHealth.ts` matches only direct children of `app_docs/`, and the gate's filesystem walk (`checkLivingDocsIndex.ts`) already includes any new top-level directory.

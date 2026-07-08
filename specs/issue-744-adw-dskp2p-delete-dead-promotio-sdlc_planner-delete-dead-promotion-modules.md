# Chore: Delete dead promotion modules + rewrite README Scenario Promotion section

## Metadata
issueNumber: `744`
adwId: `dskp2p-delete-dead-promotio`
issueJson: `{"number":744,"title":"Delete dead promotion modules + rewrite README Scenario Promotion section","body":"Delete promotionCommenter, promotionMover, promotionApprovalDetector, adwPromotionSweep.tsx, and promotionTagWriter along with their tests and JSONL/feature fixtures; keep promotionScorer, promotionThreshold, scenarioParser, vocabularyParser, promotionStatsLoader; rewrite README Scenario Promotion section.","state":"OPEN","author":"paysdoc","labels":[],"blockedBy":["#739","#740","#741"]}`

## Chore Description
The automated scenario-promotion machinery has been superseded. The new **originate + reconciliation sweep** (`adws/triggers/promotionSweep.ts`, `adws/core/promotionSweepDecider.ts`, `promotionReconcileLink.ts`, `promotionIssueBody.ts`) plus the TTL-aware per-issue sweep and the on-file marker module `adws/core/promotionTagState.ts` (salvaged from `promotionTagWriter` in #739) now own the flow. The old PR-comment-driven flow — score → auto-tag → human edits `@promotion-suggested-<date>` down to bare `@promotion` → generated mover PR — has **never** promoted a scenario and is dead code.

This chore removes that dead machinery and aligns the docs with reality:

**Delete** (modules + their unit tests + their JSONL/feature fixtures + their BDD acceptance features):
- `adws/promotion/promotionCommenter.ts`
- `adws/promotion/promotionMover.ts`
- `adws/promotion/promotionApprovalDetector.ts`
- `adws/promotion/promotionTagWriter.ts` (pure marker logic already lives in `adws/core/promotionTagState.ts`)
- `adws/adwPromotionSweep.tsx`

**Keep** (reused by the new sweep — do NOT touch, must still pass their tests):
- `adws/promotion/promotionScorer.ts`, `promotionThreshold.ts`, `scenarioParser.ts`, `vocabularyParser.ts`, `promotionStatsLoader.ts` and their `__tests__/*`
- `adws/core/promotionTagState.ts`, `adws/triggers/promotionSweep.ts`, `promotionSweepDefaults.ts`, `adws/core/promotionSweepDecider.ts`, `promotionReconcileLink.ts`, `promotionIssueBody.ts`
- `features/per-issue/feature-512.feature`, `features/regression/smoke/promotion_threshold_auto_ramp.feature`, and all `test/fixtures/jsonl/manifests/promotion-threshold-*.json` (threshold coverage)

**Rewrite** README's "Scenario Promotion" section (currently a mix of the accurate sweep description and stale legacy-flow prose) so it describes only the cron sweep + hitl-gated direct-relocation flow, and fix the `adws/` directory tree so it no longer lists the deleted files.

### Scope boundary confirmed by research
- The **only** production/code caller of the deleted modules is `adwPromotionSweep.tsx` itself (verified: no other importer of `runPromotionCommenter` / `runPromotionMover` / `detectApprovals` / `applyTagState`).
- The promotion barrel `adws/promotion/index.ts` (imported as `../promotion` by `promotionSweep.ts` and `promotionSweepDefaults.ts`) must keep its **kept-module** exports (`parseVocabulary`, `parseScenarios`, `score`, `computeThreshold`, `loadPromotionStats`, `PromotionStats`, `Scenario`, `VocabularyRegistry`, etc.) and drop only the deleted-module exports.
- The deleted-flow JSONL manifests (`promotion-sweep-*.json`, `promotion-mover-*.json`) and feature fixtures (`test/fixtures/scenarios/promotion/`) are referenced **only** by the deleted BDD features (509/510/511 + smoke commenter/mover). The new-sweep features (`feature-740`, `feature-741`) reference none of them. Verified.
- `features/regression/step_definitions/whenSteps.ts` holds a dead `ORCHESTRATOR_FILES['promotion-sweep'] = 'adwPromotionSweep.tsx'` map entry whose lookup is inside a commented-out ISSUE-3-CUTOVER stub (W1). Remove the entry (it names the deleted file); the W1 step stays a no-op so the kept threshold smoke still passes.
- The shared regression `@promotion-suggested-` given/then step defs (`givenSteps.ts`, `thenSteps.ts`) are left in place — some are still reused by the kept threshold smoke, and unused step defs do not fail cucumber.

## Relevant Files
Use these files to resolve the chore:

### Delete — source modules
- `adws/promotion/promotionCommenter.ts` — dead PR-comment-driven commenter (`runPromotionCommenter`).
- `adws/promotion/promotionMover.ts` — dead mover (`runPromotionMover`, imports `promotionApprovalDetector`).
- `adws/promotion/promotionApprovalDetector.ts` — dead `detectApprovals`.
- `adws/promotion/promotionTagWriter.ts` — dead `applyTagState` / `detectExistingSuggestionDate` (superseded by `adws/core/promotionTagState.ts`).
- `adws/adwPromotionSweep.tsx` — dead orchestrator wiring commenter + mover; sole caller of the above.

### Delete — unit tests
- `adws/promotion/__tests__/promotionCommenter.test.ts`
- `adws/promotion/__tests__/promotionMover.test.ts`
- `adws/promotion/__tests__/promotionApprovalDetector.test.ts`
- `adws/promotion/__tests__/promotionTagWriter.test.ts`

### Delete — JSONL fixtures (`test/fixtures/jsonl/manifests/`)
- `promotion-sweep-byte-exact.json`, `promotion-sweep-comment-body.json`, `promotion-sweep-high-score.json`, `promotion-sweep-lifecycle-mixed.json`, `promotion-sweep-low-score.json`, `promotion-sweep-mixed-scores.json`
- `promotion-mover-labeled.json`, `promotion-mover-mixed-tags.json`, `promotion-mover-multiple-approvals.json`, `promotion-mover-no-action.json`, `promotion-mover-removes-source.json`, `promotion-mover-single-move.json`, `promotion-mover-strip-tag.json`, `promotion-mover-suggested-only.json`
- (Keep every `promotion-threshold-*.json` — used by the kept threshold smoke / feature-512.)

### Delete — feature fixtures
- `test/fixtures/scenarios/promotion/` — entire directory (only consumed by the deleted BDD features; not used by any kept unit test). Verify empty of kept references before removal.

### Delete — BDD acceptance features + their step definitions
- `features/per-issue/feature-509.feature` + `features/per-issue/step_definitions/feature-509.steps.ts` (promotionCommenter MVP)
- `features/per-issue/feature-510.feature` + `features/per-issue/step_definitions/feature-510.steps.ts` (promotionCommenter lifecycle)
- `features/per-issue/feature-511.feature` + `features/per-issue/step_definitions/feature-511.steps.ts` (promotionMover)
- `features/regression/smoke/promotion_commenter.feature`
- `features/regression/smoke/promotion_mover.feature`

### Modify
- `adws/promotion/index.ts` — drop the deleted-module re-exports (`applyTagState`, `detectExistingSuggestionDate`, `runPromotionCommenter`, `detectApprovals`, `runPromotionMover`, `PromotionMoverDeps`, `PromotionCommenterDeps`, `PromotionResult`, `SuggestedScenario`) and the now-dead type exports (`TagState`, `ApprovedScenario`, `MovedScenarioResult`, `PromotionMoverResult`). Keep all kept-module exports.
- `adws/promotion/types.ts` — remove the now-orphaned type definitions `TagState`, `ApprovedScenario`, `MovedScenarioResult`, `PromotionMoverResult` (grep-verify no kept module/test references them first). Keep `ExecutionPattern`, `VocabularyEntry`, `VocabularyRegistry`, `Scenario`, `Step`, `PromotionStats`, `ScoreBreakdown`, `ScoreResult`.
- `features/regression/step_definitions/whenSteps.ts` — remove the `'promotion-sweep': 'adwPromotionSweep.tsx',` line from `ORCHESTRATOR_FILES`.
- `README.md` — rewrite the "Scenario Promotion" section and fix the `adws/` directory tree (details in the steps below).

### Reference (context only — do not edit)
- `README.md` (lines ~322–344 "Scenario Promotion"; line ~26–27 primitives bullets; lines ~875–902 directory tree) — read to craft the rewrite.
- `adws/triggers/promotionSweep.ts`, `adws/core/promotionSweepDecider.ts`, `promotionReconcileLink.ts`, `promotionIssueBody.ts`, `adws/core/promotionTagState.ts` — the live sweep the rewritten section must describe.
- `app_docs/feature-vpb048-promotion-sweep-originate.md` — authoritative description of the new sweep lifecycle (`originate | leave | done | decline | redrive | withdraw`).
- `app_docs/feature-ne2we8-promotion-tag-state.md` — the salvaged marker module.
- `app_docs/feature-9gjajh-promotion-system.md`, `app_docs/feature-tdauam-promotion-commenter-deep-modules.md`, `app_docs/feature-2wrg9y-promotion-mover-regression-pr.md` — historical docs describing the deleted flow (context for what is being removed).
- `.adw/commands.md` — project validation commands.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### 1. Delete the dead source modules
- `git rm adws/promotion/promotionCommenter.ts adws/promotion/promotionMover.ts adws/promotion/promotionApprovalDetector.ts adws/promotion/promotionTagWriter.ts adws/adwPromotionSweep.tsx`

### 2. Delete the corresponding unit tests
- `git rm adws/promotion/__tests__/promotionCommenter.test.ts adws/promotion/__tests__/promotionMover.test.ts adws/promotion/__tests__/promotionApprovalDetector.test.ts adws/promotion/__tests__/promotionTagWriter.test.ts`

### 3. Delete the JSONL fixtures for the dead flow
- `git rm test/fixtures/jsonl/manifests/promotion-sweep-*.json test/fixtures/jsonl/manifests/promotion-mover-*.json`
- Do NOT touch `promotion-threshold-*.json`.

### 4. Delete the feature fixtures for the dead flow
- `git rm -r test/fixtures/scenarios/promotion`

### 5. Delete the dead BDD acceptance features + step definitions
- `git rm features/per-issue/feature-509.feature features/per-issue/feature-510.feature features/per-issue/feature-511.feature`
- `git rm features/per-issue/step_definitions/feature-509.steps.ts features/per-issue/step_definitions/feature-510.steps.ts features/per-issue/step_definitions/feature-511.steps.ts`
- `git rm features/regression/smoke/promotion_commenter.feature features/regression/smoke/promotion_mover.feature`
- Do NOT delete `feature-512.feature` or `promotion_threshold_auto_ramp.feature` (threshold module, kept).

### 6. Trim the promotion barrel `adws/promotion/index.ts`
- Remove the export lines for the deleted modules: `applyTagState`/`detectExistingSuggestionDate` (from `./promotionTagWriter.ts`), `runPromotionCommenter` (from `./promotionCommenter.ts`), `detectApprovals` (from `./promotionApprovalDetector.ts`), `runPromotionMover` + `PromotionMoverDeps` (from `./promotionMover.ts`), and `PromotionCommenterDeps`/`PromotionResult`/`SuggestedScenario` (from `./promotionCommenter.ts`).
- From the `./types.ts` type-export block, remove `TagState`, `ApprovedScenario`, `MovedScenarioResult`, `PromotionMoverResult`.
- Keep the kept-module exports intact (`parseVocabulary`, `parseScenarios`, `score` + weights, `computeThreshold` + bounds, `loadPromotionStats`, `PromotionStatsLoaderDeps`, and the kept `./types.ts` exports `ExecutionPattern`, `VocabularyEntry`, `VocabularyRegistry`, `Scenario`, `Step`, `PromotionStats`, `ScoreBreakdown`, `ScoreResult`).

### 7. Remove the orphaned types from `adws/promotion/types.ts`
- Grep-verify no kept file references them: `grep -rn "TagState\|ApprovedScenario\|MovedScenarioResult\|PromotionMoverResult" adws/ features/ --include="*.ts" --include="*.tsx"` should return no hits after step 6 (the only prior hits were the deleted modules/tests; `PromotionTagState` in `adws/core/*` is a different, kept type).
- Delete the `TagState`, `ApprovedScenario`, `MovedScenarioResult`, `PromotionMoverResult` definitions from `types.ts`. Leave the rest.

### 8. Remove the dead orchestrator map entry in `whenSteps.ts`
- In `features/regression/step_definitions/whenSteps.ts`, delete the line `'promotion-sweep': 'adwPromotionSweep.tsx',` from the `ORCHESTRATOR_FILES` map.

### 9. Rewrite README — "Scenario Promotion" section
- In the "Scenario Promotion" section (currently ~lines 322–344):
  - Keep the accurate sweep paragraph describing `bunx tsx adws/triggers/promotionSweep.ts`, the deterministic vocabulary-registry scorer + auto-ramping threshold (`adws/promotion/`), reconciliation via `Promotes: feature-N` back-link (`promotionReconcileLink.ts`), the pure `promotionSweepDecider`, `@promotion-suggested-<date>` stamping on `originate` (commit scoped to the single file, never `git add -A`), and the single `hitl` + `regression-promotion` issue filed with `git mv` + vocabulary-registration instructions (`promotionIssueBody.ts`) as a human-executed direct relocation.
  - Keep the on-file marker paragraph referencing `adws/core/promotionTagState.ts` (the terminal `none → suggested → declined` state machine).
  - Keep the 14-day TTL-sweep / promotion-tag-aware exemption paragraph.
  - DELETE the stale legacy-flow paragraphs that describe `promotionCommenter` auto-tagging, the human `@promotion` approval edit, the `promotionMover` "move PR", and the `bunx tsx adws/adwPromotionSweep.tsx <issueNumber> [adwId]` "runs both halves (commenter then mover)" orchestrator-CLI note.
  - Ensure the section reads as a single coherent description of the cron-sweep + hitl-gated direct-relocation flow with no references to the deleted modules/orchestrator.

### 10. Rewrite README — primitives bullet + `adws/` directory tree
- Delete the "**Legacy promotion commenter/mover**" bullet (~line 27) that describes `adwPromotionSweep.tsx` + `promotionCommenter`/`promotionMover` as "slated for removal".
- In the `promotion/` directory-tree block (~lines 875–887):
  - Remove the tree lines for `promotionApprovalDetector.ts`, `promotionCommenter.ts`, `promotionMover.ts`, `promotionTagWriter.ts`.
  - Fix the `index.ts` comment (currently `# runPromotionCommenter entry point`) to describe the kept barrel (e.g. scorer/threshold/parser/statsLoader re-exports).
  - Update the `promotion/` directory header comment (currently "Scenario promotion scoring and mover module") to drop "mover".
- Remove the `adwPromotionSweep.tsx` line (~line 902) from the orchestrators section of the tree.

### 11. Full dangling-reference sweep
- Run: `grep -rn -E "promotionCommenter|promotionMover|promotionApprovalDetector|adwPromotionSweep|promotionTagWriter|runPromotionCommenter|runPromotionMover|detectApprovals|applyTagState|detectExistingSuggestionDate" adws/ features/ test/ README.md --include="*.ts" --include="*.tsx" --include="*.feature" --include="*.json" --include="*.md"` and confirm **zero** hits (excluding `adws/core/promotionTagState.ts`'s unrelated `PromotionTagState`, and historical `app_docs/`/`specs/` planning docs which are out of scope).
- Run: `grep -rn "promotion-sweep-\|promotion-mover-\|scenarios/promotion" features/ test/ adws/ --include="*.ts" --include="*.feature" --include="*.json"` and confirm the only survivors are `promotion-threshold-*` references (kept).

### 12. Run the validation commands
- Execute every command in `## Validation Commands` and confirm each passes with zero regressions.

## Validation Commands
Execute every command to validate the chore is complete with zero regressions.

- `bunx tsc --noEmit` — root type-check (no dangling imports of deleted modules/types).
- `bunx tsc --noEmit -p adws/tsconfig.json` — ADW type-check.
- `bun run lint` — linter / code-quality (includes the git/gh guard build step).
- `bun run build` — build succeeds with the deletions.
- `bun run test:unit` — full Vitest unit suite green (kept scorer/threshold/parser/statsLoader tests still pass; deleted tests gone).
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — full regression BDD suite green (kept threshold smoke + all other regression scenarios; deleted commenter/mover smoke gone; no undefined/ambiguous steps).

## Notes
- `.adw/coding_guidelines.md` was not found in this repo; no guideline-specific refactor is required beyond keeping the touched files idiomatic.
- The pure marker logic of `promotionTagWriter` was already salvaged into `adws/core/promotionTagState.ts` by #739 — do not re-implement it; just delete `promotionTagWriter.ts`.
- Blockers #739/#740/#741 are merged; the new sweep (`adws/triggers/promotionSweep.ts`) and TTL-awareness are live, so removing the old flow is safe.
- Keep the change surgical: do NOT delete or edit any kept module (`promotionScorer`, `promotionThreshold`, `scenarioParser`, `vocabularyParser`, `promotionStatsLoader`), `feature-512.feature`, `promotion_threshold_auto_ramp.feature`, `promotion-threshold-*.json`, or the shared regression promotion given/then step defs (still reused by the threshold smoke).
- Historical `app_docs/*` and `specs/*` that mention the deleted modules are point-in-time records and are intentionally left untouched.

# Promotion System

## Overview

Promotion moves a per-issue BDD scenario from `features/per-issue/` into the regression suite under `features/regression/`. Under ADR-0068 it is a deliberate human decision: nothing in ADW scores scenarios or originates a promotion on its own. The scorer, the threshold ramp, the statistics loader, the cron promotion sweep with its `PROMOTION_SWEEP_INTERVAL_CYCLES` cadence, the `@promotion-suggested-<date>` tag and the rot/reuse advisory comment on promotion pull requests were removed. Nomination by the scenario agent and the weekly Promotion Proposal arrive in later slices.

What remains is two generic parsers in `adws/promotion/`, the `regression-promotion` issue label, and the `/promote_regression_vocabulary` command with the `promote-regression-vocabulary` analysis skill.

## Responsibilities

**Parsers (`adws/promotion/`)**

- `parseScenarios(content)` (`scenarioParser.ts`) parses `.feature` content with the Cucumber Gherkin parser into `Scenario` objects: name, tags, steps (keyword, text, line), and the start, end and header lines. `adws/phases/baseScenarioRerun.ts` imports it from `scenarioParser.ts` directly.
- `parseVocabulary(content)` (`vocabularyParser.ts`) parses a vocabulary registry such as `features/regression/vocabulary.md` into a `VocabularyRegistry`. Each row of a `## Given`, `## When` or `## Then` table becomes a `VocabularyEntry` (phrase, `ExecutionPattern`, assertion target), and the `## Observability Surfaces (Examples)` list becomes the surface examples. Nothing in `adws/` calls it at present.
- `adws/promotion/index.ts` re-exports both parsers and the types `ExecutionPattern`, `VocabularyEntry`, `VocabularyRegistry`, `Scenario` and `Step`.

**The `regression-promotion` label (`adws/core/adwLabels.ts`)**

- `ADW_REGRESSION_PROMOTION_LABEL` names the label. `REGRESSION_PROMOTION_LABEL_DEFINITION` gives `resolveAdwLabelDefinition` its colour and description, so the forge creates it the first time it is applied.
- `scenarioAuthoringSkipReason` / `shouldSkipScenarioAuthoring`: an issue carrying the label skips the scenario-writing phase. `executeScenarioPhase` (`adws/phases/scenarioPhase.ts`) logs the reason and returns at zero cost.
- `hasRegressionPromotionLabel`: `reviewIssueKind` (`adws/phases/reviewPromptContext.ts`) returns `ReviewIssueKind.Promotion` for a labelled issue whatever its issue type, so the review does not expect the issue to carry scenarios of its own.

**Analysis command and skill**

- `.claude/commands/promote_regression_vocabulary.md`, the `/promote_regression_vocabulary` slash command, delegates to the `promote-regression-vocabulary` skill. The skill gives a reuse verdict and a rot verdict for each phrase of a scenario and writes nothing. The command's model and effort routing stays in `adws/core/modelRouting.ts`. Nothing in `adws/` runs it since the advisory phase was removed; the Promotion Proposal is to reuse it for its fit section.

## Contracts & Invariants

- The parsers are pure: they take file content and return values, with no file, git or forge access.
- The label stays out of `ADW_CLASSIFICATION_LABELS`, so it never routes an issue to a workflow, and out of `ADW_LABEL_DEFINITIONS`, so the cron's start-up label provisioning does not create it.
- The Per-Issue Sweep (`adws/triggers/perIssueScenarioSweep.ts`) exempts no promotion candidate and does not read feature-file content. A per-issue scenario is removed 14 days after its issue's pull request merged, whatever tags it carries.

## Gotchas

- Old `@promotion-suggested-<date>` and `@promotion-declined` tags in target repositories' feature files need no migration: the Per-Issue Sweep ignores them and removes such files on the normal 14-day rule.
- `parseVocabulary` reads only table rows of at least five columns (`# | Phrase | Semantics | Pattern | Assertion target`), so a registry with fewer columns parses to an empty registry. ADR-0068 records that the vocabulary template of target repositories has three. An unknown value in the Pattern column parses as `mock-query`.

## Decisions

- [ADR-0068](../docs/adr/0068-promotion-by-nomination-and-human-decided-proposal.md) — Promotion by nomination and a human-decided proposal; the scorer and the promotion sweep are removed

# Promotion System

## Overview

Promotion moves a per-issue BDD scenario from `features/per-issue/` into the regression suite under `features/regression/`. Under ADR-0068 it is a deliberate human decision: the scenario agent may nominate a scenario, and the owner decides in a Promotion Proposal. Nothing in ADW scores scenarios. The scorer, the threshold ramp, the statistics loader, the cron promotion sweep with its `PROMOTION_SWEEP_INTERVAL_CYCLES` cadence, the `@promotion-suggested-<date>` tag and the rot/reuse advisory comment on promotion pull requests were removed. The weekly Promotion Proposal arrives in a later slice.

What exists is the Nomination tags and their collector, a reader for the Per-Issue Scenario files of a default-branch checkout, two generic parsers in `adws/promotion/`, the `regression-promotion` issue label, and the `/promote_regression_vocabulary` command with the `promote-regression-vocabulary` analysis skill.

## Responsibilities

**Nomination (`adws/promotion/nominationCollector.ts`, `perIssueScenarioFiles.ts`)**

- `NOMINATION_TAG` (`@nominated`) records a Nomination; `NOMINATION_DECLINED_TAG` (`@nomination-declined`) records the owner's decline. The scenario agent writes `@nominated` per the `## Nomination` section of `.claude/commands/scenario_writer.md`, and `adws/__tests__/scenarioWriterPrompt.test.ts` pins the prompt against these same constants.
- `collectNominations({ features, getMergedAt, openProposalCandidates? })` returns the nominated and declined scenarios of issues that have merged, each as a `Nomination` (`issueNumber`, `scenarioName`, `featurePath`, `state`). A file belongs to issue `N` only when its basename is `feature-<N>.feature`, the Per-Issue Sweep's naming; other files are skipped, and a file that fails to parse yields nothing.
- `NominationState`: `Declined` when the scenario carries `@nomination-declined` (whatever else it carries); otherwise `InOpenProposal` when an `openProposalCandidates` entry has the same issue number and exact scenario name; otherwise `AwaitingProposal`.
- `getMergedAt` has the Per-Issue Sweep's `(issueNumber) => Promise<Date | null>` contract. It is called once per distinct issue that has a tagged scenario, never for files without one; `null` or a rejected lookup means not merged, and one failed lookup does not fail the others.
- Results are ordered by issue number, then by the scenario's header line. Every tagged scenario is returned, including more than one in the same file: the limit of one Nomination per issue is prompt text, not enforced here.
- `readPerIssueScenarioFiles(checkoutPath)` reads the `.feature` files under the `## Per-Issue Scenario Directory` that the checkout's own `.adw/scenarios.md` declares, returning repo-relative paths (e.g. `features/per-issue/feature-12.feature`). Without that section it returns `[]` and never falls back to `## Scenario Directory`; an absent directory also gives `[]`.
- No production caller exists yet: the Promotion Proposal slice is to compose `readPerIssueScenarioFiles` and `collectNominations` in a cron pass and supply `openProposalCandidates` from the open proposal's body.

**Parsers (`adws/promotion/`)**

- `parseScenarios(content)` (`scenarioParser.ts`) parses `.feature` content with the Cucumber Gherkin parser into `Scenario` objects: name, tags, steps (keyword, text, line), and the start, end and header lines. It returns the Feature's direct scenarios and those nested in `Rule:` blocks, in document order; `Background` blocks are excluded, and each scenario carries only its own tags (no Feature or Rule tags merged in). `adws/phases/baseScenarioRerun.ts` imports it from `scenarioParser.ts` directly, so its `locateScenario` also finds a scenario inside a `Rule:`.
- `parseVocabulary(content)` (`vocabularyParser.ts`) parses a vocabulary registry such as `features/regression/vocabulary.md` into a `VocabularyRegistry`. Each row of a `## Given`, `## When` or `## Then` table becomes a `VocabularyEntry` (phrase, `ExecutionPattern`, assertion target), and the `## Observability Surfaces (Examples)` list becomes the surface examples. Nothing in `adws/` calls it at present.
- `adws/promotion/index.ts` re-exports both parsers, `collectNominations`, `NOMINATION_TAG`, `NOMINATION_DECLINED_TAG`, `NominationState`, `readPerIssueScenarioFiles`, and the types `Nomination`, `NominationKey`, `NominationSources`, `ExecutionPattern`, `VocabularyEntry`, `VocabularyRegistry`, `Scenario` and `Step`.

**The `regression-promotion` label (`adws/core/adwLabels.ts`)**

- `ADW_REGRESSION_PROMOTION_LABEL` names the label. `REGRESSION_PROMOTION_LABEL_DEFINITION` gives `resolveAdwLabelDefinition` its colour and description, so the forge creates it the first time it is applied.
- `scenarioAuthoringSkipReason` / `shouldSkipScenarioAuthoring`: an issue carrying the label skips the scenario-writing phase. `executeScenarioPhase` (`adws/phases/scenarioPhase.ts`) logs the reason and returns at zero cost.
- `hasRegressionPromotionLabel`: `reviewIssueKind` (`adws/phases/reviewPromptContext.ts`) returns `ReviewIssueKind.Promotion` for a labelled issue whatever its issue type, so the review does not expect the issue to carry scenarios of its own.

**Analysis command and skill**

- `.claude/commands/promote_regression_vocabulary.md`, the `/promote_regression_vocabulary` slash command, delegates to the `promote-regression-vocabulary` skill. The skill gives a reuse verdict and a rot verdict for each phrase of a scenario and writes nothing. The command's model and effort routing stays in `adws/core/modelRouting.ts`. Nothing in `adws/` runs it since the advisory phase was removed; the Promotion Proposal is to reuse it for its fit section.

## Contracts & Invariants

- The parsers are pure: they take file content and return values, with no file, git or forge access. `collectNominations` is pure apart from the injected `getMergedAt`; it does no logging and no file, git or forge access.
- `perIssueScenarioFiles.ts` is the module's only file read.
- The Nomination tags count only on a scenario's own tag lines and are compared whole. A tag on the `Feature:` or `Rule:` line nominates nothing, since it would apply to every scenario below it.
- A Nomination's issue is the issue its per-issue file is named after; the prompt limits Nominations to scenarios the agent creates in `<perIssueDir>/feature-$0.feature`, so the two agree.
- The label stays out of `ADW_CLASSIFICATION_LABELS`, so it never routes an issue to a workflow, and out of `ADW_LABEL_DEFINITIONS`, so the cron's start-up label provisioning does not create it.
- The Per-Issue Sweep (`adws/triggers/perIssueScenarioSweep.ts`) exempts no Nomination and does not read feature-file content. A per-issue scenario, including one tagged `@nominated`, is removed 14 days after its issue's pull request merged; tests in the sweep's suite pin this until the proposal slice adds the exemption.

## Gotchas

- Old `@promotion-suggested-<date>` and `@promotion-declined` tags in target repositories' feature files need no migration and are not Nominations: the collector ignores them (tags are compared whole), and the Per-Issue Sweep removes such files on the normal 14-day rule.
- A scenario carrying only `@nomination-declined` (the decline replaces `@nominated`) is still returned, with state `Declined`, so the proposal can tell it apart and never propose it again.
- No caller passes `openProposalCandidates` yet, so every non-declined Nomination currently reads as `AwaitingProposal`.
- `parseVocabulary` reads only table rows of at least five columns (`# | Phrase | Semantics | Pattern | Assertion target`), so a registry with fewer columns parses to an empty registry. ADR-0068 records that the vocabulary template of target repositories has three. An unknown value in the Pattern column parses as `mock-query`.

## Decisions

- [ADR-0068](../docs/adr/0068-promotion-by-nomination-and-human-decided-proposal.md) — Promotion by nomination and a human-decided proposal; the scorer and the promotion sweep are removed

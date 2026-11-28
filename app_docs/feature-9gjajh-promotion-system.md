# Promotion System

## Overview

Promotion moves a Per-Issue Scenario from `features/per-issue/` into the Regression Suite under `features/regression/`. Under ADR-0068 it is a deliberate human decision. The scenario agent may nominate a scenario (`@nominated`). Once a week, ADW gathers each repository's open Nominations into one Promotion Proposal issue, with an agent-written analysis per candidate, and the owner decides by ticking checkboxes and closing it. A daily decision pass then acts on that decision: it files one unattended `adw:chore` implementation issue for the approved candidates and declines the rest, which the Per-Issue Sweep later removes. Nothing in ADW scores scenarios.

The module covers the Nomination tags and their collector, the Per-Issue Scenario file reader, the pure proposal body and pass-decision modules, the weekly cron pass that files the proposal, the pure promotion decider, the decision record, the implementation issue and the Nomination decline, the daily decision pass, the analysis agent with its `/promote_regression_vocabulary` command and `promote-regression-vocabulary` skill, the Per-Issue Sweep's exemption for candidates of undecided proposals and open implementation issues, the `promotion-proposal` and `regression-promotion` labels, and two generic parsers.

## Responsibilities

**Nomination (`adws/promotion/nominationCollector.ts`, `perIssueScenarioFiles.ts`)**

- `NOMINATION_TAG` (`@nominated`) records a Nomination. `NOMINATION_DECLINED_TAG` (`@nomination-declined`) records the owner's decline. The scenario agent writes `@nominated` as the `## Nomination` section of `.claude/commands/scenario_writer.md` instructs, and `adws/__tests__/scenarioWriterPrompt.test.ts` pins that prompt against these same constants.
- `collectNominations({ features, getMergedAt, openProposalCandidates? })` returns the nominated and declined scenarios of merged issues, each as a `Nomination` (`issueNumber`, `scenarioName`, `featurePath`, `state`). A file belongs to issue `N` only when its basename is `feature-<N>.feature`.
- `NominationState`: `Declined` when the scenario carries `@nomination-declined`. Otherwise it is `InOpenProposal` when an `openProposalCandidates` entry has the same issue number and exact scenario name, and `AwaitingProposal` when none does.
- `getMergedAt` is called once per distinct issue with a tagged scenario. `null` or a rejected lookup means not merged.
- `readPerIssueScenarioFiles(checkoutPath)` reads the `.feature` files under the `## Per-Issue Scenario Directory` that the checkout's own `.adw/scenarios.md` declares. It returns repo-relative paths, or `[]` when the section or the directory is absent. It never falls back to `## Scenario Directory`.

**Proposal body (`adws/promotion/proposalBody.ts`, pure)**

- Generic layer:
  - `buildProposalBody(document)` writes a heading, an intro, a checklist with one checkbox per `ProposalEntry`, and then one block per entry with its sections.
  - `readProposalCandidates(body)` returns every candidate checkbox in body order, each once, with its tick state.
  - `tickedCandidates(body)` returns the ticked candidates.
  - The Regression Suite audit is to reuse this layer, with entries ticked in advance and a tick meaning "keep".
- `buildPromotionProposal(candidates, date)` returns the `ProposalIssueSpec`:
  - Title: `Promotion Proposal <YYYY-MM-DD>: <n> candidate(s)`, using the UTC date.
  - Labels: `[adw:none, promotion-proposal]`, in that order.
  - Each candidate gets the sections "Why it qualifies", "How it fits the Regression Suite" and "Overlap with the Regression Suite". With no overlaps, the last section reads "None found.".
- A candidate line is a list bullet (`-`, `*`, `+`), possibly indented, followed by `[ ]`, `[x]` or `[X]`. It holds a hidden marker `<!-- adw-candidate:<issue>:<encodeURIComponent(name)> -->` (`PROPOSAL_CANDIDATE_MARKER`), and the last marker on the line is the key.
- The visible name is a code span (the `codeSpan` helper of `unusedStepIssueBody.ts`). An empty name is shown as `(unnamed scenario)`.
- `isSameCandidate(a, b)` compares issue number and exact scenario name.

**Pass decisions (`adws/promotion/proposalPassDecision.ts`, pure)**

- `proposalPassBlocker(proposals, now, intervalDays)` returns `proposal_open` (the lowest open issue number) while any proposal is open. It returns `proposed_recently` while the newest dated proposal is younger than `intervalDays`. Otherwise it returns `null`.
- `proposedCandidates(proposals)` returns every candidate that any listed proposal, open or closed, named, de-duplicated. `isOpenProposal` treats an absent state as open.
- `candidateMarker(key)` (in `proposalBody.ts`) writes the hidden `adw-candidate` marker, which the implementation issue reuses for its scenario lines.
- `selectProposalCandidates(nominations, alreadyProposed)` keeps the `AwaitingProposal` Nominations that no proposal named, in the collector's order. It caps them at `MAX_PROPOSAL_CANDIDATES` (12) and reports the rest as `deferred`.

**Weekly pass (`adws/triggers/promotionProposalPass.ts`, `promotionProposalDefaults.ts`, `promotionProposalIssues.ts`)**

- `runPromotionProposalPass({ boundary, ...deps })` runs these steps:
  1. List every proposal (`label:"promotion-proposal"`, state `all`, up to `PROPOSAL_LIST_LIMIT` 100, filtered to issues that really carry the label).
  2. Check the blocker.
  3. Check out the default branch read-only on the dedicated branch `chore/promotion-proposal`, removing any stale checkout first.
  4. Collect the Nominations of merged issues (`defaultGetMergedAt` of the Per-Issue Sweep) and select the candidates.
  5. Copy ADW's `.claude` commands and skills into the checkout and run the analysis there.
  6. Build the proposal and file it.
- It returns `filed` (issue number and candidates), `skipped` (`listing_failed`, `proposal_open`, `proposed_recently`, `no_checkout`, `no_nominations`) or `failed`.
- `fileProposal` creates the issue and applies its labels in order. If a label cannot be applied, it closes the issue with a comment and throws, so an unlabelled proposal never stays open for the pipeline to pick up.
- `runPromotionProposalTick(cycleCount, pass?)` in `trigger_cron.ts` gates the pass on `cycleCount % PROMOTION_PROPOSAL_INTERVAL_CYCLES === 0`. It skips the pass, with a log line, when no launch boundary exists, and logs and swallows any throw. Each tick runs it before the Per-Issue Sweep.

**Promotion decider (`adws/promotion/promotionDecider.ts`, pure)**

- `decidePromotion({ state, candidates, createdAt, now })` returns `wait`, `approve(approved, declined)` or `decline(reason, declined)`:

  | `ProposalState` | Ticks | Age | Decision |
  |---|---|---|---|
  | `ClosedAsNotPlanned` | any | any | decline all (`DeclineReason.NotPlanned`) |
  | `ClosedAsCompleted` | none | any | decline all (`NothingTicked`) |
  | `ClosedAsCompleted` | some | any | approve the ticked, decline the rest |
  | `Open` or `ClosedForUnreadReason` | any | ≥ 30 days | decline all (`Expired`) |
  | `Open` or `ClosedForUnreadReason` | any | < 30 days, or no readable `createdAt` | wait |

- `proposalStateOf(state, closeReason)` maps the forge state plus a `ProposalCloseReason` (`completed`, `not_planned`, `unread`) to a `ProposalState`.
- `proposalActions(proposals, now)` returns the actions of one pass in ascending proposal number: `decide` for each undecided proposal whose decision is not `wait`, and `close_again` for a proposal whose record says `expired` but which is still open. A proposal with any other decision record yields nothing.
- `sweepExemptCandidates(proposals, implementationIssues)` returns, de-duplicated, every candidate of a proposal without a decision record (open or closed) plus every scenario an open implementation issue names.

**Decision record (`adws/promotion/proposalDecisionRecord.ts`, pure)**

- `buildDecisionComment({ outcome, reason?, approved, declined, missing, implementationIssue })` writes the comment ADW leaves on an acted-on proposal: a summary line, the approved, missing (approved but no longer on the default branch) and declined lists, a note that declined scenarios now carry `@nomination-declined`, and the hidden marker `<!-- adw-proposal-decision:<approved|declined|expired> -->` (`PROPOSAL_DECISION_MARKER`).
- `readDecisionRecord(comments)` returns the outcome of the first comment holding a marker, or `null`. An unknown outcome reads as `declined`. `hasDecisionRecord` is its boolean.
- `<!--` and `-->` in scenario names are escaped, so a name can never forge a marker.

**Implementation issue (`adws/promotion/promotionImplementationIssue.ts`, pure)**

- `buildPromotionImplementationIssue({ proposalNumber, approved })` returns a `ProposalIssueSpec`:
  - Title: `chore: promote <n> scenario(s) into the Regression Suite from Promotion Proposal #<P>`.
  - Body: the marker line `Promotes: Promotion Proposal #<P>` (`IMPLEMENTATION_ISSUE_MARKER_PREFIX`), a sentence that the PR merges without a further human gate, `## Scenarios to promote` with one task-list line per scenario carrying its `adw-candidate` marker and feature path, `## What to do` (move each scenario on its own, never a whole feature file; reword to the Vocabulary Registry and register a new phrase only when none fits; tag `@regression` and drop per-issue tags; move the needed step definitions out of the `feature-<issue>*` files; write no new scenario), and `## Touched Files`.
  - Labels: `PROMOTION_IMPLEMENTATION_LABELS` = `[adw:chore, regression-promotion]`, in that order. Never `hitl`.
- `implementationIssueFor(proposalNumber, issues)` returns the lowest-numbered issue, open or closed, whose body holds exactly that proposal's marker line.
- `implementationIssueCandidates(issue)` reads the promoted scenarios back through `readProposalCandidates`. Ticks carry no meaning there.

**Nomination decline (`adws/promotion/nominationDecline.ts`, pure)**

- `declineNominations(content, scenarioNames)` rewrites `@nominated` to `@nomination-declined` on the named scenarios' own tag lines only (whole tags, CRLF-safe), leaving every other byte unchanged. Content the Gherkin parser rejects comes back unchanged.
- `featureOfCandidate(features, key)` returns the `feature-<issue>.feature` file that still holds a scenario of exactly that name, or `null`.

**Decision pass (`adws/triggers/promotionDecisionPass.ts`, `promotionDecisionDefaults.ts`)**

- `runPromotionDecisionPass({ boundary, now?, log?, ...deps })` lists every proposal with `listDecisionProposals`, computes `proposalActions`, and acts on each action one at a time (all share the decline branch):
  - **decide**: prepares a checkout of the default branch on `chore/nomination-decline` (`NOMINATION_DECLINE_BRANCH`, via `prepareSweepBase`), reads its Per-Issue Scenario files, acts, and always cleans the checkout up.
    - **Approve**: the approved candidates still present on the default branch are promoted, the rest reported as `missing`. If `implementationIssueFor` finds an issue already filed it is reused; otherwise one is filed (none when nothing is present). Then the declined candidates are declined, and the record is posted.
    - **Decline**: the declined candidates are declined and the record is posted. For `Expired` on an open proposal, the record must be read back before `closeIssue` is called; otherwise the outcome is `failed` and the proposal stays open.
  - **close_again**: closes an open proposal already recorded as expired.
- The decline lands as one commit through `persistCommitViaPr` (an immediately merged sweep PR, `nominationDeclineSpec`). `persistDeclines` returns `landed`, `nothing_to_change` (no edits, e.g. already declined or swept) or `failed`. Only `failed` fails the proposal.
- `fileImplementationIssue` creates the issue and applies its labels in order. On a label failure it closes the issue with a comment and throws, so the next pass files a new one.
- `recordDecision` posts the comment and returns true only once `fetchComments` shows a decision marker, because `commentOnIssue` swallows its own errors.
- Outcomes: `skipped` (`listing_failed`, `nothing_to_decide`) or `acted` with one `approved`, `declined`, `closed_again` or `failed` per proposal. A failed proposal gets no record, so the next pass acts on it again.
- `runPromotionDecisionTick(cycleCount, pass?)` in `trigger_cron.ts` gates on `cycleCount % PROMOTION_DECISION_INTERVAL_CYCLES === 0`, skips with a log line when no launch boundary exists, and logs and swallows any throw. It runs **after** the Per-Issue Sweep in each tick.

**Forge listings (`adws/triggers/promotionProposalIssues.ts`)**

- `listDecisionProposals(issueTracker)` lists every proposal with its comments, plus two closed listings by `PROPOSAL_NOT_PLANNED_SEARCH` (`reason:"not planned"`) and `PROPOSAL_COMPLETED_SEARCH` (`reason:completed`). `closeReasonOf` prefers `not_planned` when a proposal appears in both, and reads `unread` when it appears in neither.
- `listImplementationIssues(issueTracker, state)` lists issues by `label:"regression-promotion"`, filtered to those really carrying it.
- `readSweepExemptCandidates(issueTracker)` returns `sweepExemptCandidates` over all proposals and the open implementation issues.

**Analysis agent, command and skill**

- `runProposalAnalysisAgent(candidates, options)` (`adws/agents/proposalAnalysisAgent.ts`) runs `/promote_regression_vocabulary`. It passes one JSON array argument of `{ issueNumber, scenarioName, featurePath }` and logs to `promotion-proposal-analysis-agent.jsonl`.
- `extractProposalAnalyses(candidates)` requires a JSON array with one `{ issueNumber, scenarioName, qualification, fit, overlaps }` object per candidate. `qualification` and `fit` must be non-blank, and `overlaps` must be a string list. It rejects unknown, duplicate or missing candidates and returns the analyses in candidate order. Every rejection becomes the `/correct_output` retry error (`proposalAnalysisSchema`).
- `.claude/commands/promote_regression_vocabulary.md` reads `.adw/scenarios.md`, the candidates' scenarios and step definitions, the Regression Suite and the Vocabulary Registry. It answers only with that JSON array and writes nothing.
- `.claude/skills/promote-regression-vocabulary/SKILL.md` holds the qualification criterion, the reuse check against the Vocabulary Registry (`scripts/list-registered-phrases.ts`), the rot rubric and the overlap check. It is advisory only.
- `adws/__tests__/promoteRegressionVocabularyPrompt.test.ts` pins the command and skill text.

**Per-Issue Sweep exemption (`adws/triggers/perIssueScenarioSweep.ts`)**

- Before it collects a batch, the sweep reads the exempt candidates (`readSweepExemptCandidates`, injectable as `PerIssueSweepDeps.readExemptCandidates`): every candidate of a proposal without a decision record, open or closed, and every scenario an open implementation issue promotes. It keeps, by issue number, every stale `feature-<N>.feature` whose issue is exempt, together with its step-definition siblings, and logs each one it keeps (`keptForPromotion`).
- Declined candidates of a decided proposal lose the exemption. Approved ones keep it through their implementation issue until that issue closes.
- Because the feature file stays, the step-usage report counts its step definitions as used, and the unused step definition removal chore does not list them.
- `readSweepExemptIssues` returns `null` when the proposals or implementation issues cannot be read. The sweep then removes nothing that cycle.

**Labels (`adws/core/adwLabels.ts`)**

- `ADW_PROMOTION_PROPOSAL_LABEL` (`promotion-proposal`, `PROMOTION_PROPOSAL_LABEL_DEFINITION`, colour `d4c5f9`) identifies a Promotion Proposal. The issue also carries `adw:none`, so the existing opt-out gates keep the webhook and the cron from starting a workflow for it.
- `ADW_REGRESSION_PROMOTION_LABEL` (`regression-promotion`, "Moves the approved scenarios of a Promotion Proposal into the Regression Suite") marks a promotion implementation issue. `PROMOTION_IMPLEMENTATION_LABELS` is `[adw:chore, regression-promotion]`; `adw:chore` routes the issue to the chore pipeline, which has no scenario-writing phase, runs its test and diff-gated review phases, and pre-approves the PR because there is no `hitl`. `shouldSkipScenarioAuthoring` skips the scenario phase for it, and `hasRegressionPromotionLabel` makes `reviewIssueKind` return `ReviewIssueKind.Promotion`.
- Both definitions resolve through `resolveAdwLabelDefinition`, so the forge creates each label the first time it is applied.

**Parsers (`adws/promotion/`)**

- `parseScenarios(content)` (`scenarioParser.ts`) parses Gherkin into `Scenario` objects (name, own tags, steps, start/end/header lines), including scenarios nested in `Rule:` blocks and excluding `Background`. `adws/phases/baseScenarioRerun.ts` imports it.
- `parseVocabulary(content)` (`vocabularyParser.ts`) parses a vocabulary registry into a `VocabularyRegistry`. Nothing in `adws/` calls it at present.
- `adws/promotion/index.ts` re-exports the parsers, the collector, the proposal body, the pass-decision functions, the decider, the decision record, the implementation issue and the decline, with their constants and types.

## Contracts & Invariants

- `proposalBody.ts`, `proposalPassDecision.ts`, `promotionDecider.ts`, `proposalDecisionRecord.ts`, `promotionImplementationIssue.ts`, `nominationDecline.ts` and the parsers are pure. `collectNominations` is pure apart from the injected `getMergedAt`. `perIssueScenarioFiles.ts` is the only file read in `adws/promotion/`.
- A candidate's key lives only in its marker. Edits to the visible text, the analysis or anywhere else in the body do not change what `readProposalCandidates` reads. A candidate that appears on several lines is read once, and it counts as ticked when any of those lines is ticked.
- Agent text cannot forge a candidate or add a checkbox. Before it is placed, line endings are normalised and the text is trimmed. `<!--` and `-->` are escaped, and a leading `[` that would render a task-list box, or a leading `#`, is backslash-escaped. Qualification and fit are cut to `MAX_ANALYSIS_TEXT_LENGTH` (1200) characters. Overlaps are collapsed to single lines, at most `MAX_LISTED_OVERLAPS` (5) are shown, each cut to `MAX_OVERLAP_TEXT_LENGTH` (200), followed by `- … and <k> more.` when there are more.
- The proposal body has no `## Touched Files` and no `## Blocked by` section, so region-overlap and dependency handling never act on it.
- The pass never throws, never commits or pushes from its checkout, and removes the checkout on every exit path after it is created. The analysis agent runs without a subprocess credential environment.
- A candidate is offered at most once: every candidate any proposal ever named, open or closed, is excluded from later proposals.
- The week is measured from the newest proposal's `createdAt` on the forge, not from `cycleCount`, which restarts with every cron process. A proposal without a readable `createdAt` does not count toward the week.
- The sweep exemption is by issue number. A whole `feature-<N>.feature` is kept while any of its scenarios is a candidate of an undecided proposal or of an open implementation issue.
- Only a close as completed approves, and only the candidates ticked at that moment. A closed proposal whose reason the forge's search has not yet indexed (`ClosedForUnreadReason`) waits, so a lagging index can never turn "not planned" into an approval; still unread after 30 days, it is declined.
- Each proposal is acted on once, also across cron restarts: the decision record comment is the durable record. A failed action leaves no record, and the filing (lookup by marker line) and the decline (`nothing_to_change`) are idempotent for the retry.
- ADW's own close of an expired proposal happens only after its `expired` record is confirmed, so the port's close-as-completed can never be read later as the owner's approval.
- Neither the implementation issue body nor the decision comment puts `Closes`/`Implements` before an issue reference, so `bodyLinksIssue` never reads the implementation PR's merge as a candidate issue's merge.
- The decision pass never edits a file other than the declined scenarios' tag lines, and lands them only through the decline branch's pull request.
- The Nomination tags count only on a scenario's own tag lines and are compared whole.
- Neither label is in `ADW_CLASSIFICATION_LABELS`, so neither routes an issue to a workflow. Neither is in `ADW_LABEL_DEFINITIONS`, so start-up label provisioning does not create them.

## Configuration

- `PROMOTION_PROPOSAL_INTERVAL_CYCLES` (default `4320`, about daily at a 20 s poll): how often the cron checks whether a proposal is due.
- `PROMOTION_PROPOSAL_INTERVAL_DAYS` (default `7`, minimum 1): the least number of days between two proposals of a repository.
- `PROMOTION_DECISION_INTERVAL_CYCLES` (default `4320`, about daily, the Per-Issue Sweep's cadence): how often the cron runs the decision pass.
- `MAX_PROPOSAL_CANDIDATES` (12), `PROMOTION_PROPOSAL_EXPIRY_DAYS` (30, stated in the body's instructions and enforced by the decider) and the text limits are constants in code.
- `/promote_regression_vocabulary` model and effort routing lives in `adws/core/modelRouting.ts`.

## Gotchas

- Only the cron's own launch repository is served per tick, as with the other sweep ticks.
- A Nomination that has been in any proposal is never offered again, whatever the decision.
- Ticks made after the close do not count, and reopening a decided proposal does nothing: its record stops any further action. Reopening one ADW expired makes the next pass close it again.
- The decision pass runs after the Per-Issue Sweep in the same tick, so that tick's sweep still keeps the candidates of a proposal decided in it, and by the next sweep the forge's search lists the new implementation issue that keeps the approved scenarios.
- An approved scenario no longer on the default branch is reported as missing in the record and not promoted; when none is present, no implementation issue is filed.
- The forge port exposes no close reason, so it is read through the issue search's `reason:` qualifiers. The `gh` test shadow (`test/mocks/ghShadow*.ts`) models `stateReason` and that qualifier.
- If the analysis fails, returns an invalid answer after retries, or omits a candidate, no proposal is filed that cycle, and the pass retries on the next cadence cycle.
- A forge failure while listing proposals skips the weekly and decision passes, and it also makes the Per-Issue Sweep remove nothing that cycle.
- `PROMOTION_PROPOSAL_SEARCH` has no `sort:` qualifier, because the forge's test shadow reads only `label:` and `reason:` qualifiers and treats every other word as text the title or body must contain.
- Old `@promotion-suggested-<date>` and `@promotion-declined` tags in target repositories are not Nominations. The Per-Issue Sweep removes those files on the normal 14-day rule.
- `parseVocabulary` reads only table rows with at least five columns, so the three-column vocabulary template of target repositories parses to an empty registry.

## Decisions

- [ADR-0068](../docs/adr/0068-promotion-by-nomination-and-human-decided-proposal.md) — Promotion by nomination and a human-decided proposal; the scorer and the promotion sweep are removed

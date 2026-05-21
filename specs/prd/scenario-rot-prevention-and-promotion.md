# Scenario Rot Prevention and Promotion Mechanism

## Problem Statement

Issues #491–#493 removed file-content scenarios from `features/regression/` and replaced them with behavioral tests anchored to observable system outputs (state files, recorded API calls, git artefacts). The structural defences are now in place — `features/regression/` is scoped in `cucumber.js`, per-issue scenarios live under `features/per-issue/`, and a 14-day sweep deletes per-issue files after PR merge — but the `scenario_writer` agent that generates new scenarios has not been changed. It is still free to write any Gherkin it likes, including phrases that assert against file shape, file content via substring match, or structural source-file parsing. That is exactly the rot pattern issues #491–#493 spent effort removing.

In parallel, target repos onboarded via `adwInit` get no rubric at all. They receive `.adw/scenarios.md` (with optional polymorphism flags) but nothing analogous to the framework's `features/regression/vocabulary.md`. So target repos start with no shared definition of what counts as a behavioural scenario versus a rotting one, and `scenario_writer` running against them has even less guidance than it does against the framework repo.

Two questions follow:

1. How is `scenario_writer` prevented from re-introducing rot when generating new scenarios — in the framework repo and in every target repo?
2. When `scenario_writer` writes a scenario in `features/per-issue/` that is worth keeping, how does the team learn it should be promoted into `features/regression/` before the 14-day sweep deletes it?

The current answer to both is "humans read PR diffs." That has not worked reliably for rot detection in the past (which is why #491–#493 were necessary) and has no mechanism at all for promotion suggestion.

## Solution

A two-part design that addresses upstream rot prevention and downstream promotion separately, accepting that some rot will leak past the upstream defences and rely on the existing 14-day sweep to clean it up.

**Upstream: explicit rot-prevention prompt in `scenario_writer`.** The framework `scenario_writer.md` gains a "Rot Prevention" instruction block that explicitly prohibits scenarios asserting against file existence, file-content substring match, or structural source-file parsing. The block lives in the framework prompt (universal, applies to every run, every target repo) rather than being duplicated in per-repo configuration files. `vocabulary.md` (in the framework and copied to target repos by `adwInit`) remains the canonical reference document — for humans and for phrase lookup — but the operative behaviour rule for the agent is in the prompt.

**Downstream: confidence-scored promotion suggestions with a tag-based HITL gate.** When `scenario_writer` writes a per-issue scenario, a downstream scoring step evaluates whether the scenario is worth promoting. The scoring combines two axes: (a) **surface match** — whether every phrase's assertion target appears in the repo's observability-surfaces examples block — and (b) **blast radius** — proxied by execution pattern (subprocess > phase-import > mock-query) and number of phases invoked in the When section. If total score ≥ N, the agent adds a `@promotion-suggested-<date>` tag to the scenario block and posts a comment on the per-issue PR. The presence of any promotion comment in the PR triggers a `hitl` label that blocks auto-merge. A human approving the suggestion edits the tag from `@promotion-suggested-<date>` to `@promotion` (deliberate edit, hard to do accidentally); on the next agent run, the scenario is moved into the regression directory in a separate PR. Ignored suggestions die naturally at the 14-day sweep — no escalation, no nagging.

**Threshold N is auto-ramping.** N is a function of the repo's promotion-activity ratio over a rolling 90-day window (promoted-scenario count ÷ total per-issue scenarios written). Young repos start with low N (more suggestions, helps vocabulary grow); mature repos with consistent curation get a higher N (less noise). The formula is framework-owned and not per-repo overridable, eliminating drift and per-repo bikeshedding.

**Rubric export to target repos via `adwInit`.** `adwInit` is extended to copy a framework `vocabulary.md` template verbatim into the target repo at `features/regression/vocabulary.md`, containing the universal rot principle, an LLM-drafted repo-specific observability-surfaces examples block, and a minimal universal phrase seed (so the repo isn't starting from a blank registry). Maintainer rubber-stamp risk on the LLM-drafted examples is explicitly accepted — first scenarios produced against a wrong examples block will surface miscalibration in normal PR review.

**Reminder cadence is event-driven only.** The promotion-scoring step runs on per-issue PR events (push, comment, re-evaluation), updating the tag date when re-posting a reminder. No cron sweep. Dormant PRs get stale tags — that is a human responsibility to notice.

## User Stories

1. As an ADW developer, I want `scenario_writer` to refuse to write scenarios that assert against file existence, file contents, or source-file structure, so that the rot pattern removed in #491–#493 cannot silently re-enter the codebase.
2. As an ADW developer, I want the rot-prevention rule to live in the framework `scenario_writer.md` prompt (not duplicated in per-repo config), so that all target repos benefit from one source of truth and updates to the rule propagate via framework releases.
3. As an ADW developer, I want `vocabulary.md` to remain the canonical reference document for humans and for phrase lookup, so that PR reviewers can check scenario quality against a written rubric without re-deriving it.
4. As an ADW developer, I want a confidence score computed for each per-issue scenario, so that I am told which scenarios are worth promoting rather than scanning every per-issue PR myself.
5. As an ADW developer, I want the confidence score to combine surface match (vocabulary fit) with blast radius (execution pattern and phase count), so that suggestions reflect both "this looks like a real test" and "this exercises enough of the system to be worth maintaining."
6. As an ADW developer, I want the score threshold N to auto-ramp with the repo's promotion-activity ratio over 90 days, so that young repos get lenient suggestions to grow vocabulary and mature repos get tight suggestions to avoid fatigue.
7. As an ADW developer, I want N to be framework-owned and not per-repo overridable, so that no team can drift their threshold to game the system or accumulate per-repo config burden.
8. As an ADW developer, I want a `@promotion-suggested-<date>` tag added to scenarios that score above the threshold, so that the suggestion state is colocated with the scenario in the .feature file and survives across PR cycles without separate state storage.
9. As an ADW developer, I want the tag date refreshed at most once per day when the agent re-comments, so that reminders are bounded and predictable.
10. As an ADW developer, I want the suggestion comment on the per-issue PR to automatically apply a `hitl` label, so that the PR cannot auto-merge without a human deciding what to do with the suggestion.
11. As an ADW developer, I want to approve a promotion by editing the tag from `@promotion-suggested-<date>` to `@promotion` (a deliberate edit, not a deletion), so that accidental tag removal during formatting or refactoring does not trigger unintended promotion.
12. As an ADW developer, I want an ADW agent to move the scenario into `features/regression/` on a separate PR after I edit the tag, so that the human action is one tag edit but the resulting file move is reviewable as its own change.
13. As an ADW developer, I want ignored promotion suggestions to die naturally at the 14-day sweep, so that the system never nags me and never escalates.
14. As an ADW developer, I want the scoring agent to suppress comments on scenarios it already suggested today, so that PR events do not produce duplicate reminders within a single day.
15. As an ADW developer, I want the agent to drop the `@promotion-suggested-<date>` tag if a scenario's score later falls below N, so that suggestions can be withdrawn without manual cleanup.
16. As an ADW developer, I want the agent to run only on PR events (not on a cron schedule), so that dormant per-issue PRs do not generate background noise.
17. As a target-repo operator, I want `adwInit` to write a `features/regression/vocabulary.md` to my repo containing the universal rot principle, an examples block specific to my stack, and a minimal universal phrase seed, so that I start with the same scenario-quality rubric as the framework repo.
18. As a target-repo operator, I want `adwInit` to populate the per-issue and regression directory polymorphism flags in `.adw/scenarios.md` by default, so that the tiered regression model is the default for new target repos.
19. As a target-repo operator reviewing the `adwInit` PR, I accept that the LLM-drafted examples block may be wrong and that miscalibration will surface in the first scenarios produced against my repo, so that I do not need to fully audit the init PR to use the system.
20. As an ADW developer, I want `promotionScorer` extracted as a pure function deep module, so that the scoring rules can be unit-tested in isolation against synthetic scenarios and registries.
21. As an ADW developer, I want `promotionThreshold` extracted as a pure function deep module, so that the auto-ramp formula can be unit-tested against synthetic 90-day histories without standing up GitHub.
22. As an ADW developer, I want `vocabularyParser` extracted as a pure function deep module, so that the parse of `vocabulary.md` is testable independent of any agent or orchestrator.
23. As an ADW developer, I want `scenarioParser` extracted as a pure function deep module wrapping the Gherkin parser, so that scenario block extraction (with tags and positions) is testable in isolation.
24. As an ADW developer, I want `promotionTagWriter` extracted as a pure string-transform deep module, so that tag insertion, date refresh, and tag removal can be unit-tested against synthetic file contents without disk I/O.
25. As an ADW developer, I want the `promotionCommenter` orchestrator to be a thin coordination layer over the deep modules, so that integration tests can exercise it against the existing mock GitHub harness without duplicating scoring or parsing logic.
26. As an ADW developer, I want the `promotionMover` orchestrator to open the regression-promotion as a separate PR with a `regression-promotion` label, so that file moves are traceable in git history independent of the per-issue PR they originated from.
27. As an ADW developer, I want the framework `vocabulary.md.template` to be a checked-in asset, so that `adwInit` does not generate the universal sections via LLM (only the repo-specific examples block is LLM-drafted).

## Implementation Decisions

### Modules

**Deep modules (pure, unit-tested):**

- `vocabularyParser` — parses Markdown table in `vocabulary.md` into `Map<phrase, assertionTarget>` and an ordered list of surface examples. Hides Markdown table parsing.
- `scenarioParser` — wraps the Gherkin parser. Returns structured scenarios with their tags, steps, and line positions in the file. Used by scorer, commenter, mover, tag writer.
- `promotionScorer` — given `(scenario, vocabularyRegistry, examplesBlock)`, returns `{ total: number, breakdown: { surfaceMatch, executionPattern, phaseCount } }`. The scoring weights (surface match 3, subprocess 3, phase-import 2, extra phase 1, mock-query 0) are constants inside this module.
- `promotionThreshold` — given `PromotionStats { promotedCount90d, totalPerIssueCount90d }`, returns N. The formula and bounds are constants inside this module. Returns a fixed bootstrap value (3) when total is zero.
- `promotionTagWriter` — pure string transforms over `.feature` file content. Operations: add suggestion tag with date, refresh date, remove suggestion tag (on score drop), detect `@promotion` (no date) approval. No I/O.

**Orchestrator modules (shallower, integration-tested):**

- `promotionCommenter` — entry-point invoked on per-issue PR events. For each scenario block in the changed files: parse → score → compute N → decide tag-state intent → apply tag transform → write file → post comment if reminder is due → apply `hitl` label if any comment posted. All decisions delegated to deep modules; this module owns the GitHub API interaction.
- `promotionMover` — entry-point invoked on per-issue PR events. Detects `@promotion` (no date) tags. For each, opens a separate PR moving the scenario block from per-issue to the regression directory with the tag stripped. Applies `regression-promotion` label.
- A new orchestrator (working name: `adwPromotionSweep.tsx`) wraps `promotionCommenter` and `promotionMover` and is invoked on per-issue PR events.

**Modified framework assets:**

- `scenario_writer.md` — add a "Rot Prevention" instruction block listing explicit prohibitions (no file-existence checks, no file-content substring assertions, no source-file structural parsing). Add an instruction to read `features/regression/vocabulary.md` and prefer existing phrases.
- `adw_init.md` — step 7 extended to copy the framework `vocabulary.md.template` into the target repo at `features/regression/vocabulary.md`, LLM-draft the repo-specific examples block based on detected stack and dependencies, and write the `## Per-Issue Scenario Directory` and `## Regression Scenario Directory` flags in `.adw/scenarios.md` by default for new target repos.

**New framework asset:**

- `vocabulary.md.template` — checked-in template containing the universal rot-detection rubric, an examples-block placeholder, and a minimal universal phrase seed (repo-agnostic Given/When/Then phrases covering subprocess invocation, recorded mock requests, exit codes).

### Interfaces

- `vocabularyParser.parse(content: string) → VocabularyRegistry`
- `scenarioParser.parse(content: string) → Scenario[]` where each `Scenario` has `tags: string[]`, `steps: Step[]`, `startLine: number`, `endLine: number`
- `promotionScorer.score(scenario: Scenario, registry: VocabularyRegistry, examplesBlock: string[]) → { total: number, breakdown: ScoreBreakdown }`
- `promotionThreshold.computeThreshold(stats: PromotionStats) → number`
- `promotionTagWriter.applyTagState(content: string, scenarioId: ScenarioId, state: TagState) → string` where `TagState` is one of `'add-suggestion' | 'refresh-date' | 'remove-suggestion'`. Approval detection (`@promotion` without date) is a separate pure query: `promotionTagWriter.detectApprovals(content) → ScenarioId[]`.

### Activity ratio formula

- 90-day rolling window
- Numerator: count of scenarios moved into the regression directory by `promotionMover` (counted from git history of regression-promotion-labelled PRs)
- Denominator: count of per-issue scenarios written by `scenario_writer` (counted from git history of per-issue files)
- Bootstrap: when denominator is zero, N = 3 (fixed framework default)
- Above bootstrap: N rises with the ratio; exact curve is a constant in `promotionThreshold` and tuned during implementation

### State storage

- No external state file. Suggestion state lives in the `.feature` file itself as the tag (with date). Promotion-activity ratio is computed on demand from git history. The only required external state is the `hitl` label on PRs, which is GitHub-native.

### Backwards compatibility

- Existing target repos with `.adw/scenarios.md` lacking the polymorphism flags keep current behaviour (free-form scenarios, no per-issue dir, no promotion mechanism). The new system only activates for repos where `adwInit` has written the flags or a maintainer has added them manually.
- Existing per-issue scenarios in `features/per-issue/` that pre-date this work are unaffected — `promotionCommenter` will score them on the next PR event but will not retroactively post comments on closed PRs.

## Testing Decisions

### Principles

- **Test external behaviour, not implementation.** A test that exercises `promotionScorer.score(...)` and asserts on the returned `total` and `breakdown` is good; a test that mocks an internal helper and asserts it was called with specific args is not.
- **Deep modules get unit tests.** Their interfaces are stable, their inputs and outputs are small, and bugs in them propagate through every orchestrator. Unit tests pay for themselves.
- **Orchestrators get integration tests through the existing mock GitHub harness pattern.** The codebase already has `features/regression/` smoke tests that subprocess orchestrators against a programmable Claude CLI stub and assert against recorded mock-server requests. New orchestrators follow the same pattern. No mocks of internal modules.
- **Prompt changes are not unit-testable directly.** Their effects are observed via the regression suite — if a prompt regresses, smoke scenarios in `features/regression/` will fail.

### Modules with required unit tests

1. `vocabularyParser` — parse a valid `vocabulary.md`, parse a malformed one, assert on the extracted phrase→target map and the extracted examples block.
2. `scenarioParser` — parse a `.feature` with multiple scenarios, scenarios with multi-line tags, scenarios with no tags, assert on the structured output and line positions.
3. `promotionScorer` — synthetic scenarios that exercise every branch of the scoring rules: surface match present/absent, subprocess vs phase-import vs mock-query, varying phase counts. Assert on total and breakdown.
4. `promotionThreshold` — synthetic `PromotionStats` exercising bootstrap (zero denominator), low-ratio, high-ratio, and edge cases at the formula bounds. Assert on returned N.
5. `promotionTagWriter` — string-transform inputs covering all `TagState` values plus the approval-detection query. Assert on returned content (including byte-exact positions of inserted/removed tags).

### Modules tested via integration / mock harness

- `promotionCommenter` — covered by smoke scenarios under `features/regression/` that drive a per-issue PR through the mock GitHub harness and assert on recorded comment posts and label applications.
- `promotionMover` — covered by smoke scenarios that supply a `.feature` file with a `@promotion` tag and assert that a new PR is opened with the scenario moved into the regression directory.

### Prior art

- `adws/agents/__tests__/gitAgent.test.ts` — pattern for testing modules with external dependencies via dependency injection.
- `adws/__tests__/issueDependencies.test.ts` — pure function unit tests.
- `features/regression/smoke/adw_sdlc_happy_path.feature` and friends — pattern for orchestrator integration tests through the mock harness.
- `features/regression/step_definitions/world.ts` — the existing `RegressionWorld` harness that records git invocations and mock-server requests for assertion.

## Out of Scope

- **Framework `vocabulary.md` updates propagating to existing target repos.** `adwInit` copies the template verbatim at init time; updates to the framework template do not retroactively update target repos. A separate `adwUpgrade`-style mechanism is needed and is deferred.
- **Per-repo override of N or the scoring weights.** The framework owns the formula. No `.adw/scenarios.md` knobs for tuning. Repos that disagree must fork the framework prompt.
- **Cron-based reminder sweeps.** Reminders only fire on per-issue PR events. Dormant PRs get stale tags.
- **Escalation for ignored suggestions.** No re-pinging, no email, no dashboard. The 14-day sweep is the only consequence of ignoring a suggestion.
- **Automatic promotion.** No automation path moves a scenario into the regression directory without the human tag-edit gate. `promotionMover` only runs after detecting `@promotion` (no date).
- **Retroactive rescoring of merged per-issue scenarios.** Once a per-issue PR is merged and the scenario is in `features/per-issue/`, the promotion mechanism does not re-evaluate it. Re-opening the PR (and editing the file) re-triggers scoring.
- **Step-definition generation changes.** `generate_step_definitions` is not modified by this work. The vocabulary-aware step-defs work was completed in #491–#493.
- **Cross-repo coordination.** Promotion activity in target repo A does not influence threshold computation in target repo B.

## Further Notes

- The accepted-rubber-stamp-risk decision (Q19) means `adwInit` does not gate the init PR with a verification step on the LLM-drafted examples block. This is a deliberate trade-off: forcing maintainer review on every init PR was judged to deliver less safety than catching miscalibration through the first few scenarios produced.
- The decision to keep the rot prohibition in the framework `scenario_writer.md` (rather than `.adw/scenarios.md`) means `.adw/scenarios.md` remains purely a polymorphism config. Future per-repo behaviour rules would also belong in the framework prompt, with `.adw/scenarios.md` reserved for directory configuration.
- The tag-as-state design (no external state file) creates an interesting property: a per-issue file checked out at any past commit reveals exactly the suggestion state at that point in time. This was not a design goal but is a useful audit-trail side effect.
- The bootstrap N = 3 is a fixed framework constant. If field experience shows it is too low (too many false-positive suggestions) or too high (no vocabulary growth), tuning is a framework PR.
- The original `/grill-me` conversation produced three "minimal fixes" before expanding to this full design. Those fixes (tighten `scenario_writer` scope when per-issue dir is set, surface the rot rubric, optional PR-time vocabulary-change flagging) are subsumed by this PRD. They do not need to be implemented separately.

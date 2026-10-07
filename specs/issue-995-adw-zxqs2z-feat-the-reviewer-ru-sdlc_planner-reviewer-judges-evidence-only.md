# Feature: The reviewer runs nothing and judges evidence; review_proof.md and its parser are removed; green gates precede review everywhere

## Metadata
issueNumber: `995`
adwId: `zxqs2z-feat-the-reviewer-ru`
issueJson: `{"number":995,"title":"feat: the reviewer runs nothing and judges evidence; review_proof.md and its parser are removed; green gates precede review everywhere","body":"Source: `specs/prd/review-proof-redesign.md` and the ADR named below, in `specs/adr/`. The PRD section **Implementation Decisions** describes the module; the ADR holds the decision and its reasons. Read both before planning; they are the specification. Do not change the decisions.\n\n## Decision record\n\nADR-0058 (reviewer, removals). PRD modules: **Prompts** (`review.md`), **Removals and wiring**.\n\n## What to build\n\n- `.claude/commands/review.md`: remove Strategy A and B and every command execution. The reviewer judges only: the diff does what the issue asks, no more and no less; the scenarios really test the issue and are independent of the implementation (the #937 step stays); the per-issue images show what was asked, or, when the proof says no scenario opened a page, whether the diff changes anything a user can see (blocker if so); when the proof says there are no per-issue scenarios, whether the issue needed them (blocker for a feature or bug, not for a promotion issue or chore); coding guidelines; the guidance section for the repository's application type. A suppression comment or a weakened lint/compiler/build configuration in the diff is a blocker. The reviewer never raises a blocker about a test, lint, type or build result.\n- Per-type guidance lives as sections inside `review.md`, one per type in the mapping. No per-repository guidance file.\n- Delete `.adw/review_proof.md` from ADW's own repository, `parseReviewProofMd`, `supplementaryChecks`, the `## Tags` and `## Supplementary Checks` configuration, and `review_proof.md` from the required `.adw/` file list. `adw_init` no longer writes it (done in the Playwright issue if that landed first; otherwise here).\n- Green gates are a precondition of review in every orchestrator: `adwPlanBuildReview` adopts `runScenarioTestFixLoop` instead of calling the scenario phase on its own.\n- The reviewer prompt receives the selected image paths from the proof assembler and must open them.\n\n## Acceptance criteria\n\n- [ ] `review.md` contains no command that checks code; the regression suite's source-text scenario asserts it.\n- [ ] No reference to `review_proof.md`, `parseReviewProofMd` or `supplementaryChecks` remains under `adws/`, `.claude/` or `.adw/`.\n- [ ] `adwPlanBuildReview` reaches review only after the scenario fix loop is green; a unit test with injected phases shows it.\n- [ ] A review of a web issue whose proof lists images opens them (visible in the review log) and the review output refers to them.\n- [ ] The `### Confirmation` section of ADR-0058 names the implemented check.\n\n## Blocked by\n\n#994, #991\n","state":"OPEN","author":"paysdoc","labels":["adw:feature"],"createdAt":"2026-10-03T23:13:19Z","comments":[],"actionableComment":null}`

## Feature Description

ADR-0058 makes the reviewer absolutely passive: it runs no command that checks code, and it judges only what a machine cannot. Static checks, unit tests and scenarios are deterministic gates that must be green before the reviewer is called, in every orchestrator. `.adw/review_proof.md`, its parser, the `## Tags` and `## Supplementary Checks` tables and `supplementaryChecks` are deleted; per-type review guidance becomes a section of the review prompt, one per application type of ADR-0061. ADR-0063 makes the per-issue scenario images of a `web` repository the visual evidence the reviewer must see before the pull request exists. #994 built the proof assembler and put the selected images on `ScenarioProofResult.perIssueImages`; this issue hands them to the reviewer.

This issue delivers the PRD modules **Prompts** (`review.md`) and **Removals and wiring**:

- **`review.md` is rewritten.** Strategy A and B and every command execution go. The reviewer judges, in this order: whether the diff does what the issue asks, no more and no less; whether the diff adds a suppression comment or weakens lint, compiler or build configuration (a blocker); whether the per-issue scenarios really test the issue and are independent of the implementation, including what to do when the proof says `no per-issue scenarios` (a blocker for a `feature` or `bug`, not for a `chore`, `promotion` or `pr_review`); the step-definition independence check (unchanged); the per-issue images, which it must open, or, when the proof says `no scenario opened a page`, whether the diff changes anything a user can see (a blocker if so); the coding guidelines (unchanged); and the guidance section for the repository's application type. It never raises a blocker about a test, lint, type or build result.
- **The reviewer receives what TypeScript knows.** The review phase passes three new positional arguments: the title of the guidance section (`ApplicationProfile.reviewGuidanceSection`, read from the mapping, never the type), the issue kind (`feature`, `bug`, `chore`, `promotion`, `pr_review`, derived from the classification and the `regression-promotion` label), and a JSON array of the absolute paths of the selected per-issue images. The hand-off is recorded in the orchestrator log, and the agent's saved prompt and JSONL log show the images it was given and the `Read` calls that opened them.
- **`review_proof.md` is gone.** `ProjectConfig` loses `reviewProofMd` and `reviewProofConfig`; `projectConfig.ts` loses `ReviewTagEntry`, `SupplementaryCheck`, `ReviewProofConfig`, `getDefaultReviewProofConfig`, `parseReviewProofMd` and the table parsers. `.adw/review_proof.md` and the three test-fixture copies are deleted. `REQUIRED_ADW_FILES` and `adw_init.md` already omit the file (#992); the tests that asserted that by naming the file are rewritten as positive assertions, so that nothing under `adws/`, `.claude/` or `.adw/` names it.
- **Green gates precede review in `adwPlanBuildReview`.** It runs the step-definition phase and `runScenarioTestFixLoop` before its first review, like `adwSdlc`, `adwPlanBuildTestReview`, `adwChore` and `adwPrReview`, and a unit test with injected phases proves the review starts only after the loop returns green.
- **Records.** ADR-0058's `### Confirmation` names the implemented checks. The "still open" items this issue closes in ADR-0059 (the reviewer's suppression rule), ADR-0061 (the per-type guidance sections) and ADR-0063 (the review prompt that opens the images) point to it.

## User Story
As an ADW operator
I want the reviewer to run nothing, to be reached only when every machine gate is green, and to judge the change against the issue with the per-issue images in front of it and the guidance for my repository's application type
So that a green run means the checks really passed, and the review spends its attention only on what a machine cannot decide: scope, scenario fidelity, visual evidence, guidelines and per-type expectations

## Problem Statement

Checked at `64216734` (`dev` after #994):

- `.claude/commands/review.md` Strategy A tells the reviewer to run `bunx tsc --noEmit` and `bun run lint` itself and grades a failed `@adw-{issueNumber}` run as tech debt. Strategy B tells it to follow `.adw/review_proof.md`, which in ADW's own repository tells it to run both type checks, lint and `cucumber-js`. The prompt has no rule about suppressions (ADR-0059's Confirmation lists that as still open), no per-type guidance (ADR-0061 lists it as still open), and no step that judges the diff against the issue.
- The reviewer receives `adwId`, the spec path, its agent name and the proof path. It does not receive the selected images (`ScenarioProofResult.perIssueImages` exists since #994 and only the issue comment's upload reads it), the application profile's guidance section, or whether the issue is a feature, bug, chore or promotion. ADR-0063's Confirmation lists "the review prompt that opens the images and judges them" as still open.
- `adws/core/projectConfig.ts` still reads `.adw/review_proof.md` and parses `## Tags` and `## Supplementary Checks` into `ProjectConfig.reviewProofConfig`, which nothing has read since #994 fixed the tags in code. `.adw/review_proof.md` and copies under `test/fixtures/{cli-tool,python-flat,python-app}/.adw/` remain.
- `adwPlanBuildReview` calls `executeScenarioTestPhase` once and reviews whatever it returned. It runs no step-definition phase and no fix loop, so a red scenario run reaches the reviewer. It is the only reviewing orchestrator without the loop.
- `adws/__tests__/adwInitPrompt.test.ts` and `adws/phases/__tests__/worktreeSetup.test.ts` name `review_proof.md` to assert its absence, so the acceptance criterion's grep cannot pass while they do.

## Solution Statement

1. **A review prompt contract** (`adws/agents/reviewPromptArgs.ts`, pure): the `ReviewIssueKind` enum, the `ReviewPromptContext` type (`guidanceSection`, `issueKind`, `imagePaths`) and `formatReviewArgs`, which always returns seven positional arguments: `$0` adwId, `$1` spec, `$2` agent name, `$3` proof path (`''` when none), `$4` guidance section title, `$5` issue kind, `$6` the image paths as a JSON array.
2. **The review agent takes the context** (`adws/agents/reviewAgent.ts`): `runReviewAgent(adwId, specFile, context, logsDir, …)`, following the precedent of `runStepDefAgent`'s `runnerMode`.
3. **A review prompt builder** (`adws/phases/reviewPromptContext.ts`, pure): `reviewIssueKind(issueType, labels)`, `buildReviewPromptContext(config)`, which reads `requireApplicationProfile(config).reviewGuidanceSection`, the issue kind and `ctx.scenarioProof.perIssueImages`, and `describeReviewPromptContext(context)` for the log line.
4. **The review phase hands it over** (`adws/phases/reviewPhase.ts`): it builds the context, logs the hand-off to the orchestrator state log, and passes the context to the agent. The images the reviewer gets are the ones the issue comment of the same attempt shows.
5. **`review.md` is rewritten** to the structure in Step 6 below: Variables `$0`–`$6`, Rules (run nothing; never a blocker about a test, lint, type or build result), eight steps, `## Guidance by application type` with `### CLI applications` and `### Web applications`, the severity reference and the report. A vitest source-text test (`adws/__tests__/reviewPrompt.test.ts`) compares the prompt with its sources, as `generateStepDefinitionsPrompt.test.ts` and `adwInitPrompt.test.ts` do.
6. **Removals**: the review-proof parsing in `projectConfig.ts` (and a consolidation of `loadProjectConfig`'s file reads so the file stays under 300 lines), `.adw/review_proof.md`, the fixtures' copies, and every test line that names the file.
7. **`adwPlanBuildReview`** runs `executeStepDefPhase` (as `stepDef`) after the build and `runScenarioTestFixLoop` after the unit-test phase, and keeps `executeScenarioTestPhase` only for the re-test after a review patch, exactly as `adwPlanBuildTestReview` does.
8. **Docs and records**: README, `adws/README.md`, `UBIQUITOUS_LANGUAGE.md`, and the ADR Confirmation sections.

### Decisions this plan makes inside the ADRs (none changes them)

- **The images reach the reviewer as an argument, and the proof keeps listing them.** `$6` is a JSON array of `PerIssueImage.absPath` in the assembler's order. A JSON array is one argument whatever the number of images and survives `runClaudeAgentWithCommand`'s single-quote escaping, the way `/feature` already receives `issueJson`. The proof's `## Evidence` section still maps each image to its scenario. Passing the list makes the hand-off observable in the saved prompt and testable in TypeScript, instead of relying on the agent finding the paths in the document.
- **`$3` is always present.** It is `''` when there is no proof, so that `$4`–`$6` keep their positions. Empty positional arguments are already part of `generate_step_definitions.md` (`$2`) and `adw_init.md` (`$3`).
- **The guidance section is passed by title** from `ApplicationProfile.reviewGuidanceSection`, so the review prompt builder reads the mapping and never the type (ADR-0061; `applicationType.test.ts` enforces that no other module names `applicationType`).
- **The issue kind is decided by TypeScript**, not inferred by the reviewer from the spec: `regression-promotion` label → `promotion` (a promotion issue is classified `/feature`); otherwise `/feature` → `feature`, `/bug` → `bug`, `/chore` → `chore`, `/pr_review` → `pr_review`, `/adw_init` → `chore` (never reviewed; the record must be total). Only `feature` and `bug` need per-issue scenarios. A `pr_review` run revises a pull request whose issue's scenarios already exist or were never required, so it is not blocked for them.
- **The two proof lines can both appear.** In a `web` repository whose issue has no per-issue scenarios, the proof says both `no per-issue scenarios` and `no scenario opened a page`. Then the issue-kind rule decides alone. The `no scenario opened a page` rule applies to an issue whose per-issue scenarios ran and none took the page, which is the case ADR-0063 describes ("a `web` issue whose scenarios all do that"). Otherwise a `web` chore that changes a page would be blocked for lacking the scenarios the same prompt says it does not need.
- **The suppression rule covers the whole diff, build phase included.** The fix-round guard covers fix rounds only, so that a legitimate configuration change planned for the issue can still be made. The reviewer therefore blocks a configuration change only when it **weakens** a check: a rule turned off or down, files excluded, a compiler option loosened, a check command removed or set to `N/A`. Any other configuration change is judged for scope like any other change. A suppression comment the diff adds is always a blocker.
- **`adwPlanBuildReview` also runs the step-definition phase.** ADR-0058 says it "must use the loop like the other orchestrators". Every orchestrator that runs the loop runs `executeStepDefPhase` (named `stepDef`) right before the unit-test phase. Without it, the per-issue scenarios that `adwPlanBuildReview`'s scenario phase writes have no step definitions for the loop to make green.
- **The "source-text scenario" is a vitest source-text test.** The regression vocabulary's Rot-Detection Rubric forbids `@regression` phrases that read source files, and feature-937 declined a scenario reading `review.md` for that reason. ADW's prompt text checks live in `adws/__tests__/*Prompt.test.ts`. `reviewPrompt.test.ts` is that check for `review.md`.
- **Tests that named the deleted file become positive assertions** (the `.adw/` files `adw_init.md` names are a subset of the files it writes; `REQUIRED_ADW_FILES` equals the five files), so that `grep -rn review_proof adws/ .claude/ .adw/` can return nothing. The removal check in ADR-0058's Confirmation is that grep, widened to `reviewProofConfig`, `ReviewProofConfig` and `reviewProofMd`.
- **The fixtures' copies are deleted too.** They model target repositories, ADR-0058 deletes the file "in every repository", and #994's plan left them for this issue. Nothing reads them after this change.

## Relevant Files
Use these files to implement the feature:

- `README.md` — project overview; the "Multi-agent passive review" bullet, the `.adw/` file list in "Adaptable target repos", the `adw_init` paragraph and the `.adw/` project-structure tree mention the reviewer's old role or `review_proof.md`. The working tree already carries an unrelated uncommitted change in the `adws/proof/` tree; leave it.
- `.adw/coding_guidelines.md` — files under 300 lines, guard clauses, max nesting ~2, enums for named constant sets, purity, comment discipline (no issue numbers, no restating comments).
- `specs/prd/review-proof-redesign.md` — the PRD; **Prompts** and **Removals and wiring** are this issue's modules. User stories 50–62.
- `specs/adr/0058-static-checks-in-the-test-phase-reviewer-runs-nothing.md` — the decision; its `### Confirmation` must name the implemented checks.
- `specs/adr/0059-fix-loops-no-progress-stop-and-suppression-guard.md` — "the reviewer treats a suppression it finds as a blocker"; its Confirmation's "Still open" names this rule.
- `specs/adr/0061-application-type-decides-evidence-web-repos-run-playwright-bdd.md` — `reviewGuidanceSection`; its Confirmation's "Still open" names the review prompt's per-type guidance sections.
- `specs/adr/0063-per-issue-scenario-images-are-the-visual-evidence.md` — the images and the `no scenario opened a page` rule; its Confirmation's "Still open" names the review prompt that opens the images.
- `specs/adr/0049-promotion-sweep-files-human-gated-issue.md` — promotion issues have no `@adw-{N}` scenarios (reference only).
- `.claude/commands/review.md` — the prompt to rewrite.
- `.claude/commands/resolve_failed_test.md` — its "Never silence a failure" rule gives the suppression examples and configuration files the review prompt mirrors.
- `.adw/review_proof.md` — delete.
- `test/fixtures/cli-tool/.adw/review_proof.md`, `test/fixtures/python-flat/.adw/review_proof.md`, `test/fixtures/python-app/.adw/review_proof.md` — delete.
- `adws/agents/reviewAgent.ts` — `runReviewAgent` takes the context; `formatReviewArgs` moves to the new contract module.
- `adws/agents/index.ts` — export `ReviewIssueKind`, `ReviewPromptContext`, `formatReviewArgs`.
- `adws/agents/stepDefAgent.ts` — precedent: `runnerMode` added as a required third parameter and passed as `$2`.
- `adws/agents/claudeAgent.ts` — `runClaudeAgentWithCommand` single-quotes each positional argument and saves the prompt to `<agent state>/prompts/review.txt`.
- `adws/phases/reviewPhase.ts` — builds and logs the context and passes it to the agent; `uploadReviewedProofScreenshots` already uses `ctx.scenarioProof.perIssueImages`. It is 288 lines; keep it under 300.
- `adws/phases/applicationTypeGate.ts` — `requireApplicationProfile`.
- `adws/core/applicationType.ts` — `APPLICATION_TYPE_PROFILES`, `reviewGuidanceSection` (`CLI applications`, `Web applications`).
- `adws/core/adwLabels.ts` — `hasRegressionPromotionLabel`.
- `adws/types/issueTypes.ts` — `IssueClassSlashCommand`.
- `adws/proof/proofDocument.ts` — `NO_PER_ISSUE_SCENARIOS`, `NO_SCENARIO_OPENED_A_PAGE`, the `## Evidence` section.
- `adws/proof/types.ts` — `PerIssueImage`, `ScenarioProofResult.perIssueImages`.
- `adws/core/fixRoundGuardTable.ts` — `FRAMEWORK_SUPPRESSION_PATTERNS`, keyed by language.
- `adws/core/projectConfig.ts` — remove the review-proof types, defaults, parser, file read and fields; consolidate `loadProjectConfig`'s reads.
- `adws/phases/worktreeSetup.ts` — `REQUIRED_ADW_FILES` (already without the file).
- `adws/adwPlanBuildReview.tsx` — adopt `executeStepDefPhase` and `runScenarioTestFixLoop`.
- `adws/adwPlanBuildTestReview.tsx` — the pattern to mirror.
- `adws/phases/scenarioTestFixLoop.ts` — returns only when green; throws `ScenarioHermeticityError`/`GoalFidelityError` or parks otherwise.
- `adws/__tests__/adwPlanBuildReview.test.ts` — extend with the injected loop.
- `adws/__tests__/adwPlanBuildTestReview.test.ts` — the injected-phases pattern with `runScenarioTestFixLoop`.
- `adws/__tests__/generateStepDefinitionsPrompt.test.ts` — the prompt source-text test pattern (a `section()` helper, comparison with code constants).
- `adws/__tests__/adwInitPrompt.test.ts` — rewrite the two tests that name the deleted file.
- `adws/phases/__tests__/worktreeSetup.test.ts` — rewrite the two tests that name the deleted file.
- `adws/phases/__tests__/scenarioTestPhase.helpers.ts` — drop `reviewProofMd` and `reviewProofConfig` from the fixture.
- `adws/phases/__tests__/scenarioTestPhase.runner.test.ts` — drop the case that asserts no `reviewProofConfig` is handed over.
- `adws/phases/__tests__/reviewPhaseScreenshots.test.ts`, `adws/phases/__tests__/reviewPhaseApprovalGate.test.ts` — their configs need `applicationProfile` and `issueType` once the phase reads the profile.
- `adws/core/__tests__/projectConfigLoad.test.ts` — covers `loadProjectConfig`; add the empty-`.adw/` defaults case.
- `adws/core/__tests__/applicationType.test.ts` — its rule that no module but the parser and the gate names `applicationType` applies to the new modules.
- `features/per-issue/step_definitions/feature-929-agents.ts` — the only other caller of `runReviewAgent`; pass a context.
- `features/regression/step_definitions/feature-820.steps.ts` — builds a review-phase config without `applicationProfile` (used by `feature-848.feature`); add it.
- `features/regression/support/phaseConfig.ts`, `features/per-issue/step_definitions/feature-937-workflow.ts`, `features/per-issue/step_definitions/feature-994-workflow.ts` — drive the real review phase; their configs already carry `applicationProfile` and `issueType` (no change expected).
- `adws/README.md` — the `adwPlanBuildReview.tsx` section says it skips tests; it is scanned by `lint:branch-names`.
- `UBIQUITOUS_LANGUAGE.md` — the "Review", "Scenario Proof" and "Review Proof Config" rows.
- Conditional docs that apply (updated by the document phase): `app_docs/feature-9gjajh-review-and-diff-phases.md` (`reviewPhase.ts`; still says the agent "falls through to its own Strategy B"), `app_docs/feature-9gjajh-review-and-patch-agents.md` (`reviewAgent.ts`), `app_docs/feature-9gjajh-commands-and-skills.md` (`review.md`, `adwInitPrompt.test.ts`), `app_docs/feature-9gjajh-sdlc-orchestrators.md` (`adwPlanBuildReview.tsx`, `PlanBuildReviewPhases`), `app_docs/feature-9gjajh-state-and-config.md` (`projectConfig.ts`; lists `.adw/review_proof.md`), `app_docs/feature-gfv9kt-application-type-mapping.md` (review guidance section), `app_docs/feature-9gjajh-proof-and-scenario-proof.md` (the two proof lines), `app_docs/feature-9gjajh-test-and-scenario-phases.md` (`scenarioTestFixLoop.ts`), `app_docs/feature-9gjajh-worktree-and-vcs.md` (`worktreeSetup.ts`).

### New Files
- `adws/agents/reviewPromptArgs.ts` — the review prompt's argument contract (pure): `ReviewIssueKind`, `ReviewPromptContext`, `formatReviewArgs`. A separate module because the review phase tests replace `../../agents/reviewAgent` wholesale with `vi.mock`, which would also remove the enum the builder needs.
- `adws/phases/reviewPromptContext.ts` — the review prompt builder (pure): `reviewIssueKind`, `buildReviewPromptContext`, `describeReviewPromptContext`.
- `adws/agents/__tests__/reviewPromptArgs.test.ts`
- `adws/phases/__tests__/reviewPromptContext.test.ts`
- `adws/phases/__tests__/reviewPhaseEvidence.test.ts`
- `adws/__tests__/reviewPrompt.test.ts`

## Implementation Plan
### Phase 1: Foundation
Define the review prompt's argument contract and the pure builder that turns a `WorkflowConfig` into it: the guidance section title from the application profile, the issue kind from the classification and labels, and the selected image paths from the scenario proof. Unit-test both before any wiring.

### Phase 2: Core Implementation
Make `runReviewAgent` take the context and pass all seven arguments. Wire the review phase to build, log and pass the context. Rewrite `review.md` to judge only, with the evidence, suppression and per-type guidance rules, and pin it with the source-text test. Remove the review-proof configuration from `projectConfig.ts`, delete the files, and rewrite the tests that named them.

### Phase 3: Integration
Make `adwPlanBuildReview` run the step-definition phase and the scenario test-and-fix loop before its first review, with injected-phase tests. Update the remaining callers and fixtures (`feature-929-agents.ts`, `feature-820.steps.ts`, the review phase test configs). Update README, `adws/README.md` and `UBIQUITOUS_LANGUAGE.md`, rewrite ADR-0058's Confirmation and close the matching "still open" items of ADR-0059, ADR-0061 and ADR-0063. Run the validation commands.

## Step by Step Tasks
Execute every step in order, top to bottom.

### 1. The review prompt contract (`adws/agents/reviewPromptArgs.ts`, pure)
- Write `adws/agents/__tests__/reviewPromptArgs.test.ts` first:
  - `formatReviewArgs('adw-1', 'specs/plan.md', 'Review', '/abs/scenario_proof.md', context)` returns exactly `['adw-1', 'specs/plan.md', 'Review', '/abs/scenario_proof.md', context.guidanceSection, context.issueKind, JSON.stringify(context.imagePaths)]`.
  - With no proof path (`undefined`) the fourth argument is `''` and the array still has seven elements, so `$4`–`$6` keep their positions.
  - `$6` parses back (`JSON.parse`) to the image paths in the given order; it is `'[]'` when there are none; a path with a space or a single quote survives as one element.
  - Every `ReviewIssueKind` value is a lowercase string (`feature`, `bug`, `chore`, `promotion`, `pr_review`).
- Implement:
  - `export enum ReviewIssueKind { Feature = 'feature', Bug = 'bug', Chore = 'chore', Promotion = 'promotion', PrReview = 'pr_review' }`.
  - `export interface ReviewPromptContext { readonly guidanceSection: string; readonly issueKind: ReviewIssueKind; readonly imagePaths: readonly string[]; }`. Document only what the names do not say: `guidanceSection` is the title of the section under `## Guidance by application type` the reviewer applies; `imagePaths` are absolute paths the reviewer must open.
  - `export function formatReviewArgs(adwId: string, specFile: string, agentName: string, scenarioProofPath: string | undefined, context: ReviewPromptContext): string[]`. Its doc comment lists the positions (`$0` adwId … `$6` image paths as a JSON array) and says why `$3` is `''` rather than absent.
- Export `ReviewIssueKind`, `type ReviewPromptContext` and `formatReviewArgs` from `adws/agents/index.ts`.

### 2. The review agent takes the context (`adws/agents/reviewAgent.ts`)
- Remove `formatReviewArgs` from this file and import it, with `type ReviewPromptContext`, from `./reviewPromptArgs`.
- New signature: `runReviewAgent(adwId, specFile, context: ReviewPromptContext, logsDir, statePath?, cwd?, issueBody?, scenarioProofPath?, subprocessEnv?, launchContext?)`. The context is required and third, as `runStepDefAgent`'s `runnerMode` is. Build `args` with `formatReviewArgs(adwId, specFile, 'Review', scenarioProofPath, context)`.
- Update the header comment: the agent is handed the spec, the proof, the per-issue images and the guidance section for the repository's application type; neither ADW nor the agent runs a check here.
- Update the only other caller, `features/per-issue/step_definitions/feature-929-agents.ts` (`'review agent'` driver): pass `buildReviewPromptContext(config)` (step 3) as the third argument. Its config already sets `applicationProfile` (cli) and `issueType` (`/bug`).

### 3. The review prompt builder (`adws/phases/reviewPromptContext.ts`, pure)
- Write `adws/phases/__tests__/reviewPromptContext.test.ts` first:
  - `reviewIssueKind`: `/feature` → `feature`, `/bug` → `bug`, `/chore` → `chore`, `/pr_review` → `pr_review`, `/adw_init` → `chore`. A `regression-promotion` label makes it `promotion` whatever the type (`/feature`, `/chore`). Other labels (`hitl`, `adw:feature`) change nothing.
  - `buildReviewPromptContext`: the `web` profile gives `Web applications` and the `cli` profile `CLI applications`. A fake third profile's `reviewGuidanceSection` is passed through unchanged, which shows the builder reads the mapping. `imagePaths` are the `absPath`s of `ctx.scenarioProof.perIssueImages` in order. They are `[]` when the proof has no images and when `ctx.scenarioProof` is absent. A config without `applicationProfile` throws (`requireApplicationProfile`).
  - `describeReviewPromptContext`: names the guidance section, the issue kind and every image path, or says there is no per-issue image.
- Implement, without naming `applicationType` anywhere (enforced by `applicationType.test.ts`):
  - `const ISSUE_KIND_BY_TYPE: Readonly<Record<IssueClassSlashCommand, ReviewIssueKind>>`.
  - `export function reviewIssueKind(issueType: IssueClassSlashCommand, labels: readonly string[]): ReviewIssueKind`: guard clause on `hasRegressionPromotionLabel(labels)` (import from `../core/adwLabels` directly), then the record. One comment: a promotion issue is classified as a feature, and only its label says it needs no scenarios of its own.
  - `export function buildReviewPromptContext(config: Pick<WorkflowConfig, 'applicationProfile' | 'issueType' | 'issue' | 'ctx'>): ReviewPromptContext`, using `requireApplicationProfile(config).reviewGuidanceSection`.
  - `export function describeReviewPromptContext(context: ReviewPromptContext): string`, e.g. `Review: "Web applications" guidance, feature issue, 2 per-issue image(s) for the reviewer to open: /a.png, /b.png`, or `… no per-issue image`.
- Import `ReviewIssueKind`/`ReviewPromptContext` from `../agents/reviewPromptArgs`, never from `../agents/reviewAgent`.

### 4. The review phase hands the context over (`adws/phases/reviewPhase.ts`)
- Write `adws/phases/__tests__/reviewPhaseEvidence.test.ts` first, mocking as `reviewPhaseScreenshots.test.ts` does (`../../core`, `../../cost`, `../../agents/planAgent`, `../../agents/reviewAgent`, `../phaseCommentHelpers`, `../../proof/proofUploader`):
  - A `web` workflow whose proof selected two images starts the review agent with the context `{ guidanceSection: 'Web applications', issueKind: 'feature', imagePaths: [both absPaths, in order] }` (read the third argument of `runReviewAgent`'s call). These are the same images the phase uploads for the issue comment of that attempt (compare with `uploadProofArtifacts`'s `images`).
  - A `cli` workflow gets `CLI applications` and `imagePaths: []`. So does a workflow with no scenario proof on `ctx`.
  - A workflow whose issue carries `regression-promotion` hands over `promotion`.
  - The proof path still reaches the agent (eighth argument), and `''` reaches it as `undefined`.
  - The orchestrator state log (`AgentStateManager.appendLog` on `orchestratorStatePath`) records the hand-off with every image path.
  - A second call after the proof changed (a re-test between attempts) hands over the new images only.
- Implement (net ~+5 lines; the file must stay under 300):
  - `const promptContext = buildReviewPromptContext(config);` before the agent call; `log(describeReviewPromptContext(promptContext), 'info')` and `AgentStateManager.appendLog(orchestratorStatePath, describeReviewPromptContext(promptContext))`.
  - Pass `promptContext` as `runReviewAgent`'s third argument.
  - Replace the `@param scenarioProofPath` sentence "When empty, the review agent falls through to Strategy B or code-diff review" with "Empty when the repository runs no scenarios."
- Add `applicationProfile: APPLICATION_TYPE_PROFILES.web` (screenshots test; its images are `web` evidence) or `.cli` (approval-gate test) and `issueType: '/feature'` to the configs of `reviewPhaseScreenshots.test.ts` and `reviewPhaseApprovalGate.test.ts`. Their assertions do not change.
- Add `applicationProfile: APPLICATION_TYPE_PROFILES.cli` to the config `features/regression/step_definitions/feature-820.steps.ts` builds for "the review phase completes with no blocker issues for that configuration", so that `feature-848.feature` keeps running the real review phase.

### 5. Remove the review-proof configuration (`adws/core/projectConfig.ts`)
- Delete `ReviewTagEntry`, `SupplementaryCheck`, `ReviewProofConfig`, `getDefaultReviewProofConfig`, `isSeparatorRow`, `parseMarkdownTableRows`, `parseTagsTable`, `parseSupplementaryChecksTable` and `parseReviewProofMd`. The table helpers have no other caller.
- Remove `reviewProofMd` and `reviewProofConfig` from `ProjectConfig`, `getDefaultProjectConfig()` and `loadProjectConfig()`, and the read of the file.
- The removals alone leave the file at about 313 lines. Bring it under 300 by consolidating `loadProjectConfig`'s five try/catch reads into one helper. The behaviour is unchanged, because every parser already returns its defaults for `''`:
  ```ts
  /** The file's text, or '' when it is absent or unreadable: each parser turns '' into its defaults. */
  function readAdwFile(adwDir: string, fileName: string): string {
    try {
      return fs.readFileSync(path.join(adwDir, fileName), 'utf-8');
    } catch {
      return '';
    }
  }
  ```
  `loadProjectConfig` then reads `project.md`, `conditional_docs.md` and `scenarios.md` into locals and returns `commands: parseCommandsMd(readAdwFile(adwDir, 'commands.md'))`, `providers: parseProvidersMd(readAdwFile(adwDir, 'providers.md'))`, `scenarios: parseScenariosMd(scenariosMd)` and the rest as today.
- Add a case to `adws/core/__tests__/projectConfigLoad.test.ts`: an `.adw/` directory that holds no file loads `getDefaultCommandsConfig()`, `getDefaultProvidersConfig()`, `getDefaultScenariosConfig()`, empty `projectMd`/`conditionalDocsMd`/`scenariosMd`, `hasAdwDir: true` and `applicationType: null`. Run the existing `projectConfig*.test.ts` files to confirm the consolidation changes nothing.
- In `adws/phases/__tests__/scenarioTestPhase.helpers.ts`, remove `reviewProofMd` and `reviewProofConfig` from the fixture's `projectConfig`.
- In `adws/phases/__tests__/scenarioTestPhase.runner.test.ts`, delete the case "hands the run no tag configuration, because the tags are fixed". `ProjectConfig` no longer holds a tag configuration that could be handed over, and `fixedScenarioTags` is covered by `adws/proof/__tests__/proofAssembler*.test.ts`.

### 6. Rewrite `.claude/commands/review.md`
Keep the `target: false` front matter, the JSON report schema (`success`, `reviewSummary`, `reviewIssues`, `screenshots`; `reviewResultSchema` in `reviewAgent.ts` is unchanged), the current Step 3 (coding guidelines) text as Step 7 and the current Step 4 (step-definition independence) text as Step 5, both verbatim. Never write a branch name (`lint:branch-names`): keep `origin/<default>`. Target content (the wording may be tightened; the headings, variables, quoted lines and rules are what `reviewPrompt.test.ts` pins):

````md
---
target: false
---
# Review

Judge the change on this branch against its issue and the evidence ADW collected. You run nothing: before calling you, ADW ran the type check, lint, build, unit tests and scenarios itself, and it reaches the review only when they are green. You read, and you judge what a machine cannot.

## Variables

adwId: $0
specFile: $1
agentName: $2 if provided, otherwise use 'reviewAgent'
scenarioProofPath: $3 — the scenario proof ADW wrote; empty when the repository runs no scenarios
guidanceSection: $4 — the title of the one section under `## Guidance by application type` that applies to this repository
issueKind: $5 — `feature`, `bug`, `chore`, `promotion` (an issue that moves an existing scenario into the regression suite) or `pr_review` (a revision of an open pull request)
perIssueImages: $6 — a JSON array of the absolute paths of the per-issue scenario images ADW selected as the evidence of this change; `[]` when there are none

## Rules

- Run no command that checks code: no type checker, linter, build, test runner, scenario runner, package script, dev server or browser. The only commands you run are the read-only `git` commands of Step 1.
- Never raise a blocker about a test, lint, type or build result, and do not report such results at all: ADW's gates decided them before the review. A pass or fail status in the scenario proof is not a finding.
- Judge only what Steps 2 to 8 ask.

## Step 1: Gather Context

- Retrieve the default branch: the branch on the `HEAD branch:` line of `git remote show origin`
- Check current branch: `git branch`
- View all changes: `git diff origin/<default>`; the changed files: `git diff origin/<default> --name-only`
- Read the spec file at `specFile`. Its `## Metadata` holds the issue as JSON (`issueJson`): the issue's title and body are the requirement, and its number gives the per-issue tag `@adw-{issueNumber}`. The rest of the spec is how the builder meant to meet the issue; where the spec and the issue disagree, the issue decides.
- If `scenarioProofPath` is not empty, read the scenario proof. It has a section for `@regression` and one for `@adw-{issueNumber}`, and, where the repository's application type expects images, a `## Evidence` section.

## Step 2: The Diff Does What the Issue Asks, No More and No Less

- Check every requirement and acceptance criterion of the issue against the diff. A requirement the diff does not meet is a `blocker` that names the requirement and what is missing.
- A change the issue does not ask for and its implementation does not need (a behaviour change, a feature, a removal, a rewrite of unrelated code) is a `blocker` that names the change and says to take it out. An incidental change that alters no behaviour is at most `skippable`.

## Step 3: Suppressions and Weakened Checks

- A comment the diff adds that suppresses a check is a `blocker`, whatever reason comes with it: `eslint-disable`, `@ts-ignore`, `@ts-expect-error`, `@ts-nocheck`, `biome-ignore`, `# noqa`, `# type: ignore`, `# pylint: disable`, `//nolint`, `#[allow(`, `# rubocop:disable`, a pattern listed under `## Suppression Patterns` in `.adw/commands.md`, or the equivalent for any other tool. A suppression the diff did not add is not a finding.
- A change to lint, compiler or build configuration (`eslint.config.*`, `.eslintrc*`, `tsconfig*.json`, the scripts of `package.json`, `pyproject.toml`, `setup.cfg`, `.golangci.*`, `Cargo.toml` and the like) or to the check commands in `.adw/commands.md` that weakens a check is a `blocker`: a rule turned off or down, files excluded from a check, a compiler option loosened, a check command removed or set to `N/A`. A configuration change that weakens no check is judged as in Step 2.
- `issueResolution`: remove the suppression or restore the configuration, and fix the code the check reports instead.

## Step 4: The Scenarios Test the Issue

Skip this step when `scenarioProofPath` is empty.

- When the `@adw-{issueNumber}` section of the proof says `no per-issue scenarios`, decide by `issueKind` alone:
  - `feature` or `bug`: a `blocker`, because no scenario tests the behaviour the issue asks for. `issueResolution`: add scenarios tagged `@adw-{issueNumber}` that test it.
  - `chore`, `promotion` or `pr_review`: no finding. Such an issue needs no scenarios of its own.
- Otherwise read every `.feature` file that holds a scenario tagged `@adw-{issueNumber}` and judge the scenarios against the issue:
  - Every behaviour the issue asks for is exercised by a scenario, through what a user or a calling process sees, and asserted by a step that fails when the behaviour is missing.
  - The scenarios describe behaviour in the issue's terms. A scenario written around the implementation (its internal names, private state or code structure) instead of what the system does is not independent of it.
  - A scenario that would still pass with the change reverted tests nothing.
- Each such problem is a `blocker` that names the scenario and the requirement it fails to test.

## Step 5: Step Definition Independence Check

<the current Step 4 text, verbatim>

## Step 6: The Evidence

- If `perIssueImages` names images, open every one with the Read tool before you judge it, and judge no image you have not opened. The proof's `## Evidence` section names the scenario that took each image. Judge whether each image shows what the issue asked for: the page and state the scenario should end on, with the change visible. An image that does not show the change (another page, an error, a blank or loading state, the change missing or wrong) is a `blocker` that names the image and its scenario and says what the scenario must end on.
- If the `## Evidence` section says `no scenario opened a page` and the `@adw-{issueNumber}` section does not say `no per-issue scenarios`, judge from the diff whether the change alters anything a user can see. If it does, that is a `blocker`, because no image shows it. `issueResolution`: a per-issue scenario must open the page that shows the change.
- A proof without a `## Evidence` section belongs to a repository whose application type expects no images: there is nothing to open.

## Step 7: Coding Guidelines Check

<the current Step 3 text, verbatim>

## Step 8: Guidance for the Application Type

Apply the section under `## Guidance by application type` whose title is `guidanceSection`, and only that one. If `guidanceSection` names no section there, apply none and say so in `reviewSummary`.

## Guidance by application type

### CLI applications

- There is no page and no image. The evidence is the diff, the issue and the scenarios: never ask for a screenshot, a running application or a browser.
- What a user of a CLI or automation tool sees is its commands and flags, what it prints, its exit codes, and the files, state and calls it writes. A change to any of these that the issue does not ask for is out of scope (Step 2); a change it does ask for needs a scenario that observes it (Step 4).
- A scenario drives the tool the way its user or a calling process does (a command, an exported entry point, a file the tool reads) and asserts what that user can observe.

### Web applications

- The per-issue images are the visual evidence. Open each one (Step 6) and look at it as a user looks at the page: is the change there, in the place and state the issue describes, with the content and layout it asks for.
- A per-issue scenario about something a user sees must open the page that shows it. A scenario that only calls the HTTP API tests the server, not the page.
- Changes a user can see include markup, components, templates, styles, copy, client-side behaviour, routes and navigation. A change confined to the server (API handlers, data access, background jobs, configuration) needs no image.
- Do not start the application or a browser: the images are the view of the page you judge.

## Issue Severity Reference

<as today>

## Report

CRITICAL: Return ONLY a JSON object. No additional text or markdown --- `JSON.parse()` runs directly on your output.

- `success`: `true` if no `blocker` issues (can have skippable/tech-debt), `false` if any blockers exist
- `reviewSummary`: a short paragraph: what the change does and whether it does what the issue asks; when `perIssueImages` names images, what each one shows, by the scenario that took it
- `reviewIssues`: all issues found, any severity
- `screenshots`: the absolute path of every image of `perIssueImages` you opened, and `scenarioProofPath` when it is not empty, regardless of success status

<the Output Structure JSON example as today>

The `remediationStrategy` field is optional. When `issueSeverity` is `"blocker"` and the issue is a coding-guideline violation (Step 7), set `remediationStrategy: "refactor"`. When it is a step-definition independence violation (Step 5), set `remediationStrategy: "patch"`. For all other blockers, omit the field or set `remediationStrategy: "patch"`. Any blocker, including one from Step 5 or Step 7, makes `success` `false`.
````

### 7. Pin the prompt (`adws/__tests__/reviewPrompt.test.ts`)
A vitest source-text test in the style of `generateStepDefinitionsPrompt.test.ts`, whose doc comment says why: `review.md` is a prompt and cannot import the values ADW passes it, so these tests compare it with their sources. Reuse a `section(heading)` helper. Cases:
- **Runs no command that checks code.**
  - It contains none of the check commands of ADW's own `.adw/commands.md` (`parseCommandsMd` of the file: `typeCheck`, `additionalTypeChecks`, `runLinter`, `runBuild`, `runTests`, `runScenariosByTag`, `runRegressionScenarios`, `startDevServer`) nor of `getDefaultCommandsConfig()`. Skip `N/A` and empty values.
  - It contains none of the `.adw/commands.md` check headings as references (`## Type Check`, `## Additional Type Checks`, `## Run Linter`, `## Run Build`, `## Run Tests`, `## Run Scenarios by Tag`, `## Run Regression Scenarios`, `## Start Dev Server`, `## Prepare App`, `## Run E2E Tests`).
  - It matches none of these runner invocations: `/\b(?:bunx|npx|pnpm|yarn)\s/`, `/\b(?:bun|npm)\s+(?:run|test|x)\b/`, `/\btsc\b/` (this leaves `tsconfig` alone), `/\beslint\s/` (this leaves `eslint-disable` and `eslint.config.*` alone), `/\bcucumber-js\b/`, `/\bplaywright\s+test\b/`, `/\bbddgen\b/`, `/\bvitest\b/`, `/\bjest\b/`, `/\bpytest\b/`, `/\bgo\s+(?:test|vet|build)\b/`, `/\bcargo\s+(?:test|build|check|clippy)\b/`.
  - `## Rules` says to run no command that checks code and never to raise a blocker about a test, lint, type or build result.
- **No strategies and no per-repository proof file**: no `Strategy A`/`Strategy B`. Every `.adw/<file>` the prompt names is one of `coding_guidelines.md`, `commands.md`, `scenarios.md`. Do not write the deleted file's name in the test.
- **Arguments**: `## Variables` documents `$0` to `$6`, and their number equals `formatReviewArgs('a', 'b', 'c', undefined, context).length`.
- **Issue kinds**: every `ReviewIssueKind` value appears backticked. Step 4 names `feature` and `bug` as blockers and `chore`, `promotion`, `pr_review` as no finding when the proof says `no per-issue scenarios`.
- **Proof lines**: the prompt quotes `NO_PER_ISSUE_SCENARIOS` and `NO_SCENARIO_OPENED_A_PAGE` verbatim (import them from `adws/proof/proofDocument.ts`).
- **Images**: Step 6 tells the reviewer to open every image of `perIssueImages` with the Read tool, and `## Report`'s `screenshots` line names `perIssueImages`.
- **Per-type guidance**: `## Guidance by application type` has exactly one `###` section per `reviewGuidanceSection` of `APPLICATION_TYPE_PROFILES` and no other; Step 8 refers to `guidanceSection`.
- **Suppression**: Step 3 calls a suppression the diff adds a `blocker`, and names at least one pattern of every language of `FRAMEWORK_SUPPRESSION_PATTERNS`. It also names weakened lint, compiler or build configuration.
- **The independence check stays**: a `Step Definition Independence Check` heading with its four rules (**Observable behaviour through a public interface.**, **The assertion can fail.**, **Expectations come from the scenario.**, **No accommodation.**).

### 8. Delete `review_proof.md` and rewrite the tests that named it
- `git rm .adw/review_proof.md test/fixtures/cli-tool/.adw/review_proof.md test/fixtures/python-flat/.adw/review_proof.md test/fixtures/python-app/.adw/review_proof.md`.
- `adws/__tests__/adwInitPrompt.test.ts`:
  - Replace "no longer creates .adw/review_proof.md" with "names no `.adw/` file but those `adw_init` writes": every `.adw/<name>.md` the prompt names is in `[...REQUIRED_ADW_FILES, 'coding_guidelines.md']` (import `REQUIRED_ADW_FILES` from `../phases/worktreeSetup`).
  - Rename "reports the Playwright project in step 11, and no longer reports review_proof.md" to "reports the Playwright project in step 11" and drop its `not.toContain` line.
- `adws/phases/__tests__/worktreeSetup.test.ts`:
  - Retitle the `verifyAdwRegen` case to "a worktree whose .adw/ holds exactly the files /adw_init writes → ok:true".
  - Replace "does not list review_proof.md …" with "lists exactly the five files /adw_init writes": `expect(REQUIRED_ADW_FILES).toEqual(['commands.md', 'project.md', 'conditional_docs.md', 'providers.md', 'scenarios.md'])`.
- Confirm with `grep -rnE "review_proof|parseReviewProofMd|supplementaryChecks|reviewProofConfig|ReviewProofConfig|reviewProofMd" adws/ .claude/ .adw/` that nothing remains. `formatReviewProofComment` is a different name and stays.

### 9. Green gates before review in `adwPlanBuildReview` (`adws/adwPlanBuildReview.tsx`)
- Extend `adws/__tests__/adwPlanBuildReview.test.ts` first. Add `executeStepDefPhase` and `runScenarioTestFixLoop` (resolving `{ scenarioProofPath: PROOF_PATH, scenarioRetries: SCENARIO_RETRIES }`) to `makePhases`. Then add a `describe('executePlanBuildReview — green gates precede the review')` with:
  - The review starts only once the loop has returned. Make `runScenarioTestFixLoop` return a promise the test resolves later, start the run, wait until the loop was called, assert `executeReviewPhase` was not called, resolve the loop, await the run, and assert one review.
  - The loop runs after the unit-test phase and before the first review (`invocationCallOrder`). The step-definition phase runs after the build and before the unit-test phase, as the phase named `stepDef` (`runPhase` called with `executeStepDefPhase, 'stepDef'`).
  - The first review receives the loop's proof (`executeReviewPhase`'s second argument is `PROOF_PATH`).
  - No scenario test of its own runs before the first review: `executeScenarioTestPhase` is not called when the first review passes, and is called once, after the patch, when the first review fails and the second passes.
  - When the loop fails (rejects with an error), no review runs, no pull request opens, and `awaiting_merge` is never written. The error reaches `handleWorkflowError`, which the test's mock rethrows.
  - The orchestrator metadata records `scenarioRetries` on both the passing and the `review_failed` path.
- Implement, mirroring `adwPlanBuildTestReview.tsx`:
  - Import `executeStepDefPhase` and `runScenarioTestFixLoop` from `./workflowPhases`, and add both to `PlanBuildReviewPhases` and `PLAN_BUILD_REVIEW_PHASES`.
  - After the build: `await runPhase(config, tracker, phases.executeStepDefPhase, 'stepDef');`. After the unit-test phase: `const { scenarioProofPath, scenarioRetries } = await phases.runScenarioTestFixLoop(config, tracker);` and `let proofPath = scenarioProofPath;`. Delete the standalone `executeScenarioTestPhase` call before the loop. Keep `executeScenarioTestPhase` inside the review loop for the re-test after a patch.
  - Add `scenarioRetries` to both `writeState` metadata objects.
  - Add `MAX_TEST_RETRY_ATTEMPTS: Maximum retry attempts for tests (default: 5)` to the header's environment list.
- Check: every orchestrator that calls `executeReviewPhase` also calls `runScenarioTestFixLoop` (`grep -l "executeReviewPhase" adws/adw*.tsx | xargs grep -L "runScenarioTestFixLoop"` prints nothing).

### 10. Documentation
- `README.md`:
  - Rewrite the "Multi-agent passive review with blocking gate" bullet. The reviewer runs nothing and is reached only when static checks, unit tests and scenarios are green. It judges the diff against the issue (no more, no less), whether the per-issue scenarios test the issue independently of the implementation, the per-issue images of a `web` repository (which it opens) or their absence, the coding guidelines and the guidance section for the repository's application type. A suppression comment or weakened check configuration is a blocker. Keep the existing text about Blockers, Tech Debt, `patchAgent`/`refactorAgent` and `review_failed`.
  - "Adaptable target repos": drop the `review_proof.md` clause and "review proof rules".
  - The `adw_init` paragraph: replace "`adw_init` no longer writes `.adw/review_proof.md`." with a sentence saying ADW no longer reads that file and a repository that still has one can delete it.
  - The project-structure tree: remove the `review_proof.md` line under `.adw/`.
- `adws/README.md`, section `adwPlanBuildReview.tsx`: describe the pipeline as plan, build, step definitions, unit tests with the static checks, the scenario test-and-fix loop, review and PR. Say the review is reached only when those gates are green, and drop "skipping tests" and "without test verification". The file is scanned by `lint:branch-names`: write no branch name.
- `UBIQUITOUS_LANGUAGE.md`:
  - **Review**: a Phase where the Review Agent judges the change against the issue and its evidence, running nothing.
  - **Scenario Proof**: the proof document the scenario test phase writes from the `@regression` and `@adw-{issueNumber}` runs, which the Review Agent reads.
  - Delete the **Review Proof Config** row.
- Leave `app_docs/` and `.adw/conditional_docs.md` to the document phase (see Notes).

### 11. Records
- `specs/adr/0058-static-checks-in-the-test-phase-reviewer-runs-nothing.md`: rewrite `### Confirmation`. Keep it an h3 in place and touch neither the decision, the drivers nor the front matter. Start with "Implemented. Checked on <date> in the working tree on top of `<sha>`:", keep the four existing bullets (check runner, unit-test phase, `test.md`, the only TypeScript reader), delete the paragraph that says the PRD still carries the rest, and add bullets that name:
  - **The reviewer runs nothing.** `.claude/commands/review.md` has no Strategy A or B and no command that checks code. The check: `grep -nE "Strategy [AB]|tsc --noEmit|bun run|bunx |npx |npm (run|test)|cucumber-js|playwright test|bddgen|vitest|pytest" .claude/commands/review.md` returns nothing, and `adws/__tests__/reviewPrompt.test.ts` asserts the prompt holds none of the check commands of ADW's own `.adw/commands.md` or of the defaults, no `.adw/commands.md` check heading and no runner invocation.
  - **What it judges.** Scope (no more, no less); suppressions and weakened configuration, a blocker; the per-issue scenarios and the step-definition independence check; the images, opened with the Read tool and listed in `screenshots`, or the `no scenario opened a page` rule; the `no per-issue scenarios` rule by issue kind (a blocker for `feature` and `bug`; none for `chore`, `promotion`, `pr_review`, which is the promotion path's rule ADR-0058's consequences ask for); the coding guidelines; the per-type section. Never a blocker about a test, lint, type or build result. Name the `reviewPrompt.test.ts` cases that pin each.
  - **Per-type guidance and the hand-off.** `## Guidance by application type` holds one section per `reviewGuidanceSection` of `APPLICATION_TYPE_PROFILES`. `buildReviewPromptContext` (`adws/phases/reviewPromptContext.ts`) and `formatReviewArgs` (`adws/agents/reviewPromptArgs.ts`) pass the section title, the issue kind and `ScenarioProofResult.perIssueImages` as `$4`–`$6`; the review phase records them in the orchestrator log, and the agent's saved prompt (`prompts/review.txt` in its state directory) and `review-agent.jsonl` show the images and the `Read` calls. Unit tests: `reviewPromptArgs.test.ts`, `reviewPromptContext.test.ts`, `reviewPhaseEvidence.test.ts`.
  - **`review_proof.md` is gone.** `.adw/review_proof.md` and the fixtures' copies are deleted, `projectConfig.ts` neither reads the file nor parses `## Tags` or `## Supplementary Checks`, and `REQUIRED_ADW_FILES` lists exactly the five files (`worktreeSetup.test.ts`). The check: `grep -rnE "review_proof|parseReviewProofMd|supplementaryChecks|reviewProofConfig|ReviewProofConfig|reviewProofMd" adws/ .claude/ .adw/` returns nothing.
  - **Green gates in every orchestrator that reviews.** `grep -l "executeReviewPhase" adws/adw*.tsx | xargs grep -L "runScenarioTestFixLoop"` prints nothing. `adwPlanBuildReview` runs `executeStepDefPhase` and `runScenarioTestFixLoop` before its first review, and `adws/__tests__/adwPlanBuildReview.test.ts` shows with injected phases that the review starts only after the loop returns, receives its proof, and never runs when the loop fails.
  - **Scenarios**: `features/per-issue/feature-995.feature` (`@adw-995`), if the scenario writer produced it.
- `specs/adr/0059-fix-loops-no-progress-stop-and-suppression-guard.md`: replace the "Still open: the reviewer treating a suppression …" paragraph with a bullet. The rule is in place: `grep -n -i "suppress" .claude/commands/review.md` finds it, and `reviewPrompt.test.ts` asserts it names a framework pattern of every language. Change the opening to "Implemented. Checked on 2026-10-04 in the working tree on top of `19de14fc`, and the reviewer's rule on <date> on top of `<sha>`:".
- `specs/adr/0061-application-type-decides-evidence-web-repos-run-playwright-bdd.md`: in "Still open", replace "The review prompt's per-type guidance sections." with a pointer to ADR-0058's Confirmation. With both items done, turn the list into bullets and change the opening to "Implemented. Checked on 2026-10-06 in the working tree on top of `c3601f68`, and the review prompt's guidance sections on <date> on top of `<sha>`:". Change nothing else.
- `specs/adr/0063-per-issue-scenario-images-are-the-visual-evidence.md`: replace "Still open, carried by …: the review prompt that opens the images and judges them (the reviewer issue)." with a bullet. The reviewer receives the selected images as `$6` and must open each with the Read tool and list it in `screenshots`; see ADR-0058's Confirmation.

### 12. Scenarios for this issue
- If `features/per-issue/feature-995.feature` exists when the build starts, write its step definitions in `features/per-issue/step_definitions/` against the surfaces this plan exposes. Do not edit the `.feature` file.
  - The real `executeReviewPhase` with the stand-in Claude CLI (as `feature-994-workflow.ts` does): its saved prompt `prompts/review.txt` in the review agent's state directory carries `$4`–`$6`, and the orchestrator log records the hand-off.
  - `executePlanBuildReview` with injected phases (as `feature-927-run.ts` does).
  - The scenario proof's lines.
  - Register phrases in `features/regression/vocabulary.md` only if the scenarios are `@regression`.

### 13. Run the validation commands
Run every command in `Validation Commands` and fix any failure before finishing.

## Testing Strategy
### Unit Tests
- `adws/agents/__tests__/reviewPromptArgs.test.ts`: seven positions; `$3` `''` when there is no proof; `$6` a JSON array in order, `[]` when empty, and a path with a space or quote kept intact; the enum values.
- `adws/phases/__tests__/reviewPromptContext.test.ts`: the issue kind by type and label (promotion label wins; `/adw_init` → `chore`); the guidance section from the `cli`, `web` and a fake third profile; image paths from the proof in order, `[]` without a proof or images; a missing profile throws; the log description.
- `adws/phases/__tests__/reviewPhaseEvidence.test.ts`: the phase hands the reviewer the same images it uploads for the attempt's comment, the profile's section, the issue kind and the proof path, and logs the hand-off; a re-test's new images replace the old.
- `adws/__tests__/reviewPrompt.test.ts`: the source-text checks of Step 7.
- `adws/__tests__/adwPlanBuildReview.test.ts`: green gates precede the review (loop then review; deferred loop; proof handed over; no standalone scenario test; loop failure stops the run; `stepDef` order; `scenarioRetries` in the metadata). The existing review-loop, `review_failed` and baseline cases keep passing.
- `adws/__tests__/adwInitPrompt.test.ts`, `adws/phases/__tests__/worktreeSetup.test.ts`: the positive `.adw/` file-set assertions.
- `adws/core/__tests__/projectConfigLoad.test.ts`: the empty-`.adw/` defaults case guards the `loadProjectConfig` consolidation. The existing `projectConfig*.test.ts` files keep passing.
- `adws/phases/__tests__/reviewPhaseScreenshots.test.ts`, `reviewPhaseApprovalGate.test.ts`, `scenarioTestPhase.runner.test.ts`: unchanged assertions on updated fixtures.
- `adws/core/__tests__/applicationType.test.ts`: still passes with the new modules, which read the profile and never name `applicationType`.

### Edge Cases
- A repository with no scenarios configured: no proof, `$3` is `''`, `$6` is `[]`; Steps 4 and 6 are skipped, and the reviewer judges scope, suppressions, independence of any changed step definitions, guidelines and the type section.
- A `cli` repository: the proof has no `## Evidence` section, `$6` is `[]`, guidance `CLI applications`.
- A `web` issue with selected images: the reviewer gets them in the assembler's order, and they are exactly the images the issue comment of the same attempt shows.
- A `web` issue whose per-issue scenarios ran and none took the page: the proof says `no scenario opened a page`, and a diff that changes what a user sees is a blocker.
- A `web` issue with no per-issue scenarios: both lines appear and the issue-kind rule decides alone (a feature or bug is blocked; a chore, promotion or `pr_review` is not).
- A promotion issue (`/feature` + `regression-promotion`): kind `promotion`, so no blocker for missing per-issue scenarios.
- An `adwPrReview` run: `issueType` `/pr_review`, the issue stub has no labels, kind `pr_review`.
- An image path with a space or a single quote: one JSON argument, escaped by the launcher.
- A review retry: the re-test replaces `ctx.scenarioProof`, and the next attempt hands over only the new images.
- `adwPlanBuildReview` whose loop exhausts its budget or parks: no review, no PR, no `awaiting_merge`.
- A suppression already in the code before the change: not a finding. A configuration change that weakens no check: judged for scope only.
- A target repository that still holds `.adw/review_proof.md`: ignored, since nothing reads it.
- A test or BDD config without `applicationProfile`: `requireApplicationProfile` throws, by design.
- Image paths and the worktree path-rewrite hook: in a target repository the images live under ADW's own `agents/<adwId>/scenario-test/artifacts/`, outside the target's main checkout, so `.claude/hooks/pre-tool-use.ts` does not rewrite them. ADW's own repository is `cli` and gets no images.

## Acceptance Criteria
- `.claude/commands/review.md` has no Strategy A or B and no command that checks code. `adws/__tests__/reviewPrompt.test.ts` asserts it, and `grep -nE "Strategy [AB]|tsc --noEmit|bun run|bunx |npx |npm (run|test)|cucumber-js|playwright test|bddgen|vitest|pytest" .claude/commands/review.md` returns nothing.
- The prompt judges exactly: scope (no more, no less); suppressions and weakened lint, compiler or build configuration (a blocker); the per-issue scenarios and the unchanged step-definition independence check; the images or the `no scenario opened a page` rule; the `no per-issue scenarios` rule by issue kind; the coding guidelines; the per-type section. It never raises a blocker about a test, lint, type or build result.
- `## Guidance by application type` has one section per type in `APPLICATION_TYPE_PROFILES`, and there is no per-repository guidance file.
- The review phase passes the selected image paths, the guidance section title and the issue kind; the prompt requires opening every image with the Read tool and listing it in `screenshots`; the hand-off is in the orchestrator log and the agent's saved prompt.
- `grep -rnE "review_proof|parseReviewProofMd|supplementaryChecks|reviewProofConfig|ReviewProofConfig|reviewProofMd" adws/ .claude/ .adw/` returns nothing; `.adw/review_proof.md` and the fixtures' copies no longer exist; `REQUIRED_ADW_FILES` lists exactly the five files.
- `adwPlanBuildReview` runs the step-definition phase and `runScenarioTestFixLoop` before its first review, and `adws/__tests__/adwPlanBuildReview.test.ts` shows with injected phases that the review starts only after the loop has returned green and never when it fails. Every orchestrator that reviews runs the loop.
- ADR-0058's `### Confirmation` names the implemented checks; the matching "still open" items of ADR-0059, ADR-0061 and ADR-0063 point to it.
- `adws/core/projectConfig.ts` and `adws/phases/reviewPhase.ts` are under 300 lines.
- All validation commands pass.

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `bun run lint` — lint, including the new modules and tests.
- `bunx tsc --noEmit` — root type check; it covers `features/**/*.ts`, so it checks `feature-929-agents.ts` and `feature-820.steps.ts` too.
- `bunx tsc --noEmit -p adws/tsconfig.json` — additional type check of `adws/`.
- `bun run build` — build.
- `bun run test:unit` — the whole Vitest suite, including `applicationType.test.ts`'s rule on naming the type.
- `bunx vitest run adws/__tests__/reviewPrompt.test.ts adws/__tests__/adwPlanBuildReview.test.ts adws/__tests__/adwInitPrompt.test.ts adws/agents/__tests__/reviewPromptArgs.test.ts adws/phases/__tests__/reviewPromptContext.test.ts adws/phases/__tests__/reviewPhaseEvidence.test.ts adws/phases/__tests__/reviewPhaseScreenshots.test.ts adws/phases/__tests__/reviewPhaseApprovalGate.test.ts adws/phases/__tests__/worktreeSetup.test.ts adws/phases/__tests__/scenarioTestPhase.runner.test.ts adws/core/__tests__/projectConfigLoad.test.ts adws/core/__tests__/projectConfig.test.ts adws/core/__tests__/projectConfigCommands.test.ts` — this feature's own tests and its closest neighbours, in isolation.
- `bun run lint:branch-names` — `review.md` and `adws/README.md` name no branch.
- `bun run lint:git-guard` — no raw `git`/`gh` in the new code.
- `bun run lint:model-literals` — no model literal in the new code.
- `bun run lint:docs-index` — the docs index stays healthy.
- `! grep -rnE "review_proof|parseReviewProofMd|supplementaryChecks|reviewProofConfig|ReviewProofConfig|reviewProofMd" adws/ .claude/ .adw/` — nothing of the removed configuration remains.
- `! grep -nE "Strategy [AB]|tsc --noEmit|bun run|bunx |npx |npm (run|test)|cucumber-js|playwright test|bddgen|vitest|pytest" .claude/commands/review.md` — the prompt runs nothing.
- `test -z "$(grep -l executeReviewPhase adws/adw*.tsx | xargs grep -L runScenarioTestFixLoop)"` — every reviewing orchestrator runs the loop.
- `test ! -e .adw/review_proof.md && test ! -e test/fixtures/cli-tool/.adw/review_proof.md && test ! -e test/fixtures/python-flat/.adw/review_proof.md && test ! -e test/fixtures/python-app/.adw/review_proof.md` — the files are gone.
- `test "$(wc -l < adws/core/projectConfig.ts)" -lt 300 && test "$(wc -l < adws/phases/reviewPhase.ts)" -lt 300` — both changed files stay under the guideline's limit.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-995"` — this issue's scenarios.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-994"` — the review phase with the stand-in agent still reviews `web` and `cli` proofs and publishes exactly the selected images.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-937"` — the review comment's screenshots through the real review phase.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — the regression suite, including the surface rows that run the real review phase under `adwSdlc` and `adwChore`.

## Notes
- Strictly follow `.adw/coding_guidelines.md`: guard clauses, nesting depth ≤ 2, enums for the issue kinds, pure builders with side effects (logging) at the phase boundary, files under 300 lines, comments only for what the code cannot say (why `$3` is `''`, why `$6` is JSON, why a promotion label overrides the type), and no issue numbers in comments.
- No new library is needed.
- `README.md` has an uncommitted change in the working tree (the `adws/proof/` structure listing) that this plan did not make. Leave it in place and edit around it.
- The positional order of `runReviewAgent` changes (the context is the third parameter), following `runStepDefAgent`'s `runnerMode`. `reviewPhase.ts` and `features/per-issue/step_definitions/feature-929-agents.ts` are the only callers.
- AC "opens them (visible in the review log)": the review phase logs the hand-off, the agent's saved prompt holds the paths, and its JSONL output (`review-agent.jsonl` in the logs directory) holds the `Read` tool calls. If a real Claude session is available, one run of `/review` against a scratch `web` worktree with one selected image can confirm both: a `Read` of the image in `review-agent.jsonl`, and the path in the output's `screenshots`. Record the result in ADR-0058's Confirmation; if it is not run, say so there instead of claiming it.
- Optional spot checks for the two touched step-definition files: `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-929"` and `--tags "@adw-848"`. They are per-issue suites of earlier issues and may carry unrelated drift.
- Living docs, updated by the document phase: `app_docs/feature-9gjajh-review-and-diff-phases.md` (drop the Strategy B fall-through; describe the hand-off), `feature-9gjajh-review-and-patch-agents.md` (`runReviewAgent`'s context, `reviewPromptArgs.ts`), `feature-9gjajh-sdlc-orchestrators.md` (`adwPlanBuildReview` runs `stepDef` and the loop), `feature-9gjajh-state-and-config.md` (no `review_proof.md`; `readAdwFile`), `feature-9gjajh-commands-and-skills.md` (`review.md` and `reviewPrompt.test.ts`), `feature-gfv9kt-application-type-mapping.md` (the review prompt builder as a consumer of the mapping). The document phase may also add the new modules to `Owns:` in `.adw/conditional_docs.md` and add ADR-0058 to the review docs' decisions.
- Possible follow-ups, out of scope:
  - `specs/adr/README.md`'s introduction still says records 0058–0063 are not yet implemented.
  - `adwPlanBuildReview` publishes no proof comment on its pull request, unlike `adwPlanBuildTestReview` and `adwSdlc` (ADR-0063 wants the images "onto the pull request").
  - ADW could check mechanically that the reviewer opened every image it was given, by reading the `Read` calls in the agent's JSONL. Today that is a prompt instruction, not a gate.

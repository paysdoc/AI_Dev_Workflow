# Feature: The application type decides the evidence; `adw_init` writes it; a missing type parks the issue

## Metadata
issueNumber: `991`
adwId: `gfv9kt-feat-the-application`
issueJson: `{"number":991,"title":"feat: the application type decides the evidence; adw_init writes it; a missing type parks the issue","body":"Source: `specs/prd/review-proof-redesign.md` and the ADR named below, in `specs/adr/`. The PRD section **Implementation Decisions** describes the module; the ADR holds the decision and its reasons. Read both before planning; they are the specification. Do not change the decisions.\n\n## Decision record\n\nADR-0061 (application type, mapping, no default). PRD module: **Application-type mapping**, part of **`adw_init` changes**.\n\n## What to build\n\n- An **application-type mapping** (pure): type → `{ runnerMode, evidenceKinds, reviewGuidanceSection }`. `cli` → the descriptor runner from `.adw/scenarios.md`, no images. `web` → the ADW Playwright project (next issue), per-issue images. Missing or unknown → park. Every consumer reads the mapping, never the type itself, so a third type touches no phase.\n- `.claude/commands/adw_init.md` detects the application type and writes `## Application Type` to `.adw/project.md`. No default is written when detection cannot decide; the section is left out and the next run parks with the `missing_application_type` comment (\"re-run `adw_init`\").\n- The already-parsed `applicationType` in `adws/core/projectConfig.ts` loses its default of `cli`; absent means absent.\n- Already-initialised repositories are not migrated; they park until `adw_init` is re-run. ADW's own repository already carries `cli`.\n\n## Acceptance criteria\n\n- [ ] An issue in a repository without `## Application Type` parks with the comment described; one with `cli` or `web` proceeds.\n- [ ] `adw_init` writes the section in a fresh repository of each type.\n- [ ] Unit tests: both types map correctly; unknown and missing park; a fake third type reaches a consumer through the mapping without a consumer change.\n- [ ] The `### Confirmation` section of ADR-0061 names the implemented check for the parts this issue delivers.\n\n## Blocked by\n\n#989\n","state":"OPEN","author":"paysdoc","labels":["adw:feature"],"createdAt":"2026-10-03T23:13:13Z","comments":[],"actionableComment":null}`

## Feature Description
ADR-0061 makes `## Application Type` in `.adw/project.md` the only input that decides what evidence a review needs. A framework-owned mapping turns the type into a scenario runner mode, evidence kinds and a review-guidance section. There is no default: a missing or unknown type parks the issue. This issue delivers the parts of that decision that every later PRD module builds on:

1. **Application-type mapping** (pure, `adws/core/applicationType.ts`). It maps a type to `{ runnerMode, evidenceKinds, reviewGuidanceSection }`:
   - `cli` → the descriptor runner named in `.adw/scenarios.md`, no images;
   - `web` → the ADW-owned Playwright project in `features/` (built by the next issue), per-issue images;
   - missing or unknown → unknown, which the caller turns into a park.

   The table is the only place a type name means anything. Consumers receive the resolved profile, never the type, so a third type is one new table entry (plus `adw_init` learning to detect it) and touches no phase.
2. **No default in the config.** `projectConfig.applicationType` becomes what the section says, or `null` when it is absent. The `cli` fallback in `parseApplicationType` and `getDefaultProjectConfig` is removed.
3. **Application-type gate** (`adws/phases/applicationTypeGate.ts`). `initializeWorkflow` (every issue orchestrator) and `initializePRReviewWorkflow` run it right after loading the project config:
   - a `cli` or `web` type proceeds, and its profile is put on `WorkflowConfig.applicationProfile` for the consumers the next issues add;
   - a missing or unknown type parks the workflow as `human_gated` through #989's `parkWorkflow`, with the existing `missing_application_type` park comment: `## Application Type` is missing or names a type ADW does not know, re-run `adw_init`, and what `## Retry` and `## Continue` do.
4. **`adw_init` writes the type.**
   - Step 1 detects `cli` or `web`.
   - Step 3 writes `## Application Type`. It preserves a valid value the owner set by hand, and leaves the section out when detection cannot decide; it never writes a default.
   - Step 11 reports which of these happened.
5. **Records.** ADR-0061's `### Confirmation` names what is implemented and what the later issues still carry, and the README describes the mapping and the park.

Value: no repository is reviewed under a silent default. A web application can never be reviewed as a CLI by omission. The consumers added by the next issues (scenario runner, step-definition generator, proof assembler, review guidance) get one typed profile instead of a string each would switch on.

## User Story
As an ADW operator
I want every issue in a repository whose `.adw/project.md` lacks a known `## Application Type` to park with a comment telling me to re-run `adw_init`, while `cli` and `web` repositories proceed with an evidence profile from a single framework mapping
So that no repository is ever reviewed under a silent default, a web change is never judged without visual evidence by omission, and adding an application type later never means editing every phase

## Problem Statement
- `parseApplicationType` (`adws/core/projectConfig.ts`) reads any absent or unrecognised `## Application Type` as `cli`, and `getDefaultProjectConfig` defaults to `cli`. ADR-0061 rejected exactly that: "reading a missing type as `cli` … would bring back the silent default and review web changes without visual evidence".
- Nothing consumes the type, and no mapping exists. Each consumer the next issues add would switch on the raw string, so a third type would touch every phase (PRD user story 29).
- `adw_init` never writes `## Application Type`. Only ADW's own repository carries it (`cli`).
- #989 built the `missing_application_type` park comment (`adws/forge/parkComment.ts`), but nothing parks for that reason.
- ADR-0061's `### Confirmation` says "Not yet implemented".

## Solution Statement
- **Mapping (`adws/core/applicationType.ts`, pure, no I/O).**
  - `RunnerMode` enum: `Descriptor = 'descriptor'` (the runner named in `.adw/scenarios.md`) and `AdwPlaywright = 'adw_playwright'` (the ADW-owned Playwright project in `features/`).
  - `EvidenceKind` enum: `PerIssueImages = 'per_issue_images'`.
  - `ApplicationProfile` interface: `{ readonly runnerMode; readonly evidenceKinds: readonly EvidenceKind[]; readonly reviewGuidanceSection: string }`. `reviewGuidanceSection` is the title of the review prompt's guidance section for that type: `'CLI applications'` or `'Web applications'`. The reviewer issue adds those sections to `review.md`.
  - `ApplicationProfiles = Readonly<Record<string, ApplicationProfile>>`.
  - `APPLICATION_TYPE_PROFILES`, declared `as const satisfies ApplicationProfiles`, with exactly `cli` and `web`. `ApplicationType = keyof typeof APPLICATION_TYPE_PROFILES`.
  - `resolveApplicationType(declared: string | null, profiles = APPLICATION_TYPE_PROFILES): ApplicationTypeResolution`, returning `{ kind: 'known'; profile } | { kind: 'unknown'; found: string | null }`:
    - the lookup key is the trimmed, lowercased value;
    - `null` or blank is missing (`found: null`);
    - an unknown value keeps its original text in `found`, for the park comment;
    - only own keys count (`Object.prototype.hasOwnProperty.call`; the lib is ES2020, so not `Object.hasOwn`), so `constructor` or `__proto__` resolve to unknown.
  - `describeApplicationProfile(profile)`: a one-line description built only from the profile's fields, through `Record<RunnerMode, string>` and `Record<EvidenceKind, string>` tables. It feeds the run's log line.
- **Config (`adws/core/projectConfig.ts`).**
  - `ProjectConfig.applicationType: string | null`: what the section says, with HTML comments stripped and trimmed, case kept; `null` when the section is absent or empty.
  - `parseApplicationType` returns that value. `getDefaultProjectConfig` sets `null`.
  - The old `ApplicationType` alias leaves this file; the mapping now owns the type names.
- **Gate (`adws/phases/applicationTypeGate.ts`).**
  - Signature: `runApplicationTypeGate(config, projectConfig, deps): { projectConfig, applicationProfile }`. `config` is `Pick<WorkflowConfig, 'adwId' | 'issueNumber' | 'orchestratorStatePath' | 'repoContext' | 'worktreePath' | 'defaultBranch'>`. `deps` holds `loadProjectConfig`, `mergeLatestFromDefaultBranch`, `park` and optional `profiles`.
  - A known type logs `Application type <value>: <description>` to the console and `execution.log`, then returns.
  - An unknown or missing type first merges the latest default branch into the worktree once, through the typed `GitContext.mergeLatestFromDefaultBranch`. It then reloads the project config and resolves again. It proceeds if the type is now known, and parks only if it is still unknown, with `{ reason: ParkReason.MissingApplicationType, found }`.
  - Why the merge before parking: on the target-repo path `initializeWorkflow` reuses an existing worktree without merging the default branch (`ensureWorktree`; only the self-host path calls `mergeLatestFromDefaultBranch`). The same holds for a PR branch in `initializePRReviewWorkflow`. Without the merge, `## Retry` ("re-reads `## Application Type` after `adw_init` has been re-run") would re-read a stale worktree and park forever.
  - `buildApplicationTypeGateDeps(gitContext)` returns the real dependencies: `loadProjectConfig`, the git merge and `parkWorkflow`.
  - `requireApplicationProfile(config)` returns `config.applicationProfile`, or throws. It never defaults. It is the accessor the next issues' consumers use, mirroring `requireWorkflowGitContext`.
- **Wiring.**
  - `WorkflowConfig` gains `applicationProfile?: ApplicationProfile`. The field is optional for the same reason `gitContext?` is: phase-test fixtures built with `as unknown as WorkflowConfig` keep compiling. Both init functions always set it.
  - `initializeWorkflow` runs the gate right after `loadProjectConfig(worktreePath)`, before `readAdwYmlConfig` and the port allocation, and returns the gate's `projectConfig` (possibly reloaded) and `applicationProfile`.
  - `initializePRReviewWorkflow` does the same with `defaultBranch: pr.targetBranch`. Its early top-level state write also records `orchestratorScript: deriveOrchestratorScript(OrchestratorId.PrReview)`, so that `## Retry` on a PR-review park resumes the PR review instead of the issue's previous orchestrator.
  - `adwMerge` and `adwUpgrade` call neither init function and never park on the type. The upgrade, which re-runs `adw_init`, stays the remedy.
- **`adw_init.md`.**
  - Step 1 detects `web` (pages a person opens in a browser) or `cli` (no browser user interface). When the signals conflict or there is nothing to go on, it does not decide.
  - Step 3 writes `` - `## Application Type` — exactly one of `cli` or `web` ``: preserve an existing `cli`/`web` value verbatim, otherwise write the detected type, otherwise leave the section out (no default, placeholder or empty section).
  - Step 11 reports the outcome.
  - `adws/__tests__/adwInitPrompt.test.ts` gains a drift test: the step-3 bullet names exactly the keys of `APPLICATION_TYPE_PROFILES`.
- **Mechanical rule.** A unit test asserts that the identifier `applicationType` appears only in `adws/core/projectConfig.ts` and `adws/phases/applicationTypeGate.ts` among non-test `adws/` sources. A later phase that switches on the type fails CI ("every consumer reads the mapping, never the type").
- **Records.** Rewrite ADR-0061's `### Confirmation`. Update the README bullet list, the `/adw_init` operator section and the directory tree.

## Relevant Files
Use these files to implement the feature:

- `specs/prd/review-proof-redesign.md` — The specification. *Implementation Decisions*: **Application-type mapping**, **`adw_init` changes**, **Park comment builder**. *Testing Decisions*: "Application-type mapping: both types map correctly; unknown and missing park; adding a type needs no change to consumers (assert consumers read the mapping, via a fake third type)". Read-only.
- `specs/adr/0061-application-type-decides-evidence-web-repos-run-playwright-bdd.md` — The decision: type alone decides the evidence; two types; a third without touching phases; `adw_init` detects and writes; missing/unknown parks; no default; no migration. Its `### Confirmation` must be rewritten (acceptance criterion).
- `specs/adr/0060-baseline-gate-on-the-base-branch.md` — Every park comment says what failed and what `## Retry`/`## Continue` do. Read-only.
- `specs/adr/0002-worktree-per-issue.md` — "An existing worktree for the issue is reused and merged with the default branch instead of reset". This supports the gate's merge before parking. Read-only.
- `specs/adr/0042-hash-versioned-self-upgrade.md` — `adw_init.md` is a `hashInputs` file, so editing it bumps the framework hash and regenerates `.adw/` in every target repository. Read-only.
- `README.md` — Feature bullet list (add the application-type bullet), `### 4. Bootstrap a target repo with /adw_init`, and the directory tree (`adws/core/`, `adws/phases/` and their `__tests__`).
- `.adw/coding_guidelines.md` — Must be followed: guard clauses, nesting ≤ 2, enums for named sets, `readonly`, no `any`, pure core, comments only for invariants/ordering/non-obvious reasons (no issue numbers, no banners), files under 300 lines.
- `.adw/project.md` — ADW's own repository already carries `## Application Type` `cli`. Read-only.
- `.adw/commands.md` — Source of the validation commands. Read-only.
- `.github/adw.yml` — `unitTests` is not set to `false`, so unit tests are enabled. Read-only.
- `adws/core/projectConfig.ts` — `ApplicationType`, `ProjectConfig.applicationType`, `getDefaultProjectConfig`, `parseApplicationType`, `stripHtmlComments`, `loadProjectConfig`. Remove the default. Already over 300 lines (pre-existing): change only what this issue needs.
- `adws/core/index.ts` — Core barrel. Add the mapping exports next to the `projectConfig` export line.
- `adws/core/__tests__/projectConfig.test.ts`, `adws/core/__tests__/projectConfigLoad.test.ts`, `adws/core/__tests__/projectConfigCommands.test.ts` — Existing config tests. Add the application-type parsing cases; none asserts the old `cli` default today.
- `adws/forge/parkComment.ts` — `ParkReason.MissingApplicationType`, `ParkEvidence` `{ reason, found: string | null }`, `buildParkComment`, `parkDirectives`. Already complete. Do NOT change it: the `@adw-989` step definitions (`features/per-issue/step_definitions/feature-989-park.steps.ts`) hard-code its directive text.
- `adws/forge/__tests__/parkComment.*.test.ts` — Existing coverage of the `missing_application_type` comment (heading, "re-run `adw_init`", `found` quoted, directives). Read-only.
- `adws/phases/workflowPark.ts` — `parkWorkflow(config, evidence): never`: writes `human_gated`, posts the park comment (non-fatal), `process.exit(0)`. The gate's real `park`. Not modified.
- `adws/phases/__tests__/workflowPark.test.ts` — Pattern for unique adwIds, temp state, a throwing `process.exit` spy and a fake `commentOnIssue`.
- `adws/phases/staticCheckGate.ts` — Prior art for a phase-level gate over a pure core module that parks through `parkWorkflow` and logs to the console and `execution.log`.
- `adws/phases/workflowInit.ts` — `WorkflowConfig` (add `applicationProfile?`), `initializeWorkflow` (`loadProjectConfig` at the end of `initializeWorkflowSteps`; target-repo path `gitCtx.ensureWorktree` reuses without merging; self-host path merges). Already over 300 lines (pre-existing): add only the gate call, the field and the return entry.
- `adws/phases/__tests__/workflowInit.test.ts` — Runs the real `initializeWorkflow` against `/tmp/fake-worktree` (no `.adw/`), so the real gate would park. Mock the gate module there and add the wiring assertions.
- `adws/phases/prReviewPhase.ts` — `initializePRReviewWorkflow`: early `writeTopLevelState` (pid, pidStartedAt, lastSeenAt), `loadProjectConfig(worktreePath)`, `base: WorkflowConfig`. Add the gate, the profile and `orchestratorScript`.
- `adws/phases/__tests__/prReviewPhase.test.ts` — Runs the real `initializePRReviewWorkflow` with a boundary whose `gitContext` has only `ensureWorktree`. Mock the gate module there and add the wiring assertions.
- `adws/phases/workflowRepoIdentity.ts` — `requireWorkflowGitContext`: the pattern `requireApplicationProfile` mirrors.
- `adws/adwPrReview.tsx` — `main()` writes `orchestratorScript: 'adws/adwPrReview.tsx'` after init. Unchanged. It is the reason the early write must carry it too.
- `adws/core/orchestratorNames.ts` — `deriveOrchestratorScript(OrchestratorId.PrReview)` → `adws/adwPrReview.tsx`.
- `adws/core/resolveResumeSpawn.ts` — `## Retry` → `phase_timeout` → the cron resumes `state.orchestratorScript`. Not modified.
- `adws/triggers/retryHandler.ts` — `decideRetryAction('human_gated')` → `rearm_phase_timeout`. How `## Retry` re-runs init and the gate. Not modified.
- `adws/adwMerge.tsx`, `adws/adwUpgrade.tsx` — Neither calls `initializeWorkflow`, so the upgrade that re-runs `adw_init` can never park on the type. Not modified.
- `node_modules/@paysdoc/devplatform/dist/git/gitContext.d.ts` and `.../branchOps.js` — `mergeLatestFromDefaultBranch(defaultBranch, worktreePath)`: fetch and merge `origin/<default>`, warn-don't-throw on failure or conflict. `ensureWorktree` reuses an existing worktree as-is. Read-only.
- `adws/checkGitGhGuard.ts` — Only typed `GitContext` methods may be used (no `git …` strings).
- `.claude/commands/adw_init.md` — Step 1 (Analyze), step 3 (`.adw/project.md`), step 11 (Report). Steps 6 and 8 (review_proof, the Playwright branch) belong to the Playwright issue and are not touched here.
- `adws/__tests__/adwInitPrompt.test.ts` — Source-text drift tests over `adw_init.md`. Add the application-type test.
- `adws/phases/__tests__/scenarioTestPhase.test.ts` — Builds a `projectConfig` with `applicationType: 'cli'`. Still type-valid; must keep passing.
- `test/fixtures/cli-tool/.adw/project.md` (`cli`), `test/fixtures/python-app/.adw/project.md` (`web`), `test/fixtures/python-flat/.adw/project.md` (`cli`) — Every fixture already declares a known type, so the regression harness (`features/regression/support/fixtureTargetRepo.ts`, `fixtureWorktree.ts`, `drivers/workflowInitDriver.ts`) proceeds. Read-only.
- `features/per-issue/step_definitions/feature-959-pr-review.steps.ts`, `features/per-issue/step_definitions/feature-959-boundary.ts` — Run the real `initializePRReviewWorkflow`. The worktree they use must declare a known type, or that scenario now parks.
- `features/per-issue/step_definitions/feature-929-workflow.ts`, `feature-796.steps.ts`, `feature-988-phase.steps.ts`, `feature-989-comments.ts`, `feature-989-park.steps.ts` — Harness the `@adw-991` step definitions reuse: throwaway worktrees, recording providers, `commentsOn`, `process.exit` trap, park-comment assertions.
- `app_docs/feature-9gjajh-state-and-config.md` — Conditional doc owning `projectConfig.ts` and `adws/core/index.ts` (project config loading).
- `app_docs/feature-9gjajh-workflow-lifecycle-phases.md` — Conditional doc owning `workflowInit.ts` (workflow initialization).
- `app_docs/feature-9gjajh-pr-and-merge-phases.md` — Conditional doc owning `prReviewPhase.ts` (PR review phases).
- `app_docs/feature-9gjajh-test-and-scenario-phases.md` — Conditional doc owning `workflowPark.ts` and the park-comment builder conditions.
- `app_docs/feature-9gjajh-github-api.md` — Conditional doc owning `adws/forge/**` (`parkComment.ts`).
- `app_docs/feature-9gjajh-commands-and-skills.md` — Conditional doc owning `.claude/commands/adw_init.md` and `adws/__tests__/adwInitPrompt.test.ts`.
- `app_docs/feature-9gjajh-specs-and-prd.md` — Conditional doc owning `specs/**` (the ADR edit).
- `app_docs/feature-9gjajh-root-config.md` — Conditional doc owning `README.md` and `.adw/project.md`.
- `app_docs/feature-9gjajh-bdd-per-issue.md` — Conditional doc owning `features/per-issue/**` (the `@adw-991` step definitions).
- `adws/README.md` — Conditional doc for working in `adws/`.

### New Files
- `adws/core/applicationType.ts` — The pure mapping: `RunnerMode`, `EvidenceKind`, `ApplicationProfile`, `ApplicationProfiles`, `APPLICATION_TYPE_PROFILES`, `ApplicationType`, `ApplicationTypeResolution`, `resolveApplicationType`, `describeApplicationProfile`.
- `adws/core/__tests__/applicationType.test.ts` — Mapping tests, including the fake third type and the "only the mapping reads the type" source rule.
- `adws/phases/applicationTypeGate.ts` — `ApplicationTypeGateConfig`, `ApplicationTypeGateDeps`, `ApplicationTypeGateResult`, `runApplicationTypeGate`, `buildApplicationTypeGateDeps`, `requireApplicationProfile`.
- `adws/phases/__tests__/applicationTypeGate.test.ts` — Gate tests: proceed, park, merge-and-reread, fake third type through the gate, `requireApplicationProfile`, the real park end to end.
- `features/per-issue/step_definitions/feature-991*.ts` — Step definitions for the `@adw-991` scenarios of `features/per-issue/feature-991.feature` (written by the scenario agent). Split helpers into `feature-991-*.ts` modules to stay under 300 lines.

## Implementation Plan
### Phase 1: Foundation
- The pure mapping and its tests: both types, missing, unknown, inherited keys, case/whitespace, a fake third type, and the profile description.
- `projectConfig` without a default: `applicationType: string | null`, parse cases, load cases.
- Core barrel exports.

### Phase 2: Core Implementation
- The application-type gate over injected dependencies:
  - a known type proceeds and logs;
  - an unknown type merges the latest default branch once, re-reads, then proceeds or parks with `missing_application_type`;
  - `requireApplicationProfile` never defaults.
- The source rule: no `adws/` module outside the config parser and the gate names `applicationType`.

### Phase 3: Integration
- Wire the gate into `initializeWorkflow` and `initializePRReviewWorkflow` (the latter records `orchestratorScript` first), and add `WorkflowConfig.applicationProfile`. Update the two init unit tests.
- `adw_init.md` detects, writes, preserves or leaves out `## Application Type`, with its drift test.
- Keep the `@adw-959` PR-review scenario green. Write the `@adw-991` step definitions.
- Rewrite ADR-0061's `### Confirmation`, update the README, run every validation command.

## Step by Step Tasks
Execute every step in order, top to bottom.

### 1. Write the application-type mapping (test first)
- Create `adws/core/__tests__/applicationType.test.ts`:
  - `resolveApplicationType('cli')` → `{ kind: 'known', profile }` with `runnerMode: RunnerMode.Descriptor`, `evidenceKinds: []`, `reviewGuidanceSection: 'CLI applications'`.
  - `resolveApplicationType('web')` → `runnerMode: RunnerMode.AdwPlaywright`, `evidenceKinds: [EvidenceKind.PerIssueImages]`, `reviewGuidanceSection: 'Web applications'`.
  - `' Web '`, `'CLI'`, `'web\n'` resolve to the same profiles (trimmed, case-insensitive).
  - Missing: `null`, `''` and `'   '` → `{ kind: 'unknown', found: null }`.
  - Unknown: `'desktop'`, `'api'`, `'web app'` → `{ kind: 'unknown', found }` with the original text (`'Desktop'` stays `'Desktop'`).
  - Inherited keys: `'constructor'`, `'toString'`, `'hasOwnProperty'`, `'__proto__'` → unknown.
  - The table holds exactly `cli` and `web` (`Object.keys(APPLICATION_TYPE_PROFILES)`), the two types of ADR-0061.
  - Fake third type:
    - `const FAKE: ApplicationProfile = { runnerMode: RunnerMode.Descriptor, evidenceKinds: [EvidenceKind.PerIssueImages], reviewGuidanceSection: 'Desktop applications' }`;
    - `resolveApplicationType('desktop', { ...APPLICATION_TYPE_PROFILES, desktop: FAKE })` → `known` with `FAKE`;
    - the same call with the default table → unknown;
    - `cli` and `web` still resolve under the extended table.
  - `describeApplicationProfile`:
    - `cli` names the runner from `.adw/scenarios.md` and no images;
    - `web` names the ADW Playwright project in `features/` and per-issue scenario images;
    - `FAKE` is described from its fields (the descriptor runner plus per-issue images), with no type name anywhere in the output.
- Create `adws/core/applicationType.ts` with the contents described in the Solution Statement:
  - string enums `RunnerMode` and `EvidenceKind`;
  - the `readonly` interface `ApplicationProfile`, and `ApplicationProfiles`;
  - `APPLICATION_TYPE_PROFILES` (`as const satisfies ApplicationProfiles`) and `ApplicationType = keyof typeof APPLICATION_TYPE_PROFILES`;
  - the `ApplicationTypeResolution` union with string-literal `kind` discriminants, as elsewhere in `adws/core`;
  - `resolveApplicationType` with guard clauses (blank → missing; own-key lookup through `Object.prototype.hasOwnProperty.call`);
  - `describeApplicationProfile` through two `Readonly<Record<…, string>>` tables.
- One comment above the table, because the invariant is not visible in the code: the table is the only place a type name means anything, so a new type is an entry here plus detection in `adw_init` and touches no phase. No other comments beyond what guard clauses cannot say.
- Run `bunx vitest run adws/core/__tests__/applicationType.test.ts` until green.

### 2. Remove the `cli` default from the project config (test first)
- Add tests to `adws/core/__tests__/projectConfig.test.ts`, or to a new `adws/core/__tests__/projectConfigApplicationType.test.ts` if that file would pass 300 lines:
  - `parseApplicationType`:
    - absent section → `null`;
    - heading with an empty body → `null`;
    - a body holding only an HTML comment → `null`;
    - `cli` / `web` → as written;
    - `Web` → `'Web'` (case kept);
    - `desktop` → `'desktop'`;
    - surrounding blank lines and spaces trimmed;
    - `web` followed by an HTML comment → `'web'`.
  - `getDefaultProjectConfig().applicationType` → `null`.
  - `loadProjectConfig`, temp-dir cases as in `projectConfigLoad.test.ts`:
    - `.adw/project.md` without the section → `null`;
    - with `## Application Type\nweb` → `'web'`;
    - no `.adw/` directory → `null`.
- In `adws/core/projectConfig.ts`:
  - delete `export type ApplicationType = 'cli' | 'web';` (no importer exists; the mapping owns the names now);
  - change `ProjectConfig.applicationType` to `string | null` and replace `/** Defaults to `'cli'`. */` with a short invariant comment: absent or empty ⇒ `null`; decisions read it only through `resolveApplicationType`;
  - set `applicationType: null` in `getDefaultProjectConfig`;
  - rewrite `parseApplicationType(projectMd): string | null` as `const value = stripHtmlComments(sections['application type'] ?? ''); return value === '' ? null : value;`, and replace its doc comment (it describes the removed default).
- Run `bunx vitest run adws/core/__tests__/projectConfig.test.ts adws/core/__tests__/projectConfigLoad.test.ts adws/core/__tests__/projectConfigCommands.test.ts adws/phases/__tests__/scenarioTestPhase.test.ts` until green.

### 3. Export the mapping from the core barrel
- In `adws/core/index.ts`, next to the `projectConfig` export line:
  - `export type { ApplicationProfile, ApplicationProfiles, ApplicationType, ApplicationTypeResolution } from './applicationType';`
  - `export { APPLICATION_TYPE_PROFILES, RunnerMode, EvidenceKind, resolveApplicationType, describeApplicationProfile } from './applicationType';`

### 4. Write the application-type gate (test first)
- Create `adws/phases/__tests__/applicationTypeGate.test.ts`, set up like `workflowPark.test.ts`:
  - a unique adwId, with `agents/<adwId>` removed in `afterEach`;
  - a real `orchestratorStatePath` from `AgentStateManager.initializeState`;
  - fake deps: `loadProjectConfig` as a `vi.fn` returning scripted configs, `mergeLatestFromDefaultBranch` as a `vi.fn`, `park` as a `vi.fn` that throws a sentinel and records `(config, evidence)`;
  - a helper `configDeclaring(value: string | null)` built from `getDefaultProjectConfig()`.

  Cases:
  - `cli` → returns `{ projectConfig, applicationProfile: APPLICATION_TYPE_PROFILES.cli }`. No merge, no reload, no park. `execution.log` holds `Application type cli:` followed by `describeApplicationProfile(...)`.
  - `web` → the web profile; same assertions.
  - Missing, still missing after the merge → `mergeLatestFromDefaultBranch(defaultBranch, worktreePath)` once, `loadProjectConfig(worktreePath)` once, then `park` with the gate's config and `{ reason: ParkReason.MissingApplicationType, found: null }`.
  - Unknown `Desktop`, unchanged after the merge → park with `found: 'Desktop'`.
  - Missing, then `web` after the merge → proceeds with the web profile and returns the reloaded `projectConfig`. No park.
  - Fake third type: `profiles: { ...APPLICATION_TYPE_PROFILES, desktop: FAKE }` with `configDeclaring('desktop')` → returns `FAKE` with no merge and no park. The log line is `describeApplicationProfile(FAKE)`. The gate's code is unchanged: this is the "fake third type reaches a consumer through the mapping without a consumer change" criterion.
  - `requireApplicationProfile({ applicationProfile: FAKE })` → `FAKE`. `requireApplicationProfile({})` throws an error naming `initializeWorkflow` and `initializePRReviewWorkflow`. It never returns a default.
  - The real park, end to end: `buildApplicationTypeGateDeps({ mergeLatestFromDefaultBranch: vi.fn() })` with a temp worktree whose `.adw/project.md` lacks the section, a fake `repoContext.issueTracker.commentOnIssue` and a `process.exit` spy that throws:
    - the top-level `workflowStage` is `human_gated`;
    - the one posted comment equals `buildParkComment(adwId, { reason: ParkReason.MissingApplicationType, found: null })`, which names `## Application Type` and says to re-run `adw_init`;
    - `process.exit` was called with `0`.
- Create `adws/phases/applicationTypeGate.ts`:
  - `import type { WorkflowConfig } from './workflowInit'`. A type-only import, so `workflowInit.ts` can import this module without a runtime cycle.
  - `export type ApplicationTypeGateConfig = Pick<WorkflowConfig, 'adwId' | 'issueNumber' | 'orchestratorStatePath' | 'repoContext' | 'worktreePath' | 'defaultBranch'>`. It is structurally a superset of `parkWorkflow`'s config, so `workflowPark.ts` is not changed.
  - `ApplicationTypeGateDeps`: `loadProjectConfig`, `mergeLatestFromDefaultBranch`, `park: (config, evidence: ParkEvidence) => never`, `profiles?: ApplicationProfiles`.
  - `ApplicationTypeGateResult`: `{ readonly projectConfig: ProjectConfig; readonly applicationProfile: ApplicationProfile }`.
  - `runApplicationTypeGate(config, projectConfig, deps)`:
    1. resolve;
    2. if known, log and return;
    3. otherwise log `## Application Type <missing | says "<value>"> in the worktree; merging the latest <defaultBranch> and reading it again`, merge, reload and resolve again;
    4. if known, log and return the reloaded config;
    5. otherwise `return deps.park(config, { reason: ParkReason.MissingApplicationType, found })`.

    Extract `proceed(...)` and `recordLine(...)` helpers so the function stays flat. Comment the merge before the park, because the reason is not visible in the code: a reused target-repo or PR worktree is not merged with the default branch at init, and `## Retry` must see what `adw_init` wrote there.
  - `buildApplicationTypeGateDeps(gitContext: Pick<GitContext, 'mergeLatestFromDefaultBranch'>)` → `{ loadProjectConfig, mergeLatestFromDefaultBranch: (b, w) => gitContext.mergeLatestFromDefaultBranch(b, w), park: parkWorkflow }`.
  - `requireApplicationProfile(config: Pick<WorkflowConfig, 'applicationProfile'>): ApplicationProfile`, shaped like `requireWorkflowGitContext`.
- Run `bunx vitest run adws/phases/__tests__/applicationTypeGate.test.ts` until green.

### 5. Wire the gate into `initializeWorkflow` (test first)
- In `adws/phases/__tests__/workflowInit.test.ts`:
  - mock `../applicationTypeGate`, keeping `requireApplicationProfile` actual: `runApplicationTypeGate: vi.fn((_config, projectConfig) => ({ projectConfig, applicationProfile: APPLICATION_TYPE_PROFILES.cli }))` and `buildApplicationTypeGateDeps: vi.fn(() => ({}))`. Without this, `/tmp/fake-worktree` (no `.adw/`) would park through the real gate;
  - add cases:
    - the gate receives the run's `adwId`, `issueNumber`, `orchestratorStatePath`, `worktreePath` and `defaultBranch`, plus the config `loadProjectConfig` read from the worktree;
    - `buildApplicationTypeGateDeps` receives the launch `GitContext`;
    - the returned `WorkflowConfig.applicationProfile` is the gate's profile, and `WorkflowConfig.projectConfig` is the gate's returned config, which can differ from the first load after a merge.
  - Keep every existing case green.
- In `adws/phases/workflowInit.ts`:
  - `WorkflowConfig` gains `applicationProfile?: ApplicationProfile`, with a comment mirroring `gitContext?`'s: always set by `initializeWorkflow`/`initializePRReviewWorkflow`; optional only for phase-test fixtures; read through `requireApplicationProfile`, which never defaults;
  - at the `loadProjectConfig(worktreePath)` site, keep the two existing log lines, then call `runApplicationTypeGate({ adwId: resolvedAdwId, issueNumber, orchestratorStatePath, repoContext, worktreePath, defaultBranch }, loaded, buildApplicationTypeGateDeps(gitCtx))`. Call it before `readAdwYmlConfig` and `allocateRandomPort`, so a parked run allocates no port;
  - return the gate's `projectConfig` and `applicationProfile`;
  - import the gate by module path, as `staticCheckGate.ts` is imported; the phases barrel does not list phase gates.
- Run `bunx vitest run adws/phases/__tests__/workflowInit.test.ts` until green.

### 6. Wire the gate into `initializePRReviewWorkflow` (test first)
- In `adws/phases/__tests__/prReviewPhase.test.ts`:
  - mock `../applicationTypeGate` the same way (its boundary `gitContext` only has `ensureWorktree`);
  - extend the owner assertions: the early top-level write records `orchestratorScript: 'adws/adwPrReview.tsx'` together with `pid`/`pidStartedAt`/`lastSeenAt`;
  - the gate receives `defaultBranch` = the PR's target branch and the PR worktree path;
  - `config.base.applicationProfile` is the gate's profile.
- In `adws/phases/prReviewPhase.ts`:
  - add `orchestratorScript: deriveOrchestratorScript(OrchestratorId.PrReview)` to the existing early `AgentStateManager.writeTopLevelState(resolvedAdwId, { … })`. Extend that write's existing comment by one clause: a park inside init must resume the PR review on `## Retry`. `main()`'s later write stays as it is;
  - replace `const projectConfig = loadProjectConfig(worktreePath);` with the gate call over `{ adwId: resolvedAdwId, issueNumber: issueNumber ?? 0, orchestratorStatePath, repoContext, worktreePath, defaultBranch: pr.targetBranch }` and `buildApplicationTypeGateDeps(boundary.gitContext)`;
  - put `projectConfig` and `applicationProfile` from the result into `base`.
- Run `bunx vitest run adws/phases/__tests__/prReviewPhase.test.ts adws/phases/__tests__/prReviewCompletion.test.ts` until green.

### 7. Add the "only the mapping reads the type" rule
- In `adws/core/__tests__/applicationType.test.ts`, add a test that walks every `.ts`/`.tsx` file under `adws/`, excluding `__tests__` directories and `node_modules`. It asserts that the case-sensitive identifier `applicationType` (`/\bapplicationType\b/`) occurs only in `adws/core/projectConfig.ts` and `adws/phases/applicationTypeGate.ts`. The failure message names each offending file and says to read the mapping (`requireApplicationProfile` / `resolveApplicationType`) instead. `ApplicationType`, `resolveApplicationType` and `APPLICATION_TYPE_PROFILES` do not match the pattern, by construction.
- Run it. It must be green after tasks 1–6.

### 8. Teach `adw_init` to detect and write `## Application Type`
- In `.claude/commands/adw_init.md` **step 1** (Analyze the Project), after the README bullet, add **Detect the application type**. It decides what evidence ADW's review needs, and ADW assumes no type:
  - `web`: the application serves pages that a person opens in a browser. Signals: a web framework or front-end build in the manifest (for example Next.js, Nuxt, Remix, SvelteKit, Astro, Angular, Vue, React with Vite; Django, Flask or FastAPI serving templates; Rails, Laravel, Phoenix), or routes and templates that render HTML.
  - `cli`: the application has no browser user interface. Examples: a command-line tool (a `bin` entry, commander, yargs, oclif, click, typer, cobra, clap), a library, scripts or automation, or a service with an HTTP API and no pages.
  - Test tooling alone (Playwright, Cypress, Cucumber) does not decide the type.
  - Undecided: the signals conflict (for example a CLI and a separate browser UI, neither of them primary), or there is nothing to go on (an empty repository whose issue describes no application). Do not guess, and never fall back to `cli`.
- In **step 3** (Create `.adw/project.md`), add after `## Script Execution`, with the first line exactly as written here (the drift test parses it):
  - `` - `## Application Type` — exactly one of `cli` or `web`, alone on its line: ``
    - If the existing `.adw/project.md` has `## Application Type` holding `cli` or `web`, preserve it verbatim. The owner may have set it by hand, and an upgrade must not drop it.
    - Otherwise write the type detected in step 1.
    - If step 1 could not decide, leave the section out entirely: no default, no placeholder, no empty section. ADW then parks every issue with the `missing_application_type` comment until the section is added or `adw_init` is re-run.
- In **step 11** (Report), add: `## Application Type`: the value and whether it was detected or preserved, or `left out — detection could not decide (the next ADW run parks the issue with missing_application_type)`.
- Do not touch steps 6 and 8, the `.github/adw.yml` heredoc or the Comments entry. Name no branch (the `lint:branch-names` guard scans `.claude/commands/`).
- In `adws/__tests__/adwInitPrompt.test.ts`, add `it('offers exactly the application types the mapping knows')`:
  - find the line starting with ``- `## Application Type` `` in `adw_init.md`;
  - collect its backticked tokens other than `## Application Type`;
  - expect them, sorted, to equal `Object.keys(APPLICATION_TYPE_PROFILES)` sorted.

  Also add an assertion that the prompt says to leave the section out when detection cannot decide: the step-3 sub-bullet contains `leave the section out`. Keep the file's header comment accurate: it describes texts the prompt "cannot import"; the type list is one of them.
- Run `bunx vitest run adws/__tests__/adwInitPrompt.test.ts` until green.

### 9. Rewrite ADR-0061's `### Confirmation`
- In `specs/adr/0061-application-type-decides-evidence-web-repos-run-playwright-bdd.md`, replace the paragraph starting "Not yet implemented; carried by…" with "Partly implemented. Checked on <date> at `<short hash>`:" and these bullets:
  - The mapping: `adws/core/applicationType.ts` (`APPLICATION_TYPE_PROFILES`, `resolveApplicationType`).
    - `cli` → the descriptor runner from `.adw/scenarios.md`, no images; `web` → the ADW Playwright project, per-issue images; a missing or unknown type resolves to unknown.
    - Unit tests in `adws/core/__tests__/applicationType.test.ts`: both types, missing, unknown, a fake third type through the mapping, and the rule that only the config parser and the gate name `applicationType`.
  - No default: `adws/core/projectConfig.ts` reads an absent or empty `## Application Type` as `null` (`parseApplicationType`, `getDefaultProjectConfig`). Tests in the `projectConfig` test files.
  - The park: `adws/phases/applicationTypeGate.ts` (`runApplicationTypeGate`), run by `initializeWorkflow` and `initializePRReviewWorkflow`.
    - A missing or unknown type parks the workflow as `human_gated` with the `missing_application_type` comment of `adws/forge/parkComment.ts`, after merging the latest default branch once so that `## Retry` sees a re-run `adw_init`.
    - `cli` or `web` proceeds, with the profile on `WorkflowConfig.applicationProfile` (`requireApplicationProfile`).
    - Tests in `adws/phases/__tests__/applicationTypeGate.test.ts`, including a fake third type that reaches the gate without a gate change.
  - `adw_init`: `.claude/commands/adw_init.md` detects and writes `## Application Type`, preserves a hand-set value, and leaves the section out when it cannot decide. `adws/__tests__/adwInitPrompt.test.ts` asserts that the offered types equal the mapping's keys.
  - Still open, carried by the PRD's later modules:
    - the ADW Playwright project, and `adw_init`'s Gherkin-plus-Playwright inconsistency in step 8;
    - the scenario phase passing `ADW_APPLICATION_URL` and running the `web` mode;
    - the step-definition generator's `web` mode;
    - the proof assembler's evidence selection;
    - the review prompt's per-type guidance sections.
- Keep the "Spike limits" paragraph, the decision text, the drivers and the front matter unchanged.

### 10. Update the README
- Add a bullet after **Static-check gates and a per-repo unit-test switch**: **Application type decides the evidence**.
  - `## Application Type` in `.adw/project.md` (`cli` or `web`) is written by `adw_init` and has no default.
  - The framework-owned mapping `adws/core/applicationType.ts` turns it into the scenario runner mode, the evidence kinds and the review guidance section. Consumers read the mapping, never the type.
  - A missing or unknown type parks the issue as `human_gated` with the `missing_application_type` park comment (`adws/phases/applicationTypeGate.ts`), which says to re-run `adw_init`. `## Retry` re-reads the section after merging the latest default branch.
- In `### 4. Bootstrap a target repo with /adw_init`, add one paragraph:
  - `adw_init` detects the application type and writes `## Application Type`; when it cannot decide, it leaves the section out, and ADW parks the repository's issues until the section is added by hand or `adw_init` is re-run;
  - a value set by hand survives regeneration.
- Directory tree:
  - `adws/core/`: `applicationType.ts  # Pure application-type mapping: type → runner mode, evidence kinds, review guidance section (resolveApplicationType, APPLICATION_TYPE_PROFILES)`, in its position near `agentState.ts`;
  - core `__tests__`: `applicationType.test.ts`;
  - `adws/phases/`: `applicationTypeGate.ts  # Resolves the application type at init; a missing or unknown type parks the workflow (missing_application_type); requireApplicationProfile`;
  - phases `__tests__`: `applicationTypeGate.test.ts`, if the tree lists that directory's files;
  - give the bare `projectConfig.ts` entry a description that says `applicationType` has no default.

### 11. Keep the scenarios that run the real init functions green
- Run `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-959"`. The PR-review scenario runs the real `initializePRReviewWorkflow` over `useBenignGitContext()`'s worktree (`real.worktreePathFor(branch)`). If that worktree has no `.adw/project.md` declaring a known type, the run now parks.
  - Fix it in the step definitions (`feature-959-boundary.ts` or `feature-959-pr-review.steps.ts`): write `.adw/project.md` with `## Application Type\n\ncli` into that worktree before the call, and remove it in the scenario's cleanup.
  - Do not edit `features/per-issue/feature-959.feature`.
- The regression harness needs no change: every fixture under `test/fixtures/` already declares a known type. Confirm with the `@regression` run in task 13.

### 12. Write the step definitions for `@adw-991`
- The scenario agent writes `features/per-issue/feature-991.feature`. Implement every `@adw-991` step in `features/per-issue/step_definitions/feature-991*.ts`, splitting helpers into `feature-991-*.ts` modules under 300 lines. Do not edit the feature file.
- Reuse, never redefine (Cucumber fails on ambiguous steps):
  - the Background `the ADW codebase is checked out` (`features/regression/step_definitions/givenSteps.ts`);
  - the park-comment helpers of `feature-989-comments.ts` / `feature-989-park.steps.ts` where a phrase already exists;
  - #929's `createWorkflow`/`commitFile`/`commentsOn` and #796's recording providers;
  - #988's `process.exit` trap.
- Drive behaviour through the public seams:
  - "parks" / "proceeds" scenarios: run `runApplicationTypeGate` with `buildApplicationTypeGateDeps` over a throwaway worktree whose `.adw/project.md` has, lacks, or misdeclares the section. Assert `AgentStateManager.readTopLevelState(adwId).workflowStage === 'human_gated'` and the `ADW Parked` comment in `commentsOn(issueNumber)`, or the returned profile.
  - Mapping scenarios: call `resolveApplicationType` / `describeApplicationProfile`. A fake third type goes in through the `profiles` argument.
  - `adw_init` scenarios are source-text checks over `.claude/commands/adw_init.md`, which is as far as prompt testing goes (PRD *Testing Decisions*).
  - Config scenarios: call `parseApplicationType` / `loadProjectConfig`.
- Hooks: reset shared state and remove temp dirs plus `agents/<adwId>`/`logs/<adwId>` in `After`, and keep them idempotent.
- Cucumber expressions treat `/` as alternation: use `{string}` for quoted paths.
- Run `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-991"` until green.

### 13. Run the validation commands
- Run every command in `Validation Commands` and fix any failure before finishing.

## Testing Strategy
### Unit Tests
- `adws/core/__tests__/applicationType.test.ts`:
  - `cli` and `web` profiles (runner mode, evidence kinds, guidance section);
  - trimmed, case-insensitive lookup;
  - missing (`null`, blank) → `found: null`; unknown → `found` with the original text; inherited keys → unknown;
  - exactly two types in the table;
  - a fake third type resolves only through an extended table, and `cli`/`web` still resolve beside it;
  - `describeApplicationProfile` built from fields only;
  - the source rule: only `projectConfig.ts` and `applicationTypeGate.ts` name `applicationType`.
- `adws/core/__tests__/projectConfig*.test.ts`:
  - `parseApplicationType`: absent, empty or comment-only → `null`; values kept as written; trimming;
  - `getDefaultProjectConfig().applicationType === null`;
  - `loadProjectConfig` with and without the section, and with no `.adw/`.
- `adws/phases/__tests__/applicationTypeGate.test.ts`:
  - `cli`/`web` proceed, log, no merge, no park;
  - missing and unknown merge once, re-read, park with the right `found`;
  - a missing type fixed on the default branch proceeds after the merge, with the reloaded config;
  - a fake third type through `profiles` proceeds without a gate change;
  - `requireApplicationProfile` returns or throws, never defaults;
  - the real park end to end (`human_gated`, the exact `buildParkComment` text, `process.exit(0)`).
- `adws/phases/__tests__/workflowInit.test.ts`: gate inputs (run identity, worktree, default branch, loaded config, launch `GitContext`); `applicationProfile` and the gate's `projectConfig` on the returned config.
- `adws/phases/__tests__/prReviewPhase.test.ts`: `orchestratorScript` recorded in the early owner write; gate inputs (PR target branch, PR worktree); `base.applicationProfile` set.
- `adws/__tests__/adwInitPrompt.test.ts`: the step-3 bullet offers exactly the mapping's keys; the prompt says to leave the section out when detection cannot decide.
- Unchanged and still passing:
  - `adws/forge/__tests__/parkComment.*.test.ts` (the comment described: heading, `## Application Type`, `found`, "re-run `adw_init`", directives);
  - `adws/phases/__tests__/workflowPark.test.ts`;
  - `adws/phases/__tests__/scenarioTestPhase.test.ts`;
  - `adws/triggers/__tests__/retryHandler.test.ts`;
  - the injectable orchestrator tests.

### Edge Cases
- **Section absent, empty or comment-only** → `null` → missing → park with "is missing".
- **Unknown value** (`desktop`, `api`, `web app`, `CLI tool`) → park; the comment quotes the value as written (case kept, newlines flattened by the builder).
- **Case and spacing** (`Web`, ` cli `) → known; `found` is never lowercased.
- **Inherited object keys** (`constructor`, `__proto__`, `toString`) → unknown, not a crash and not a function treated as a profile.
- **No `.adw/` directory at all** → default config with `applicationType: null` → park. An uninitialised repository is told to run `adw_init`, never run under defaults.
- **Reused target-repo worktree, or a PR branch, created before the section existed** → the gate merges the latest default branch before parking. `## Retry` after a re-run `adw_init` (merged to the default branch) proceeds.
- **The merge fails or conflicts** → `mergeLatestFromDefaultBranch` warns and never throws (devplatform). The gate re-reads whatever the worktree holds and parks if the type is still unknown. A conflicted merge left in place is the same exposure the self-host reuse path already has.
- **Self-host** → ADW's `.adw/project.md` declares `cli`; the gate proceeds and never merges.
- **Framework hash bump** → this issue edits `adw_init.md`, a `hashInputs` file. Every registered target repository's next issue first triggers `adwUpgrade`, which re-runs `adw_init` before a feature worktree exists. The type is then written, or left out when detection cannot decide. That is the ADR's remedy, not a migration: nothing converts or defaults.
- **`adwUpgrade` and `adwMerge`** never call the init functions, so they never park on the type. The upgrade's regen verification must not require the section, because its absence is a legitimate outcome.
- **Hand-set value across upgrades** → step 3 preserves `cli`/`web` verbatim, so an owner's manual fix survives regeneration.
- **PR-review park** → the top-level `orchestratorScript` already says `adws/adwPrReview.tsx`, so `## Retry` resumes the PR review. With no linked issue (`issueNumber` 0) the comment cannot be posted: the failure is logged and the state is still parked, as in `parkWorkflow`.
- **A park is not a failure** → the board and labels stay as they are, no port is allocated, the exit status is 0, and the cron skips `human_gated` until `## Retry`.
- **The park comment never reads as a directive or a stage** → covered by the existing builder tests; `parkComment.ts` is not changed.
- **Fixtures and casts** → every `test/fixtures/*/.adw/project.md` declares a known type. Phase-test fixtures built with `as unknown as WorkflowConfig`, or typed builders without the optional field, keep compiling.
- **`features/per-issue/feature-937.feature` prose** ("the default application type, `cli`") becomes historical. Its step definitions read no application type, so behaviour is unchanged.

## Acceptance Criteria
- An issue in a repository whose `.adw/project.md` lacks `## Application Type`, or names a type the mapping does not know, parks as `human_gated` with the `missing_application_type` comment from `buildParkComment`: the section is missing or the value is unknown, re-run `adw_init`, and the meaning of `## Retry` and `## Continue`. This holds for every orchestrator that runs `initializeWorkflow`, and for `adwPrReview`.
- An issue in a repository declaring `cli` or `web` proceeds, with `WorkflowConfig.applicationProfile` set from the mapping.
- `## Retry` on such a park re-runs init, which merges the latest default branch before re-reading. A section added there is found, on the self-host path, the target-repo path and the PR-review path alike.
- `projectConfig.applicationType` has no default: an absent or empty section is `null`. Nothing in `adws/` reads it except the config parser and the gate, and a unit test enforces this.
- `APPLICATION_TYPE_PROFILES` maps exactly `cli` (descriptor runner, no images) and `web` (ADW Playwright project, per-issue images), each with a review-guidance section.
- Unit tests prove that both types map correctly, that unknown and missing park, and that a fake third type reaches a consumer (the gate, `describeApplicationProfile`, `requireApplicationProfile`) through the mapping without a consumer change.
- `adw_init.md` detects the type, writes `## Application Type` (`cli` or `web`) in a fresh repository of each type, preserves a hand-set valid value, and leaves the section out when it cannot decide. The drift test ties its offered types to the mapping.
- ADR-0061's `### Confirmation` names the implemented mapping, config, gate, `adw_init` change and their tests, and lists what the later modules still carry.
- Lint, both type checks, the unit suite, the build, the git/gh guard, the branch-name guard, the model-literal guard and the docs-index gate pass. The `@adw-991`, `@adw-989`, `@adw-959` and `@regression` scenarios pass.

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `bunx vitest run adws/core/__tests__/applicationType.test.ts adws/core/__tests__/projectConfig.test.ts adws/core/__tests__/projectConfigLoad.test.ts adws/core/__tests__/projectConfigCommands.test.ts` — mapping, source rule and config tests pass (add `adws/core/__tests__/projectConfigApplicationType.test.ts` if task 2 created it)
- `bunx vitest run adws/phases/__tests__/applicationTypeGate.test.ts adws/phases/__tests__/workflowInit.test.ts adws/phases/__tests__/prReviewPhase.test.ts adws/phases/__tests__/workflowPark.test.ts adws/phases/__tests__/scenarioTestPhase.test.ts` — gate and init wiring pass
- `bunx vitest run adws/__tests__/adwInitPrompt.test.ts adws/forge/__tests__/ adws/triggers/__tests__/retryHandler.test.ts` — `adw_init` drift tests, the unchanged park-comment builder and `## Retry` handling pass
- `grep -n -A2 "^## Application Type" .adw/project.md` — ADW's own repository still declares `cli`
- `grep -n "## Application Type" .claude/commands/adw_init.md` — the prompt detects, writes and reports the section
- `bun run lint` — Run Linter
- `bunx tsc --noEmit` — Type Check (includes `features/` step definitions)
- `bunx tsc --noEmit -p adws/tsconfig.json` — Additional Type Checks
- `bun run test:unit` — full unit suite, zero regressions
- `bun run build` — Run Build
- `bun run lint:git-guard` — the gate uses the typed `mergeLatestFromDefaultBranch`, no `git …` shell-out
- `bun run lint:branch-names` — the edited prompt and new `adws/` code name no branch
- `bun run lint:model-literals` — no model literal introduced
- `bun run lint:docs-index` — the conditional-docs index stays healthy
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-991"` — this issue's scenarios pass
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-989"` — the park-comment scenarios still pass (builder unchanged)
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-959"` — the scenarios that run the real `initializePRReviewWorkflow` still pass
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — regression suite passes (every fixture declares a known type; the subprocess harness's real `initializeWorkflow` proceeds)

## Notes
- **Coding guidelines.** Follow `.adw/coding_guidelines.md` strictly:
  - a pure core mapping, with I/O only in the gate's injected dependencies;
  - string enums (`RunnerMode`, `EvidenceKind`); `readonly` everywhere; no `any`;
  - guard clauses and nesting ≤ 2 (extract `proceed`/`recordLine` in the gate);
  - comments only for the table invariant, the merge-before-park reason and the optional-field invariant; no issue numbers;
  - new files under 300 lines. `projectConfig.ts` (408 lines) and `workflowInit.ts` (470 lines) are already over the limit: change only what this issue needs there.
- **No new library.** If one were needed, `.adw/commands.md` says `bun add <package>`.
- **Why the worktree is the source.** Every `.adw/` value a run uses is read from the worktree the run works in, and the next issues' consumers (the Playwright project in `features/`, the runner commands) must exist in that same worktree.
  - Reading the type from `origin/<default>`, as the upgrade gate reads `.adw-version`, would let a stale worktree run under a type whose machinery it does not contain.
  - The gate therefore reads the worktree, and refreshes it from the default branch once before deciding to park. That is the only path where a stale reused worktree would otherwise stop the run for good.
- **Why `applicationProfile` is optional on `WorkflowConfig`.** This mirrors `gitContext?`: production always sets it, and fixtures built with casts keep compiling. "No default" is kept by `requireApplicationProfile`, which throws instead of falling back. The first phase consumer, the scenario phase of the Playwright issue, must call it and must set `applicationProfile` in the WorkflowConfig builders it exercises, notably `features/regression/support/phaseConfig.ts` (resolve the fixture's type through the mapping; an unresolved fixture is a harness error).
- **`reviewGuidanceSection` values** (`'CLI applications'`, `'Web applications'`) are the titles the reviewer issue gives the per-type sections of `review.md`. That issue may retitle them, in this table only.
- **Detection boundary.** A service with an HTTP API and no pages is `cli`. ADR-0061 ties the type to "the evidence a review needs", and such a review needs no images. An owner who disagrees sets the section by hand, and `adw_init` preserves it.
- **`adw_init.md` is a `hashInputs` file.** Task 8 raises the framework hash. `adwUpgrade` then regenerates `.adw/` in every registered target repository, which writes the detected type there. This is intended: it is the ADR's "re-run `adw_init`", run by ADW itself, before any feature worktree of the next issue exists.
- **Acceptance "adw_init writes the section in a fresh repository of each type"** is covered by the drift test and the `@adw-991` source-text scenarios, per the PRD ("Not unit-tested: `adw_init` and the prompts"). A manual spot check is worthwhile before closing: run `/adw_init` in a scratch copy of a CLI repository and of a web repository, and confirm `## Application Type` reads `cli` and `web`.
- **Do not change `adws/forge/parkComment.ts`.** Its `missing_application_type` title, description and directive meanings are already the ones ADR-0061 asks for, and `@adw-989`'s step definitions hard-code them.
- **Docs.** The `/document` phase updates the owning module docs: `state-and-config` (mapping, config), `workflow-lifecycle-phases` (gate, init), `pr-and-merge-phases` (PR-review init), `commands-and-skills` (`adw_init.md`) and `root-config` (README). If a doc adds ADR-0061 to its `## Decisions`, the matching `Decisions:` block in `.adw/conditional_docs.md` must change in the same commit, or `bun run lint:docs-index` fails. `UBIQUITOUS_LANGUAGE.md` may gain **Application Type** and **Application Profile** entries then.
- **Not in scope** (the PRD's later modules):
  - the Playwright project and the removal of `adw_init`'s step-8 Playwright branch and step-6 `review_proof.md`;
  - the scenario phase's `web` mode and `ADW_APPLICATION_URL`;
  - the step-definition generator's `web` mode;
  - dev-server failure handling;
  - the proof assembler and image selection;
  - the review prompt's guidance sections and the removal of `review_proof.md`.

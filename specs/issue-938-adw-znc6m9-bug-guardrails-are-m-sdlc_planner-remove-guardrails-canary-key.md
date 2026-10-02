# Bug: Guardrails are opt-in per target repository; remove the `guardrails` canary key from `.github/adw.yml`

## Metadata
issueNumber: `938`
adwId: `znc6m9-bug-guardrails-are-m`
issueJson: `{"number":938,"title":"bug: guardrails are mandatory for every target repo; remove the canary key","body":"Source: the `## Divergence` sections of the records named below, in `specs/adr/`. Each item there states the facts, the check that showed them and the owner's ruling. Read those sections before planning; they are the specification.\n\n## Decision record\n\nADR-0050 (`## Divergence`).\n\n## What to build\n\nGuardrail injection is gated on `guardrails: true` in `.github/adw.yml`, default false. Issue #762 called the key temporary rollout scaffolding. The canary is over: inject guardrails for every target repository and remove the key from the configuration reader, the template and the documents.\n\nA `guardrails` key left in an existing repository's file must be ignored without a warning storm: one log line at most.\n\n## Acceptance criteria\n\n- [ ] A target repository with no `.github/adw.yml` gets the guardrail settings injected.\n- [ ] The configuration reader and the template no longer know the key.\n- [ ] Unit tests cover injection with the file absent and with a leftover key.\n- [ ] The Divergence section of ADR-0050 is removed in the same pull request.\n\n## Blocked by\n\n#931\n","state":"OPEN","author":"paysdoc","labels":["adw:bug"],"createdAt":"2026-10-01T19:20:11Z","comments":[],"actionableComment":null}`

## Bug Description
ADW starts every agent with `--dangerously-skip-permissions`. For target repositories it is meant to add its guardrail settings when it starts the agent. These are an inline `--settings` JSON, carrying the deny list from `templates/claude-settings-starter.json` and the framework's five hooks at absolute paths, plus a `CLAUDE_HOOKS_LOG_DIR` pointing at `agents/{adwId}/hook-logs` (ADR-0050).

**Actual behaviour.** Injection only happens when the target repository's `.github/adw.yml` contains `guardrails: true`.
- `resolveGuardrailsDecision` (`adws/core/guardrailsGate.ts:54`) withholds injection whenever `readAdwYml(worktreePath).guardrails !== true`.
- `adws/core/adwYmlConfig.ts` defaults the key to `false` for a missing file, a missing key, an explicit `false` and a malformed value. A malformed value also logs a warning.
- The gate re-reads the file for every agent it starts, so a malformed value logs one warning per agent.
- The template ADW writes still advertises a "Guardrails canary (opt-in)" key. The template exists twice: `ADW_YML_TEMPLATE` and its byte-identical heredoc in `.claude/commands/adw_init.md`.

On 2026-10-01 only `paysdoc/devplatform` had opted in, so `paysdoc/depaudit` runs every agent with no deny rules and no hooks.

**Expected behaviour.** This is ADR-0050 `## Divergence`, item 1, with the owner's ruling of 2026-10-01. Guardrails are mandatory for every target repository: every agent ADW starts for one is injected, whether or not `.github/adw.yml` exists and whatever it says. Only three things withhold injection:
- the kill switch `ADW_TARGET_GUARDRAILS=off`;
- a self-host run;
- a failed startup probe, which fails open with one Slack alert.

The configuration reader and the template no longer know the key. A `guardrails` key left in an existing file is ignored, and ADW logs at most one line about it.

**A second defect hides behind the key and surfaces once it is gone.**
- The phases build the agent launch context as `{ selfHost: !repoContext, … }`.
- `initializeWorkflow` binds a `RepoContext` for self-host runs too (`adws/phases/workflowInit.ts:288-296`). ADW's own runs therefore reach the gate with `selfHost: false`.
- Only the missing `guardrails` key in ADW's own `.github/adw.yml` keeps those runs uninjected today. This planning run is self-host, and `CLAUDE_HOOKS_LOG_DIR` is unset in it.
- `adws/adwUpgrade.tsx:427` pins `selfHost: false`, although `adwUpgrade` also runs self-host.
- `adws/adwPatch.tsx:55` pins `selfHost: true`, although `adwPatch` also runs with `--target-repo`.

Removing the key alone would therefore do two wrong things:
- It would inject the framework's hooks into ADW's own runs on top of ADW's own `.claude/settings.json`, so every hook fires twice. ADR-0050 rules this out: "Self-host runs get no injection … injecting would fire every hook twice".
- It would still leave target-repo patch runs unguarded.

## Problem Statement
1. The rollout canary from #762 is still the gate: a target repository is unguarded unless it opts in.
2. The `.github/adw.yml` reader, its template (two byte-identical copies), its tests and the documents still define the key. A malformed leftover value warns once for every agent ADW starts.
3. The self-host flag handed to the gate comes from `repoContext` instead of the launch boundary. Once the key is gone, ADW would start injecting into its own runs.
4. Several test harnesses start agents in a target-repo context: the in-process BDD fixtures of #929, #930 and #933. Today they stop at the key check. Without it they would run the real, paid guardrails probe, and its fail-open path would post a Slack alert from a test run.

## Solution Statement
- **Reader (`adws/core/adwYmlConfig.ts`).** Delete the `guardrails` field, its default, its key spec, its template block and its documentation. A leftover `guardrails:` line is then an unknown key, which the parser already skips without logging. That is zero log lines, which meets "one log line at most" without any per-process memo state.
- **Template.** Remove the "Guardrails canary" block from `ADW_YML_TEMPLATE` and from the `adw_init.md` heredoc in the same change. `adws/__tests__/adwInitPrompt.test.ts` keeps the two byte-identical. The new template is byte-identical to ADW's own `.github/adw.yml`.
- **Gate (`adws/core/guardrailsGate.ts`).** Drop the key check, the `readAdwYml` dependency and the `worktreePath` input, whose only use was the key read. The order becomes kill switch → self-host → probe, still failing open. `adws/agents/claudeAgent.ts` passes `{ selfHost, adwId }`.
- **Self-host from the launch boundary.**
  - Add `workflowLaunchContext(config)` to `adws/phases/workflowRepoIdentity.ts`. It returns `{ selfHost: config.gitContext?.selfHost ?? true, adwId: config.adwId, gitContext: config.gitContext }`.
  - Use it at all 25 phase sites and in `adwPatch.tsx`. `adwUpgrade.tsx` uses `params.gitContext?.selfHost ?? true`.
  - A config with no `GitContext` (phase-test fixtures only) counts as self-host. That is the same fail-safe `claudeAgent.ts` applies to an absent launch context.
- **Tests.**
  - Update the reader, gate and spawn tests.
  - Add a spawn-level unit test for AC3. It starts an agent in a real temporary worktree, once with no `.github/adw.yml` and once per leftover key value, and asserts the injected `--settings` and `CLAUDE_HOOKS_LOG_DIR`.
  - Add tests for `workflowLaunchContext`.
  - Drop `guardrails` from every `AdwYmlConfig` literal, and the `readAdwYml` dependency from `feature-928-harness.ts`.
  - Add one global BDD `Before`/`After` pair that installs a quiet gate, so no scenario ever runs the real probe.
- **Documents.**
  - Update the README, `app_docs/feature-9gjajh-claude-agents-core.md` and the guardrails entry in `.adw/conditional_docs.md`.
  - Remove the `## Divergence` section of ADR-0050 and change nothing else in it. After acceptance, an ADR may change only in `status`, `superseded-by`, `## Divergence` and the supersession note (`.claude/skills/write-an-adr/SKILL.md`). The precedent is commit 66e18a66, which did the same for ADR-0043 and ADR-0054.
- **First, restore the working tree.** The worktree holds stale copies of `.claude/` files and an unrelated `README.md` line; see Step 1.

## Steps to Reproduce
Run every command from the worktree root.

1. The gate withholds injection for a target repository that has no `.github/adw.yml`, with the probe faked to pass and the kill switch off:
   ```bash
   bunx tsx -e "
   import { mkdtempSync } from 'fs'; import { tmpdir } from 'os'; import { join } from 'path';
   import { resolveGuardrailsDecision, productionGuardrailsGateDeps } from './adws/core/guardrailsGate';
   const worktreePath = mkdtempSync(join(tmpdir(), 'adw-938-repro-'));
   resolveGuardrailsDecision({ selfHost: false, worktreePath, adwId: 'repro-938' }, { ...productionGuardrailsGateDeps, probeGuardrails: async () => ({ ok: true }), notifySlack: async () => {}, getEnv: () => undefined }).then((d) => console.log('target repo without .github/adw.yml -> inject =', d.inject));
   "
   ```
   Today it prints `inject = false`; expected `inject = true`. `tsx` does not type-check, so the same command still runs once `worktreePath` has left the input type.
2. The reader still knows the key and warns about it:
   ```bash
   bunx tsx -e "import { parseAdwYml } from './adws/core/adwYmlConfig'; console.log(JSON.stringify(parseAdwYml('guardrails: maybe\nunitTests: false\n')))"
   ```
   Today it prints `adw.yml: malformed 'guardrails' value "maybe", defaulting to disabled (guardrails: false)` followed by `{"hitl":false,"unitTests":false,"guardrails":false}`. Expected: no log line, then `{"hitl":false,"unitTests":false}`.
3. The template still offers the key:
   ```bash
   bunx tsx -e "import { ADW_YML_TEMPLATE } from './adws/core/adwYmlConfig'; process.stdout.write(ADW_YML_TEMPLATE)" | diff - .github/adw.yml
   ```
   Today the diff shows the 5-line "Guardrails canary" block. Expected: no diff.
4. Self-host is derived from `repoContext`. Today the following returns 26 lines: the 25 phase sites plus the mirror in `feature-929-agents.ts:75`. Expected: none.
   ```bash
   grep -rnE --include='*.ts' --include='*.tsx' 'selfHost: ![A-Za-z.]*repoContext' adws features
   ```
   The grep is limited to TypeScript because the prose of `feature-938.feature` quotes the old expression.

## Root Cause Analysis
1. **The canary was never removed.** #762 added `guardrails` as "temporary rollout scaffolding; the end state is mandatory guardrails for all target repos", and it stayed as the third gate:
   - `guardrailsGate.ts:54`: `if (deps.readAdwYml(input.worktreePath).guardrails !== true) return { inject: false };`.
   - `adwYmlConfig.ts:45` `DEFAULT_CONFIG.guardrails = false`, used when the file is absent.
   - The `KEY_SPECS` entry (`adwYmlConfig.ts:104-109`), which gives `false` for an omitted key and `false` plus a warning for a malformed value.
   - The template block at `adwYmlConfig.ts:63-66`, mirrored at `adw_init.md` step 9.
2. **The warning storm.** The malformed-value warning comes from the `guardrails` key spec, and `productionGuardrailsGateDeps.readAdwYml` re-reads the file on every agent start. N agents give N warnings.
3. **The latent self-host mislabel.**
   - Commit f1ee47c9 (#762's launch-context threading) built a phase-local `gitContextFor({ owner, repo, selfHost: !repoContext })` and passed `gitCtx.selfHost`.
   - Commit 03ae1c59 retired the phase-local context and inlined `selfHost: !repoContext` at every phase site.
   - The #762 plan intended `GitContext.selfHost` from the launch boundary.
   - `repoContext` is bound for self-host runs as well (`workflowInit.ts` → `bindWorkspaceContext`), so the flag is `false` on ADW's own runs.
   - The key masked this, because ADW's own `.github/adw.yml` never had `guardrails: true`.
   - `adwUpgrade.tsx` and `adwPatch.tsx` pin a constant instead of reading the boundary.
4. **Test hermeticity.** Several in-process BDD fixtures start agents with `selfHost: false` and no gate override:
   - `feature-929-agents.ts:75` computes `!repoContext` over a target boundary from `buildRecordingBoundary` → `buildLaunchBoundary(makeTargetRepo(...))`.
   - The `feature-933` phases run over the same kind of boundary.
   - `feature-930.steps.ts:108` passes `selfHost: false` explicitly. Once phases read the boundary, `feature-930-plan-fixture.ts` also passes `false` through its `selfHost: false` `GitContext`.

   All of them stop at the key check today. Without it they reach `getGuardrailsProbeVerdict()`, which runs `scripts/guardrails-probe.ts`: real `claude` calls unless `CLAUDE_CODE_PATH` points at a stand-in. Its failure calls `postSlack`, and the host `.env` can set `SLACK_WEBHOOK_URL`.

## Relevant Files
Use these files to fix the bug:

**Gate, reader, template and spawn**
- `adws/core/adwYmlConfig.ts`: the `.github/adw.yml` reader and `ADW_YML_TEMPLATE`. Holds the `guardrails` field, its default, its key spec, the template block, the docblock rules and the read-failure message that names the key.
- `adws/core/guardrailsGate.ts`: the gate. Holds the key check (`:54`), the `readAdwYml` dependency, the `worktreePath` input and docblocks that describe the canary.
- `adws/agents/claudeAgent.ts`: the spawn. It calls `resolveGuardrailsDecisionForSpawn` with `worktreePath: resolvedCwd` (`:142-144`).
- `.claude/commands/adw_init.md`: step 9's heredoc must stay byte-identical to `ADW_YML_TEMPLATE`. It is a `hashInputs:` file.

**Launch context**
- `adws/phases/workflowRepoIdentity.ts`: home of `requireWorkflowGitContext` and `resolveWorkflowRepoId`. The new `workflowLaunchContext` goes here.
- The phase files with the 25 `selfHost: !repoContext` sites:
  - `adws/phases/alignmentPhase.ts:130,185`
  - `adws/phases/buildPhase.ts:145,221,273`
  - `adws/phases/diffEvaluationPhase.ts:98`
  - `adws/phases/documentPhase.ts:55,104`
  - `adws/phases/installPhase.ts:108`
  - `adws/phases/planPhase.ts:87`
  - `adws/phases/planValidationPhase.ts:38`
  - `adws/phases/prPhase.ts:28,60`
  - `adws/phases/prReviewPhase.ts:151,227,300`
  - `adws/phases/promotionRotAdvisory.ts:118`
  - `adws/phases/reviewPhase.ts:143,243`
  - `adws/phases/scenarioFixPhase.ts:82,117`
  - `adws/phases/scenarioPhase.ts:52`
  - `adws/phases/scenarioTestFixLoop.ts:86`
  - `adws/phases/stepDefPhase.ts:33`
  - `adws/phases/unitTestPhase.ts:66`
- `adws/adwPatch.tsx`: `:44-55` pins `selfHost: true` for a run that may target a repository.
- `adws/adwUpgrade.tsx`: `:427` pins `selfHost: false` in `runInitCommandDefault`; `adwUpgrade` also runs self-host.

**Unit tests**
- `adws/core/__tests__/adwYmlConfig.test.ts`: every expectation carries `guardrails`. Lines 160-206 test the key.
- `adws/core/__tests__/guardrailsGate.test.ts`: built around `readAdwYml` and `makeAdwYmlConfig`.
- `adws/agents/__tests__/claudeAgent.test.ts`: `:440-463` assert the gate input includes `worktreePath`.
- `adws/__tests__/adwUpgrade.test.ts`: `:398` expects `guardrails: false`.
- `adws/phases/__tests__/prReviewCompletion.test.ts`: `:96` is a typed `WorkflowConfig` literal carrying `guardrails: false`, which is a type error once the field is gone.
- `adws/phases/__tests__/workflowRepoIdentity.test.ts`: gets the `workflowLaunchContext` tests.
- `adws/__tests__/adwInitPrompt.test.ts`: unchanged. It proves the heredoc and `ADW_YML_TEMPLATE` stay byte-identical.

**BDD scenarios and harnesses**
- `features/per-issue/feature-938.feature`: this issue's scenarios. Read-only for the plan. Its §1 to §5 and the "Notes for the step definitions" pin the observable behaviour.
- `features/regression/support/hooks.ts`: the global support file cucumber loads for every scenario. The quiet guardrails gate goes here.
- `features/per-issue/step_definitions/feature-928-harness.ts`: `:20` imports `AdwYmlConfig`, and `:208` passes `readAdwYml` to `setGuardrailsGateDepsForTesting`, which is a type error once the dependency is gone.
- `AdwYmlConfig` literals that carry `guardrails: false`:
  - `features/per-issue/step_definitions/feature-820.steps.ts:300`
  - `features/per-issue/step_definitions/feature-929-workflow.ts:108`
  - `features/per-issue/step_definitions/feature-929.steps.ts:153`
  - `features/per-issue/step_definitions/feature-930-plan-fixture.ts:142`
  - `features/per-issue/step_definitions/feature-933-workflow.ts:153`
  - `features/per-issue/step_definitions/feature-937-workflow.ts:122`

  The `feature-929.steps.ts` and `feature-933-workflow.ts` literals are typed, so they fail the type-check. The rest are cast but are updated for consistency.
- `features/per-issue/step_definitions/feature-929-agents.ts`: `:75` mirrors the phases' `selfHost: !workflow.config.repoContext`.

**Documents**
- `README.md`: `:22`, the feature bullet describing the canary, and `:612`, the `guardrailsGate.ts` tree comment.
- `app_docs/feature-9gjajh-claude-agents-core.md`: `:24` and `:45` give the gate chain with the canary; `:67` is the `.github/adw.yml` `guardrails: true` bullet.
- `.adw/conditional_docs.md`: `:661` names "the `.github/adw.yml`/kill-switch/self-host gate".
- `specs/adr/0050-target-repo-guardrails.md`: `:72-75` is the `## Divergence` section to remove.

**Read for context only; do not change**
- `adws/core/guardrailsPayload.ts`, `adws/core/guardrailsProbe.ts` and `scripts/guardrails-probe.ts`: the payload and the memoized, fail-open probe.
- `adws/phases/workflowInit.ts` (`:288-296`, `:411-439`): `repoContext` is bound for self-host runs; `gitContext: boundary.gitContext`.
- `adws/core/launchGitContext.ts` (`:198`): `selfHost = targetRepo === null`.
- `adws/triggers/autoMergeHandler.ts` (`:64`): already passes `selfHost: ctx.selfHost`.
- `adws/adwDocument.tsx` (`:65-76`): `buildLaunchBoundary(null)` is always self-host, so its `selfHost: true` is the boundary's value and stays.
- `.github/adw.yml`: ADW's own file. It never had the key, and it equals the new template byte for byte.
- `.claude/skills/write-an-adr/SKILL.md`: what may change in an accepted ADR.
- `specs/adr/0005-adw-directory-config-per-target-repo.md`: `:65` names the `guardrails` flag. It is immutable under the same rule; see Notes.

**Conditional documentation** (matched in `.adw/conditional_docs.md`)
- `app_docs/feature-9gjajh-claude-agents-core.md`: target-repo guardrails injection; owns `guardrailsGate.ts` and `claudeAgent.ts`.
- `app_docs/feature-9gjajh-state-and-config.md`: owns `adwYmlConfig.ts`. It already lists only `hitl` and `unitTests` (`:13`, `:25`), so no change.
- `app_docs/feature-9gjajh-commands-and-skills.md`: `adw_init`'s `.github/adw.yml` creation and `adwInitPrompt.test.ts`.
- `app_docs/feature-9gjajh-workflow-lifecycle-phases.md`: owns `workflowRepoIdentity.ts` and `workflowInit.ts`.
- `app_docs/feature-9gjajh-bdd-regression-suite.md`: owns `features/regression/**`.
- `app_docs/feature-9gjajh-bdd-per-issue.md`: owns `features/per-issue/**`.
- `app_docs/feature-9gjajh-root-config.md`: owns `README.md` and `.github/**`.
- `app_docs/feature-9gjajh-document-phase.md`: owns `.adw/conditional_docs.md`.
- `app_docs/feature-9gjajh-specs-and-prd.md`: owns `specs/**`.
- The phase owners, read when editing their phases:
  - `app_docs/feature-9gjajh-build-and-plan-phases.md`
  - `app_docs/feature-9gjajh-test-and-scenario-phases.md`
  - `app_docs/feature-9gjajh-pr-and-merge-phases.md`
  - `app_docs/feature-9gjajh-review-and-diff-phases.md`
  - `app_docs/feature-9gjajh-promotion-system.md`
  - `app_docs/feature-9gjajh-feature-orchestrators.md` (`adwPatch`, `adwUpgrade`)

  The launch-context change does not alter what those documents describe.

### New Files
- `adws/agents/__tests__/claudeAgentGuardrails.test.ts`: the AC3 unit tests at the spawn boundary, using the real gate in a real temporary worktree.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### 1. Restore the stale working-tree copies before touching anything
- `git status --short` shows tracked modifications this issue did not make: 13 files under `.claude/` (`commands/adw_init.md`, `bug.md`, `chore.md`, `clean_local_repo.md`, `document.md`, `feature.md`, `generate_step_definitions.md`, `resolve_conflict.md`, `resolve_failed_test.md`, `review.md`, `scenario_writer.md`, `skills/depaudit-triage/SKILL.md`, `skills/implement-tdd/SKILL.md`) and `README.md`.
- Where they come from:
  - The `.claude/` files are byte-identical to the runner checkout's own copies: `/Users/martin/projects/paysdoc/AI_Dev_Workflow` on `main` at 3f1ed745.
  - That checkout's `copyClaudeAssetsToWorktree` predates the rule that leaves the framework repository's tracked prompts alone, so it wrote them over the branch's prompts when it created the worktree.
  - `README.md` carries one unrelated extra line, a `planCommitGuard.ts` tree entry.
- Why they must go before any edit:
  - They undo #931's prompt restoration. `/commit` runs `git add -A`, so leaving them would revert #931 in this pull request.
  - They make `adws/__tests__/adwInitPrompt.test.ts` (2 tests) and `adws/__tests__/depauditTriageSkill.test.ts` (3 tests) fail before any change. Both files pass against a clean export of `HEAD`.
  - The working-tree `adw_init.md` has no step 9 heredoc at all, so the edit in Step 3 cannot be made against it.
- Confirm the list with `git diff --stat`, then restore: `git checkout HEAD -- .claude/commands .claude/skills README.md`.
- Afterwards no tracked file may show as modified. The untracked `features/per-issue/feature-938.feature` belongs to the scenario phase; leave it alone.
- Re-run `git status --short` before every commit in this issue and make sure only files this plan names are staged.

### 2. Remove the key from the reader (`adws/core/adwYmlConfig.ts`)
- **Module docblock:**
  - Delete the four `guardrails` rule lines.
  - Change the "File absent" and "File unreadable" lines to `{ hitl: false, unitTests: true }`.
  - Add one rule: `- Any other key → ignored without a log line (a \`guardrails:\` line left from the retired opt-in is one)`.
- **`AdwYmlConfig` JSDoc:** delete the `guardrails: true` paragraph. The interface keeps `hitl` and `unitTests` only.
- **`DEFAULT_CONFIG`:** `{ hitl: false, unitTests: true }`.
- **`ADW_YML_TEMPLATE`:** delete the blank line and the four "Guardrails canary (opt-in)" comment lines, so the template ends with `# hitl: false\n`. It must equal ADW's own `.github/adw.yml` byte for byte.
- **`KEY_SPECS`:** delete the `guardrails` entry.
- **`parseAdwYml`:** delete the `guardrails` line from the returned object.
- **`readAdwYmlConfig` catch:** the message ends `defaulting to { hitl: false, unitTests: true }`. No log line ADW writes may contain both "guardrails" and "adw.yml"; §2 of `feature-938.feature` counts such lines.
- **Do not add any log about a leftover key.** `applyKeySpec` already skips a line no key spec matches.

### 3. Remove the key from the template copy in `.claude/commands/adw_init.md`
- In step 9's heredoc, delete the same five lines: the blank line, then `# Guardrails canary (opt-in). …`, `# into every agent spawn …`, `# .claude/settings.json of its own. Default: false.` and `# guardrails: false`. `# hitl: false` becomes the last line before `EOF`.
- Change nothing else in the file. Step 7, "Copy Starter Guardrails Settings", is the starter `.claude/settings.json` and has nothing to do with the key.
- `adws/__tests__/adwInitPrompt.test.ts` must pass. It compares this heredoc with `ADW_YML_TEMPLATE`.

### 4. Make the gate unconditional apart from the kill switch, self-host and the probe (`adws/core/guardrailsGate.ts`)
- Delete the imports of `readAdwYmlConfig` and `AdwYmlConfig`.
- `GuardrailsGateInput`: `{ readonly selfHost: boolean; readonly adwId: string }`. Drop `worktreePath`, whose only use was the key read.
- `GuardrailsGateDeps`: drop `readAdwYml`.
- `resolveGuardrailsDecision`: delete the key check. The guard clauses are: kill switch, then self-host, then probe verdict (failure → AWAIT one alert, return `{ inject: false }`), then build and inject.
- Docblocks:
  - Module: three gates in strict order (kill switch, self-host, a startup probe that fails open), so a wrong deny rule can never wedge the queue.
  - Function: the chain numbered 1 to 3, and "Only once all three pass…".
- `productionGuardrailsGateDeps`: drop `readAdwYml`.

### 5. Pass the new gate input from the spawn (`adws/agents/claudeAgent.ts`)
- Change the call to `resolveGuardrailsDecisionForSpawn({ selfHost: launchContext?.selfHost ?? true, adwId: launchContext?.adwId ?? '' })`.
- Keep the comment that an absent launch context counts as self-host. `resolvedCwd` stays; the spawn options use it.

### 6. Take self-host from the launch boundary at every launch-context site
- **Add the helper.** In `adws/phases/workflowRepoIdentity.ts`, add the following, importing `type { AgentLaunchContext }` from `'../agents/claudeAgent'` (the `adws/agents` barrel does not re-export it):
  ```ts
  /**
   * Self-host is the launch boundary's fact: a RepoContext is bound for self-host runs too, so it cannot
   * stand in for it. A config without a GitContext (phase-test fixtures only) counts as self-host and never injects.
   */
  export function workflowLaunchContext(config: Pick<WorkflowConfig, 'adwId' | 'gitContext'>): AgentLaunchContext {
    return { selfHost: config.gitContext?.selfHost ?? true, adwId: config.adwId, gitContext: config.gitContext };
  }
  ```
- **Replace the 25 phase sites.** At each site listed under Relevant Files, replace the `{ selfHost: !repoContext, adwId, gitContext: … }` literal with `workflowLaunchContext(config)`. The `prReviewPhase.ts` sites use `workflowLaunchContext(config.base)`. Every `gitContext` those literals carried, including the `gitCtx` aliases, is `config.gitContext`, so the passed context is unchanged apart from `selfHost`.
- **Drop `repoContext` where it becomes unused.** This happens in `scenarioPhase.ts:17`, `installPhase.ts:90`, `stepDefPhase.ts:15`, `scenarioTestFixLoop.ts:45` and `scenarioFixPhase.ts:31`. Let `bun run lint` (`no-unused-vars` is an error) confirm, and keep it wherever it is still used.
- **`adws/adwPatch.tsx`:** pass `workflowLaunchContext(config)` and delete the "selfHost pinned to true…" comment. A `--target-repo` patch run is then guarded like every other target run.
- **`adws/adwUpgrade.tsx` `runInitCommandDefault`:** `{ selfHost: params.gitContext?.selfHost ?? true, adwId: params.adwId, gitContext: params.gitContext }`.
- **Leave these alone:**
  - `adws/adwDocument.tsx`: its boundary is always self-host.
  - `adws/triggers/autoMergeHandler.ts`: it already uses `ctx.selfHost`.
  - Callers that pass no launch context: the classifier and the branch-name agent run framework-side.
- **`features/per-issue/step_definitions/feature-929-agents.ts:75`** mirrors the phase expression. Change it to `selfHost: requireWorkflowGitContext(workflow.config).selfHost`. Its boundary is a target boundary, so the value stays `false`.

### 7. Keep every BDD scenario away from the real guardrails probe (`features/regression/support/hooks.ts`)
- Add an untagged `Before` that calls `setGuardrailsGateDepsForTesting({ ...productionGuardrailsGateDeps, probeGuardrails: async () => ({ ok: false }), notifySlack: async () => undefined })`, and an untagged `After` that calls `setGuardrailsGateDepsForTesting(null)`.
  - Import both from `'../../../adws/core/guardrailsGate.ts'`.
  - Precede them with one comment line saying why: once the key is gone, every target-repo agent start reaches the probe, which is a paid, network-bound `claude` run whose failure alerts Slack.
- How it interacts with scenario steps:
  - A scenario that needs a passing or failing probe installs its own override in a step, which replaces this one, because steps run after hooks. `feature-938.feature`'s "the guardrails startup probe passes/fails" steps do exactly that.
  - Because the quiet gate spreads `productionGuardrailsGateDeps`, the kill switch in `process.env` still works.
- `features/per-issue/step_definitions/feature-928-harness.ts`:
  - Delete the `readAdwYml` line from `quietGuardrailsGate()` and the now-unused `AdwYmlConfig` import.
  - Its docblock "never probes and never injects" becomes "never runs the real probe and never injects `--settings`". The gate now consults its failing fake probe.

### 8. Drop `guardrails` from every `AdwYmlConfig` literal
- Remove `, guardrails: false` from:
  - `features/per-issue/step_definitions/feature-820.steps.ts:300`
  - `features/per-issue/step_definitions/feature-929-workflow.ts:108`
  - `features/per-issue/step_definitions/feature-929.steps.ts:153`
  - `features/per-issue/step_definitions/feature-930-plan-fixture.ts:142`
  - `features/per-issue/step_definitions/feature-933-workflow.ts:153`
  - `features/per-issue/step_definitions/feature-937-workflow.ts:122`
  - `adws/phases/__tests__/prReviewCompletion.test.ts:96`
- Then `grep -rn "guardrails: \(true\|false\)" adws features` may only match test inputs that write a leftover key into a file or string.

### 9. Update and add unit tests
- **`adws/core/__tests__/adwYmlConfig.test.ts`**
  - Mock the logger for the whole file: `vi.mock('../utils', async (importOriginal) => ({ ...(await importOriginal<typeof import('../utils')>()), log: vi.fn() }))`, and clear it in `beforeEach`.
  - Change every expectation to the two-key shape, `{ hitl, unitTests }`.
  - Replace the key's tests (`:160-206`) with a `describe` for a leftover key. It covers:
    - `it.each(['guardrails: true', 'guardrails: false', 'guardrails: maybe'])`: a file holding the line followed by `unitTests: false` and `hitl: true`, read three times through `readAdwYmlConfig`, returns `{ hitl: true, unitTests: false }` every time, and `log` is never called. This is the "no warning storm" proof.
    - `readAdwYmlConfig` for an absent file and for a leftover-key file returns no `guardrails` property (`not.toHaveProperty('guardrails')`).
    - A malformed known key (`unitTests: maybe`) still logs exactly one `warn`, so removing the key's spec did not break malformed-value handling.
  - `ADW_YML_TEMPLATE` parses to `{ hitl: false, unitTests: true }`, and no line matches `/^\s*#?\s*guardrails\s*:/im`.
  - Update the `writeAdwYmlTemplateIfAbsent` expectations to the two-key shape.
- **`adws/core/__tests__/guardrailsGate.test.ts`**
  - Rewrite `makeDeps` without `readAdwYml` and `makeAdwYmlConfig`; `BASE_INPUT = { selfHost: false, adwId: 'adw-test-123' }`.
  - Keep, adapted:
    - kill switch → no inject, probe not called;
    - self-host → no inject, probe not called;
    - probe failure → no inject plus one AWAITED alert carrying the detail;
    - probe pass → inject, with a parseable payload, a non-empty deny list, a `hookLogDir` containing the adwId and no alert.
  - Delete the two "withholds injection when adw.yml …" tests.
  - Add "injects for a target-repo agent with no repository configuration consulted": the deps carry only probe, alert and env.
- **`adws/agents/__tests__/claudeAgent.test.ts`**
  - The gate-input test becomes "passes selfHost/adwId derived from launchContext to the gate" and expects `{ selfHost: false, adwId: 'adw-guard-1' }`.
  - The fail-safe test expects `{ selfHost: true, adwId: '' }`.
- **New `adws/agents/__tests__/claudeAgentGuardrails.test.ts` (AC3)**
  - Use the real gate through `runClaudeAgentWithCommand`.
  - Mock only the process boundary:
    - `child_process`: spread the real module so the `adws/core` barrel's other imports still resolve, then override two exports. `spawn` returns `{ pid: 1234, unref: vi.fn() }` and `execSync` is a `vi.fn()`:
      ```ts
      vi.mock('child_process', async (importOriginal) => ({ ...(await importOriginal<typeof import('child_process')>()), spawn: vi.fn(), execSync: vi.fn() }))
      ```
    - `../agentProcessHandler`: `handleAgentProcess` resolves a successful `AgentResult`.
  - Set up in `beforeEach`:
    - Set `process.env.CLAUDE_CODE_PATH = process.execPath` (an existing absolute file, so `resolveClaudeCodePath()` never shells out) and call `clearClaudeCodePathCache()`.
    - Call `setGuardrailsGateDepsForTesting({ probeGuardrails: vi.fn(async () => ({ ok: true })), notifySlack: vi.fn(async () => undefined), getEnv: () => undefined })`.
  - Tear down in `afterEach`: reset the override to `null`, restore `CLAUDE_CODE_PATH`, clear the cache, and remove the temporary directories with `fs.rmSync`.
  - Cases, each starting `/commit` in a fresh `mkdtempSync` worktree as `cwd` with launch context `{ selfHost: false, adwId }`:
    - no `.github/adw.yml`;
    - a file holding `unitTests: true` plus a leftover `guardrails: false`;
    - the same with `guardrails: true`;
    - the same with `guardrails: maybe`.
  - For each case, assert:
    - the spawned argv holds `--settings` followed by JSON deep-equal to `buildGuardrailsSettings({ frameworkRepoRoot: REPO_ROOT })`;
    - the spawn env's `CLAUDE_HOOKS_LOG_DIR` equals `resolveHookLogDir(adwId)` and lies outside the worktree.
  - Add one self-host case in the same kind of worktree: no `--settings`, no `CLAUDE_HOOKS_LOG_DIR`, probe not called.
- **`adws/__tests__/adwUpgrade.test.ts:398`:** expect `{ hitl: false, unitTests: true }`.
- **`adws/phases/__tests__/workflowRepoIdentity.test.ts`:** add a `describe('workflowLaunchContext')`:
  - a self-host `GitContext` (`{ selfHost: true }` cast) gives `selfHost: true` and passes `adwId` and the same `gitContext` through;
  - a target `GitContext` (`selfHost: false`) gives `selfHost: false`;
  - no `gitContext` gives `selfHost: true`.

### 10. Update the documents
- **`README.md:22`.** Rewrite the opening of the bullet: every target-repo `claude` spawn gets the `--settings` injection; `resolveGuardrailsDecision` (`guardrailsGate.ts`) withholds it only for the `ADW_TARGET_GUARDRAILS=off` kill switch, a self-host run, or a failed memoized startup probe (`scripts/guardrails-probe.ts`) that fails OPEN (no injection + one Slack alert) rather than blocking; there is no per-repository switch. Keep the payload sentence as it is.
- **`README.md:612`.** Change the comment to `(kill switch, self-host, startup probe)`.
- **`app_docs/feature-9gjajh-claude-agents-core.md`**
  - `:24`: the chain becomes "kill switch → self-host → startup probe verdict".
  - `:45`: "kill switch (`ADW_TARGET_GUARDRAILS=off`) → self-host → probe verdict", plus one sentence: no repository setting takes part; a target repository is injected with or without `.github/adw.yml`, and a leftover `guardrails:` key there is ignored.
  - `:44`: add one sentence: phases take `selfHost` from the launch boundary's `GitContext.selfHost` through `workflowLaunchContext` (`adws/phases/workflowRepoIdentity.ts`), never from whether a `RepoContext` was bound.
  - `:67`: delete the `.github/adw.yml` `guardrails: true` bullet.
- **`.adw/conditional_docs.md:661`.** Change it to "…the `--settings` payload, the kill-switch/self-host gate, or the fail-open startup probe".
- **Do not edit** `app_docs/feature-9gjajh-state-and-config.md` (already two keys) or ADR-0005; see Notes.

### 11. Remove the Divergence section of ADR-0050 (`specs/adr/0050-target-repo-guardrails.md`)
- Delete four lines: `## Divergence`, the blank line, item 1 ("**Guardrails are still opt-in.** …"), and the blank line after it.
- `## More Information` then follows the `Not run: …` paragraph after one blank line.
- Change nothing else in the ADR.

### 12. Run the validation commands
- Run every command in `Validation Commands`.
- A failure in a file this plan does not name is a regression to fix, not to skip.
- Before the commit, `git status --short` must list only:
  - the files named in Steps 2 to 11;
  - the new test file;
  - this plan;
  - the untracked `features/per-issue/feature-938.feature` and its step definitions if a phase produced them.

## Validation Commands
Execute every command to validate the bug is fixed with zero regressions.

- Before and after, the reproductions from `Steps to Reproduce`:
  - `bunx tsx -e "import { mkdtempSync } from 'fs'; import { tmpdir } from 'os'; import { join } from 'path'; import { resolveGuardrailsDecision, productionGuardrailsGateDeps } from './adws/core/guardrailsGate'; const worktreePath = mkdtempSync(join(tmpdir(), 'adw-938-repro-')); resolveGuardrailsDecision({ selfHost: false, worktreePath, adwId: 'repro-938' }, { ...productionGuardrailsGateDeps, probeGuardrails: async () => ({ ok: true }), notifySlack: async () => {}, getEnv: () => undefined }).then((d) => console.log('target repo without .github/adw.yml -> inject =', d.inject));"`
    - Before: `inject = false`. After: `inject = true`.
  - `bunx tsx -e "import { parseAdwYml } from './adws/core/adwYmlConfig'; console.log(JSON.stringify(parseAdwYml('guardrails: maybe\nunitTests: false\n')))"`
    - After: exactly `{"hitl":false,"unitTests":false}`, with no `adw.yml:` warning line.
  - `bunx tsx -e "import { ADW_YML_TEMPLATE } from './adws/core/adwYmlConfig'; process.stdout.write(ADW_YML_TEMPLATE)" | diff - .github/adw.yml`
    - After: no output, exit 0.
- `! grep -rnE --include='*.ts' --include='*.tsx' 'selfHost: ![A-Za-z.]*repoContext' adws features`: no TypeScript site derives self-host from `repoContext`. Keep the single quotes; the `.feature` prose is excluded on purpose.
- `! grep -rniE "^\s*#?\s*guardrails\s*:" adws/core/adwYmlConfig.ts .claude/commands/adw_init.md .github/adw.yml`: neither template copy offers the key.
- `! grep -n "^## Divergence" specs/adr/0050-target-repo-guardrails.md`: the Divergence section is gone.
- `bun run lint`
- `bunx tsc --noEmit`: the root config also type-checks `features/` (scenario T22).
- `bunx tsc --noEmit -p adws/tsconfig.json`
- `bun run build`
- `bun run test:unit`: everything passes, including the two `adwInitPrompt.test.ts` and three `depauditTriageSkill.test.ts` tests that failed only because of the stale copies Step 1 restores.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-938"`: this issue's scenarios, once their step definitions exist.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-820 or @adw-928 or @adw-929 or @adw-930 or @adw-933 or @adw-937"`: the scenarios whose step definitions or fixtures this plan touches, now under the global quiet gate.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"`
- `git status --short && git diff --stat HEAD`
  - The only file changed under `.claude/` is `.claude/commands/adw_init.md`, and only its heredoc.
  - `README.md` changes only on lines 22 and 612.

## Notes
- Follow `.adw/coding_guidelines.md`, in particular its Comments entry: comment only invariants and non-obvious reasons, never restate code, never cite issue numbers in code comments. Keep functions flat with guard clauses. Remove unused imports and variables; ESLint treats them as errors.
- No new library is needed.
- **Decision on the leftover key: log nothing.** The issue allows one line at most and `feature-938.feature` leaves the choice to the plan. With the key spec gone, a `guardrails:` line is an unknown key like any other and is skipped without a log line. That is zero lines per run with no per-process memo state. It also holds §2 of `feature-938.feature`, which counts lines containing both "guardrails" and "adw.yml". So no gate or spawn log may mention the file.
- **Decision on the gate's inputs:** the gate keeps no dependency on the configuration reader and no `worktreePath`. Without the key, nothing in a repository's files may influence the decision, and the input type now makes that structural.
- **Why the self-host fix is in scope.** Without it, removing the key injects the framework's hooks into ADW's own runs (self-host from the runner checkout, ADR-0019) on top of ADW's own `.claude/settings.json`. Every hook would fire twice, which ADR-0050's decision forbids.
  - `adwPatch.tsx` gets the helper too, because the ruling makes guardrails mandatory for every target repository and a `--target-repo` patch run was the remaining unguarded path.
  - `adwDocument.tsx` builds only a self-host boundary, so it keeps `selfHost: true`.
- **`feature-938.feature`'s step-definition notes** say the phases pass `selfHost: !repoContext` for a target repository. That parenthetical describes the expression before this fix. The values the steps pass are unchanged: `{ selfHost: false, adwId }` for a target run and `selfHost: true` for ADW's own repository. They match what `workflowLaunchContext` yields, so the scenarios need no change.
- **ADR immutability.** Only the `## Divergence` section of ADR-0050 is removed. Two pieces of text are left as they are:
  - Its Decision Outcome still lists the key as one of the gates, as the recorded rollout state.
  - ADR-0005's `## More Information` names `guardrails` among the flags `adwYmlConfig.ts` reads.

  The `write-an-adr` skill allows no other edit to an accepted ADR. If the owner wants the decision text to state the end state, that is a new ADR that supersedes ADR-0050. Raise it in the pull request; do not edit either ADR beyond the Divergence removal.
- **Propagation.** `adw_init.md` is a `hashInputs:` file, so this edit changes the framework hash, and every registered target repository gets a framework-upgrade pull request.
  - `writeAdwYmlTemplateIfAbsent` and step 9 never overwrite an existing `.github/adw.yml`. `paysdoc/devplatform`'s `guardrails: true` line therefore stays and is ignored, and the owner may delete it by hand.
  - The runner runs `main`, so the behaviour change reaches target runs only after `dev` is promoted (ADR-0019). The first target spawn in a process then runs the memoized probe; the cron already warms it at startup. A failing probe still fails open with one Slack alert.
- **The global BDD quiet gate** (Step 7) is needed because removing the key exposes the probe to every in-process scenario that starts a target-repo agent: the fixtures of #929, #930 and #933 today. It is overridable by any step. The pause-queue regression scenarios relaunch a fixture script whose argv is intercepted before `tsx` runs it, and no BDD step starts a real orchestrator subprocess, so the in-process hook is enough.
- **The untracked `features/per-issue/feature-938.feature`** was written by the scenario phase in this worktree. Do not edit it. Its step definitions must follow the file's own notes: scope hooks to `@adw-938`, spread `productionGuardrailsGateDeps` and replace only the probe and the alert sender, never start the real Claude CLI.

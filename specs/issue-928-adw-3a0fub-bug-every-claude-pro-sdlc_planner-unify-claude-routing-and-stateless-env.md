# Bug: Claude processes bypass the routing tables, build a prompt in code and start with auto-memory on; the health check requires the optional API key

## Metadata
issueNumber: `928`
adwId: `3a0fub-bug-every-claude-pro`
issueJson: `{"number":928,"title":"bug: every claude process uses the routing tables, a slash command and a stateless environment","body":"Source: the `## Divergence` sections of the records named below, in `specs/adr/`. Each item there states the facts, the check that showed them and the owner's ruling. Read those sections before planning; they are the specification.\n\n## Decision records\n\nADR-0010 (items 1 and 2), ADR-0015 (item 1), ADR-0052 (item 1), ADR-0057 (items 1 and 2).\n\n## What to build\n\n- **Routing tables (ADR-0010).** Three call sites pass a literal model: the upgrade orchestrator running `/adw_init`, the auto-merge handler running `/resolve_conflict`, and the output-validation retry. Each must read the model and effort from the routing tables. `/resolve_conflict` needs an entry in the command union and in all four tables. In the fast tables, `/promote_regression_vocabulary` is routed to Haiku with an effort; the effort must be undefined.\n- **Retry as a slash command (ADR-0015).** The output-validation retry builds its prompt in code. Make it a command file invoked like every other command.\n- **Stateless probes (ADR-0052).** The rate-limit probe, the schema probe and the guardrails probe start `claude` without `CLAUDE_CODE_DISABLE_AUTO_MEMORY`. Give every `claude` process ADW starts one shared launch environment that sets it.\n- **API key is optional (ADR-0057).** The health check must not list `ANTHROPIC_API_KEY` as required. The environment sample, both READMEs, the orchestrator usage text and the orchestrator header comments must present the key as optional and say that setting it moves billing from the subscription to the API. ADW keeps forwarding the key when it is set.\n\n## Acceptance criteria\n\n- [ ] No call site outside the routing module names a model literally; a unit test or lint rule fails if one is added.\n- [ ] No Haiku entry in any routing table carries an effort; a unit test asserts it.\n- [ ] The retry runs a command file; no prompt is assembled in code.\n- [ ] All three probes set the memory variable; unit tests assert it.\n- [ ] The health check passes with the key unset.\n- [ ] The Divergence sections of ADR-0010, ADR-0015, ADR-0052 and ADR-0057 are removed in the same pull request.\n","state":"OPEN","author":"paysdoc","labels":["adw:bug"],"createdAt":"2026-10-01T19:19:55Z","comments":[],"actionableComment":null}`

## Bug Description

The `## Divergence` sections of ADR-0010, ADR-0015, ADR-0052 and ADR-0057 record five places where the code does not follow an accepted decision. The owner ruled each one a bug, on 2026-09-29 and 2026-10-01. All five concern how ADW starts the `claude` CLI, or how ADW tells the operator to authenticate it.

1. **Literal models instead of the routing tables (ADR-0010, item 1).** Three spawn sites pass a model literally:
   - `adws/adwUpgrade.tsx:410` runs `/adw_init` with `'sonnet'` and no effort. The default tables give `sonnet` and `medium`.
   - `adws/triggers/autoMergeHandler.ts:55` runs `/resolve_conflict` with `'sonnet'` and no effort. `/resolve_conflict` is missing from the `SlashCommand` union and from all four tables.
   - `adws/agents/commandAgent.ts:141` runs the output-validation retry with `'haiku'`.

   The same literal hides in two more places. `runClaudeAgentWithCommand` defaults `model` to `'sonnet'` (`adws/agents/claudeAgent.ts:63`). The three probes put `'--model', 'haiku'` in their argv: `adws/triggers/rateLimitProbe.ts:34`, `adws/jsonl/schemaProbe.ts:27` and `scripts/guardrails-probe.ts:42`.

   Expected: every model and effort comes from `adws/core/modelRouting.ts`. Actual: seven sites name a model themselves, and nothing fails when another one is added.
2. **A Haiku entry with an effort (ADR-0010, item 2).** In the fast tables `/promote_regression_vocabulary` is routed to `haiku` with effort `'medium'`.

   Expected: `undefined`, so no `--effort` flag is passed. The file's own comment says Haiku does not support the effort parameter. Actual: when an issue body contains `/fast` or `/cheap`, the rot advisory runs as `--model haiku --effort medium`.
3. **The output-validation retry is not a slash command (ADR-0015, item 1).** `buildRetryPrompt` in `adws/agents/commandAgent.ts` assembles a corrective prompt in TypeScript and passes it to `runClaudeAgentWithCommand` where a command should go.

   Expected: the prompt lives in a Markdown file under `.claude/commands/`, and code supplies positional arguments only. Actual: changing the retry prompt means changing code.
4. **The probes start `claude` with auto-memory on (ADR-0052, item 1).** Only `runClaudeAgentWithCommand` sets `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`. The three probes build their own environment and leave the switch out:
   - the rate-limit probe inherits the trigger's full `process.env`;
   - the schema probe uses `getSafeSubprocessEnv()`;
   - the guardrails probe uses `{ ...process.env, CLAUDE_HOOKS_LOG_DIR }`.

   Three more `claude` starts use yet another environment: both `claude auth status --json` checks (`adws/agents/claudeAgent.ts:207`, `adws/triggers/trigger_cron.ts:267`) and the health check's `claude --version` (`adws/healthCheckChecks.ts:134`).

   Expected: every `claude` process ADW starts runs under one shared launch environment that disables auto-memory. Actual: there are four differently built environments, and three of them lack the switch.
5. **The API key is treated as required (ADR-0057, items 1 and 2).** `checkEnvironmentVariables` (`adws/healthCheckChecks.ts:33`) lists `ANTHROPIC_API_KEY` as its only required variable. An installation that runs on the Claude subscription therefore fails both `bunx tsx adws/healthCheck.tsx` and the webhook's `/health`.

   The documents tell the operator to set the key, and none of them says that setting it changes billing:
   - `.env.sample` puts the key under `# Required`;
   - `README.md` and `adws/README.md`;
   - the usage text in `adws/core/orchestratorCli.ts`;
   - the header comments of 13 orchestrator scripts.

   Expected: the key is optional, the health check passes without it, and every one of these documents says that setting the key moves billing from the subscription to the API. ADW keeps forwarding the key when it is set.

## Problem Statement

Three rules hold for every pipeline agent today only because each one lives inside the spawn function:
- the model and the effort come from the routing tables;
- the prompt is a slash command file;
- the process starts without auto-memory.

Every site that starts `claude` outside that function rebuilt the spawn by hand and broke one of the rules. No test or lint rule catches a new divergence, so the cost profile and the statelessness guarantee can drift without anyone noticing. Separately, the operator-facing health check and the setup documents contradict the decision that the pipeline runs on the subscription by default.

## Solution Statement

- **One source for models (ADR-0010).**
  - Add `/resolve_conflict` and a new `/correct_output` to the `SlashCommand` union and to all four tables.
  - Set the fast effort of `/promote_regression_vocabulary` to `undefined`.
  - Add a `PROBE_MODEL` constant to `modelRouting.ts` for the one-turn probes, which run no slash command.
  - Make the three call sites read `getModelForCommand`/`getEffortForCommand`, point the probes at `PROBE_MODEL`, and remove the `'sonnet'` default from `runClaudeAgentWithCommand`.
  - Two unit tests guard this. One asserts that no Haiku entry carries an effort. The other parses production source and fails on any spawn call site that passes a literal model.
- **The retry is a command (ADR-0015).**
  - Add `.claude/commands/correct_output.md`.
  - The retry loop writes the invalid output to a file in the logs directory and runs `/correct_output` with positional arguments. Its model and effort are routed like every other command's.
  - Delete `buildRetryPrompt`.
- **One stateless launch environment (ADR-0052).**
  - Add `buildClaudeLaunchEnv(overlay?)` to `adws/core/environment.ts`. It returns the allowlisted environment, then the caller's overlay, then `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`. The switch comes last so no caller can turn memory back on.
  - Every `claude` start uses it: the agent spawn and its retries, both auth-status checks, the three probes and the health check's version probe.
  - Unit tests observe the environment that each probe's child process actually receives.
- **The key is optional (ADR-0057).**
  - The environment check has no required variables. It reports whether billing runs on the subscription or the API, and warns when the key is set.
  - The listed documents present the key as optional and state its billing effect.
  - `SAFE_ENV_VARS` keeps forwarding the key.
- Remove the four `## Divergence` sections in the same pull request.

## Steps to Reproduce

Run from the repository root.

1. Literal models at spawn sites. This prints seven lines: `autoMergeHandler.ts:55`, `claudeAgent.ts:63`, `commandAgent.ts:141`, `adwUpgrade.tsx:410` and the three probe argv lines.
   ```bash
   grep -nE "'(sonnet|haiku)',|'--model', 'haiku'" adws/adwUpgrade.tsx adws/triggers/autoMergeHandler.ts adws/agents/commandAgent.ts adws/agents/claudeAgent.ts adws/triggers/rateLimitProbe.ts adws/jsonl/schemaProbe.ts scripts/guardrails-probe.ts
   ```
2. `/resolve_conflict` is unrouted. Both files print `0`.
   ```bash
   grep -c "'/resolve_conflict'" adws/types/issueTypes.ts adws/core/modelRouting.ts
   ```
3. A Haiku entry carries an effort. This prints `fast /promote_regression_vocabulary -> medium` and exits 1.
   ```bash
   bunx tsx -e "import('./adws/core/modelRouting.ts').then((m) => { const bad = [['default', m.SLASH_COMMAND_MODEL_MAP, m.SLASH_COMMAND_EFFORT_MAP], ['fast', m.SLASH_COMMAND_MODEL_MAP_FAST, m.SLASH_COMMAND_EFFORT_MAP_FAST]].flatMap(([n, models, efforts]) => Object.entries(models).filter(([c, t]) => t === 'haiku' && efforts[c] !== undefined).map(([c]) => n + ' ' + c + ' -> ' + efforts[c])); console.log(bad.join('\n') || 'none'); process.exit(bad.length ? 1 : 0); })"
   ```
4. The retry prompt is built in code. This prints the definition (line 58) and the call (line 134).
   ```bash
   grep -n "buildRetryPrompt" adws/agents/commandAgent.ts
   ```
5. The probes never set the memory switch. Each file prints `0`.
   ```bash
   grep -c "CLAUDE_CODE_DISABLE_AUTO_MEMORY\|buildClaudeLaunchEnv" adws/triggers/rateLimitProbe.ts adws/jsonl/schemaProbe.ts scripts/guardrails-probe.ts
   ```
6. The health check fails without the key. This prints `{"success":false,"error":"Missing required environment variables: ANTHROPIC_API_KEY"}` and exits 1. The empty assignment keeps `dotenv` from loading a key from `.env`.
   ```bash
   ANTHROPIC_API_KEY= bunx tsx -e "import('./adws/healthCheckChecks.ts').then((m) => { const r = m.checkEnvironmentVariables(); console.log(JSON.stringify({ success: r.success, error: r.error })); process.exit(r.success ? 0 : 1); })"
   ```
7. The documents name the key as something to set.
   ```bash
   grep -n "ANTHROPIC_API_KEY" .env.sample README.md adws/README.md adws/core/orchestratorCli.ts adws/adw*.tsx
   ```
8. The four Divergence sections exist.
   ```bash
   grep -l "^## Divergence" specs/adr/0010-model-and-effort-routing-per-command.md specs/adr/0015-slash-commands-as-single-spawn-path.md specs/adr/0052-stateless-pipeline-agents.md specs/adr/0057-subscription-by-default-api-key-by-choice.md
   ```

## Root Cause Analysis

- **The rules live in a function, not at the process boundary.**
  - `runCommandAgent` does the routing and `runClaudeAgentWithCommand` sets the memory switch. Every site that starts `claude` without both of them rebuilt the spawn and missed a rule.
  - `runClaudeAgentWithCommand` types `command` and `model` as `string` and defaults `model` to `'sonnet'`. The type checker therefore accepts a literal model and an assembled prompt alike.
  - `/resolve_conflict` never entered the `SlashCommand` union because `autoMergeHandler.ts` calls `runClaudeAgentWithCommand` directly. Through `runCommandAgent`, the missing table entry would have failed the type check: its `command: SlashCommand` feeds four `Record<SlashCommand, …>` tables.
- **The retry reused the spawn function with a prompt.** Commit 18f572ca passed the corrective prompt where the command goes, and the `string` parameter allowed it. The hard-coded `'haiku'` came with it.
- **The memory switch was added inside the spawn function, not to a shared environment.** PR #811 put the switch in `runClaudeAgentWithCommand`. ADW assembles the environment of a `claude` process in four different places. The probes build their own, so they never received the switch, and there is no single builder to add it to.
- **The tables are kept consistent by hand.** ADR-0010 lists this as a "Bad" consequence. The table test was deleted in commit 3231e576. A fast-table edit therefore left Haiku with an effort, and nothing noticed.
- **The setup surface predates the billing decision.** The health check and the documents were written when the key was assumed. ADR-0057 decided that the subscription is the default and the key is the operator's choice.

## Relevant Files
Use these files to fix the bug:

**Specification and rules**
- `README.md`: project overview. Three places need updating: the "Stateless pipeline agents" bullet (line 22), the environment-variable list, which calls the key "Your Anthropic API key" (line 210), and the `.claude/commands/` tree (around lines 390–420).
- `.adw/coding_guidelines.md`: the guidelines to follow. The relevant ones here:
  - files stay under 300 lines;
  - guard clauses;
  - no `any`;
  - comment discipline: no issue numbers, comment only what the code cannot say;
  - Vitest tests co-located in `__tests__/`.
- `specs/adr/0010-model-and-effort-routing-per-command.md`, `specs/adr/0015-slash-commands-as-single-spawn-path.md`, `specs/adr/0052-stateless-pipeline-agents.md` and `specs/adr/0057-subscription-by-default-api-key-by-choice.md`: the specification. Their `## Divergence` sections are removed.
- `.claude/skills/write-an-adr/SKILL.md`: only `status`, `superseded-by`, `## Divergence` and the supersession note may change in an accepted ADR. Nothing else in the four ADRs may be edited.

**Routing and the launch environment**
- `adws/types/issueTypes.ts`: the `SlashCommand` union. It gains `/resolve_conflict` and `/correct_output`.
- `adws/core/modelRouting.ts`: the four routing tables, `getModelForCommand`/`getEffortForCommand`, and the new `PROBE_MODEL`.
- `adws/core/environment.ts`: `SAFE_ENV_VARS` and `getSafeSubprocessEnv()`. The new `buildClaudeLaunchEnv()` goes here.
- `adws/core/config.ts`, `adws/core/index.ts`: the barrel re-exports. Both add `buildClaudeLaunchEnv`.

**Spawn sites**
- `adws/agents/claudeAgent.ts`: the single agent spawn function. Three changes:
  - `model` loses its `'sonnet'` default;
  - the environment comes from `buildClaudeLaunchEnv`;
  - the auth-status check runs under the same environment.
- `adws/agents/commandAgent.ts`: the output-validation retry loop (`buildRetryPrompt`, `runRetryLoop`).
- `adws/adwUpgrade.tsx`: `runInitCommandDefault` runs `/adw_init` with a literal model.
- `adws/triggers/autoMergeHandler.ts`: `resolveConflictsViaAgent` runs `/resolve_conflict` with a literal model.
- `adws/triggers/rateLimitProbe.ts`: `PROBE_ARGS`, and `runClaudeProbe`, which inherits the full environment.
- `adws/jsonl/schemaProbe.ts`: `PROBE_ARGS`, and `runProbe`, whose environment lacks the switch.
- `scripts/guardrails-probe.ts`: `runClaudePrint` uses `{ ...process.env, CLAUDE_HOOKS_LOG_DIR }` and a literal model.
- `adws/core/guardrailsProbe.ts`: `runGuardrailsProbe()`, the production seam that runs the script as a subprocess. The new integration test drives the script through it.
- `adws/triggers/trigger_cron.ts`: `handleAuthGateTick` runs `claude auth status --json` with `{ ...process.env }`.

**Health check**
- `adws/healthCheckChecks.ts`: `checkEnvironmentVariables` requires the key. `checkClaudeCodeCLI` and `execCommand` run `claude --version`.
- `adws/healthCheck.tsx`: prints `details.required` in the environment section. Its usage text names the key.
- `adws/triggers/trigger_webhook.ts`: `/health` consumes `checkEnvironmentVariables` and `checkClaudeCodeCLI`. It only reads `success`/`error`/`warning`, so it needs no change.

**Operator documents**
- `adws/core/orchestratorCli.ts`: `printUsageAndExit` lists the key under "Environment Requirements".
- 13 orchestrator header comments read `ANTHROPIC_API_KEY: Anthropic API key`:
  - `adws/adwSdlc.tsx`
  - `adws/adwPlan.tsx`
  - `adws/adwBuild.tsx`
  - `adws/adwTest.tsx`
  - `adws/adwChore.tsx`
  - `adws/adwPatch.tsx`
  - `adws/adwDocument.tsx`
  - `adws/adwPrReview.tsx`
  - `adws/adwPlanBuild.tsx`
  - `adws/adwPlanBuildTest.tsx`
  - `adws/adwPlanBuildReview.tsx`
  - `adws/adwPlanBuildDocument.tsx`
  - `adws/adwPlanBuildTestReview.tsx`
- `.env.sample`: the key is under `# Required`.
- `adws/README.md`: the Quick Start `export ANTHROPIC_API_KEY=…` line and the Troubleshooting comment "Check required variables".

**Read only**
- `adws/phases/worktreeSetup.ts`: `copyClaudeAssetsToWorktree` copies every `.claude/commands/*.md` into target worktrees on every `initializeWorkflow`. The new command therefore needs no wiring.
- `.claude/commands/resolve_conflict.md`, `.claude/commands/diff_evaluator.md`: style references for the new command file, with `target: false` front matter and 0-based `$0…$N` positional variables.
- `test/mocks/claude-cli-stub.ts`: the BDD Claude stub picks its payload by substring of the prompt. The retry prompt keeps the original command as `$0`, so payload selection is unchanged.
- `features/regression/step_definitions/realCronProcess.ts`, `features/regression/step_definitions/feature-911.steps.ts`: these spawn a real cron whose rate-limit and guardrails probes run the stub. They pass only cron-side variables (`PROBE_INTERVAL_CYCLES`, `TARGET_REPOS_DIR`), so moving the probes to the allowlisted environment does not affect them.

**Existing tests to update**
- `adws/agents/__tests__/claudeAgent.test.ts`: mocks `getSafeSubprocessEnv`, has 16 calls that rely on the `'sonnet'` default, and has three statelessness tests.
- `adws/triggers/__tests__/autoMergeHandler.test.ts`: expects `'sonnet', undefined`.
- `adws/triggers/__tests__/rateLimitProbe.test.ts`: mocks the `../../core` barrel.
- `adws/core/__tests__/environment.test.ts`: the `getSafeSubprocessEnv` tests.
- `adws/__tests__/healthCheckChecks.test.ts`: has no environment-check tests yet.

**Living docs** (conditional docs that match this task)
- `app_docs/feature-9gjajh-classifier-and-routing.md`: owns `modelRouting.ts` and states the rule that Haiku takes an undefined effort.
- `app_docs/feature-9gjajh-claude-agents-core.md`: owns `claudeAgent.ts`, `commandAgent.ts`, `guardrailsProbe.ts` and `scripts/guardrails-probe.ts`. It describes the "corrective Haiku prompt", the `'sonnet'` default, the auth retry under the full `process.env` and the "(haiku)" probe.
- `app_docs/feature-9gjajh-takeover-and-coordination.md`: owns `rateLimitProbe.ts`.
- `app_docs/feature-9gjajh-jsonl-schema.md`: owns `schemaProbe.ts`.
- `app_docs/feature-9gjajh-health-check.md`: owns the health check and says the key is required.
- `app_docs/feature-9gjajh-state-and-config.md`: owns `environment.ts`, `config.ts` and `index.ts`.
- `app_docs/feature-9gjajh-issue-routing-and-eligibility.md`: owns `autoMergeHandler.ts`.
- `app_docs/feature-9gjajh-feature-orchestrators.md`: owns `adwUpgrade.tsx` and the single-issue orchestrators. Line 34 says the key is required.
- `app_docs/feature-9gjajh-sdlc-orchestrators.md`: owns the SDLC orchestrators. Line 34 says the key is required.
- `app_docs/feature-9gjajh-claude-stream-parser.md`: owns `orchestratorCli.ts`.
- `app_docs/feature-9gjajh-cron-triggers.md`: owns `trigger_cron.ts`.
- `app_docs/feature-9gjajh-commands-and-skills.md`: owns `.claude/commands/*`.
- `app_docs/feature-9gjajh-types.md`: owns `adws/types/**`.
- `app_docs/feature-9gjajh-specs-and-prd.md`: owns `specs/**`.
- `app_docs/feature-9gjajh-root-config.md`: owns `README.md`.

### New Files

- `.claude/commands/correct_output.md`: the output-validation retry as a slash command.
- `adws/core/__tests__/modelRouting.test.ts`: table integrity. No Haiku entry carries an effort, and the new commands are routed.
- `adws/core/__tests__/modelRoutingCallSites.test.ts`: parses production source and fails on any spawn call site that names a model literally.
- `adws/core/__tests__/fixtures/recordingClaudeCli.ts`: an executable fake `claude` that records the environment it was started with.
- `adws/agents/__tests__/commandAgent.test.ts`: the retry runs `/correct_output` with a routed model and effort and a file argument.
- `adws/jsonl/__tests__/schemaProbe.test.ts`: the schema probe's child process runs under the launch environment.
- `adws/core/__tests__/guardrailsProbe.integration.test.ts`: the `claude` children of the guardrails probe script run under the launch environment. The test drives the script through `runGuardrailsProbe()`.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### 1. Add the two unrouted commands to the `SlashCommand` union
- In `adws/types/issueTypes.ts`, add `'/resolve_conflict'` to `SlashCommand` after `'/resolve_failed_scenario'`, and add `'/correct_output'` at the end.
- Do not touch `IssueClassSlashCommand` or `VALID_ISSUE_TYPES`.
- `bunx tsc --noEmit` fails until step 2 adds the table entries. That failure is the type check ADR-0010 relies on.

### 2. Route the new commands, fix the Haiku effort and add the probe model
- In `adws/core/modelRouting.ts`:
  - `/resolve_conflict`:
    - model `'sonnet'` in `SLASH_COMMAND_MODEL_MAP` and `SLASH_COMMAND_MODEL_MAP_FAST`, as today;
    - effort `'high'` in `SLASH_COMMAND_EFFORT_MAP` and `'medium'` in `SLASH_COMMAND_EFFORT_MAP_FAST`, in line with the other Sonnet entries that modify code.
    
    These values are tuning, per ADR-0010.
  - `/correct_output`: `'haiku'` in both model tables and `undefined` in both effort tables. This keeps today's retry behaviour: Haiku, no effort flag.
  - `SLASH_COMMAND_EFFORT_MAP_FAST['/promote_regression_vocabulary']`: change `'medium'` to `undefined`.
  - Add `export const PROBE_MODEL: ModelTier = 'haiku';` with a one-line comment: the model of the one-turn `claude` probes (rate limit, JSONL schema, guardrails), which run no slash command.
  - Every table now has 32 entries.
- Create `adws/core/__tests__/modelRouting.test.ts` with three tests:
  - For the default pair (`SLASH_COMMAND_MODEL_MAP` and `SLASH_COMMAND_EFFORT_MAP`) and the fast pair, collect every command routed to `'haiku'` whose effort is not `undefined`, and expect `[]`. This is the acceptance test for "No Haiku entry in any routing table carries an effort".
  - A named regression case: with an issue body that contains `/fast`, `getModelForCommand('/promote_regression_vocabulary', body)` is `'haiku'` and `getEffortForCommand(…)` is `undefined`.
  - `/resolve_conflict` and `/correct_output` resolve to a model in both modes, and `/correct_output` has no effort.

### 3. Add the shared Claude launch environment
- In `adws/core/environment.ts`, below `getSafeSubprocessEnv`, add:
  ```ts
  export function buildClaudeLaunchEnv(overlay: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
    return { ...getSafeSubprocessEnv(), ...overlay, CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1' };
  }
  ```
  Give it a short comment adapted from the one it replaces in `claudeAgent.ts`. The comment states the reason and the ordering constraint:
  - every `claude` process ADW starts runs under this environment;
  - auto-memory is the operator's `~/.claude/projects/<key>/memory/`, and a worktree resolves to the same key as the checkout;
  - the switch is applied after the overlay, so no caller can re-enable memory.
- Re-export `buildClaudeLaunchEnv` from `adws/core/config.ts` (the environment block) and from `adws/core/index.ts` (the `./config` list).
- Add `describe('buildClaudeLaunchEnv')` to `adws/core/__tests__/environment.test.ts`. Save and restore every variable a test touches. The cases:
  - with no overlay, `CLAUDE_CODE_DISABLE_AUTO_MEMORY` is `'1'`;
  - an overlay of `{ CLAUDE_CODE_DISABLE_AUTO_MEMORY: '0' }` still yields `'1'`;
  - overlay keys win over the allowlisted base, for example an overlay `GH_TOKEN` over `process.env.GH_TOKEN`;
  - a `process.env` name that is not on the allowlist, for example `ADW_RECORDING_SENTINEL`, is absent;
  - `ANTHROPIC_API_KEY` is forwarded when set (ADR-0057: ADW keeps forwarding the key);
  - `process.env` is not mutated.

  Two assertions that step 4 removes from `claudeAgent.test.ts` now live here: an overlay cannot re-enable auto-memory, and the overlay merges over the allowlist.

### 4. Spawn agents under the launch environment and require a model
- In `adws/agents/claudeAgent.ts`:
  - Import `buildClaudeLaunchEnv` from `'../core'` instead of `getSafeSubprocessEnv`.
  - Change `model: string = 'sonnet'` to `model: string`. Every production caller already passes a model.
  - Replace the `spawnEnv` construction and the `CLAUDE_CODE_DISABLE_AUTO_MEMORY` assignment (lines 111–117) with `const spawnEnv = buildClaudeLaunchEnv(subprocessEnv);`. The memory comment moves to the builder. Keep the per-command-auth comment, and keep the later `ADW_WORKTREE_PATH`, `ADW_MAIN_REPO_PATH` and `CLAUDE_HOOKS_LOG_DIR` additions as they are.
  - In the OAuth branch, run `` execSync(`${resolvedPath} auth status --json`, …) `` with `env: spawnEnv`, and drop the "Inherit full env" comment. `HOME` and `USER` are on the allowlist, and the check now sees exactly the environment the agent sees.
- Update `adws/agents/__tests__/claudeAgent.test.ts`:
  - In the `vi.mock('../../core', …)` factory, replace `getSafeSubprocessEnv` with `buildClaudeLaunchEnv: vi.fn(() => ({ LAUNCH_ENV: 'shared' }))`. It must return a fresh object on every call, because the spawn adds keys to it.
  - Rewrite the environment tests:
    - `buildClaudeLaunchEnv` is called with the caller's `subprocessEnv`, or `undefined` when there is none;
    - every spawn (the first, the ENOENT retries and the auth retry) receives the returned object as `env`;
    - the `auth status` `execSync` receives the same object.
  - Drop the "overlay cannot re-enable auto-memory" and "merges subprocessEnv over getSafeSubprocessEnv()" cases. Step 3 covers both against the real builder.
  - Keep the guardrails `CLAUDE_HOOKS_LOG_DIR` expectations.
  - Add a model argument to the 16 calls that relied on the removed default, for example `'sonnet'`. Test code may name models.

### 5. Route `/adw_init` in the upgrade orchestrator
- In `adws/adwUpgrade.tsx` `runInitCommandDefault`, replace `'sonnet', undefined` with `getModelForCommand('/adw_init'), getEffortForCommand('/adw_init')`, imported from `'./core'`.
- Pass no issue body. The body of the synthetic `issueJson` is always empty, so the default tables apply. The upgrade now passes `--effort medium`, as the table says.
- `adws/__tests__/adwUpgrade.test.ts` injects `runInitCommand` and needs no change.

### 6. Route `/resolve_conflict` in the auto-merge handler
- In `adws/triggers/autoMergeHandler.ts` `resolveConflictsViaAgent`, replace `'sonnet', undefined` with `getModelForCommand('/resolve_conflict'), getEffortForCommand('/resolve_conflict')`.
  - Import both from `'../core/modelRouting'`, not from the barrel: the test mocks `../../core` with only `log` and `MAX_AUTO_MERGE_ATTEMPTS`.
  - `mergeWithConflictResolution` has no issue body, so the default tables apply.
- In `adws/triggers/__tests__/autoMergeHandler.test.ts`, change both `toHaveBeenCalledWith` expectations from `'sonnet', undefined` to `getModelForCommand('/resolve_conflict'), getEffortForCommand('/resolve_conflict')`, imported from `'../../core/modelRouting'`.

### 7. Create the `/correct_output` command file
- Create `.claude/commands/correct_output.md`. ADR-0056 keeps the planner out of `.claude/`, so this file is a build task. Content:
  ```md
  ---
  target: false
  ---
  # Correct Output

  A slash command returned output that failed validation against the JSON schema its caller expects. Rewrite that output so it validates.

  ## Variables

  command: $0 — the slash command that produced the output
  commandArgs: $1 — the arguments `command` was invoked with
  invalidOutputFile: $2 — absolute path of a file holding the output that failed validation
  validationError: $3 — why the output failed validation
  schema: $4 — the JSON schema the output must match

  ## Instructions

  - Read `invalidOutputFile`. It holds what `command` returned when it ran with `commandArgs`.
  - The output failed validation with `validationError`; `schema` is the shape it must have.
  - Rewrite the output so it matches `schema`, keeping the content it already carries.
  - Do not run `command` again, and do not create, edit or delete any file.

  ## Output

  Return ONLY valid JSON matching `schema` — no preamble, no explanation, no markdown fences.
  ```

### 8. Run the output-validation retry as `/correct_output`
- In `adws/agents/commandAgent.ts`:
  - Delete `buildRetryPrompt`.
  - Add `const OUTPUT_CORRECTION_COMMAND: SlashCommand = '/correct_output';`.
  - Add a small boundary helper, for example `writeInvalidOutput(outputFile, retryNumber, output): string`. It resolves `outputFile` to an absolute path, runs `fs.mkdirSync(dir, { recursive: true })`, writes `output` to `<dir>/<name>-invalid-output-<retryNumber>.txt` and returns that absolute path. The path must be absolute because the retry runs in the agent's `cwd`, which is often a worktree.
  - In `runRetryLoop`, replace the prompt assembly and the spawn with:
    ```ts
    const invalidOutputFile = writeInvalidOutput(outputFile, attempt + 1, currentOutput);
    const retryResult = await runClaudeAgentWithCommand(
      OUTPUT_CORRECTION_COMMAND,
      [command, formatCommandArgs(options.args), invalidOutputFile, validationError, JSON.stringify(outputSchema ?? {})],
      `${agentName} (retry ${attempt + 1})`,
      outputFile,
      getModelForCommand(OUTPUT_CORRECTION_COMMAND, options.issueBody),
      getEffortForCommand(OUTPUT_CORRECTION_COMMAND, options.issueBody),
      options.onProgress, options.statePath, options.cwd, undefined, undefined, options.subprocessEnv, options.launchContext,
    );
    ```
    `formatCommandArgs` is the existing join, `typeof args === 'string' ? args : args.join(' ')`.
  - Remove the now-unused `const schema = outputSchema ?? {};`.
  - Update two doc comments:
    - `outputSchema`: the retry loop passes the schema to `/correct_output`. Do not name a model.
    - `subprocessEnv`: the overlay is merged into the shared Claude launch environment.
- Create `adws/agents/__tests__/commandAgent.test.ts`:
  - Setup:
    - mock `../claudeAgent` (`runClaudeAgentWithCommand`), and `../../core/logger` if it is noisy;
    - use a temporary `logsDir`;
    - config: `command: '/review'`, an `extractOutput` that parses JSON, and a small `outputSchema`.
  - The first call resolves `{ success: true, output: 'not json' }` and the second `{ success: true, output: '{"ok":true}' }`. Assert that:
    - the second call's command is `'/correct_output'`;
    - its args are `['/review', <joined args>, <path>, <validation error>, JSON.stringify(schema)]`;
    - `<path>` is absolute and the file contains `not json`;
    - its model and effort equal `getModelForCommand('/correct_output', issueBody)` and `getEffortForCommand(…)`;
    - `result.parsed` is `{ ok: true }`;
    - every call's command is a `/`-prefixed slash command.
  - `.claude/commands/correct_output.md` exists. Resolve the repository root from the test file with `fileURLToPath(import.meta.url)`, as `adws/__tests__/prTemplateMarker.test.ts` does.
  - The early exit still holds: three identical validation errors in a row throw `OutputValidationError`.

### 9. Start the three probes under the launch environment and the probe model
- `adws/triggers/rateLimitProbe.ts`:
  - `PROBE_ARGS` uses `'--model', PROBE_MODEL`, imported from `'../core/modelRouting'`.
  - `runClaudeProbe` passes `env: buildClaudeLaunchEnv()` to `spawnSync`. Import it from `'../core/environment'`, not from the barrel that `rateLimitProbe.test.ts` mocks.
  - The working directory stays as it is.
- `adws/jsonl/schemaProbe.ts`:
  - `PROBE_ARGS` uses `PROBE_MODEL`, from `'../core/modelRouting'`.
  - `runProbe` spawns with `env: buildClaudeLaunchEnv()`. Drop the `getSafeSubprocessEnv` import.
  - The temp-cwd comment stays.
- `scripts/guardrails-probe.ts`:
  - `runClaudePrint` uses `'--model', PROBE_MODEL` (from `'../adws/core/modelRouting'`) and `env: buildClaudeLaunchEnv({ CLAUDE_HOOKS_LOG_DIR: hookLogDir })` (from `'../adws/core/environment'`).
  - In the header comment, change "Spawns a real `claude -p` (haiku)" so it names the probe model instead of a tier.
  - Do not add an entry-point guard, and do not move code: `void main()` stays unconditional. A guard that compares `process.argv[1]` with `import.meta.url` is false when the script is reached through a symlinked path; this was verified with `bunx tsx` under macOS `/tmp`. The script would then exit 0 without probing, and `runGuardrailsProbe()` reads exit 0 as a pass.
- Create `adws/core/__tests__/fixtures/recordingClaudeCli.ts`, which exports `createRecordingClaudeCli()`:
  - In a fresh `mkdtempSync` directory, write an executable `/bin/sh` script (`mode 0o755`).
  - Each run of the script appends one tab-separated line with `$CLAUDE_CODE_DISABLE_AUTO_MEMORY`, `$CLAUDE_HOOKS_LOG_DIR` and `$ADW_RECORDING_SENTINEL` to a record file. Bake the absolute path of the record file into the script: a path passed through the environment would be dropped by the allowlist.
  - The script prints nothing and exits 0.
  - Return `{ cliPath, readInvocations(), cleanup() }`, where `readInvocations()` parses the record lines into `{ memory, hooksLogDir, sentinel }`.

  The fixture sits in `adws/` because `adws/tsconfig.json` sets `rootDir: "."`. An adws test that imports from `test/` or `scripts/` fails `tsc -p adws/tsconfig.json` with TS6059 (verified).
- `adws/triggers/__tests__/rateLimitProbe.test.ts`: add `describe('runClaudeProbe')`:
  - Set `process.env.ADW_RECORDING_SENTINEL = 'leak'` and call `runClaudeProbe(cli.cliPath, PROBE_ARGS)`, which uses the real `spawnSync`.
  - Expect one invocation with `memory === '1'` and `sentinel === ''`. The probe no longer inherits the trigger's full environment.
  - Expect the element after `'--model'` in `PROBE_ARGS` to be `PROBE_MODEL`.
  - Restore the environment and clean up.
- Create `adws/jsonl/__tests__/schemaProbe.test.ts`:
  - Set `process.env.CLAUDE_CODE_PATH = cli.cliPath` and call `clearClaudeCodePathCache()`.
  - `await expect(checkClaudeJsonlSchema()).rejects.toThrow(/produced no output/)`. The default `schema.json` path exists.
  - Expect one invocation with `memory === '1'`.
  - Restore `CLAUDE_CODE_PATH`, clear the cache and clean up.
- Create `adws/core/__tests__/guardrailsProbe.integration.test.ts`:
  - Set `process.env.CLAUDE_CODE_PATH = cli.cliPath` and the sentinel.
  - `await runGuardrailsProbe()`. This runs the real `bunx tsx scripts/guardrails-probe.ts` subprocess, which inherits the test's environment.
  - Expect `ok === false`, because the recording CLI never denies a tool.
  - Expect four invocations, one per deny-matrix check. Each has `memory === '1'`, a non-empty `hooksLogDir` and `sentinel === ''`.
  - Give the test a generous timeout, for example 60 s, and restore the environment.

### 10. Start the auth-status check and the version check under the launch environment
- `adws/triggers/trigger_cron.ts` `handleAuthGateTick`: use `env: buildClaudeLaunchEnv()`, added to the existing `'../core'` import. `trigger_cron.test.ts` spreads the real barrel into its mock, so the builder is available there.
- `adws/healthCheckChecks.ts`:
  - `execCommand(command: string, env?: NodeJS.ProcessEnv)` passes `env` to `execSync`. When `env` is undefined, other callers keep today's inheritance.
  - `checkClaudeCodeCLI` calls `` execCommand(`${resolvedPath} --version`, buildClaudeLaunchEnv()) ``.
- `adws/__tests__/healthCheckChecks.test.ts`: add `describe('checkClaudeCodeCLI')`. Set the recording CLI as `CLAUDE_CODE_PATH` and call `clearClaudeCodePathCache()`. Expect the version probe to run once, with `memory === '1'`.

### 11. Make `ANTHROPIC_API_KEY` optional in the health check
- In `adws/healthCheckChecks.ts`, rewrite `checkEnvironmentVariables`. It has no required variables and always returns `success: true`. The result carries:
  - `details.optional`: the names among `ANTHROPIC_API_KEY`, `CLAUDE_CODE_PATH` and `GITHUB_PAT` that are set;
  - `details.claudeBilling`: `'api'` or `'subscription'`;
  - a `warning` only when the key is set. It says that billing for every agent ADW starts moves from the Claude subscription to the Anthropic API, and that unsetting the key returns to the subscription.
  
  Use `Boolean(process.env[name])`, so an empty value counts as unset.
- In `adws/healthCheck.tsx`:
  - The environment section prints `Optional set: <list or none>` and `Claude billing: Claude subscription | Anthropic API (ANTHROPIC_API_KEY is set)`.
  - Print the warning line in the style the other sections use (`⚠️  Warning: …`).
  - Drop the `details.required` read and the error branch, which can no longer be reached.
  - Change the usage-text line to, for example, `- Environment variables (all optional; ANTHROPIC_API_KEY moves billing to the API)`.
- Add `describe('checkEnvironmentVariables')` to `adws/__tests__/healthCheckChecks.test.ts`. Save and restore `process.env.ANTHROPIC_API_KEY`, because `dotenv` may have loaded one. The cases:
  - key deleted: `success: true`, no `error`, no `warning`, and `claudeBilling: 'subscription'`. This is the acceptance test for "The health check passes with the key unset";
  - key set to `''`: the same result;
  - key set: `success: true`, `optional` contains the key, `claudeBilling: 'api'`, and the warning mentions the API.
- `SAFE_ENV_VARS` in `adws/core/environment.ts` keeps `ANTHROPIC_API_KEY`. No change.

### 12. Present the key as optional in the documents
- `.env.sample`:
  - Under `# Required`, keep only `GITHUB_REPO_URL`.
  - Add an optional block with the key commented out, explaining two things: left unset, every agent runs on the Claude subscription (log in once with `claude auth login`); setting the key moves billing from the subscription to the Anthropic API.
- `README.md`:
  - Line 210 becomes: `` `ANTHROPIC_API_KEY` - (Optional) Anthropic API key. Leave it unset to run on your Claude subscription (log in once with `claude auth login`); setting it moves billing for every agent ADW starts from the subscription to the Anthropic API. ``
  - Under "3. Configure Environment", add one sentence saying that ADW runs on the Claude subscription by default.
  - Rewrite the "Stateless pipeline agents" bullet (line 22). It should say that every `claude` process ADW starts runs under `buildClaudeLaunchEnv()` (`adws/core/environment.ts`), which sets `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` after any overlay. That covers the agents, the rate-limit, schema and guardrails probes, the auth-status checks and the version check.
  - Add `correct_output.md` to the `.claude/commands/` tree, after `conditional_docs.md`.
- `adws/README.md`:
  - In the Quick Start block, replace `export ANTHROPIC_API_KEY=…` with a commented-out line, preceded by the same two-part explanation.
  - In Troubleshooting, change the comment "# Check required variables" to say that the key is optional and decides billing.
- `adws/core/orchestratorCli.ts` `printUsageAndExit`: `'  ANTHROPIC_API_KEY  - (Optional) Anthropic API key; setting it moves billing from the Claude subscription to the API'`.
- In all 13 orchestrator headers listed under Relevant Files, replace ` * - ANTHROPIC_API_KEY: Anthropic API key` with ` * - ANTHROPIC_API_KEY: (Optional) Anthropic API key; setting it moves billing from the Claude subscription to the API`.

### 13. Correct the living-doc statements this change makes false
- `app_docs/feature-9gjajh-health-check.md` line 9: the environment variables are all optional; the check reports billing and warns when the key is set.
- `app_docs/feature-9gjajh-sdlc-orchestrators.md` line 34 and `app_docs/feature-9gjajh-feature-orchestrators.md` line 34: the key is optional and is forwarded to agents when set; setting it moves billing to the API.
- `app_docs/feature-9gjajh-claude-agents-core.md`:
  - "corrective Haiku prompt" and "fresh Haiku session" become the `/correct_output` command, routed through the tables;
  - "`model` defaults to `'sonnet'`" becomes: `model` is required and comes from `getModelForCommand`;
  - the gotcha "Auth retry calls `execSync` with the full `process.env`" becomes: the check runs under the agent's launch environment;
  - "spawn a real `claude -p` (haiku)" becomes: on `PROBE_MODEL`;
  - "`CLAUDE_HOOKS_LOG_DIR` — set on `spawnEnv` (after the `getSafeSubprocessEnv()` allowlist filter…)" becomes: set on top of the shared launch environment.
- Keep each edit to the sentence it corrects. The document phase owns broader rewrites, and the registration of `.claude/commands/correct_output.md` under `Owns:` in `.adw/conditional_docs.md`.

### 14. Remove the four Divergence sections
- Delete the `## Divergence` heading, its numbered items and the blank line that follows them from these files:
  - `specs/adr/0010-model-and-effort-routing-per-command.md`, lines 63–67;
  - `specs/adr/0015-slash-commands-as-single-spawn-path.md`, lines 62–65;
  - `specs/adr/0052-stateless-pipeline-agents.md`, lines 62–65;
  - `specs/adr/0057-subscription-by-default-api-key-by-choice.md`, lines 55–59.
  
  Each file then goes straight from `### Confirmation` to `## More Information`.
- Change nothing else in these ADRs, even where `### Confirmation` or `## More Information` now reads stale. Examples are ADR-0010's "No unit test covers the tables" and ADR-0015's note that `/resolve_conflict` is missing from the type. The write-an-adr rule allows only `status`, `superseded-by`, `## Divergence` and the supersession note to change.
- `specs/adr/README.md` needs no change; the statuses stay `accepted`.

### 15. Add the call-site guard: no literal model outside the routing module
- Create `adws/core/__tests__/modelRoutingCallSites.test.ts`. It uses the TypeScript compiler API (`import * as ts from 'typescript'`), as `adws/checkGitGhGuard.ts` and `adws/guard/*` do.
- In the test, define a pure `findLiteralModelCallSites(fileName, sourceText): string[]`. It parses with `ts.createSourceFile` (TSX script kind for `.tsx`), walks the tree, and reports `file:line` for three shapes. "Literal" means `ts.isStringLiteralLike`.
  1. An array literal in which a `'--model'` literal is followed by another literal. This is the probes' argv.
  2. A call to `runClaudeAgentWithCommand` whose fifth argument (`model`) is a literal.
  3. A parameter named `model` with a literal default.
- Enumerate every `.ts`/`.tsx` file under `adws/` and `scripts/` with `fs`:
  - skip any path with a `__tests__`, `node_modules` or `dist` segment, and skip `adws/core/modelRouting.ts`;
  - take the root from `REPO_ROOT` in `adws/core/environment.ts`;
  - read the files instead of importing them, so the `adws/tsconfig.json` `rootDir` is not crossed.
  
  Expect the findings to be `[]`, and list them in the failure message.
- Add a self-check so the guard cannot pass vacuously:
  - a snippet with `spawnSync(p, ['--model', 'haiku'])`, `runClaudeAgentWithCommand('/x', [], 'a', 'o', 'sonnet')` and `function f(model = 'opus') {}` yields exactly three findings;
  - the same shapes written with `PROBE_MODEL` or `getModelForCommand(...)` yield none.
- Test code (unit tests, `features/`, `test/`) is out of scope and may still pass literal models, for example `features/per-issue/step_definitions/feature-907.steps.ts`.
- Before steps 4–9 this test lists the seven findings. After them it passes. This is the acceptance test for "a unit test or lint rule fails if one is added".

### 16. Run the Validation Commands
- Run every command in `Validation Commands`, and fix any failure before finishing.

## Validation Commands
Execute every command to validate the bug is fixed with zero regressions.

- Reproduce before and confirm after. Each command fails today and must succeed after the fix.
  - No literal model at the spawn sites or as a default, and none after `--model`. Must print nothing:
    ```bash
    ! grep -nE "'(sonnet|haiku|opus|fable)',|'--model', '" adws/adwUpgrade.tsx adws/triggers/autoMergeHandler.ts adws/agents/commandAgent.ts adws/agents/claudeAgent.ts adws/triggers/rateLimitProbe.ts adws/jsonl/schemaProbe.ts scripts/guardrails-probe.ts
    ```
  - `/resolve_conflict` is routed. Each file must print a count of at least 1:
    ```bash
    grep -c "'/resolve_conflict'" adws/types/issueTypes.ts adws/core/modelRouting.ts
    ```
  - No Haiku entry carries an effort: the one-liner from step 3 of Steps to Reproduce must print `none` and exit 0.
  - The retry runs a command file:
    ```bash
    ! grep -n "buildRetryPrompt" adws/agents/commandAgent.ts && test -f .claude/commands/correct_output.md
    ```
  - Every `claude` start uses the launch environment. Each file must print a count of at least 1:
    ```bash
    grep -c "buildClaudeLaunchEnv" adws/triggers/rateLimitProbe.ts adws/jsonl/schemaProbe.ts scripts/guardrails-probe.ts adws/agents/claudeAgent.ts adws/triggers/trigger_cron.ts adws/healthCheckChecks.ts
    ```
  - The health check passes with the key unset: the one-liner from step 6 of Steps to Reproduce must print `success: true` and exit 0.
  - The Divergence sections are removed:
    ```bash
    ! grep -l "^## Divergence" specs/adr/0010-model-and-effort-routing-per-command.md specs/adr/0015-slash-commands-as-single-spawn-path.md specs/adr/0052-stateless-pipeline-agents.md specs/adr/0057-subscription-by-default-api-key-by-choice.md
    ```
- Targeted unit tests:
  ```bash
  bunx vitest run adws/core/__tests__/modelRouting.test.ts adws/core/__tests__/modelRoutingCallSites.test.ts adws/core/__tests__/environment.test.ts adws/agents/__tests__/claudeAgent.test.ts adws/agents/__tests__/commandAgent.test.ts adws/triggers/__tests__/autoMergeHandler.test.ts adws/triggers/__tests__/rateLimitProbe.test.ts adws/jsonl/__tests__/schemaProbe.test.ts adws/core/__tests__/guardrailsProbe.integration.test.ts adws/__tests__/healthCheckChecks.test.ts adws/__tests__/adwUpgrade.test.ts adws/triggers/__tests__/trigger_cron.test.ts
  ```
- Full unit suite: `bun run test:unit`
- Lint: `bun run lint`
- Type check, root and adws project: `bunx tsc --noEmit` and `bunx tsc --noEmit -p adws/tsconfig.json`
- Build: `bun run build`
- Git/gh guard: `bun run lint:git-guard`
- Docs index gate, because app_docs are edited: `bun run lint:docs-index`
- JSONL conformance (`schemaProbe.ts` is touched, and CI runs this on every PR): `bun run jsonl:check`
- Scenarios for this issue: `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-928"`
- Regression suite. The real-cron scenarios run the rate-limit and guardrails probes against the stub, now under the launch environment: `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"`

## Notes
- Follow `.adw/coding_guidelines.md` strictly. In particular, apply the comment discipline to every comment this change adds or rewrites: no issue numbers, no restating the code, and no model names in comments where the value comes from the routing module.
- No new library is needed.
- ADR-0056 keeps the planner out of `.claude/` and `.adw/`. `.claude/commands/correct_output.md` (step 7) is created by the build agent.
- Behaviour changes to call out in the PR:
  - The upgrade's `/adw_init` now passes `--effort medium`.
  - `/resolve_conflict` now passes `--effort high`. Fast mode cannot reach it or `/adw_init`, because neither site has the issue body. Threading the body through is out of scope; both sites read the default tables.
  - The fast-mode rot advisory no longer passes `--effort` to Haiku.
  - The rate-limit probe, the guardrails probe, both auth-status checks and the version check now start `claude` with the allowlisted environment instead of the full `process.env`. Production agents already run this way, with OAuth working through `HOME`/`USER`, so the probes and checks now see what the agents see.
  - The retry writes `<agent output name>-invalid-output-<n>.txt` next to the agent's JSONL file in the logs directory.
  - The health check and the webhook's `/health` pass on a subscription host, and warn when the key is set.
- The tests observe child processes instead of mocking `child_process`. There are two reasons:
  - the guardrails probe script runs `main()` when it is imported, and an entry-point guard would risk a silent pass;
  - adws tests cannot import from `scripts/`.
  
  The recording fake CLI uses the same technique as feature-909's throwaway CLI script. These same public seams suit the BDD step definitions for `@adw-928`: `checkEnvironmentVariables()`, `buildClaudeLaunchEnv()`, `runClaudeProbe()`, `checkClaudeJsonlSchema()`, `runGuardrailsProbe()`, `PROBE_MODEL` and the routing tables.
- The probes keep their inline prompts (`ping`, `say hello` and the deny-matrix prompts). ADR-0015 places them outside the slash-command rule because they do no pipeline work, and the issue asks only that the retry become a command file.
- Wiring and side effects of the new command file:
  - `copyClaudeAssetsToWorktree` copies it into target worktrees on every `initializeWorkflow`, including resumes. There it is gitignored (`target: false`).
  - The framework hash (`hashInputs` of `adw_init.md`) does not include it, so no wave of target-repo upgrades follows.
  - The BDD stub still selects its payload from the original command, which travels as `$0`.
- `runClaudeAgentWithCommand` keeps `command: string`. `features/per-issue/step_definitions/feature-907.steps.ts` passes a command outside the union. Narrowing the type to `SlashCommand` would be a further guard, but the issue does not require it.
- Out of scope:
  - ADR-0055's CI-secret divergence.
  - The `model: 'sonnet' | 'opus' | 'haiku'` type literals in `adws/types/agentTypes.ts`. They are type positions, not call sites, and the guard ignores them.
  - The `/find_plan_file` table entry, which has no command file.
  - The inaccurate "default: /usr/local/bin/claude" text in the usage and header comments.

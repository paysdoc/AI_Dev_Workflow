# Patch: Treat a `--target-repo` launch for the framework's own repository as self-host in the guardrails gate

## Metadata
adwId: `znc6m9-bug-guardrails-are-m`
reviewChangeRequest: `Issue #1: Runs on ADW's own repository will now get the guardrails `--settings` injection, so every hook fires twice. ADR-0050 (`specs/adr/0050-target-repo-guardrails.md:44`: "Self-host runs get no injection ... injecting would fire every hook twice") rules this out, and the spec's 'Self-host from the launch boundary' step was meant to prevent it. Cause: `workflowLaunchContext` (`adws/phases/workflowRepoIdentity.ts:40-42`) reads `GitContext.selfHost`, and `buildLaunchBoundary` sets that to `targetRepo === null` (`adws/core/launchGitContext.ts:198`). In the deployed setup, ADW's own runs always carry `--target-repo`. `buildCronTargetRepoArgs` (`adws/triggers/cronRepoResolver.ts:29-39`) adds `--target-repo <owner/repo>` to every spawn, even when the cron itself has no target, and `resolveWebhookRepo` (`adws/triggers/webhookRepoResolver.ts:44`) does the same for every webhook event. The live ADW cron runs as `trigger_cron.ts --target-repo paysdoc/AI_Dev_Workflow`, and this run's own orchestrator is `adwSdlc.tsx 938 znc6m9-bug-guardrails-are-m --issue-type /bug --target-repo paysdoc/AI_Dev_Workflow --clone-url ...`. Passing that exact argv through the real `parseTargetRepoArgs` -> `buildLaunchBoundary` (only the credentials stubbed) -> `workflowLaunchContext` -> `resolveGuardrailsDecision` (probe passing, kill switch off) gives `gitContext.selfHost: false`, `basePath: /Users/martin/projects/paysdoc/AI_Dev_Workflow` and the decision INJECT. On dev, the missing `guardrails` key in ADW's own `.github/adw.yml` was the only thing that withheld injection for these runs. ADW's `.claude/settings.json` registers the five hooks as `bunx tsx $CLAUDE_PROJECT_DIR/.claude/hooks/<hook>.ts`, while the payload registers `bun <abs>/.claude/hooks/<hook>.ts ... || true`. The commands differ, so both sets will run on every ADW agent once dev is promoted. `adwUpgrade.tsx:427`, `adwPatch.tsx:55` and `autoMergeHandler.ts:64` (`ctx.selfHost`) have the same problem. No test catches it: the @adw-938 'run on ADW's own repository' scenario passes `selfHost: true` directly, and the `workflowLaunchContext` unit tests only use a `{ selfHost: true }` GitContext. Resolution: Make the self-host fact the guardrails gate receives mean 'this launch is for the framework's own repository', not only 'no --target-repo flag'. Add one helper (for example in `adws/core`). It returns true when there is no GitContext, when `gitContext.selfHost` is true, or when the GitContext's `{ owner, repo }` matches the framework checkout's identity. Get that identity from `readLocalRepoIdentity(REPO_ROOT)`, memoise it once per process, and treat a read failure as null. Compare with `isFrameworkOwnRepository`/`sameRepoIdentity`, the way `copyClaudeAssetsToWorktree` already does at `adws/phases/worktreeSetup.ts:237`. Use the helper in `workflowLaunchContext`, in `adwUpgrade.runInitCommandDefault` and in `autoMergeHandler.mergeWithConflictResolution`. Leave `GitContext.selfHost` itself unchanged, because it also decides worktree base paths. Add unit tests: a GitContext with `selfHost: false` whose owner/repo match the framework identity gives `selfHost: true`, and the spawn gets no `--settings` and no `CLAUDE_HOOKS_LOG_DIR`; a different owner/repo gives `selfHost: false` and is injected.`

## Issue Summary
**Original Spec:** `specs/issue-938-adw-znc6m9-bug-guardrails-are-m-sdlc_planner-remove-guardrails-canary-key.md`

**Issue:** The guardrails gate's self-host fact comes from `GitContext.selfHost`, and `buildLaunchBoundary` sets that to `targetRepo === null` (`adws/core/launchGitContext.ts:198`). ADW's own deployed runs always carry `--target-repo paysdoc/AI_Dev_Workflow`, because `buildCronTargetRepoArgs` and `resolveWebhookRepo` add it to every spawn. So they reach the gate with `selfHost: false`. Without the retired `guardrails` key, they are injected on top of ADW's own `.claude/settings.json`. The hook command strings differ (`bunx tsx $CLAUDE_PROJECT_DIR/…` vs `bun <abs>/… || true`), so every hook fires twice, which ADR-0050 forbids.

Three launch-context sites carry the defect:
- `workflowLaunchContext` (`adws/phases/workflowRepoIdentity.ts:40-42`), which the 25 phase sites and `adwPatch.tsx:55` call;
- `runInitCommandDefault` (`adws/adwUpgrade.tsx:427`);
- `resolveConflictsViaAgent` (`adws/triggers/autoMergeHandler.ts:64`), which `mergeWithConflictResolution` calls.

Reproduced on `HEAD`: the argv `938 repro-938 --target-repo paysdoc/AI_Dev_Workflow` was run through `parseTargetRepoArgs` → `buildLaunchBoundary` (credentials stubbed) → `workflowLaunchContext` → `resolveGuardrailsDecision`, with the probe passing and the kill switch off. It prints `selfHost = false | inject = true`. No test catches it:
- the `workflowLaunchContext` tests use identity-less `{ selfHost }` stubs;
- the @adw-938 own-repository scenario passes `selfHost: true` directly.

**Solution:** Add one helper, `isSelfHostLaunch(gitContext)`, in a new `adws/core/selfHostLaunch.ts`. It returns true in three cases:
- there is no GitContext;
- the GitContext does not say `selfHost: false`;
- the GitContext's `{ owner, repo }` equals the framework checkout's identity.

How it gets and compares the framework identity:
- It reads the identity with `readLocalRepoIdentity(REPO_ROOT)` once per process, and a read failure becomes `null`.
- It compares with `sameRepoIdentity` behind the same `null` guard as `isFrameworkOwnRepository` (`adws/phases/worktreeSetup.ts:126-128`). `copyClaudeAssetsToWorktree` uses that at `:237`.

`workflowLaunchContext`, `runInitCommandDefault` and `resolveConflictsViaAgent` call the helper. `GitContext.selfHost` and `buildLaunchBoundary` stay unchanged, because `selfHost` also picks the worktree base path.

Approaches weighed:
- Setting `selfHost` in `buildLaunchBoundary` for the framework identity. Rejected: it moves worktree base paths.
- Dropping `--target-repo` for ADW's own repository in the cron and webhook triggers. Rejected: more files, it changes the pause-queue identity that `pauseQueueDecider` compares, and a manual `--target-repo` launch would still double the hooks.
- One helper at the three launch-context sites. Chosen: the fewest changes, with the rule in one place.

## Files to Modify
Use these files to implement the patch:

- `adws/core/selfHostLaunch.ts` (**new**): `isSelfHostLaunch`, the once-per-process framework identity read, and the test-only `resetFrameworkIdentityMemo`.
- `adws/phases/workflowRepoIdentity.ts`: `workflowLaunchContext` uses the helper. This covers the 25 phase sites and `adwPatch.tsx` with no edit to them.
- `adws/adwUpgrade.tsx`: `runInitCommandDefault` (`:427`) uses the helper.
- `adws/triggers/autoMergeHandler.ts`: `resolveConflictsViaAgent` (`:64`) uses the helper.
- `adws/core/__tests__/selfHostLaunch.test.ts` (**new**): the helper's unit tests.
- `adws/phases/__tests__/workflowRepoIdentity.test.ts`: framework-identity cases for `workflowLaunchContext`.
- `adws/agents/__tests__/claudeAgentGuardrails.test.ts`: spawn-level cases through `workflowLaunchContext`.
- `adws/triggers/__tests__/autoMergeHandler.test.ts`: one case pinning the conflict-resolver launch for the framework repository.
- `app_docs/feature-9gjajh-claude-agents-core.md`: the `:44` sentence on how `selfHost` is derived, which this patch makes stale.

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Add the helper in a new `adws/core/selfHostLaunch.ts`
- Write the module as follows. Its comments follow `.adw/coding_guidelines.md`: reasons only, no issue numbers.
  ```ts
  /**
   * `GitContext.selfHost` only records that no `--target-repo` was passed, and the cron and webhook triggers pass one
   * for the framework's own repository too. A launch for that repository keeps the framework's own
   * `.claude/settings.json`, so the guardrails gate must see it as self-host. `GitContext.selfHost` itself stays as it is
   * because it also picks the worktree base path.
   */

  import type { GitContext } from '@paysdoc/devplatform/git';
  import type { RepoIdentity } from '../types/agentTypes';
  import { REPO_ROOT } from './environment';
  import { readLocalRepoIdentity } from './localRepoIdentity';
  import { sameRepoIdentity } from './repoIdentityCrossCheck';

  let frameworkIdentity: RepoIdentity | null | undefined;

  /** `null` when the framework checkout has no readable `origin`; every `selfHost: false` launch is then a target. */
  function readFrameworkIdentityOnce(): RepoIdentity | null {
    if (frameworkIdentity !== undefined) return frameworkIdentity;
    try {
      frameworkIdentity = readLocalRepoIdentity(REPO_ROOT);
    } catch {
      frameworkIdentity = null;
    }
    return frameworkIdentity;
  }

  /** Test-only seam: clears the memoised framework identity so the next call re-reads it. */
  export function resetFrameworkIdentityMemo(): void {
    frameworkIdentity = undefined;
  }

  /** Anything short of an explicit `selfHost: false`, including no GitContext at all, counts as self-host and never injects. */
  export function isSelfHostLaunch(gitContext: Pick<GitContext, 'selfHost' | 'owner' | 'repo'> | undefined): boolean {
    if (gitContext?.selfHost !== false) return true;
    const framework = readFrameworkIdentityOnce();
    return framework !== null && sameRepoIdentity(framework, gitContext);
  }
  ```
- Keep the guard exactly `gitContext?.selfHost !== false`. It is today's `gitContext?.selfHost ?? true`.
  - Partial GitContext stubs that carry no `selfHost` must stay self-host and never reach `sameRepoIdentity`, which would throw on their missing `owner`. The stubs are `buildPhase.test.ts:49`, `reviewPhase.test.ts:89` and the @adw-928 upgrade step's `{ mainRepoPath }`.
  - TypeScript 5.9 narrows `gitContext` to defined after this guard (checked), so no `!` assertion is needed.
- Import the dependencies by module path as shown, not through the `adws/core` barrel. Do not add a barrel export.
- Callers import from `…/core/selfHostLaunch`. `reviewPhase.test.ts` and `autoMergeHandler.test.ts` replace the `core` barrel with a fixed mock that would not carry the new export.
- `bun run lint:git-guard` passes. The `cwd-derived-identity` rule only flags an identity read fed into a context constructor. This read takes an explicit root and feeds none, the same shape as `worktreeSetup.ts:120`.

### Step 2: Use the helper at the three launch-context sites
- **`adws/phases/workflowRepoIdentity.ts`**
  - Add `import { isSelfHostLaunch } from '../core/selfHostLaunch';`.
  - The body of `workflowLaunchContext` becomes `return { selfHost: isSelfHostLaunch(config.gitContext), adwId: config.adwId, gitContext: config.gitContext };`.
  - Replace its docblock with:
    ```ts
    /**
     * Self-host means a launch for the framework's own repository (see `isSelfHostLaunch`). A RepoContext is bound for
     * self-host runs too, so it cannot stand in for it. A config without a GitContext (phase-test fixtures only) counts as
     * self-host and never injects.
     */
    ```
  - The 25 phase call sites and `adwPatch.tsx:55` already call `workflowLaunchContext(config)`. Do not edit them.
- **`adws/adwUpgrade.tsx`, `runInitCommandDefault` (`:427`)**
  - The launch context becomes `{ selfHost: isSelfHostLaunch(params.gitContext), adwId: params.adwId, gitContext: params.gitContext }`.
  - Add `import { isSelfHostLaunch } from './core/selfHostLaunch';` beside the existing imports.
- **`adws/triggers/autoMergeHandler.ts`, `resolveConflictsViaAgent` (`:64`)**
  - The launch context becomes `{ selfHost: isSelfHostLaunch(ctx), adwId, gitContext: ctx }`.
  - Add `import { isSelfHostLaunch } from '../core/selfHostLaunch';`.
- **Leave these unchanged:**
  - `adws/core/launchGitContext.ts` and `GitContext.selfHost` (worktree base paths).
  - `adws/adwDocument.tsx`: its `buildLaunchBoundary(null)` is always self-host, so `selfHost: true` stays.
  - `adws/agents/claudeAgent.ts`: an absent launch context stays self-host.
  - `copyClaudeAssetsToWorktree`'s own `readFrameworkIdentity`.
  - The `selfHost` readers that are not guardrails decisions: `trigger_cron.ts:66`, `pauseQueueDecider.ts`, `docsIndexSweepDefaults.ts:126` and `cancelHandler.ts`.
  - Everything under `features/`. That includes `feature-938.feature`, its steps and `feature-929-agents.ts`; their target boundaries are `acme/widgets`, so their values do not change.

### Step 3: Add the unit tests
- Each test file below pins one framework identity, so no test depends on the checkout's real `origin`.
  - Mock the reader module with a factory that references no outer constant, because `vi.mock` is hoisted.
  - Reset the memo and set the identity in `beforeEach`:
  ```ts
  vi.mock('<relative>/core/localRepoIdentity', () => ({ readLocalRepoIdentity: vi.fn() }));
  // in beforeEach, after any vi.clearAllMocks():
  resetFrameworkIdentityMemo();
  vi.mocked(readLocalRepoIdentity).mockReturnValue({ owner: 'paysdoc', repo: 'AI_Dev_Workflow', platform: Platform.GitHub });
  ```
- **`adws/core/__tests__/selfHostLaunch.test.ts` (new)**: `describe('isSelfHostLaunch')`. It imports from `'../localRepoIdentity'`, `'../selfHostLaunch'`, `'../environment'` (`REPO_ROOT`) and `'@paysdoc/devplatform'` (`Platform`), and mocks `'../localRepoIdentity'`. Cases:
  - No GitContext gives `true`, and `readLocalRepoIdentity` is never called.
  - `{ selfHost: true, owner: 'acme', repo: 'widgets' }` gives `true`, and the reader is never called.
  - `{ selfHost: false, owner: 'PaysDoc', repo: 'ai_dev_workflow' }` gives `true`, compared case-insensitively like `sameRepoIdentity`. The reader was called with `REPO_ROOT`.
  - `{ selfHost: false, owner: 'acme', repo: 'widgets' }` gives `false`.
  - The reader throws (`mockImplementation(() => { throw new Error('Failed to get repo info: no origin'); })`). Then `{ selfHost: false, owner: 'paysdoc', repo: 'AI_Dev_Workflow' }` gives `false`.
  - Two `selfHost: false` calls read the identity once (`toHaveBeenCalledTimes(1)`).
- **`adws/phases/__tests__/workflowRepoIdentity.test.ts`**
  - Add the mock and `beforeEach`. Import `vi` and `beforeEach` from `vitest`, `readLocalRepoIdentity` from `'../../core/localRepoIdentity'` and `resetFrameworkIdentityMemo` from `'../../core/selfHostLaunch'`; `Platform` is already imported.
  - "takes selfHost: false from a target-repository GitContext": give the stub `owner: 'acme', repo: 'widgets'`. An identity-less `{ selfHost: false }` stub would now throw in `sameRepoIdentity`.
  - Add "counts a --target-repo GitContext for the framework's own repository as self-host". The stub `{ selfHost: false, owner: 'paysdoc', repo: 'AI_Dev_Workflow' } as unknown as GitContext` gives `toEqual({ selfHost: true, adwId: 'adw-framework', gitContext })`.
  - The other three `workflowLaunchContext` cases stay as they are.
- **`adws/agents/__tests__/claudeAgentGuardrails.test.ts`**
  - Add the mock (`'../../core/localRepoIdentity'`) and put the reset and return value in the existing `beforeEach`, after `vi.clearAllMocks()`.
  - Import `readLocalRepoIdentity` from `'../../core/localRepoIdentity'`, `resetFrameworkIdentityMemo` from `'../../core/selfHostLaunch'`, `workflowLaunchContext` from `'../../phases/workflowRepoIdentity'`, `Platform` from `'@paysdoc/devplatform'` and `type GitContext` from `'@paysdoc/devplatform/git'`.
  - Add a stub builder:
    ```ts
    function targetGitContext(owner: string, repo: string): GitContext {
      return { selfHost: false, owner, repo, commandEnv: () => ({}) } as unknown as GitContext;
    }
    ```
    `commandEnv` is required because the spawn reads the git identity overlay from it (`launchIdentityEnv`, `claudeAgent.ts`).
  - New `describe('runClaudeAgentWithCommand — a --target-repo launch for the framework's own repository')`:
    - Start the agent with `startAgent(makeWorktree(), workflowLaunchContext({ adwId: 'adw-framework-target', gitContext: targetGitContext('paysdoc', 'AI_Dev_Workflow') }))`. Expect no `--settings` in `argv`, `env['CLAUDE_HOOKS_LOG_DIR']` undefined, and `probeGuardrails` not called.
    - Do the same with `targetGitContext('acme', 'widgets')` and adwId `'adw-other-target'`. Expect `expectInjected(worktree, 'adw-other-target')`.
  - The existing cases (no file, the three leftover keys, self-host) still pass explicit `{ selfHost, adwId }` contexts. Leave them unchanged.
- **`adws/triggers/__tests__/autoMergeHandler.test.ts`**
  - Add the mock (`'../../core/localRepoIdentity'`) and add the reset and return value to `beforeEach`.
  - Import `readLocalRepoIdentity` from `'../../core/localRepoIdentity'`, `resetFrameworkIdentityMemo` from `'../../core/selfHostLaunch'` and the value `Platform` from `'@paysdoc/devplatform'`; the file imports only types from there today. These module paths are not the mocked `'../../core'` barrel.
  - Change `makeGitContext(exec)` to `makeGitContext(exec, owner = 'acme', repo = 'widgets')`, feeding `owner` and `repo` into the GitContext.
  - Add "starts /resolve_conflict as self-host when the pull request is the framework repository's own":
    - Build `ctx = makeGitContext(makeSpyExec('', true).exec, 'paysdoc', 'AI_Dev_Workflow')` and run `mergeWithConflictResolution(...)` as the first test in this `describe` does.
    - Expect `mockedAgent.mock.calls[0]?.[12]` to equal `{ selfHost: true, adwId: ADW_ID, gitContext: ctx }`.
  - The two existing `{ selfHost: false, … }` expectations, for `acme/widgets`, stay unchanged.

### Step 4: Correct the one document sentence the fix makes stale
- In `app_docs/feature-9gjajh-claude-agents-core.md:44`, replace the last sentence of the "Guardrails injection is target-repo only" bullet. The sentence to replace starts "Phases take `selfHost` from the launch boundary's `GitContext.selfHost` through `workflowLaunchContext` …". The replacement:
  > Phases (through `workflowLaunchContext`, `adws/phases/workflowRepoIdentity.ts`), the upgrade's `/adw_init` agent and the auto-merge conflict resolver take `selfHost` from `isSelfHostLaunch` (`adws/core/selfHostLaunch.ts`). It is true when `GitContext.selfHost` is, and also when the GitContext's owner/repo is the framework checkout's own, because the cron and webhook triggers pass `--target-repo` for ADW's own repository too. A bound `RepoContext` never decides it, because a self-host run binds one too.
- Change nothing else in that document. Leave `README.md` and ADR-0050 as they are: "Self-host runs get no injection" is what this patch restores.

### Step 5: Run the validation and check the staged set
- Run every command under `Validation`.
- Before committing, `git status --short` must list only the nine files under `Files to Modify` and this patch plan.

## Validation
Execute every command to validate the patch is complete with zero regressions.

1. Reproduction of the review's path. Before the patch, both lines print `selfHost = false | inject = true`, which was confirmed on `HEAD`. After it, the output must be `paysdoc/AI_Dev_Workflow -> selfHost = true | inject = false` and `paysdoc/depaudit -> selfHost = false | inject = true`:
   ```bash
   bunx tsx -e "
   import { parseTargetRepoArgs } from './adws/core/orchestratorCli';
   import { buildLaunchBoundary } from './adws/core/launchGitContext';
   import { workflowLaunchContext } from './adws/phases/workflowRepoIdentity';
   import { resolveGuardrailsDecision, productionGuardrailsGateDeps } from './adws/core/guardrailsGate';
   const gitIdentity = { authorName: 'ADW', authorEmail: 'adw@example.test', committerName: 'ADW', committerEmail: 'adw@example.test' };
   const deps = { ...productionGuardrailsGateDeps, probeGuardrails: async () => ({ ok: true }), notifySlack: async () => {}, getEnv: () => undefined };
   (async () => {
     for (const fullName of ['paysdoc/AI_Dev_Workflow', 'paysdoc/depaudit']) {
       const { gitContext } = buildLaunchBoundary(parseTargetRepoArgs(['938', 'repro-938', '--target-repo', fullName]), { resolveToken: () => 'stub-token', resolveGitIdentity: () => gitIdentity });
       const launch = workflowLaunchContext({ adwId: 'repro-938', gitContext });
       const decision = await resolveGuardrailsDecision({ selfHost: launch.selfHost, adwId: launch.adwId }, deps);
       console.log(fullName, '-> selfHost =', launch.selfHost, '| inject =', decision.inject);
     }
   })();
   "
   ```
2. `bun run lint && bun run lint:git-guard`
3. `bunx tsc --noEmit && bunx tsc --noEmit -p adws/tsconfig.json && bun run build`
4. `bun run test:unit`. Everything must pass, including:
   - the new and updated cases in the four test files from Step 3;
   - the unchanged `buildPhase.test.ts`, `reviewPhase.test.ts` and `claudeAgent.test.ts`, whose partial or explicit launch contexts must keep their current values.
5. Run the scenarios that start agents through the changed sites, then the regression suite:
   - `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-820 or @adw-928 or @adw-929 or @adw-930 or @adw-933 or @adw-937 or @adw-938"`
   - `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"`

   Their target boundaries are `acme/widgets`, and the @adw-928 upgrade step's `{ mainRepoPath }` stub stays self-host, so every value is unchanged.

## Patch Scope
**Lines of code to change:** about 170:
- about 45 lines of production code and documentation: the new ~35-line helper, two lines at each of the three sites, the `workflowLaunchContext` docblock and one doc sentence;
- about 125 lines of tests: a new ~55-line helper test file, plus additions to `workflowRepoIdentity.test.ts`, `claudeAgentGuardrails.test.ts` and `autoMergeHandler.test.ts`.

**Risk level:** low. Only the `selfHost` value handed to the guardrails gate changes, and only for a `selfHost: false` GitContext whose owner/repo is the framework checkout's. Every other launch gets the value it gets today. A failed identity read falls back to today's behaviour. `GitContext.selfHost`, worktree base paths and the pause-queue identity are untouched.

**Testing required:**
- unit tests for the helper: the absent, self-host, matching (case-insensitive), different, read-failure and memoised cases;
- `workflowLaunchContext` cases for a framework-identity target and another target;
- spawn-level tests: no `--settings` and no `CLAUDE_HOOKS_LOG_DIR` for the framework repository, and injection for another repository;
- an auto-merge launch-context case;
- the full unit suite, both type checks, the build, lint and git-guard;
- the affected BDD tags and `@regression`.

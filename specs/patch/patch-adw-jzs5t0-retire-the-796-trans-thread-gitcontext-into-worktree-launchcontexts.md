# Patch: Thread `gitContext` into every remaining worktree-cwd agent `launchContext`

## Metadata
adwId: `jzs5t0-retire-the-796-trans`
reviewChangeRequest: `Issue #1: Parity constraint 2 / acceptance criterion 4 regression: before this change adws/agents/claudeAgent.ts set ADW_WORKTREE_PATH and ADW_MAIN_REPO_PATH for every spawn whose cwd contained '.worktrees/'. It now does so only when launchContext?.gitContext is present, and .claude/hooks/pre-tool-use.ts rewriteWorktreePath() returns null (no main-repo-to-worktree path redirection) when either variable is missing. The following worktree-cwd spawn sites still pass a launchContext without gitContext and therefore lose the env vars: adws/phases/planPhase.ts:90 and :142; adws/phases/installPhase.ts:123; adws/phases/scenarioPhase.ts:63; adws/phases/stepDefPhase.ts:44; adws/phases/alignmentPhase.ts:148 and :206; adws/phases/planValidationPhase.ts:47 (shared launchContext const used at :108 and :179); adws/phases/unitTestPhase.ts:82; adws/phases/diffEvaluationPhase.ts:119; adws/phases/promotionRotAdvisory.ts:133; adws/phases/scenarioTestFixLoop.ts:93; adws/phases/prPhase.ts:70 (runPullRequestAgent); adws/triggers/autoMergeHandler.ts:79. Additionally adws/adwDocument.tsx:77 and adws/adwPatch.tsx:56 spawn in the worktree with no launchContext at all. Net effect: the plan, install, scenario, step-def, alignment, validation, unit-test, diff-evaluator, PR, rot-advisory, fidelity and conflict-resolver agents now run without the worktree path-rewrite guardrail, so a file tool call that resolves against the main repo root lands in the main checkout instead of the worktree. The spec's step 6 names exactly this as a criterion-4 violation. Resolution: Thread the context into every remaining worktree-cwd launchContext literal: in the WorkflowConfig-based phases use { selfHost: !repoContext, adwId, gitContext: requireWorkflowGitContext(config) } (or config.gitContext, matching the pattern already applied in buildPhase/documentPhase/reviewPhase/scenarioFixPhase/prReviewPhase); in adws/triggers/autoMergeHandler.ts:79 add gitContext: ctx (already in scope); in adws/adwDocument.tsx and adws/adwPatch.tsx pass a launchContext carrying the entrypoint's boundary gitContext. Keep selfHost: !repoContext unchanged at each site (parity constraint 1). Re-run the spec's step-6 parity grep to confirm no runClaudeAgentWithCommand/runCommandAgent spawn with a worktree cwd lacks gitContext, then update app_docs/feature-9gjajh-claude-agents-core.md line 10 to state that the env-var injection depends on a threaded launchContext.gitContext.`

## Issue Summary
**Original Spec:** `specs/issue-822-adw-jzs5t0-retire-the-796-trans-sdlc_planner-retire-transitional-construction-sites.md`

**Issue:** `adws/agents/claudeAgent.ts:146` now injects `ADW_WORKTREE_PATH` / `ADW_MAIN_REPO_PATH` only when `launchContext?.gitContext` is threaded (because `getMainRepoPath` no longer constructs its own `GitContext`, #822 step 6). The step-6 threading was applied to `buildPhase`, `documentPhase`, `reviewPhase`, `scenarioFixPhase`, `prReviewPhase`, `prPhase:38` and `adwUpgrade`, but **fourteen** other worktree-cwd `launchContext` literals still read `{ selfHost: !repoContext, adwId }` (or `{ selfHost: ctx.selfHost, adwId }` in `autoMergeHandler`), and two standalone entrypoints (`adwDocument.tsx`, `adwPatch.tsx`) spawn with no `launchContext` at all. For all of those agents the env vars are now silently absent, so `.claude/hooks/pre-tool-use.ts` `rewriteWorktreePath()` returns `null` and a main-repo-rooted file tool call is no longer redirected into the worktree. That is the parity-constraint-2 / acceptance-criterion-4 violation the spec's step 6 grep was meant to catch.

**Solution:** Add `gitContext` to each of the 16 remaining literals, changing nothing else about them:
- **WorkflowConfig phases (13 literals):** append `gitContext: config.gitContext`. `WorkflowConfig.gitContext` is always set by `initializeWorkflow` in production and is typed `GitContext | undefined`, which satisfies `AgentLaunchContext.gitContext?: Pick<GitContext, 'mainRepoPath'>` directly. This is the same form already used at `reviewPhase.ts:100` and `prPhase.ts:38`. `config.gitContext` is preferred over `requireWorkflowGitContext(config)` here because the existing phase tests (`scenarioTestFixLoop.test.ts` `makeConfig()`, `planPhase.test.ts`, `promotionRotAdvisory.test.ts`) build fixtures without a `gitContext`, and `requireWorkflowGitContext` throws on those. No new imports are needed.
- **`autoMergeHandler.ts:79`:** append `gitContext: ctx` (`ctx: GitContext` is already the function parameter).
- **`adwPatch.tsx` / `adwDocument.tsx`:** pass a `launchContext` carrying the boundary context (`config.gitContext` for adwPatch, whose config comes from `initializeWorkflow`; a `buildLaunchBoundary(null).gitContext` self-host boundary for adwDocument, which has no `WorkflowConfig`). At both sites pin `selfHost: true` — that is the value `runClaudeAgentWithCommand` already applies to an un-threaded caller (`launchContext?.selfHost ?? true`), so the guardrails `--settings` decision stays byte-for-byte identical and the only behaviour delta is the restored env vars. Using `!repoContext` there would newly switch guardrails injection on for those two agents, which is a criterion-4 behaviour change outside this patch.
- **Every existing `selfHost:` expression stays exactly as it is** (parity constraint 1).
- Update the two `toHaveBeenCalledWith` assertions in `autoMergeHandler.test.ts` that pin the literal shape, and correct line 10 of `app_docs/feature-9gjajh-claude-agents-core.md`.

Alternatives considered and rejected: (a) falling back to `buildLaunchBoundary(null)` inside `claudeAgent.ts` when no context is threaded — re-introduces a construction site outside the boundary, which `bun run lint:git-guard` and the spec's core goal forbid; (b) making `AgentLaunchContext.gitContext` required so `tsc` proves completeness — widens the type contract the spec deliberately made optional and touches every agent test fixture; scope creep for a patch.

## Files to Modify
Use these files to implement the patch:

- `adws/phases/planPhase.ts` — lines 90 and 142
- `adws/phases/installPhase.ts` — line 123
- `adws/phases/scenarioPhase.ts` — line 63
- `adws/phases/stepDefPhase.ts` — line 44
- `adws/phases/alignmentPhase.ts` — lines 148 and 206
- `adws/phases/planValidationPhase.ts` — line 47 (the shared `launchContext` const, which also feeds lines 108, 179, 238 and 287)
- `adws/phases/unitTestPhase.ts` — line 82
- `adws/phases/diffEvaluationPhase.ts` — line 119
- `adws/phases/promotionRotAdvisory.ts` — line 133
- `adws/phases/scenarioTestFixLoop.ts` — line 93
- `adws/phases/prPhase.ts` — line 70
- `adws/triggers/autoMergeHandler.ts` — line 79
- `adws/triggers/__tests__/autoMergeHandler.test.ts` — lines 139 and 176 (assertion shape)
- `adws/adwPatch.tsx` — `executePatchPhase`, the `runPatchAgent(...)` call at lines 56–64
- `adws/adwDocument.tsx` — `main()`, the `runDocumentAgent(...)` call at lines 77–84, plus the `./core` import block
- `app_docs/feature-9gjajh-claude-agents-core.md` — line 10

Not touched, verified out of scope: `adws/core/issueClassifier.ts:50` (no `cwd`, never a worktree) and `adws/triggers/issueDependencies.ts:158` (cwd is the repo base path, not a worktree) spawn without a `launchContext` and are unaffected by the worktree env-var guard.

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Append `gitContext: config.gitContext` to the 13 WorkflowConfig-phase literals
Each edit is a same-line change; leave the `selfHost: !repoContext` expression, argument positions and everything else untouched.
- `adws/phases/planPhase.ts:90` and `:142` — `{ selfHost: !repoContext, adwId }` → `{ selfHost: !repoContext, adwId, gitContext: config.gitContext }`
- `adws/phases/installPhase.ts:123` — same replacement
- `adws/phases/scenarioPhase.ts:63` — same replacement
- `adws/phases/stepDefPhase.ts:44` — same replacement
- `adws/phases/alignmentPhase.ts:148` and `:206` — same replacement
- `adws/phases/planValidationPhase.ts:47` — `const launchContext = { selfHost: !repoContext, adwId, gitContext: config.gitContext };` (this single const covers the `runValidationAgent` calls at 108/179/238 and the `runCommitAgent` at 287)
- `adws/phases/unitTestPhase.ts:82` — `launchContext: { selfHost: !repoContext, adwId, gitContext: config.gitContext },`
- `adws/phases/diffEvaluationPhase.ts:119` — same object-form replacement
- `adws/phases/promotionRotAdvisory.ts:133` — same object-form replacement
- `adws/phases/scenarioTestFixLoop.ts:93` — `{ selfHost: !repoContext, adwId, gitContext: config.gitContext },`
- `adws/phases/prPhase.ts:70` — `{ selfHost: !repoContext, adwId, gitContext: config.gitContext },` (matches the form already used at line 38 of the same file)
- `config` is already the phase parameter in every one of these functions; no destructuring or import changes are required.

### Step 2: Thread `ctx` in `autoMergeHandler.ts` and update its test
- `adws/triggers/autoMergeHandler.ts:79` — `{ selfHost: ctx.selfHost, adwId }` → `{ selfHost: ctx.selfHost, adwId, gitContext: ctx }`. Keep `ctx.selfHost` as is (that is this site's pre-existing value; parity constraint 1).
- `adws/triggers/__tests__/autoMergeHandler.test.ts:139` and `:176` — change the final expected argument from `{ selfHost: false, adwId: ADW_ID }` to `{ selfHost: false, adwId: ADW_ID, gitContext: ctx }` (`ctx` is the `makeGitContext(exec)` instance created in each of those two tests, so the reference is in scope). Without this the two `toHaveBeenCalledWith` assertions fail on the extra property.

### Step 3: Give `adwPatch.tsx` and `adwDocument.tsx` a threaded `launchContext`
- `adws/adwPatch.tsx` `executePatchPhase` (lines 56–64): `runPatchAgent`'s signature is `(adwId, reviewIssue, logsDir, specPath?, onProgress?, statePath?, cwd?, issueBody?, subprocessEnv?, launchContext?)`. Append three trailing arguments after `worktreePath`: `undefined, undefined, { selfHost: true, adwId, gitContext: config.gitContext }`. Precede the call with a one-line comment: `// selfHost pinned to true = the un-threaded default this call had before #822; only gitContext is new, so the guardrails decision is unchanged.` Do not pass `issue.body` or a `subprocessEnv` — both would change model selection / git env for this agent, which is out of scope.
- `adws/adwDocument.tsx`: add `buildLaunchBoundary` to the existing `from './core'` import block. Inside `main()`'s `try`, immediately before `runDocumentAgent(...)`, add `const boundary = buildLaunchBoundary(null);` (self-host boundary — this entrypoint parses no `--target-repo`, and `GitContext.mainRepoPath(cwd)` runs `git worktree list` in the explicit cwd, so the main-repo path resolves correctly for any worktree cwd). `runDocumentAgent`'s signature is `(adwId, logsDir, specPath?, screenshotsDir?, statePath?, cwd?, issueBody?, subprocessEnv?, launchContext?)`, so extend the call to `runDocumentAgent(adwId, logsDir, undefined, undefined, undefined, cwd || undefined, undefined, undefined, { selfHost: true, adwId, gitContext: boundary.gitContext })`, with the same one-line `selfHost` parity comment as in adwPatch. Building the boundary inside the `try` means a boundary failure is recorded in the orchestrator state via the existing catch, exactly like every other error there.

### Step 4: Re-run the spec's step-6 parity grep and correct the living doc
- Run the parity grep in Validation item 1 and confirm it prints nothing. Then confirm `grep -n "gitContext" adws/adwDocument.tsx adws/adwPatch.tsx` shows the two new literals.
- `app_docs/feature-9gjajh-claude-agents-core.md:10` — replace the bullet with: ``- Injects `ADW_WORKTREE_PATH` and `ADW_MAIN_REPO_PATH` environment variables when the working directory is inside a worktree **and** the caller threads a `launchContext.gitContext` (the launch boundary's `GitContext`, narrowed to `mainRepoPath` — `claudeAgent` no longer constructs one, #822). An un-threaded worktree spawn sets neither variable, which silently disables `.claude/hooks/pre-tool-use.ts` path rewriting, so every worktree-cwd spawn site must carry `gitContext`.``
- Do not touch any other line of that doc; `bun run lint:docs-index` in Validation confirms the index entry is still healthy.

## Validation
Execute every command to validate the patch is complete with zero regressions.

1. Parity grep (spec step 6) — every `launchContext` literal in production code must now carry `gitContext`; expected output is **empty** (before this patch it lists exactly the 14 literal sites named above; `claudeAgent.ts` is excluded because its line 160 is the guardrails-gate call, not a launch-context literal):
   ```bash
   grep -rn "selfHost: " adws --include='*.ts' --include='*.tsx' | grep -v "__tests__\|adws/agents/claudeAgent.ts" | grep "adwId" | grep -v "gitContext"
   ```
   Then `grep -n "gitContext" adws/adwDocument.tsx adws/adwPatch.tsx` must list the two new entrypoint literals.
2. Lint and both type-checks (`config.gitContext` and `boundary.gitContext` satisfy `AgentLaunchContext.gitContext` with no casts):
   ```bash
   bun run lint && bunx tsc --noEmit && bunx tsc --noEmit -p adws/tsconfig.json
   ```
3. Full Vitest suite — the two updated `autoMergeHandler.test.ts` assertions must pass, and the phase tests whose fixtures lack a `gitContext` (`scenarioTestFixLoop`, `planPhase`, `promotionRotAdvisory`) must stay green (baseline before this patch: 81/81 across those files plus `claudeAgent.test.ts`):
   ```bash
   bun run test:unit
   ```
4. Guard and docs-index gates — no new construction site was introduced (adwDocument uses `buildLaunchBoundary`, the sanctioned constructor) and the edited living doc still indexes cleanly:
   ```bash
   bun run lint:git-guard && bun run lint:docs-index
   ```
5. Build:
   ```bash
   bun run build
   ```

## Patch Scope
**Lines of code to change:** ~25 (16 one-line literal edits, 2 test assertion lines, 2 import/boundary lines in adwDocument, 2 comment lines, 1 doc line)
**Risk level:** low
**Testing required:** Type-check proves every threaded value matches `AgentLaunchContext`; the parity grep proves no worktree-cwd spawn is left un-threaded; `bun run test:unit` covers the updated `autoMergeHandler` assertions and the phase fixtures without a `gitContext`; no runtime behaviour other than the restored env-var injection changes, because every `selfHost` value is preserved.

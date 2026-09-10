# Patch: Restore the HITL Slack alert on the PR-review error path by injecting real notifier deps from `adwPrReview.tsx`

## Metadata
adwId: `ciwxf3-migrate-trigger-call`
reviewChangeRequest: `Issue #1: Operator-visible regression on the PR-review error path. initializePRReviewWorkflow (adws/phases/prReviewPhase.ts:143-161) builds \`base: WorkflowConfig\` without a \`gitContext\` field, and handlePRReviewWorkflowError (adws/phases/prReviewCompletion.ts:111-117) now resolves \`deps = notifierDeps ?? (config.base.gitContext ? buildNotifierDeps(...) : undefined)\` and only logs 'hitlBoardNotifier: no GitContext on this workflow config — skipping HITL Slack notification' when that is undefined. The only production caller, adws/adwPrReview.tsx:129, passes no notifierDeps, so for a hitl-labelled GitHub issue whose PR-review workflow errors, the ':warning: HITL issue #N ... PR review failed' Slack alert is no longer sent. On origin/dev notifyBlockedTransition(args, undefined) fell back to defaultReadIssue/defaultListOpenPRs and posted it. This contradicts the spec's 'Operator-visible behaviour unchanged' acceptance criterion and its edge-case assumption that the no-GitContext branch is reachable from test fixtures only. The SDLC path is unaffected because initializeWorkflow sets config.gitContext from the boundary (workflowInit.ts:157,471). Resolution: Restore the notification without widening scope: in adws/adwPrReview.tsx pass \`buildNotifierDeps(boundary.gitContext, boundary.repoId)\` (imported from './forge/hitlBoardNotifier') as the fifth argument of handlePRReviewWorkflowError at line 129 — \`boundary\` is already in scope from line 60. Alternatively add \`gitContext: boundary.gitContext\` to the \`base\` literal in prReviewPhase.ts, but note that this also makes \`config.base.gitContext?.commandEnv()\` at prReviewPhase.ts:282 start passing the context env to the PR-review build agent, a second behaviour change to weigh deliberately. Add a unit case asserting handlePRReviewWorkflowError reaches notifyBlockedTransition with real deps when none are injected and the config carries a GitHub repoContext.`

## Issue Summary
**Original Spec:** `specs/issue-821-adw-ciwxf3-migrate-trigger-call-sdlc_planner-migrate-triggers-delete-legacy-github-layer.md`

**Issue:** #821 made `NotifierDeps` required and taught `handlePRReviewWorkflowError` (`adws/phases/prReviewCompletion.ts:111-120`) to self-resolve them from `config.base.gitContext`, warning and skipping when that field is absent. The spec assumed "in production the boundary supplies both `repoContext` and `gitContext`" (spec task 4, edge case "test fixtures only"). That holds for SDLC (`initializeWorkflow` sets `gitContext` from the boundary, `workflowInit.ts:157,471`) but **not** for PR review: `initializePRReviewWorkflow`'s `base` literal (`adws/phases/prReviewPhase.ts:143-161`) never carried `gitContext` — neither on this branch nor on `origin/dev`. The one production caller, `adws/adwPrReview.tsx:129`, passes no fifth argument. Net effect: on `origin/dev` the `:warning: HITL issue #N "…" — PR review failed: …` Slack alert was posted (the notifier's old internal defaults); on this branch every real PR-review failure for a `hitl`-labelled GitHub issue hits the `skipping HITL Slack notification` warn instead. This violates the spec's "Operator-visible behaviour unchanged" acceptance criterion.

**Solution:** Take the review's primary resolution: inject the real reader set at the orchestrator, exactly as `adws/adwMerge.tsx:251-252` already does — `adwPrReview.tsx` passes `buildNotifierDeps(boundary.gitContext, boundary.repoId)` as the fifth argument of `handlePRReviewWorkflowError`. `boundary` is in scope (line 60), `buildNotifierDeps` → `createGhRepoApi(ctx)` is a bound view of closures (no command runs until `readIssue`/`listOpenPRs` execute inside the handler's `Platform.GitHub` + `repoContext` gate, and the expression is only evaluated in the `catch`), and the construction guard already accepts the identical shape in `adwMerge.tsx`. The handler itself is untouched. Add the requested unit case pinning that the handler reaches `notifyBlockedTransition` with real `buildNotifierDeps` readers when no deps are injected and the config carries a GitHub `repoContext` (plus the `gitContext` that branch reads). The alternative — adding `gitContext: boundary.gitContext` to the `base` literal — is rejected for this patch (see Notes).

## Files to Modify
Use these files to implement the patch:

- `adws/adwPrReview.tsx` — **edit (2 lines).** Import `buildNotifierDeps`; pass real deps at the terminal-handler call on line 129.
- `adws/phases/__tests__/prReviewCompletion.test.ts` — **new.** The single unit case the review asks for.
- `app_docs/feature-9gjajh-workflow-lifecycle-phases.md` — **edit (one sentence, line 64).** The paragraph currently implies the PR-review path self-resolves from `config.gitContext`; note that `adwPrReview.tsx` injects the deps because its `base` carries no `gitContext`.

Reference only (read, do not edit): `adws/phases/prReviewCompletion.ts` (the handler under test), `adws/forge/hitlBoardNotifier.ts` (`buildNotifierDeps`, `NotifierDeps`), `adws/adwMerge.tsx:34,251-252` (the precedent), `adws/providers/github/__tests__/gitContextFixture.ts` (`makeCtx`, `makeSpyExec`), `features/per-issue/step_definitions/feature-587.steps.ts:257-300` (`makeRepoContext`/`makeWorkflowConfig` fixture shapes and the `process.exit` sentinel to mirror).

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom. Do **not** edit `adws/phases/prReviewPhase.ts` or `adws/phases/prReviewCompletion.ts`.

### Step 1: Inject real notifier deps at the orchestrator (`adws/adwPrReview.tsx`)
- Add the import next to the other local imports (after line 49, `import { decidePostReviewOutcome } from './phases/decidePostReviewOutcome';`):
  ```ts
  import { buildNotifierDeps } from './forge/hitlBoardNotifier';
  ```
- Replace line 129 so the terminal handler receives the production reader set built over the boundary the process already holds:
  ```ts
  await handlePRReviewWorkflowError(
    config,
    error,
    tracker.totalCostUsd,
    tracker.totalModelUsage,
    buildNotifierDeps(boundary.gitContext, boundary.repoId),
  );
  ```
- Leave the `AuthRequiredError` → `handleAuthRequiredPause` line above it unchanged. Nothing else in the file changes; `boundary` (line 60) and `config` are already in scope. `boundary.repoId` is the same identity `bindWorkspaceContext(boundary, worktreePath)` stamped on `config.base.repoContext.repoId`, so the handler's `Platform.GitHub` gate and the deps' pull-URL owner/repo agree.

### Step 2: Add the unit case (`adws/phases/__tests__/prReviewCompletion.test.ts`, new)
- Vitest picks up `adws/**/__tests__/**/*.test.ts` (`vitest.config.ts`). Imports: `describe/it/expect/vi/beforeEach/afterEach` from `vitest`; `fs`, `os`, `path`; `handlePRReviewWorkflowError` from `'../prReviewCompletion'`; `notifyBlockedTransition` from `'../../forge/hitlBoardNotifier'`; `Platform, type RepoContext, type RepoIdentifier` from `'../../providers/types'`; `type WorkflowConfig` from `'../workflowInit'`; `type PRReviewWorkflowConfig` from `'../prReviewPhase'`; `type PRReviewWorkflowContext` from `'../../forge/workflowCommentsPR'`; `makeCtx, makeSpyExec` from `'../../providers/github/__tests__/gitContextFixture'`.
- Partial-mock **only** `notifyBlockedTransition` so `buildNotifierDeps` stays real (same `importOriginal` idiom as `adws/phases/__tests__/reviewPhase.test.ts`):
  ```ts
  vi.mock('../../forge/hitlBoardNotifier', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../forge/hitlBoardNotifier')>();
    return { ...actual, notifyBlockedTransition: vi.fn().mockResolvedValue(undefined) };
  });
  ```
  Do **not** mock `'../../core'` — the handler writes real state files, so give it a real directory instead (below); `persistTokenCounts` is skipped because `costUsd` is left `undefined`; `log` output is harmless.
- `process.exit` sentinel, exactly as `feature-587.steps.ts` does: `class ExitCalled extends Error { constructor(public readonly code: number | undefined) { super(\`process.exit(${code})\`); } }`; in `beforeEach` save `process.exit` and assign `process.exit = ((code?: number) => { throw new ExitCalled(code); }) as typeof process.exit;`; in `afterEach` restore it, `vi.clearAllMocks()`, and `fs.rmSync(tmpDir, { recursive: true, force: true })`.
- Fixture. `const REPO_ID: RepoIdentifier = { owner: 'acme', repo: 'widget', platform: Platform.GitHub };` (matches `makeCtx`'s default owner/repo). `tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adw-prreview-completion-'))`; `orchestratorStatePath = path.join(tmpDir, 'orch')` with `fs.mkdirSync` (`AgentStateManager.writeState`/`appendLog` write `<dir>/state.json` and the execution log into an existing directory). Spy exec answering the issue read: `const { exec, calls } = makeSpyExec(new Map([['gh issue view', JSON.stringify({ title: 'Fix the retry budget', labels: [{ name: 'hitl' }] })]]));` and `gitContext = makeCtx({}, exec)`. `repoContext: RepoContext` cast field-by-field like `feature-587.steps.ts`'s `makeRepoContext`: `{ repoId: REPO_ID, issueTracker: { moveToStatus: vi.fn().mockResolvedValue(true) } as unknown as RepoContext['issueTracker'], codeHost: { commentOnPullRequest: vi.fn() } as unknown as RepoContext['codeHost'], cwd: tmpDir }`. Build `base: WorkflowConfig` by copying the minimal field set from `makeWorkflowConfig` (`issueNumber: 42`, `adwId`, `orchestratorStatePath`, `orchestratorName`, `topLevelStatePath`, `ctx`, `repoContext`, `issue`, `issueType`, `worktreePath`, `defaultBranch`, `logsDir`, `recoveryState`, `branchName`, `applicationUrl`, `projectConfig`, `adwYmlConfig`, with the same `as unknown as` casts) **plus `gitContext`**, and wrap it as `PRReviewWorkflowConfig` (`prNumber: 99`, a stub `prDetails`, `unaddressedComments: []`, `ctx` as `PRReviewWorkflowContext`).
- The single case, `it('reaches notifyBlockedTransition with real buildNotifierDeps readers when no deps are injected and the config carries a GitHub repoContext', …)`:
  1. `await expect(handlePRReviewWorkflowError(prReviewConfig, new Error('boom'))).rejects.toBeInstanceOf(ExitCalled);` — no fifth argument.
  2. `expect(vi.mocked(notifyBlockedTransition)).toHaveBeenCalledTimes(1);` and the first argument `toEqual({ issueNumber: 42, repoInfo: REPO_ID, source: 'review_error', errorMessage: 'Error: boom' })`.
  3. Take the second argument `deps`; `expect(typeof deps.readIssue).toBe('function'); expect(typeof deps.listOpenPRs).toBe('function');` then prove they are the real readers bound to the config's `GitContext`, not a stub: `expect(deps.readIssue(42, REPO_ID)).toEqual({ title: 'Fix the retry budget', labels: [{ name: 'hitl' }] });` and `expect(calls.some((c) => c.command.includes('gh issue view'))).toBe(true);`.
  4. `expect(fs.existsSync(path.join(orchestratorStatePath, 'state.json'))).toBe(true);` — the handler still wrote its failed state before exiting (sanity that the test drove the real handler to its end).
- Keep it to this one `it(...)`; the injected-deps branch of the same handler is already pinned by the `@adw-587` rows, and `adwPrReview.tsx`'s `main()` self-invokes on import, so the orchestrator wiring is verified by typecheck + the grep in Validation, not by a unit test.

### Step 3: One-sentence living-doc note (`app_docs/feature-9gjajh-workflow-lifecycle-phases.md`, line 64)
- The paragraph ends: "`handlePRReviewWorkflowError` (`adws/phases/prReviewCompletion.ts`) follows the identical pattern for the PR-review path (`source: 'review_error'`)." Append one sentence: "Because `initializePRReviewWorkflow`'s `base` carries no `gitContext`, `adwPrReview.tsx` passes `buildNotifierDeps(boundary.gitContext, boundary.repoId)` explicitly (the `adwMerge.tsx` shape), so the skip-warn branch is reached only by test fixtures."
- No registry/`Owns:` change; `lint:docs-index` is count-based and stays at 47 entries.

## Validation
Execute every command to validate the patch is complete with zero regressions. Baseline observed on this branch before the patch (2026-09-10): `bunx tsc --noEmit -p adws/tsconfig.json` clean; `hitlBoardNotifier.test.ts` 17/17; `@adw-587` 15 scenarios / 118 steps passed. If any command below fails after the patch, fix it before reporting.

1. Typecheck + lint:
   `bunx tsc --noEmit -p adws/tsconfig.json && bunx tsc --noEmit && bun run lint`
2. Targeted units first, then the full suite:
   `bunx vitest run adws/phases/__tests__/prReviewCompletion.test.ts adws/forge/__tests__/hitlBoardNotifier.test.ts && bun run test:unit`
3. Guards (the `buildNotifierDeps` call in an orchestrator is a bound view, not a construction — no allowlist entry may be added; the legacy-path grep from the spec must still print nothing; docs gate stays green):
   `bun run lint:git-guard && bun run lint:docs-index && ! grep -rnE "(adws/|\.\./|\./)github/(githubApi|issueApi|prApi|projectBoardApi|issueListApi|labelManager|workflowComments|index|hitlBoardNotifier|linkedPrDetector|prCommentDetector|issueLinkMarker|proofCommentFormatter|workflowCommentsBase|workflowCommentsIssue|workflowCommentsPR)" adws features test scripts --include='*.ts' --include='*.tsx'`
4. BDD rows that drive this handler and the #821 feature:
   `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-587 or @adw-821"`
5. Wiring proof — both orchestrators now inject the production reader set at their terminal-handler call, and the PR-review phase files are untouched:
   `grep -n 'buildNotifierDeps' adws/adwPrReview.tsx adws/adwMerge.tsx && git diff --stat -- adws/phases/prReviewPhase.ts adws/phases/prReviewCompletion.ts | grep -c . | grep -qx 0 && echo "phase files untouched"`

## Patch Scope
**Lines of code to change:** ~2 in `adws/adwPrReview.tsx` (1 import + the widened call), ~80 new lines in `adws/phases/__tests__/prReviewCompletion.test.ts`, 1 sentence in `app_docs/feature-9gjajh-workflow-lifecycle-phases.md`.
**Risk level:** low — additive at a single call site, mirrors an existing orchestrator shape, evaluated only on the error path, no phase/handler logic changes.
**Testing required:** the new unit case (handler self-resolves real readers from a config carrying `gitContext` + GitHub `repoContext`), the existing notifier units, the `@adw-587`/`@adw-821` BDD rows, both guards, typecheck and lint.

## Notes
- **Why not `gitContext: boundary.gitContext` in the `base` literal.** It is one line, but `executePRReviewBuildPhase` (`adws/phases/prReviewPhase.ts:282`) already passes `config.base.gitContext?.commandEnv()` to `runPrReviewBuildAgent`, and that expression has been `undefined` on `origin/dev` as well (line 286 there; `base` never carried `gitContext`). Populating the field would start injecting the boundary's credential env plus `GIT_AUTHOR_*`/`GIT_COMMITTER_*` into the PR-review build agent's subprocess — a second operator-visible change the review asked to weigh deliberately, and outside a patch whose acceptance criterion is "behaviour unchanged". Observation for a separate follow-up, not this patch: SDLC's `buildPhase.ts:157` does pass `gitCtx.commandEnv()` to its build agent, so the PR-review build agent's `undefined` env is a pre-existing inconsistency.
- After this patch the handler's `config.base.gitContext` fallback remains a defensive branch on the PR-review path (production injects deps); `handleWorkflowDiscarded` on the SDLC path still self-resolves from `config.gitContext`, which `initializeWorkflow` sets. The unit case pins the fallback so a future caller that drops the fifth argument on a config that does carry `gitContext` still notifies.
- `.adw/coding_guidelines.md`: guard clauses and max-depth are unaffected (the widened call adds no nesting); the test file stays well under 300 lines; no `any`, casts limited to the `as unknown as` fixture shape the BDD steps already use.

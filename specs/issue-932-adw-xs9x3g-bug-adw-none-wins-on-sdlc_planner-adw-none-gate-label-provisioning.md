# Bug: `adw:none` is ignored on the comment, dependency-closure and cron take-over/merge paths; `adw:*` labels are never provisioned; the depaudit-triage skill routes by issue text

## Metadata
issueNumber: `932`
adwId: `xs9x3g-bug-adw-none-wins-on`
issueJson: `{"number":932,"title":"bug: adw:none wins on every path; adw labels are created up front; triage skill routes by label","body":"Source: the `## Divergence` sections of the records named below, in `specs/adr/`. Each item there states the facts, the check that showed them and the owner's ruling. Read those sections before planning; they are the specification.\n\n## Decision records\n\nADR-0041 (items 1 and 2), ADR-0033 (item 1).\n\n## What to build\n\n- **`adw:none` everywhere (ADR-0041, item 1).** The opt-out is read only on `issues.opened` and in the cron's fresh-issue path. A comment on an `adw:none` issue, or a dependency closing, still starts a run. Check the opt-out on every spawn path, in one place that all paths pass through.\n- **Labels up front (ADR-0041, item 2).** The provisioning function for the `adw:*` labels has no caller. Call it so that a repository has all labels before a person needs them: from `adw_init` or on the first webhook from a repository.\n- **Triage skill (ADR-0033, item 1).** The `depaudit-triage` skill puts `/adw_sdlc` in the body of a major-upgrade issue. The body no longer selects an orchestrator. The skill must apply an `adw:*` label.\n\nDo not change how conflicting classification labels are handled. ADR-0041 records that as settled: refused on `issues.opened` and by the cron, decided by the LLM on the other paths.\n\n## Acceptance criteria\n\n- [ ] An issue labelled `adw:none` starts no run on any path: opened, comment, dependency closure, cron. Unit tests cover each.\n- [ ] After provisioning, a repository has every label in the ADW label catalogue.\n- [ ] The triage skill contains no orchestrator command in an issue body.\n- [ ] The Divergence sections of ADR-0041 and ADR-0033 are removed in the same pull request.\n","state":"OPEN","author":"paysdoc","labels":["adw:bug"],"createdAt":"2026-10-01T19:20:01Z","comments":[],"actionableComment":null}`

## Bug Description

There are three defects. Each is a `## Divergence` item that the owner ruled a bug: ADR-0041 items 1 and 2, and ADR-0033 item 1.

**1. `adw:none` does not win on every spawn path.** `adw:none` (`ADW_NONE_LABEL`, "Opt out of ADW automation") is read in only two places:

- `decideIssueOpenedRoute` (`adws/triggers/issueOpenedRouter.ts`), on `issues.opened`.
- `decideLabelRecovery` (`adws/triggers/cronLabelEligibility.ts`). The cron filter applies it only to a fresh issue with no prior ADW run (`stage === null && adwId === null`, `adws/triggers/cronIssueFilter.ts:140`).

What happens today:

- **Comment.** A `## Continue` comment on an `adw:none` issue starts a run. The `issue_comment` branch calls `classifyAndSpawnWorkflow(issueNumber, commentBoundary, webhookTargetRepoArgs)` (`adws/triggers/trigger_webhook.ts:235`), and that function has no opt-out check.
- **Dependency closure.** Closing a blocker starts a run on an `adw:none` dependent. `handleIssueClosedDependencyUnblock` spawns through `buildDefaultDependencyUnblockDeps().spawn`, which calls `classifyAndSpawnWorkflow` (`adws/triggers/issueClosedUnblockRouter.ts:43`).
- **Cron.** The cron takes over an `abandoned` or `phase_timeout` run, and spawns `adwMerge.tsx` for an `awaiting_merge` issue, even when that issue is labelled `adw:none`. An issue with a prior run never reaches the label gate. The take-over branch (`adws/triggers/trigger_cron.ts:468`) and the merge branch (`trigger_cron.ts:416`) spawn directly, without `classifyAndSpawnWorkflow`.
- **Late labels.** The opened route reads only the payload snapshot, so it misses a label applied after the event was captured. `adws/triggers/docsIndexSweepDefaults.ts:108-109` creates its report issue and only then applies `hitl` + `adw:none`, so that issue's `issues.opened` event carries no labels.

Expected: an issue labelled `adw:none` starts no run on any path: opened, comment, dependency closure or cron. The owner ruled on 2026-10-01: "`adw:none` always wins, on every path".

**2. The `adw:*` labels are not provisioned up front.** Nothing calls `ensureAdwLabelsExist` (`adws/forge/adwLabelProvisioning.ts`) outside its tests. A label appears only when `applyLabel` lazy-creates it on first use, or when someone creates it by hand.

On 2026-10-01 the ADW repository had 6 of the 8 catalogue labels: `gh label list` shows no `adw:pr_review` and no `adw:blocked`. When ADR-0041 was checked, `adw:none` was missing as well.

Expected: every repository ADW serves has every label in `ADW_LABEL_DEFINITIONS` before a person needs one, so the opt-out label is in the label menu.

**3. The depaudit-triage skill routes by issue text.** The major-upgrade flow in `.claude/skills/depaudit-triage/SKILL.md` (line 108) puts the literal `/adw_sdlc` in the issue body "so ADW immediately picks up the issue and runs the upgrade SDLC".

Since ADR-0041 the body selects nothing. The LLM classifies the issue instead. If it picks `/chore`, the issue goes to `adwChore.tsx`, whose LLM diff gate can auto-merge. The depaudit PRD wants the full SDLC for a breaking upgrade.

Expected: the skill applies an `adw:*` label, and no issue body carries an orchestrator command.

Out of scope and unchanged: conflicting classification labels. They are refused on `issues.opened` and by the cron, and decided by the LLM on the comment and dependency-closure paths. ADR-0041 records this as settled.

## Problem Statement

- The opt-out is enforced in each caller instead of in the function every spawn path calls. All four paths reach `classifyAndSpawnWorkflow` (`adws/triggers/webhookGatekeeper.ts:55`): opened (through `routeIssueOpened`), comment, dependency closure, and the cron's `spawn_fresh` branch. That function checks only `adw:upgrade`.
- In the cron, the opt-out sits inside the fresh-issue label evaluator. It therefore never applies to an issue with a prior ADW run. The cron's take-over and merge branches also spawn without passing through `classifyAndSpawnWorkflow`.
- `ensureAdwLabelsExist` exists, but nothing calls it.
- The triage skill depends on the body-text trigger that #546 deleted.

## Solution Statement

1. **One opt-out gate in `classifyAndSpawnWorkflow`.**
   - Hoist the existing `issueTracker.fetchLabels(issueNumber)` call, used today only for the `adw:upgrade` check, into a `labels` constant read once after the auth-gate check.
   - If `readAdwLabelNames(labels).optOut` is true, log and return before the `adw:upgrade` route and before `evaluateCandidate`. `evaluateCandidate` acquires the spawn lock and can SIGKILL a process, reset a worktree and write state.
   - Release the spawn lock only when `precomputedDecision` is supplied. Only the cron arrives holding the lock, because it ran `evaluateCandidate` itself, and `releaseIssueSpawnLock` unlinks the lock file whoever owns it.
   - Reading the labels live also catches a label applied after a payload or a cron listing was captured. No forge call is added: the single `fetchLabels` call now serves both checks.
2. **Cron filter: opt-out on every stage.** In `evaluateIssue`, right after the `cancelled` guard, return `{ eligible: false, reason: 'label:opt_out' }` when `readAdwLabelNames(issue.labels.map((l) => l.name)).optOut` is true. This covers the cron's take-over and merge branches, which spawn directly. The reason string matches the existing fresh-path annotation.

   The two existing early exits stay, because they decide precedence:
   - `decideIssueOpenedRoute` puts opt-out ahead of the multi-label refusal comment and the eligibility check. This is the routing order ADR-0041 records.
   - `decideLabelRecovery` keeps its documented guard order.
3. **Provision the label catalogue when the per-repository cron starts.** Add `provisionAdwLabels(boundary)` to `adws/forge/adwLabelProvisioning.ts`. It wraps `ensureAdwLabelsExist(boundary.repoId, boundary.providers.issueTracker)` and never throws; the `providers` getter mints lazily and can throw. Call it once from the entry-script block of `trigger_cron.ts`, after `registerAndGuard` and before the first tick.
   - **It runs on a repository's first webhook.** The webhook starts one cron per repository on that repository's first event (`ensureCronProcess`, `trigger_webhook.ts:146`).
   - **It stays off the webhook's request path.** Provisioning is eight synchronous `gh label create --force` calls. On the request path they could push a delivery past GitHub's 10-second webhook timeout.
   - **It covers the self-host ADW repository.** `adw_init` cannot: `/adw_init` runs inside `adwUpgrade.tsx`, which the upgrade gate starts only for target repositories (`adws/phases/workflowInit.ts:222`, `if (targetRepo && targetRepoWorkspacePath)`) and only when the framework hash changes. Hanging provisioning on `adw_init` would never reach the ADW repository, which is the repository ADR-0041 found short of labels.
   - **It is idempotent.** It runs again on every cron start, which also restores a label someone deleted.
4. **The triage skill routes by label.**
   - The major-upgrade flow first runs `gh label create 'adw:bug' --color d73a4a --description 'ADW bug workflow' --force`. These are the catalogue's own values, in the same command shape `ensureLabel` uses.
   - It then runs `gh issue create --title <title> --body <body> --label adw:bug`. The body carries no slash command, and every `/adw_sdlc` mention is removed.
   - Why `adw:bug`: it maps to `/bug`, which maps to `adws/adwSdlc.tsx` (`adws/types/issueRouting.ts:5`). That is the orchestrator `/adw_sdlc` named, so the PRD's "full SDLC" intent holds. `adw:chore` would route to `adwChore.tsx` and its auto-merge diff gate, which is wrong for a breaking upgrade.
   - The label must be applied in the create call. ADW reads labels from the `issues.opened` payload, and a label added later would collide with the label ADW infers and writes back.
5. **Close the records.** Remove the `## Divergence` sections of ADR-0041 and ADR-0033 and change nothing else in them. This is the write-an-adr rule.

## Steps to Reproduce

1. **Unit level (reproduced during planning).** I ran a throwaway vitest file with the mocks from `webhookGatekeeper.test.ts`:
   - `classifyAndSpawnWorkflow(7, boundary, [])` with `fetchLabels → ['adw:none']`, which is the call shape of the comment and dependency-closure paths, spawned `tsx /repo/adws/adwChore.tsx 7 gen --issue-type /chore`.
   - `evaluateIssue` for an issue labelled `adw:none` returned `{"eligible":true,"action":"spawn","adwId":"old-run"}` at stage `abandoned`, and `{"eligible":true,"action":"merge","adwId":"old-run"}` at stage `awaiting_merge`. It did so even with a label evaluator that answers `opt_out`.
2. **Comment path, live.**
   - On a registered repository, open an issue labelled `adw:none`. The webhook logs `opted out via adw:none`.
   - Comment `## Continue`. The webhook logs `Issue #N classified as …, spawning …`, and an orchestrator starts.
3. **Dependency closure, live.**
   - Open issue B labelled `adw:none`, with `## Blocked by` followed by `- #A` in its body.
   - Close A. The webhook logs `Issue #B unblocked by closure of #A, spawning workflow`, and a run starts on B.
4. **Cron, live.**
   - Label `adw:none` on an issue that already has an ADW run: an adw-id comment and a state of `abandoned`, `phase_timeout` or `awaiting_merge`.
   - The next sweep logs `taking over adwId=…` or `Spawning merge orchestrator for issue #N`.
5. **Labels.**
   - `gh label list --limit 100 --json name --jq '.[].name' | grep '^adw:' | sort` lists 6 names; `adw:pr_review` and `adw:blocked` are missing.
   - `grep -rn "ensureAdwLabelsExist(" adws --include='*.ts' | grep -v __tests__` shows only the definition.
6. **Skill.** `grep -n "adw_sdlc" .claude/skills/depaudit-triage/SKILL.md` prints lines 108, 174 and 201.

## Root Cause Analysis

- **The opt-out is enforced in each caller.**
  - #542 placed the opt-out in the `issues.opened` route decider. #545 placed it in the cron's fresh-issue label-recovery gate.
  - #618 later moved the single-label *classification* override into the shared `classifyIssueForTrigger`. It explicitly left the opt-out out of scope, noting that these paths "currently do process `adw:none` issues".
  - So `classifyAndSpawnWorkflow`, the one function all four paths call, checks only `adw:upgrade`. The comment and dependency-closure paths never consult the opt-out.
- **`classifyIssueForTrigger` cannot hold the gate.**
  - It is skipped when a caller passes `precomputedClassification`, which happens for a labelled issue on the opened and cron paths.
  - It is skipped on every take-over branch.
  - Its result type has no "do not spawn" outcome.
- **The cron's check is scoped to fresh issues.** `evaluateIssue` calls `labelRecovery` only when `stage === null && resolution.adwId === null`. This is deliberate: the evaluator's other guards (`in_progress_comment`, `reserved_label`, …) must not block take-over. The opt-out rode inside that evaluator, so any issue with a prior run skips it. The cron's take-over branch (`spawnDetached` with `resolveResumeSpawn`) and merge branch (`spawn` of `adwMerge.tsx`) then never reach `classifyAndSpawnWorkflow`.
- **No provisioning caller.** #542 deferred bulk provisioning as "a separate concern". When `labelManager.ts` was deleted (#821), the function was kept as policy but still had no caller.
- **The skill predates label routing.** It was written for #438 under ADR-0007, when issue text triggered workflows. #546 deleted text triggers without touching the skill, which is `target: false` and is not read by any test.

## Relevant Files
Use these files to fix the bug:

- `README.md`: project overview (read first).
- `.adw/coding_guidelines.md`: guard clauses, comment rules (only the non-obvious why, no issue numbers), immutability, and tests that exercise behaviour.
- `adws/triggers/webhookGatekeeper.ts`: `classifyAndSpawnWorkflow`, the function every spawn path calls. It gets the opt-out gate.
- `adws/triggers/cronIssueFilter.ts`: `evaluateIssue`, the filter every cron candidate passes through. The opt-out moves to cover every stage.
- `adws/triggers/trigger_cron.ts`: its entry-script block gets the provisioning call (`registerAndGuard` at line 545, the "started" log at line 551). For context:
  - the merge branch (line 416) and the take-over branch (line 468) spawn directly;
  - `spawn_fresh` (line 495) calls `classifyAndSpawnWorkflow` with a precomputed decision.
- `adws/forge/adwLabelProvisioning.ts`: `ensureAdwLabelsExist`. It gains the never-throw `provisionAdwLabels(boundary)` wrapper.
- `adws/core/adwLabels.ts` (read only):
  - `readAdwLabelNames`, the single definition of opt-out;
  - `ADW_LABEL_DEFINITIONS`, the label catalogue;
  - `ADW_CLASSIFICATION_LABELS` and `resolveAdwLabelDefinition`.
- `adws/core/launchGitContext.ts`: `LaunchBoundary`. Its `providers` getter mints lazily, is memoised, and can throw. Read only.
- `adws/triggers/spawnGate.ts`: `releaseIssueSpawnLock` unlinks without checking ownership, which is why the gate releases the lock only for the cron. Read only.
- `adws/triggers/takeoverHandler.ts`: `evaluateCandidate` takes the lock and has side effects, which is why the gate runs before it. Read only.
- `adws/triggers/trigger_webhook.ts`: the comment path (line 235) and `ensureCronProcess` (line 146). Unchanged.
- `adws/triggers/issueOpenedRouter.ts`: the opened path. Its opt-out route and conflict refusal stay unchanged.
- `adws/triggers/issueClosedUnblockRouter.ts`: the dependency-closure path, through `buildDefaultDependencyUnblockDeps().spawn`. Unchanged.
- `adws/triggers/cronLabelEligibility.ts`: `decideLabelRecovery`. Unchanged, including the conflict refusal.
- `adws/core/issueClassifier.ts`: `classifyIssueForTrigger`. Unchanged; the LLM still decides a label conflict on the comment and dependency paths.
- `adws/triggers/docsIndexSweepDefaults.ts`: creates an issue, then applies `hitl` + `adw:none`. The live label read in the gate helps here. Read only.
- `adws/phases/workflowInit.ts`: the upgrade gate (and so `/adw_init`) runs only for target repositories. Read only.
- `adws/types/issueRouting.ts`: `/bug` maps to `adws/adwSdlc.tsx`, which is the reason for choosing `adw:bug`. Read only.
- `.claude/skills/depaudit-triage/SKILL.md`: the major-upgrade flow (lines 108, 109, 116), the Action 3 upstream body (line 174) and the Notes (line 201).
- `specs/adr/0041-label-based-classification.md`: remove `## Divergence` (lines 77–81).
- `specs/adr/0033-depaudit-as-dependency-gate.md`: remove `## Divergence` (lines 62–65).
- `.claude/skills/write-an-adr/SKILL.md`: after acceptance, only `status`, `superseded-by`, `## Divergence` and the supersession note may change.
- `specs/prd/adw-init-hash-and-label-classification.md` and `specs/prd/depaudit.md`: the original intent (provisioning on first webhook; the full SDLC for major upgrades).
- Tests:
  - changed: `adws/triggers/__tests__/webhookGatekeeper.test.ts`, `adws/triggers/__tests__/cronIssueFilter.test.ts`, `adws/triggers/__tests__/issueClosedUnblockRouter.test.ts`, `adws/forge/__tests__/adwLabelProvisioning.test.ts`;
  - unchanged: `adws/triggers/__tests__/issueOpenedRouter.test.ts` (it already covers the opened path) and `adws/triggers/__tests__/cronLabelEligibility.test.ts`;
  - precedent for a prompt-file contract test: `adws/__tests__/prTemplateMarker.test.ts`.
- Conditional docs that match this task (`.adw/conditional_docs.md`):
  - `app_docs/feature-9gjajh-webhook-triggers.md`: `classifyAndSpawnWorkflow`, `issueClosedUnblockRouter.ts`, `routeIssueOpened`.
  - `app_docs/feature-9gjajh-cron-triggers.md`: `cronIssueFilter.ts`, `cronLabelEligibility.ts`, `trigger_cron.ts`.
  - `app_docs/feature-9gjajh-github-api.md`: `adwLabelProvisioning.ts`, `ensureAdwLabelsExist`.
  - `app_docs/feature-9gjajh-classifier-and-routing.md`: `adwLabels.ts`.
  - `app_docs/feature-9gjajh-takeover-and-coordination.md`: the spawn gate and takeover.
  - `app_docs/feature-9gjajh-commands-and-skills.md`: `.claude/skills/**`.
  - `app_docs/feature-9gjajh-specs-and-prd.md`: `specs/**`.

### New Files

- `adws/triggers/__tests__/trigger_webhook.test.ts`: drives `dispatchWebhookEvent` and proves the comment path reaches the gate.
- `adws/__tests__/depauditTriageSkill.test.ts`: a contract test for the skill. It checks that the skill has no orchestrator command, that it applies `adw:bug` at creation with the catalogue's colour and description, and that `adw:bug` routes to `adwSdlc.tsx`.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### 1. Gate the opt-out in `classifyAndSpawnWorkflow` (`adws/triggers/webhookGatekeeper.ts`)

**Code changes:**

- Extend the import: `import { issueTypeToAdwLabel, ADW_UPGRADE_LABEL, readAdwLabelNames } from '../core/adwLabels';`.
- Directly after the `readAuthGate()` block (line 65), read the labels once: `const labels = issueTracker.fetchLabels(issueNumber);`. Move the sentence "fetchLabels is fail-open ([] on error)…" from the `adw:upgrade` comment onto this line, and keep the rest of that comment where it is.
- Insert the gate right after that line, before the `adw:upgrade` block:
  ```ts
  // adw:none wins on every spawn path, so it is read here, live, before evaluateCandidate
  // locks, kills or resets anything. Only the cron arrives holding the spawn lock (its
  // precomputed decision), and releaseIssueSpawnLock unlinks whoever owns the file.
  if (readAdwLabelNames(labels).optOut) {
    log(`Issue #${issueNumber}: opted out via adw:none, skipping spawn`);
    if (precomputedDecision) releaseIssueSpawnLock(repoId, issueNumber);
    return;
  }
  ```
- Change the `adw:upgrade` test to `if (labels.includes(ADW_UPGRADE_LABEL)) {`. Leave everything else unchanged: the rest of that block, the auth-gate block, the takeover branches, classification and `persistInferredLabel`.

**Tests:** add `describe('classifyAndSpawnWorkflow — adw:none wins on every spawn path')` to `adws/triggers/__tests__/webhookGatekeeper.test.ts`.

- Reuse `makeBoundary`, `spawnMock`, `evaluateCandidateMock` and `releaseIssueSpawnLockMock`. Import the mocked `classifyIssueForTrigger` from `'../../core/issueClassifier'`. In `beforeEach`, call `mockClear()` on the spawn and lock mocks and `mockReset()` on `evaluateCandidateMock`.
- One case per path, each using that path's exact call shape:

  | Path | Call | `fetchLabels` returns | Expect |
  |---|---|---|---|
  | comment | `(41, boundary, TARGET_ARGS)` | `['adw:none']` | No spawn. `evaluateCandidate`, `classifyIssueForTrigger` and `releaseIssueSpawnLock` are not called. |
  | dependency closure | same shape as comment | `['adw:bug', 'adw:none']` | No spawn; `evaluateCandidate` not called. The opt-out beats a classification label. |
  | issues.opened | `(42, boundary, TARGET_ARGS, undefined, undefined, { precomputedClassification: '/bug', issueTitle: 'Fix login' })` | `['adw:bug', 'adw:none']` | No spawn; `evaluateCandidate` not called. |
  | cron | `(43, boundary, TARGET_ARGS, 'adw-prior', { kind: 'spawn_fresh' }, { precomputedClassification: '/chore', issueTitle: 'Bump deps' })` | `['adw:chore', 'adw:none']` | No spawn; `releaseIssueSpawnLock` called with `(REPO_INFO, 43)`. |

- Labels `['adw:upgrade', 'adw:none']`: nothing is spawned, not even `adwUpgrade.tsx`.
- Control: labels `['adw:bug']` with `evaluateCandidate → { kind: 'spawn_fresh' }` spawns a workflow, and `fetchLabels` was called exactly once.

### 2. Pin the comment and dependency-closure paths to the gate

**Comment path: new `adws/triggers/__tests__/trigger_webhook.test.ts`.**

- Mock `'../webhookGatekeeper'` with every name its importers use: `classifyAndSpawnWorkflow` (a hoisted `vi.fn(() => Promise.resolve())`), `ensureCronProcess`, `spawnDetached`, `logDeferral` and `closeAbandonedDependents`.
- Mock the rest of the path:
  - `'../../forge/workflowCommentsBase'`: `isAdwRunningForIssue` returns `false`.
  - `'../issueEligibility'`: `checkIssueEligibility` returns `{ eligible: true }`.
  - `'../../core/authGate'`: `readAuthGate` returns `null`; also mock `writeAuthGate`.
  - `'../../core'`: use `importOriginal` and replace `log` with `vi.fn()`.
- Call `vi.stubEnv('GITHUB_WEBHOOK_SECRET', '')` in `beforeEach` and `vi.unstubAllEnvs()` in `afterEach`, so the unsigned payload is not rejected with a 401.
- Call `dispatchWebhookEvent` with:
  - header `x-github-event: issue_comment`;
  - payload `{ action: 'created', repository: { full_name: 'acme/target', clone_url: 'https://example.invalid/acme/target.git' }, issue: { number: 77, body: '', labels: [{ name: 'adw:none' }] }, comment: { body: '## Continue' } }`;
  - `mintEventBoundary = () => boundary`, where `boundary` is a fake with `repoId` and `providers.issueTracker.fetchComments`.
- Assert with `await vi.waitFor(...)` that `classifyAndSpawnWorkflow` was called with `(77, boundary, ['--target-repo', 'acme/target', '--clone-url', 'https://example.invalid/acme/target.git'])`.
- Build the fake `req` and `res` like `features/per-issue/step_definitions/feature-908.steps.ts:488-501`.
- Give each case an issue number used nowhere else in the file. The module keeps a 60-second cooldown per issue.

**Dependency-closure path: `adws/triggers/__tests__/issueClosedUnblockRouter.test.ts`.**

- Add `vi.mock('../webhookGatekeeper', () => ({ classifyAndSpawnWorkflow: vi.fn(() => Promise.resolve()) }))` and import the mock.
- New case: `buildDefaultDependencyUnblockDeps(boundary).spawn(29, TARGET_ARGS)` calls `classifyAndSpawnWorkflow` with `(29, boundary, TARGET_ARGS)`.
- The existing tests inject their own `spawn`, so they are unaffected.

**Opened path: already covered.** `routeIssueOpened` has the test "AC1: adw:none → opted_out". `buildDefaultIssueOpenedRouterDeps().classifyAndSpawn` calls `classifyAndSpawnWorkflow`, and step 1 has an opened-shape case.

### 3. Apply the opt-out on every cron stage (`adws/triggers/cronIssueFilter.ts`)

**Code changes:**

- Add `import { readAdwLabelNames } from '../core/adwLabels';`.
- In `evaluateIssue`, directly after the `cancelledThisCycle` guard (line 76), add:
  ```ts
  // Every stage: the take-over and merge branches spawn without passing
  // classifyAndSpawnWorkflow's opt-out gate.
  if (readAdwLabelNames(issue.labels.map((l) => l.name)).optOut) {
    return { eligible: false, reason: 'label:opt_out' };
  }
  ```
- Leave `labelRecovery` (fresh issues only) and `decideLabelRecovery` untouched. Conflict (`multi_label`) and reserved-label handling therefore do not change.

**Tests:** add `describe('evaluateIssue — adw:none opts out on every stage')` to `adws/triggers/__tests__/cronIssueFilter.test.ts`, using `makeIssue({ labels: [{ name: 'adw:none' }], updatedAt: OLD_DATE })`.

- Each of these cases returns `{ eligible: false, reason: 'label:opt_out' }`:
  - a fresh issue with no evaluator injected (`freshResolution()`);
  - a fresh issue with a prior adwId (`takeoverResolution()`);
  - stage `abandoned`;
  - stage `phase_timeout`;
  - stage `awaiting_merge`, so no merge is dispatched.
- `cancelledThisCycle` still takes precedence and returns `cancelled`.
- `filterEligibleIssues` leaves the issue out of `eligible` and annotates it `#N(label:opt_out)`.
- Control: the same `abandoned` issue without the label stays eligible.

### 4. Provision the label catalogue when the per-repository cron starts

**Code changes:**

- In `adws/forge/adwLabelProvisioning.ts`, add `import type { LaunchBoundary } from '../core/launchGitContext';`, following the `prCommentDetector.ts` precedent. Then add:
  ```ts
  /** Never throws: an issue tracker that cannot be minted is logged like a failed label. */
  export function provisionAdwLabels(
    boundary: Pick<LaunchBoundary, 'repoId' | 'providers'>,
    logger: Logger = log,
  ): void {
    try {
      ensureAdwLabelsExist(boundary.repoId, boundary.providers.issueTracker, logger);
    } catch (error) {
      logger(`provisionAdwLabels: no issue tracker for ${boundary.repoId.owner}/${boundary.repoId.repo}: ${error}`, 'warn');
    }
  }
  ```
- In `adws/triggers/trigger_cron.ts`, import `provisionAdwLabels` from `'../forge/adwLabelProvisioning'`.
- In the entry-script block, add the call directly after `log('CRON trigger (backlog sweeper) started');` (line 551). At that point `registerAndGuard` has let this process proceed, and neither the guardrails warm-up nor the first `runGuardedTick()` has run yet:
  ```ts
  // The webhook starts one cron per repository on its first event (ensureCronProcess), so this
  // is where a repository gets its adw:* labels — outside the webhook's request path, since
  // each label is a synchronous gh call.
  if (cronBoundary) provisionAdwLabels(cronBoundary);
  ```

**Tests:** add `describe('provisionAdwLabels')` to `adws/forge/__tests__/adwLabelProvisioning.test.ts`.

- **Acceptance criterion: after provisioning, the repository has every catalogue label.**
  - Seed a `Set` with the ADW repository's labels as of 2026-10-01: `adw:bug`, `adw:chore`, `adw:feature`, `adw:none`, `adw:unverified`, `adw:upgrade`.
  - Give the fake tracker an `ensureLabel` that adds to the set.
  - After `provisionAdwLabels`, the sorted set equals `ADW_LABEL_DEFINITIONS.map((d) => d.name)`, sorted.
- **A boundary whose `providers` getter throws.** `provisionAdwLabels` does not throw, and the injected logger receives one `'warn'` that names `acme/widgets`.

### 5. Route the triage skill's major-upgrade issue by label (`.claude/skills/depaudit-triage/SKILL.md`)

- **Line 108** (major flow, step 3 "Draft the issue", **Body**): drop "and the literal `/adw_sdlc` command on its own line so ADW immediately picks up the issue and runs the upgrade SDLC". The body is now the readable summary plus a pointer to the finding. Say that it carries no slash command, because ADW routes the issue by the `adw:bug` label applied in step 4.
- **Line 109** (step 4): rename it "File the issue with its routing label". Against the current repo, still with no `--repo` flag, it runs two commands in order:
  1. `gh label create 'adw:bug' --color d73a4a --description 'ADW bug workflow' --force`
  2. `gh issue create --title <title> --body <body> --label adw:bug`

  Add two sentences:
  - `adw:bug` sends the issue to ADW's full SDLC (`adws/adwSdlc.tsx`).
  - The label goes in the create call, never afterwards. ADW reads labels from the `issues.opened` event, and an issue opened without a label gets an `adw:*` label inferred by the LLM, which a later label would conflict with.
- **Line 116** (step 7): change the condition to "If `gh label create` or `gh issue create` fails …"; keep the rest.
- **Line 174** (Action 3, step 4): replace "The body does NOT include `/adw_sdlc` — ADW SDLC integration is only for the current-repo major-bump path." with "The upstream issue carries no `adw:*` label — ADW routing applies only to the current-repo major-bump path."
- **Line 201** (Notes, "Major-bump auto-filing"): replace "it embeds `/adw_sdlc` in the body so ADW runs the upgrade SDLC" with "it applies the `adw:bug` label at creation so ADW runs the full SDLC on it".
- When done, no `/adw_<name>` string remains anywhere in the file.

**Test:** new `adws/__tests__/depauditTriageSkill.test.ts`, modelled on `prTemplateMarker.test.ts`. Read the skill once and assert:

- the content does not match `/\/adw_[a-z_]+/`;
- it contains `gh issue create --title <title> --body <body> --label adw:bug`;
- for `def = resolveAdwLabelDefinition('adw:bug')`, it contains `--color ${def.color}` and `--description '${def.description}'`;
- `ADW_CLASSIFICATION_LABELS['adw:bug']` is `'/bug'`, and `issueTypeToOrchestratorMap['/bug']` (from `adws/types/issueRouting.ts`) is `'adws/adwSdlc.tsx'`.

### 6. Remove the resolved Divergence sections

- `specs/adr/0041-label-based-classification.md`: delete lines 77–81 (the `## Divergence` heading, both items and the blank line after them). The last bullet of `### Confirmation` is then followed by one blank line and `## More Information`.
- `specs/adr/0033-depaudit-as-dependency-gate.md`: delete lines 62–65 (the `## Divergence` heading, item 1 and the blank line after it).
- Change nothing else in either record. The front matter, `### Confirmation` and `## More Information` stay byte-for-byte, as the write-an-adr rule requires. That includes ADR-0041's "`adw:none` overrides on every path; see Divergence."
- `specs/adr/README.md` needs no change.

### 7. Run the validation commands

- Run every command in `Validation Commands`, in order.

## Validation Commands
Execute every command to validate the bug is fixed with zero regressions.

- `bunx vitest run adws/triggers/__tests__/webhookGatekeeper.test.ts adws/triggers/__tests__/trigger_webhook.test.ts adws/triggers/__tests__/issueClosedUnblockRouter.test.ts adws/triggers/__tests__/issueOpenedRouter.test.ts adws/triggers/__tests__/cronIssueFilter.test.ts adws/triggers/__tests__/cronLabelEligibility.test.ts adws/triggers/__tests__/trigger_cron.test.ts adws/forge/__tests__/adwLabelProvisioning.test.ts adws/__tests__/depauditTriageSkill.test.ts`
  - Reproduces the bug: before steps 1–5, the new opt-out, cron-stage, `provisionAdwLabels` and skill cases fail. After them, every file passes.
- `grep -rn "provisionAdwLabels(" adws --include='*.ts' | grep -v __tests__`
  - Expect two lines: the definition in `adws/forge/adwLabelProvisioning.ts` and one call in `adws/triggers/trigger_cron.ts`.
- `! grep -nE '/adw_[a-z_]+' .claude/skills/depaudit-triage/SKILL.md && echo "NO ORCHESTRATOR COMMAND"`
  - Prints `NO ORCHESTRATOR COMMAND`.
- `grep -c -- "--label adw:bug" .claude/skills/depaudit-triage/SKILL.md`
  - Expect `1` or more.
- `! grep -n '^## Divergence' specs/adr/0041-label-based-classification.md specs/adr/0033-depaudit-as-dependency-gate.md && echo "DIVERGENCE REMOVED"`
  - Prints `DIVERGENCE REMOVED`.
- `test "$(git diff origin/dev -- specs/adr/ | grep -c '^+[^+]')" = 0 && echo "ADR EDITS ARE DELETIONS ONLY"`
  - Prints `ADR EDITS ARE DELETIONS ONLY`: the ADR diff adds no lines.
- `bun run lint`
  - ESLint passes.
- `bunx tsc --noEmit`
  - The root type-check passes.
- `bunx tsc --noEmit -p adws/tsconfig.json`
  - The ADW type-check passes.
- `bun run test:unit`
  - The whole unit suite passes with 0 failures. Baseline before the change: 155 files and 2635 tests; expect those plus the new tests.
- `bun run build`
  - The build passes.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --dry-run --format summary`
  - 0 undefined and 0 ambiguous steps. Baseline: `265 scenarios (265 skipped)`, plus any `@adw-932` scenarios the scenario writer adds.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-932" --format summary`
  - Every scenario passes. The count is 0 if none were written.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression" --format summary`
  - The full regression gate. Baseline: `122 scenarios (42 pending, 80 passed)` and `886 steps (42 pending, 86 skipped, 758 passed)`.
  - Expect the same counts, with 0 failed, 0 undefined and 0 ambiguous.
  - The exit code is non-zero only because of the 42 pending rows that already exist.

## Notes
- **Guidelines.** Follow `.adw/coding_guidelines.md` strictly: guard clauses, no `any`, comments only for the non-obvious why (no issue numbers, no restating the code), and tests that exercise behaviour through public functions.
- **No new library** is needed.
- **Opt-out checks after this change.**
  - `classifyAndSpawnWorkflow` is the gate that decides. All four spawn paths pass through it.
  - The cron filter covers the cron's own direct-spawn branches: take-over and merge.
  - The two older early exits stay because they decide precedence:
    - `decideIssueOpenedRoute` checks opt-out before the conflict refusal comment.
    - Both early exits stop the issue before the eligibility check and any LLM call.
- **Failed label reads.**
  - On GitHub, `fetchLabels` is fail-open: it returns `[]` on error. A failed read on the comment or dependency-closure path therefore proceeds as if the issue had no labels. The `adw:upgrade` check already follows this policy, and the port cannot tell "no labels" from "error".
  - The Jira adapter throws from `fetchLabels` and from `ensureLabel`. The first is not new, because `classifyAndSpawnWorkflow` already calls it. The second makes `provisionAdwLabels` log one warning per label at cron start. Neither crashes the cron.
- **Regression harness.** Only the `@adw-911` scenario launches a real cron (`features/regression/step_definitions/realCronProcess.ts`). Its PATH carries a `gh` shadow (`feature-902-queue.steps.ts` `createGhMockDir`) that exits 0 for `gh label create`. Provisioning therefore costs that scenario about one second of its 20-second first-tick budget and makes no network call. Nothing in it asserts on the extra log line.
- **Out of scope, unchanged:**
  - the ADR-0032 heading directives (`## Cancel` and `## Retry`), which ADR-0041 leaves untouched;
  - pause-queue and auth-queue resumes, which continue a run that already started;
  - PR-review spawns, which are keyed on a pull request;
  - the upgrade lane: `upgradeGate.ts` spawning and the cron's `upgradeRedrive` pass. It stops on `adw:blocked`, and the PRD exempts `#UPG` from the opt-out.
- **Two consequences to expect.**
  - `adw:none` now wins inside `classifyAndSpawnWorkflow`, so a comment no longer drives a `#UPG` that someone labelled `adw:none`.
  - A `## Retry` that resets `merge_blocked` to `awaiting_merge` on an `adw:none` issue waits until the label is removed, because the cron filter now holds the merge.
- **Deploy.** Provisioning runs when a cron process starts. A cron started before the deploy runs the old code until it restarts, or until it dies and the webhook respawns it.
- **For the document phase:**
  - `app_docs/feature-9gjajh-webhook-triggers.md`: the gate.
  - `app_docs/feature-9gjajh-cron-triggers.md`: opt-out on every stage, and provisioning at cron start.
  - `app_docs/feature-9gjajh-github-api.md`: `provisionAdwLabels` and its caller. Its "six" labels is out of date; the catalogue has eight.
  - `app_docs/feature-9gjajh-commands-and-skills.md`: the triage skill's label.
  - `README.md:664`: also says "six".
- **Glossary.** `UBIQUITOUS_LANGUAGE.md` still defines "ADW Command" as a slash command in the issue body, which has been out of date since ADR-0041. It is not touched here.
- **BDD scenarios.** A separate agent writes the `@adw-932` scenarios. The unit tests above are the implementing agent's own.

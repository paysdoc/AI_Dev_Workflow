# Feature: adw_init invokes depaudit setup and propagates SOCKET_API_TOKEN + SLACK_WEBHOOK_URL

## Metadata
issueNumber: `439`
adwId: `hm6br4-adw-init-call-depaud`
issueJson: `{"number":439,"title":"adw_init: call depaudit setup + propagate SOCKET_API_TOKEN and SLACK_WEBHOOK_URL","body":"## Parent PRD\n\n`specs/prd/depaudit.md` (in paysdoc/depaudit)\n\n## What to build\n\nHooks `depaudit` into ADW's target-repo bootstrap. Adds a step to `adws/adwInit.tsx` (or the appropriate `adw_init` code path) that, after the target repo is cloned and `.adw/` is set up, invokes `depaudit setup` in the target repo's working directory. Assumes `depaudit` is installed globally on the machine running ADW (doc: `npm install -g depaudit`).\n\nAlso: propagate `SOCKET_API_TOKEN` and `SLACK_WEBHOOK_URL` from ADW's process environment to each target repo's GitHub Actions secrets via `gh secret set --repo <target>` during the same `adw_init` run.\n\nDocs updates: `README.md`, `adws/README.md`, `.env.sample` (depaudit-related env vars already added).\n\n## Acceptance criteria\n\n- [ ] `adw_init` invokes `depaudit setup` in the freshly-cloned target repo's working tree.\n- [ ] `SOCKET_API_TOKEN` and `SLACK_WEBHOOK_URL` propagated to target repo secrets via `gh secret set`.\n- [ ] Missing env values: warn (do not fail) and note in init summary.\n- [ ] Integration test with a fixture target repo — see `adws/__tests__/` for prior art.\n- [ ] Docs updated (README, adws/README, `.env.sample`).\n\n## Blocked by\n\n- Blocked by paysdoc/depaudit#12\n- Blocked by #438\n\n## User stories addressed\n\n- User story 11\n- User story 28 (cross-repo secret propagation)\n","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-04-17T13:27:52Z","comments":[],"actionableComment":null}`

## Feature Description

Extend ADW's target-repo bootstrap (`adwInit.tsx`) so that, after the target
repo has been cloned/worktreed and its `.adw/` configuration has been
generated, ADW automatically runs `depaudit setup` inside the target repo's
worktree and propagates the maintainer-wide secrets `SOCKET_API_TOKEN` and
`SLACK_WEBHOOK_URL` from ADW's process environment into the target repo's
GitHub Actions secret store via `gh secret set --repo <owner>/<repo>`.

`depaudit` is assumed to be installed globally on the host running ADW
(`npm install -g depaudit`). When either env value is unset, ADW must log a
warning, record the skip in a visible init summary, and continue the workflow
(missing env values MUST NOT abort `adw_init`). This lets a freshly onboarded
target repo land with a working `depaudit` gate and the cross-repo secrets
its CI workflow needs, without any additional manual steps.

## User Story

As a maintainer of a repository that I manage through ADW (user story 11)
I want `adw_init` to automatically run `depaudit setup` and populate the
target repo's `SOCKET_API_TOKEN` and `SLACK_WEBHOOK_URL` secrets from ADW's
`.env`, so that a newly registered target repo is immediately gated by
`depaudit` and its notifications flow through my single ADW-managed Slack
channel (user story 28) — without me cloning the repo and running setup by
hand.

## Problem Statement

Today, `adwInit.tsx` clones the target repo, generates `.adw/` via the
`/adw_init` slash command, copies target-marked skills/commands, commits, and
creates a PR. Nothing in that flow installs `depaudit` into the target repo
or pushes the supply-chain secrets that the scaffolded
`.github/workflows/depaudit-gate.yml` needs in order to call Socket.dev or
fire Slack notifications.

As a result, newly onboarded target repos ship without a depaudit gate, or
ship with a gate that fails because the secrets aren't set. Maintainers have
to clone each target repo, `depaudit setup` manually, and run
`gh secret set …` for every propagated value — exactly the manual per-repo
toil that ADW exists to eliminate.

## Solution Statement

Insert two post-slash-command steps into `adwInit.tsx`'s main flow, between
`copyTargetSkillsAndCommands(config.worktreePath)` and
`commitChanges(...)`:

1. **Invoke `depaudit setup`** in `config.worktreePath` via a synchronous
   child-process call. `depaudit` is assumed to be resolvable on `PATH`.
   Output is captured into the orchestrator log. If the binary is missing or
   `depaudit setup` exits non-zero, the step warns and records the failure
   in the init summary but does NOT abort the workflow (the existing PR will
   still land; maintainers can re-run `depaudit setup` manually).

2. **Propagate secrets** by, for each of `SOCKET_API_TOKEN` and
   `SLACK_WEBHOOK_URL`:
   - Read the value from `process.env`.
   - If present, run `gh secret set <NAME> --body "<value>" --repo <owner>/<repo>`
     against the target repo identifier (derived from
     `config.targetRepo ?? config.repoContext.repoId`). When `config.targetRepo`
     is undefined (ADW running against its own repo), use the repo info from
     the git remote.
   - If absent, emit a warning via `log(..., 'warn')` and record the skip in
     the init summary; do NOT throw.

Both concerns live in a new focused module (`adws/phases/depauditInitPhase.ts`)
and are exposed as dependency-injectable functions so the integration tests in
`adws/__tests__/` can stub `execSync`/`execWithRetry` without needing a real
`depaudit` or `gh` install.

Warnings and skips are funneled into a new `depauditInitSummary` field on
`WorkflowContext`, and `formatCompletedComment` / the equivalent init-summary
formatter is extended to render that section when present. The existing
`completeWorkflow` / `handleWorkflowError` contract is unchanged; this is
purely additive context.

Documentation is updated to reflect the new behavior (README, adws/README).
`.env.sample` already lists `SOCKET_API_TOKEN` and `SLACK_WEBHOOK_URL` — no
change needed there, but the Notes section confirms it.

## Relevant Files

Use these files to implement the feature:

- `adws/adwInit.tsx` — Main orchestrator. The insertion point sits between
  `copyTargetSkillsAndCommands(config.worktreePath)` (line 85) and
  `commitChanges('chore: initialize .adw/ config …', config.worktreePath)`
  (line 90). Both new phase calls go here, inside the existing `try` block so
  their errors flow into `handleWorkflowError` only if they throw — which, by
  design, they do not for missing env / missing binary (they warn instead).
- `adws/core/utils.ts` — Provides `execWithRetry()` (lines 53-78), the
  standard synchronous wrapper around `execSync` that adds exponential
  backoff and a non-retryable-error allowlist. Use it for `gh secret set`.
  `depaudit setup` does not need retry semantics (it is idempotent and the
  cost of a single failure is a warning); use `execSync` directly with a
  try/catch for it.
- `adws/core/environment.ts` — Hosts provider secret accessors (GITHUB_PAT,
  JIRA_API_TOKEN, etc., lines 67-106). Add two new exports here:
  `SOCKET_API_TOKEN` and `SLACK_WEBHOOK_URL`. Follow the existing
  `process.env.X || ''` pattern so the rest of the codebase can reference
  these through the environment module rather than scattering `process.env`
  lookups. Also: the BDD scenarios require the secret propagation code to
  literally reference `process.env.SOCKET_API_TOKEN` and
  `process.env.SLACK_WEBHOOK_URL`, so the propagation module must use those
  direct expressions (re-export `process.env.X` via a named getter, or read
  `process.env.X` inline in the propagation module).
- `adws/core/index.ts` — Barrel export for core. Re-export the two new env
  constants so they can be imported alongside `log`, `execWithRetry`, etc.
- `adws/phases/workflowInit.ts` — Defines `WorkflowConfig` (lines 60-87).
  No structural change needed; the new phase reads `config.worktreePath`,
  `config.targetRepo`, and `config.repoContext` straight from this config.
- `adws/phases/workflowCompletion.ts` — `completeWorkflow` (lines 24-63)
  posts the `completed` comment via `postIssueStageComment`. The formatter
  reads from `ctx`, so no change to this file is needed beyond the context
  it already passes.
- `adws/github/workflowCommentsIssue.ts` — Defines `WorkflowContext`
  (lines 13-73) and all comment formatters. Add a
  `depauditInitSummary?: DepauditInitSummary` field to `WorkflowContext`,
  and extend `formatCompletedComment` (or add an adw-init-specific branch)
  to render the init summary section when present. Keep rendering
  idempotent: if `depauditInitSummary` is absent (non-init workflows),
  render nothing.
- `adws/phases/index.ts` — Barrel export. Re-export the new module's
  public functions so `adwInit.tsx` can import from `./phases` consistently
  with the existing phase imports.
- `adws/workflowPhases.ts` — Composed-phase barrel used by orchestrators.
  Re-export `runDepauditSetup` and `propagateDepauditSecrets` here so
  `adwInit.tsx` can import alongside the other workflow-phase helpers.
- `adws/__tests__/adwMerge.test.ts` — Prior-art for dependency-injected
  integration tests in `adws/__tests__/`. Pattern: build a `makeDeps()`
  helper that returns vi-mocked versions of every subprocess-touching
  dependency, then assert on call arguments. The new test file follows
  this pattern exactly.
- `.adw/project.md` — `## Unit Tests: enabled` (line 34). Unit tests ARE
  in scope for this feature.
- `.adw/commands.md` — Run tests via `bun run test:unit` (line 16). Type
  check via `bunx tsc --noEmit -p adws/tsconfig.json` (line 31).
- `README.md` — User-facing docs for ADW. Add a short subsection under the
  ADW Init documentation explaining that `adw_init` runs `depaudit setup`
  and propagates `SOCKET_API_TOKEN` + `SLACK_WEBHOOK_URL` to target-repo
  secrets, and that `depaudit` must be installed globally
  (`npm install -g depaudit`).
- `adws/README.md` — Developer-facing docs for the ADW scripts. Document
  the same behavior under the `adwInit.tsx` section.
- `.env.sample` — Already lists both env vars (lines 60-65). Verify the
  existing comments are clear; no new entries required (scenarios assert
  they are present, which they already are).
- `features/adw_init_depaudit_setup_and_secrets.feature` — Pre-existing
  BDD scenarios for this issue. Every scenario here must pass after
  implementation. Several scenarios assert literal strings in
  `adws/adwInit.tsx` (e.g. `"depaudit setup"`, `"gh secret set"`,
  `"SOCKET_API_TOKEN"`, `"SLACK_WEBHOOK_URL"`, `"process.env.SOCKET_API_TOKEN"`,
  `"process.env.SLACK_WEBHOOK_URL"`) — implementation must import the
  helpers into `adwInit.tsx` in a way that keeps those literals visible in
  the orchestrator file, OR the helpers must be inlined there. Keeping the
  literals in the orchestrator file is the safest route: import thin
  helpers from `depauditInitPhase.ts` but pass the env-var *names* as
  arguments from `adwInit.tsx`, so the strings appear in the orchestrator.
- `specs/prd/depaudit.md` — Parent PRD. Sections "Bootstrap" (line 153)
  and "ADW Integration" (line 181) describe exactly what this feature
  implements. Use as source of truth.

### New Files

- `adws/phases/depauditInitPhase.ts` — New phase module exporting:
  - `runDepauditSetup(worktreePath: string, deps?: DepauditSetupDeps): DepauditSetupResult`
    — synchronously runs `depaudit setup` in the given worktree. Returns
    `{ ok: true }` on zero exit, `{ ok: false, error: string }` otherwise.
    Does NOT throw.
  - `propagateDepauditSecrets(targetRepoSlug: string, deps?: PropagateSecretsDeps): PropagateSecretsResult`
    — for each of `SOCKET_API_TOKEN` and `SLACK_WEBHOOK_URL`, reads
    `process.env.X` and calls `gh secret set X --body "<value>" --repo <targetRepoSlug>`
    when set. Returns `{ propagated: string[]; skipped: string[] }`. Does NOT
    throw on missing env vars. Does NOT throw on `gh` failure — it warns
    and records the failure in `skipped` with a reason prefix.
  - `DepauditInitSummary` type — the shape passed through `ctx` to the
    completion comment formatter (`{ depauditSetup: {...}; secrets: {...} }`).
  - `formatDepauditInitSummary(summary: DepauditInitSummary): string` —
    pure function that renders the summary as markdown for inclusion in the
    completion comment. Keep output under ~15 lines; use the "skipped /
    not set" phrasing the BDD scenarios assert on.
  - `DepauditSetupDeps` / `PropagateSecretsDeps` — small dep-injection
    interfaces (`runCommand`, `getEnv`) so the integration tests can mock
    the subprocess and env boundary cleanly.
- `adws/phases/__tests__/depauditInitPhase.test.ts` — Unit tests for the
  two helpers. Keeps deep-module tests close to the module (consistent with
  the `adws/core/__tests__/` and `adws/phases/__tests__/` convention).
- `adws/__tests__/adwInitDepaudit.test.ts` — Integration test that wires
  `runDepauditSetup` and `propagateDepauditSecrets` into a shallow test
  harness mimicking the `adwInit.tsx` flow. Modeled on the
  `adwMerge.test.ts` `makeDeps()` pattern. This is the integration test
  the acceptance criteria explicitly require.

## Implementation Plan

### Phase 1: Foundation

Extend the environment and types layer so downstream code can consume the
two new env vars and the init-summary shape without scattering
`process.env` lookups or context fields.

- Add `SOCKET_API_TOKEN` and `SLACK_WEBHOOK_URL` exports to
  `adws/core/environment.ts`.
- Re-export them from `adws/core/index.ts`.
- Add a `DepauditInitSummary` type and a `depauditInitSummary?:
  DepauditInitSummary` field to `WorkflowContext` in
  `adws/github/workflowCommentsIssue.ts`.

### Phase 2: Core Implementation

Build the two dependency-injectable helpers and their unit tests, entirely
independent of `adwInit.tsx`.

- Create `adws/phases/depauditInitPhase.ts` exporting `runDepauditSetup`,
  `propagateDepauditSecrets`, `formatDepauditInitSummary`, and associated
  types.
- Create `adws/phases/__tests__/depauditInitPhase.test.ts` covering:
  - `runDepauditSetup` success and failure paths (mocked runCommand).
  - `propagateDepauditSecrets` happy path (both env vars set).
  - `propagateDepauditSecrets` both env vars unset (returns both in
    `skipped`, calls no subprocess).
  - `propagateDepauditSecrets` one env var set, one unset.
  - `propagateDepauditSecrets` where `gh` exits non-zero (captured in
    `skipped` with reason, does not throw).
  - `formatDepauditInitSummary` renders "skipped" / "not set" language for
    missing env and "propagated" for set env.
- Wire the module into `adws/phases/index.ts` and
  `adws/workflowPhases.ts`.

### Phase 3: Integration

Wire the helpers into `adwInit.tsx`, add the integration test, render the
summary on the completion comment, and update docs.

- Modify `adws/adwInit.tsx`:
  - After `copyTargetSkillsAndCommands(config.worktreePath)` (existing
    line 85) and before `commitChanges(...)` (existing line 90), insert
    the two phase calls.
  - Resolve the target repo slug from `config.targetRepo` or
    `config.repoContext.repoId`.
  - Store the resulting `DepauditInitSummary` on `config.ctx` so the
    completion formatter picks it up.
  - Pass the literal env-var *names* `'SOCKET_API_TOKEN'` and
    `'SLACK_WEBHOOK_URL'` explicitly at the call site so the BDD
    "contains the string" scenarios pass when reading `adwInit.tsx`.
  - Ensure the reads themselves occur as `process.env.SOCKET_API_TOKEN`
    / `process.env.SLACK_WEBHOOK_URL` in a location the scenarios will
    observe — simplest: do the reads inline in `adwInit.tsx` and pass
    the resolved values (and names) into
    `propagateDepauditSecrets(...)`.
- Create `adws/__tests__/adwInitDepaudit.test.ts` asserting:
  - The integration harness calls the `depaudit setup` runner with the
    worktree path.
  - `gh secret set` is called for `SOCKET_API_TOKEN` when the env var
    is set (and once for `SLACK_WEBHOOK_URL` when that is set).
  - When either env var is unset, a warning is logged, no
    `gh secret set` is called for that var, and the init summary notes
    the skip. The workflow completes (integration does not throw / exit).
  - The `gh secret set` invocation includes the `--repo <owner>/<repo>`
    flag with the correct target identifier.
- Extend `formatCompletedComment` (or add an adw-init-specific branch)
  in `adws/github/workflowCommentsIssue.ts` to append the rendered
  `depauditInitSummary` markdown when present in `ctx`.
- Update `README.md` to mention the two new `adw_init` behaviors and the
  `npm install -g depaudit` prerequisite.
- Update `adws/README.md` to document the same in the `adwInit.tsx`
  section.
- Verify `.env.sample` already contains both vars (it does; scenarios
  assert this).
- Run `Validation Commands` to confirm no type errors, no lint errors,
  all unit tests pass, and the `@adw-439` BDD scenarios pass.

## Step by Step Tasks
Execute every step in order, top to bottom.

### Task 1 — Add new env accessors to `adws/core/environment.ts`
- Under the "Provider secret accessors" section (after `COST_API_TOKEN`),
  add:
  - `export const SOCKET_API_TOKEN = process.env.SOCKET_API_TOKEN || '';`
  - `export const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL || '';`
- Add a brief JSDoc comment above each explaining their purpose
  (Socket.dev API token for `depaudit`, Slack webhook URL propagated to
  target-repo secrets).

### Task 2 — Re-export from `adws/core/index.ts`
- Add `SOCKET_API_TOKEN` and `SLACK_WEBHOOK_URL` to the `environment.ts`
  re-export block.

### Task 3 — Extend `WorkflowContext` with `depauditInitSummary`
- In `adws/github/workflowCommentsIssue.ts`, define `DepauditInitSummary`:
  ```ts
  export interface DepauditInitSummary {
    depauditSetup:
      | { ok: true }
      | { ok: false; error: string };
    secrets: {
      propagated: string[];  // env var names successfully pushed via gh secret set
      skipped: { name: string; reason: 'not set' | string }[];
    };
  }
  ```
- Add `depauditInitSummary?: DepauditInitSummary;` to `WorkflowContext`.

### Task 4 — Create `adws/phases/depauditInitPhase.ts`
- Export `runDepauditSetup(worktreePath: string, deps?: DepauditSetupDeps): DepauditSetupResult`.
  - Default `deps.runCommand` implementation uses `execSync('depaudit setup',
    { cwd: worktreePath, encoding: 'utf-8', stdio: ['ignore', 'pipe',
    'pipe'] })` wrapped in try/catch. Log stdout/stderr on both paths.
  - Return `{ ok: true }` on success; `{ ok: false, error: String(err) }`
    on failure. Never throw.
- Export `propagateDepauditSecrets(targetRepoSlug: string, vars: Array<{
  name: string; value: string | undefined }>, deps?: PropagateSecretsDeps):
  PropagateSecretsResult`.
  - Default `deps.runCommand` uses `execWithRetry` with `maxAttempts: 2`.
  - For each var: if `value` is truthy, run
    `gh secret set ${name} --body "${value}" --repo ${targetRepoSlug}`.
    On success, push `name` to `propagated`. On failure, push
    `{ name, reason: String(err) }` to `skipped` and log a warning. Never
    throw.
  - If `value` is falsy, push `{ name, reason: 'not set' }` to `skipped`
    and log a warning. Do not call runCommand.
- Export `formatDepauditInitSummary(summary: DepauditInitSummary): string`.
  - Return a markdown block with a heading `### :shield: depaudit Init
    Summary` and bullet lines per propagated/skipped secret plus a line for
    the `depaudit setup` outcome. Use the word "skipped" or "not set" for
    missing-env skips so the BDD scenarios find the language.
- Export `DepauditSetupDeps`, `DepauditSetupResult`,
  `PropagateSecretsDeps`, `PropagateSecretsResult` TS interfaces.
- Re-export from `adws/phases/index.ts` and `adws/workflowPhases.ts`.

### Task 5 — Add unit tests `adws/phases/__tests__/depauditInitPhase.test.ts`
- Vitest suite covering:
  - `runDepauditSetup` returns `{ ok: true }` when `runCommand` resolves.
  - `runDepauditSetup` returns `{ ok: false, error }` when `runCommand`
    throws; does not re-throw.
  - `runDepauditSetup` passes `cwd: worktreePath` to `runCommand`.
  - `propagateDepauditSecrets` with both values set: calls `runCommand`
    twice with the expected `gh secret set …` commands and returns both
    names in `propagated`.
  - `propagateDepauditSecrets` with both values unset: `propagated` empty,
    both names in `skipped` with `reason: 'not set'`, `runCommand` never
    called.
  - `propagateDepauditSecrets` mixed case: one propagated, one skipped.
  - `propagateDepauditSecrets` when `runCommand` throws: the name goes to
    `skipped` with the thrown error as reason; function does not re-throw.
  - `propagateDepauditSecrets` uses `--repo <slug>` in the gh command
    (string-assert the emitted command).
  - `formatDepauditInitSummary` output contains "not set" for missing env
    vars, "propagated" for set ones, "failed" for a failed `depaudit setup`.

### Task 6 — Wire phases into `adws/adwInit.tsx`
- Add imports for `runDepauditSetup`, `propagateDepauditSecrets`,
  `formatDepauditInitSummary`, `DepauditInitSummary` from `./workflowPhases`
  (or `./phases`).
- Inside the existing `try` block, between
  `copyTargetSkillsAndCommands(config.worktreePath)` and
  `commitChanges(...)`:
  1. `log('Phase: depaudit setup', 'info');`
  2. Call `runDepauditSetup(config.worktreePath)`; store result.
  3. Resolve `targetRepoSlug`:
     - If `config.targetRepo`: `${config.targetRepo.owner}/${config.targetRepo.repo}`.
     - Else, derive from `config.repoContext.repoId` or `getRepoInfo()`.
  4. Construct the secrets input INLINE so the scenario-required literals
     appear in `adwInit.tsx`:
     ```ts
     const secretVars = [
       { name: 'SOCKET_API_TOKEN', value: process.env.SOCKET_API_TOKEN },
       { name: 'SLACK_WEBHOOK_URL', value: process.env.SLACK_WEBHOOK_URL },
     ];
     ```
  5. `log('Phase: depaudit secret propagation (gh secret set)', 'info');`
     (this log line keeps the `"gh secret set"` literal present in the
     orchestrator file as the BDD scenarios require).
  6. Call `propagateDepauditSecrets(targetRepoSlug, secretVars)`.
  7. Build `const depauditInitSummary: DepauditInitSummary = { depauditSetup:
     setupResult, secrets: propagateResult };`
  8. `config.ctx.depauditInitSummary = depauditInitSummary;`
  9. `log(formatDepauditInitSummary(depauditInitSummary), 'info');`
- Confirm the orchestrator file now contains the literal strings:
  `depaudit setup`, `gh secret set`, `SOCKET_API_TOKEN`, `SLACK_WEBHOOK_URL`,
  `process.env.SOCKET_API_TOKEN`, `process.env.SLACK_WEBHOOK_URL`,
  `copyTargetSkillsAndCommands`, `commitChanges`, and `--repo` (for the BDD
  scenario "uses --repo flag").

### Task 7 — Extend `formatCompletedComment` to render the init summary
- In `adws/github/workflowCommentsIssue.ts`, locate `formatCompletedComment`
  (the function that renders the "completed" stage). Append
  `ctx.depauditInitSummary ? '\n\n' + formatDepauditInitSummary(ctx.depauditInitSummary) : ''`
  immediately before the closing signature, so adw-init completions carry
  the summary.
- Keep rendering guarded on presence (non-init workflows won't set this field
  and must therefore render unchanged).

### Task 8 — Add integration test `adws/__tests__/adwInitDepaudit.test.ts`
- Build a `makeDeps()` helper modeled after `adwMerge.test.ts` that
  supplies vi-mocked `runDepauditSetup` and `propagateDepauditSecrets`
  (plus a mocked `runCommand` seam into both functions).
- Test cases:
  - "invokes `depaudit setup` in the freshly-cloned target repo's worktree"
    — asserts `runDepauditSetup` is called with `config.worktreePath`.
  - "propagates SOCKET_API_TOKEN when env var is present" — set
    `process.env.SOCKET_API_TOKEN = 'test-socket-token'`; assert
    `runCommand` invocation includes `gh secret set SOCKET_API_TOKEN
    --body "test-socket-token" --repo owner/repo`.
  - "propagates SLACK_WEBHOOK_URL when env var is present" — analogous.
  - "warns and skips when SOCKET_API_TOKEN is unset" — unset the env var;
    assert no gh invocation for SOCKET_API_TOKEN; assert the summary lists
    SOCKET_API_TOKEN under `skipped` with `reason: 'not set'`; assert the
    flow completes without throwing.
  - "warns and skips when SLACK_WEBHOOK_URL is unset" — analogous.
  - "uses a fixture target repo" — the test explicitly uses a fixture
    `targetRepo: { owner: 'fixture-owner', repo: 'fixture-repo' }` and
    asserts `--repo fixture-owner/fixture-repo` appears in the emitted
    gh command. This satisfies the BDD "uses a fixture target repo"
    scenario.
- Use `beforeEach`/`afterEach` to snapshot and restore
  `process.env.SOCKET_API_TOKEN` and `process.env.SLACK_WEBHOOK_URL` so
  tests don't leak env state into each other.

### Task 9 — Update `README.md`
- In the `adw_init` / onboarding section, add a short paragraph:
  - Explains that `adw_init` runs `depaudit setup` in the target repo's
    freshly-cloned working tree after `.adw/` is generated.
  - Notes `npm install -g depaudit` must be installed on the host.
  - Notes `adw_init` propagates `SOCKET_API_TOKEN` and `SLACK_WEBHOOK_URL`
    from ADW's environment to each target repo's GitHub Actions secrets
    via `gh secret set --repo <target>`.
  - Notes that missing env vars only emit warnings and are listed in the
    init summary; they do NOT fail the workflow.

### Task 10 — Update `adws/README.md`
- In the `adwInit.tsx` section, document the new post-init phases:
  `depaudit setup` invocation and secret propagation. Mention the
  `depauditInitSummary` context field.

### Task 11 — Verify `.env.sample` already lists the env vars
- Confirm `SOCKET_API_TOKEN` (line 64-65) and `SLACK_WEBHOOK_URL`
  (line 61) are present. No edit needed.

### Task 12 — Run `Validation Commands` to validate zero regressions
- See `## Validation Commands` below.

## Testing Strategy

### Unit Tests
`.adw/project.md` specifies `## Unit Tests: enabled` (line 34), so unit tests
ARE in scope. Unit tests for this feature live in
`adws/phases/__tests__/depauditInitPhase.test.ts` and cover the two exported
helpers (`runDepauditSetup`, `propagateDepauditSecrets`) and the pure
formatter (`formatDepauditInitSummary`) through fully-mocked dependency
injection:

- `runDepauditSetup` — success and failure paths, working-directory
  assertion.
- `propagateDepauditSecrets` — both-set / both-unset / one-of-each / gh
  failure / `--repo` flag presence.
- `formatDepauditInitSummary` — output contains the "skipped" / "not set" /
  "propagated" / "failed" language the BDD scenarios rely on.

Integration tests for the composed flow in `adwInit.tsx` live in
`adws/__tests__/adwInitDepaudit.test.ts`, following the
`adws/__tests__/adwMerge.test.ts` `makeDeps()` pattern. These satisfy the
acceptance criterion "Integration test with a fixture target repo — see
`adws/__tests__/` for prior art" by using a fixture `{ owner, repo }` and
asserting on the emitted `gh secret set … --repo <fixture>/…` command.

### Edge Cases

- `depaudit` binary not installed globally on the host — the subprocess
  exits ENOENT. `runDepauditSetup` catches, logs a warning, returns
  `{ ok: false, error }`. Workflow continues.
- `depaudit setup` exits non-zero (e.g., detected-ecosystem lookup fails) —
  same warn-and-continue path as missing binary.
- Both env vars missing simultaneously — summary lists both under
  `skipped: 'not set'`; no `gh` calls made; workflow completes and posts
  normally.
- Only `SLACK_WEBHOOK_URL` set (common case — maintainer hasn't generated a
  Socket API token yet) — SOCKET_API_TOKEN listed as skipped; Slack
  webhook propagated; workflow completes.
- `gh secret set` fails (e.g., auth issue, repo misidentified) — captured
  in `skipped` with the thrown error as reason; workflow still completes;
  PR creation proceeds.
- `config.targetRepo` is undefined (ADW acting on its own repo) — fall
  back to `config.repoContext.repoId` or `getRepoInfo()` for the slug. No
  test coverage required but code path must be defined.
- Env vars contain characters that need shell-quoting (e.g., `$`, backticks,
  quotes) — use `gh secret set … --body "<value>"` with double quotes and
  rely on the shell for variable-free literal interpolation. For Slack
  webhook URLs and Socket API tokens the values are URL-safe /
  alphanumeric, but document that the values are passed as-is.

## Acceptance Criteria

- [ ] `adws/adwInit.tsx` invokes `depaudit setup` in `config.worktreePath`
      between `copyTargetSkillsAndCommands` and `commitChanges`.
- [ ] `adws/adwInit.tsx` reads `process.env.SOCKET_API_TOKEN` and
      `process.env.SLACK_WEBHOOK_URL` and, when each is set, runs
      `gh secret set <NAME> --body "<value>" --repo <owner>/<repo>`
      against the target repo slug.
- [ ] When either env var is unset, a warning is logged and the var is
      recorded in the init summary with language containing "skipped" or
      "not set"; the workflow does NOT throw / exit.
- [ ] The init summary (appended to the `completed` comment) lists the
      outcome of `depaudit setup` and the per-secret propagate/skip result.
- [ ] `adws/__tests__/adwInitDepaudit.test.ts` asserts all four behaviors
      (depaudit setup invoked; each secret propagated when set; each
      secret skipped-with-warning when unset) using a fixture target repo
      slug.
- [ ] `adws/phases/__tests__/depauditInitPhase.test.ts` covers the
      module-level helpers' happy and failure paths.
- [ ] `README.md`, `adws/README.md` mention the new behavior and the
      `npm install -g depaudit` prerequisite.
- [ ] `.env.sample` already lists `SOCKET_API_TOKEN` and `SLACK_WEBHOOK_URL`
      (no change required; verified).
- [ ] All `@adw-439` BDD scenarios in
      `features/adw_init_depaudit_setup_and_secrets.feature` pass.
- [ ] `bunx tsc --noEmit` and `bunx tsc --noEmit -p adws/tsconfig.json`
      both exit zero.
- [ ] `bun run lint`, `bun run build`, `bun run test:unit` all exit zero.

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `bun install` — Ensure dependencies are present.
- `bun run lint` — Run ESLint to check for code quality issues.
- `bunx tsc --noEmit` — Type-check the root project.
- `bunx tsc --noEmit -p adws/tsconfig.json` — Type-check the ADW subproject
  (BDD scenario "TypeScript type-check passes … on adws/tsconfig.json"
  asserts exactly this).
- `bun run build` — Build the project to verify no build errors.
- `bun run test:unit` — Run Vitest unit + integration tests (includes the
  two new test files).
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-439"` —
  Execute every scenario in
  `features/adw_init_depaudit_setup_and_secrets.feature` tagged
  `@adw-439` and confirm they all pass.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` —
  Run the full regression suite to confirm zero regressions elsewhere.

## Notes

- `guidelines/coding_guidelines.md` applies. Key points enforced by this
  plan: strict TypeScript (no `any`), single-responsibility per file,
  isolate side effects at boundaries (the deps-injection pattern in the
  new phase module), meaningful names (`runDepauditSetup`,
  `propagateDepauditSecrets`), keep files under 300 lines. The coding
  guidelines also note "ADW itself does not use unit tests", but
  `.adw/project.md` explicitly sets `## Unit Tests: enabled`. The explicit
  per-project config wins, and this project AND the acceptance criteria
  both require tests (BDD scenarios explicitly assert on integration-test
  files in `adws/__tests__/`). So unit/integration tests are implemented
  as planned.

- **Literal-string presence in `adwInit.tsx` is load-bearing.** Multiple
  BDD scenarios assert literal string presence in
  `adws/adwInit.tsx` (e.g. `"depaudit setup"`, `"gh secret set"`,
  `"SOCKET_API_TOKEN"`, `"SLACK_WEBHOOK_URL"`,
  `"process.env.SOCKET_API_TOKEN"`, `"process.env.SLACK_WEBHOOK_URL"`,
  `"copyTargetSkillsAndCommands"`, `"commitChanges"`, `"--repo"`).
  Implementation MUST keep those literals visible in that file. The
  approach in this plan (read `process.env.X` inline in `adwInit.tsx`,
  log `"Phase: depaudit secret propagation (gh secret set)"`, include
  `--repo` in the same log or in a shared constant referenced inline)
  achieves that without relocating the work into the phase module.

- **`execWithRetry` already exists** (`adws/core/utils.ts`) and handles
  the synchronous-with-backoff pattern needed for `gh secret set`. Don't
  introduce a new retry helper.

- **No new library install required.** `depaudit` is expected to be
  installed globally on the host (`npm install -g depaudit`), not as a
  project dependency. `gh` is already a prerequisite (see root `README.md`
  "Install Prerequisites"). No `bun add` needed.

- **Why not piggyback on `/adw_init` slash command?** The depaudit
  invocation and `gh secret set` calls are pure subprocess operations
  that don't need Claude Code reasoning. Keeping them in the TypeScript
  orchestrator is faster, cheaper, and easier to test. The slash command
  (`.claude/commands/adw_init.md`) stays unchanged.

- **Why warn instead of fail on missing env?** User story 11 is about a
  *smoother* onboarding. A maintainer may register a target repo before
  they've generated their Socket API token — failing `adw_init` in that
  case would make depaudit onboarding a prerequisite for ADW onboarding,
  inverting the intended relationship. The init summary's visible "not
  set" listing ensures the missed secret doesn't silently stay missed.

- **Cross-repo secret reuse (user story 28).** The single `SLACK_WEBHOOK_URL`
  from ADW's `.env` is pushed to every target repo, guaranteeing all
  depaudit Slack notifications flow through one channel — no per-repo
  webhook provisioning required.

- **Future consideration.** If `depaudit` ever grows a non-interactive
  `--skip-commit` flag for `depaudit setup`, adopt it here so `depaudit
  setup` never tries to commit from within the ADW-managed worktree
  (which is about to have `commitChanges(...)` run on it anyway). For
  MVP, `depaudit setup`'s own commit-or-PR policy (see PRD "Bootstrap"
  step 10) handles the feature-branch case gracefully.

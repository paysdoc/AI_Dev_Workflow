# Feature: GitContext — migrate label / board / secret `gh` ops

## Metadata
issueNumber: `695`
adwId: `0p8lxe-gitcontext-migrate-l`
issueJson: `{"number":695,"title":"GitContext: migrate label / board / secret gh ops","body":"## Parent PRD\n`specs/prd/git-context-repo-authority.md`\n\n## What to build\nMigrate label/board/secret gh ops onto GitContext (`applyLabel`/`createLabel`/`runGraphQL` exist; add `setSecret`), removing their ALLOWLIST entries.\n\n## Acceptance criteria\n- [ ] `setSecret` (or equivalent) on GitContext\n- [ ] labelManager, githubBoardManager, depauditSetup route through GitContext\n- [ ] Those files removed from `ALLOWLIST`\n- [ ] `lint:git-guard` passes; tests green\n\n## Blocked by\n- Blocked by #694\n\n## Touched Files\n- adws/gitContext/gitContext.ts\n- adws/github/labelManager.ts\n- adws/providers/github/githubBoardManager.ts\n- adws/phases/depauditSetup.ts\n- adws/checkGitGhGuard.ts\n\n## User stories addressed\n- User story 5\n- User story 18","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-06-23T11:45:28Z","comments":[],"actionableComment":null}`

## Feature Description

This is the next slice of the **GitContext epic** (PRD `specs/prd/git-context-repo-authority.md`), following the merged slices #691 (gh reads), #692 (identity reads), #693 (VCS probe/branch reads), and #694 (phase-level git reads). Each slice migrates one cohort of direct `git`/`gh` shell-outs onto the single `GitContext` deep-module authority and removes the now-clean files from the `checkGitGhGuard.ts` `ALLOWLIST`, shrinking the surface where the historical "wrong-repo" / `GH_TOKEN`-bleed class of bug can reappear.

This slice migrates the **three remaining residual `gh`-writing consumers** off raw shell-outs and onto `GitContext` methods:

1. **`labelManager.ts`** — the `adw:*` label lifecycle module. Its `gh label create …` and `gh issue edit … --add-label …` shell-outs move onto `GitContext.createLabel(...)` and `GitContext.applyLabel(...)` (both already exist on the context). The module's lazy-create-on-"not found" policy is preserved; only the I/O primitive changes.
2. **`githubBoardManager.ts`** — the GitHub Projects V2 board provider. It already routes every GraphQL call through `this.ctx.runGraphQL(...)` **except** one direct `execSync('gh api graphql --input -', …)` in `updateStatusFieldOptions` (needed because the column-update mutation passes a complex array variable via stdin JSON, which `runGraphQL`'s `-f`/`-F` flag form cannot express). A new `GitContext.runGraphQLInput(body)` method covers that stdin-JSON case, eliminating the last raw shell-out in the file.
3. **`depauditSetup.ts`** — propagates `SOCKET_API_TOKEN` / `SLACK_WEBHOOK_URL` to a target repo's GitHub Actions secrets via `gh secret set … --body -`. A new `GitContext.setSecret(name, value)` method (the `setSecret` acceptance-criterion deliverable) routes that through the context's per-command auth.

After migration, all three files are removed from the `ALLOWLIST` and `bun run lint:git-guard` passes with them scanned. The value: per-command auth isolation (no process-global `GH_TOKEN` mutation) for label, board, and secret writes, and a smaller allowlist — fewer places a future call site can re-introduce the wrong-repo bug.

## User Story

As an **ADW maintainer** (PRD user stories 5 and 18),
I want **every label, project-board, and secret-set `gh` operation to run through the mandatory `GitContext` rather than a direct shell-out**,
So that **the `gh` target repo and auth token are never ambiguous, per-command auth isolation holds for these writes, and a new call site cannot re-introduce the wrong-repo / token-bleed class of bug** (enforced mechanically by the `lint:git-guard` CI rule once these files leave the allowlist).

## Problem Statement

Three files still shell out to `gh` directly and sit on the `checkGitGhGuard.ts` `ALLOWLIST`:

- `adws/phases/depauditSetup.ts` — `gh secret set …` via injected `execWithRetry`.
- `adws/github/labelManager.ts` — `gh label create …` and `gh issue edit … --add-label …` via an injected `exec`.
- `adws/providers/github/githubBoardManager.ts` — one `execSync('gh api graphql --input -', …)` in `updateStatusFieldOptions` (the file already routes all other GraphQL through `GitContext`).

These shell-outs inherit `process.env.GH_TOKEN` (set by the legacy auth path) rather than using `GitContext`'s per-command env injection. They are precisely the kind of ad-hoc `gh` call the PRD's enforcement guard exists to forbid, but they remain allowlisted because the context did not yet expose a `setSecret` method or a stdin-JSON GraphQL method. The board-column update in particular runs its Projects V2 write with whatever ambient `GH_TOKEN` is set, not the PAT that the rest of the board path deliberately uses (`runGraphQL` → `usePat: true`) — a latent auth inconsistency on user-owned boards.

## Solution Statement

Add the two missing operation surfaces to `GitContext`, then route the three consumers through the context and drop them from the allowlist — the same thin-method + package-private command-builder pattern every prior slice used:

1. **`GitContext.setSecret(name, value)`** — runs `gh secret set <name> --repo <owner>/<repo> --body -` with `value` piped to the child's stdin (never on argv), using the context's primary token. Command string lives in a new pure builder `adws/gitContext/commands/secretCommands.ts` (`setSecretCmd`).
2. **`GitContext.runGraphQLInput(body)`** — runs `gh api graphql --input -` with `JSON.stringify(body)` piped to stdin and `usePat: true` (Projects V2 writes require the PAT; gracefully falls back to the context token when no PAT is configured, matching prior board-auth behaviour). Command string lives in a new pure builder `graphQLInputCmd()` added to `adws/gitContext/commands/boardCommands.ts`.
3. **`labelManager.ts`** — swap the `LabelManagerDeps` I/O seam from a raw `exec` to a `gitContextForRepo` factory; delegate creation/application to the existing `GitContext.createLabel(...)` / `GitContext.applyLabel(...)` methods (which use the same `createLabelCmd` / `applyLabelCmd` builders, so command shapes are byte-identical). Keep the pure policy helpers (`isLabelNotFoundError`, `resolveLabelDefinition`) and the lazy-create-and-retry behaviour.
4. **`githubBoardManager.ts`** — replace the lone `execSync('gh api graphql --input -', …)` with `this.ctx.runGraphQLInput(body)`; remove the now-unused `child_process` import.
5. **`depauditSetup.ts`** — resolve a context (`config.gitContext ?? gitContextForRepo(repoInfo)`) and call `ctx.setSecret(envName, envValue)` instead of the `gh secret set` shell-out; keep `execWithRetry` for the non-`gh` `depaudit setup` CLI invocation.
6. **`checkGitGhGuard.ts`** — delete the three `ALLOWLIST` entries.

Because the existing `createLabel`/`applyLabel` command builders are reused verbatim, the `@adw-540` regression BDD scenario (which asserts on the recorded `gh` command strings the label module issues) stays green after rewiring its mock seam to the new deps shape.

## Relevant Files

Use these files to implement the feature:

### Files to modify

- `adws/gitContext/gitContext.ts` — Add two thin methods: `setSecret(name, value)` (stdin-piped value, context token) and `runGraphQLInput(body)` (stdin-piped JSON, `usePat: true`). Both delegate to the private `#run()` chokepoint. Mirrors existing `createLabel`/`applyLabel`/`runGraphQL`/`approvePR` method patterns.
- `adws/gitContext/commands/boardCommands.ts` — Add a pure `graphQLInputCmd(): string` builder returning `'gh api graphql --input -'`. Keeps the `gh` literal inside the structurally-exempt package.
- `adws/github/labelManager.ts` — Change `LabelManagerDeps` from `{ exec, logger }` to `{ gitContextForRepo, logger }`; delegate `ensureAdwLabelsExist` / `applyLabel` to `GitContext.createLabel` / `GitContext.applyLabel`; remove the private `createLabel` / `addLabelToIssue` helpers and their `gh` string literals; drop the `execWithRetry` / `ExecSyncOptions` imports. Keep `isLabelNotFoundError`, `resolveLabelDefinition`, and all pure read-side functions unchanged.
- `adws/providers/github/githubBoardManager.ts` — Replace the `execSync('gh api graphql --input -', …)` in `updateStatusFieldOptions` with `this.ctx.runGraphQLInput(body)`; remove `import { execSync } from 'child_process'`.
- `adws/phases/depauditSetup.ts` — Add a `gitContextForRepo` factory to `DepauditSetupDeps`; resolve `ctx = config.gitContext ?? d.gitContextForRepo(repoInfo)`; call `ctx.setSecret(envName, envValue)` in `propagateSecret` instead of the `gh secret set` shell-out; keep `execWithRetry` for the `depaudit setup` CLI call.
- `adws/checkGitGhGuard.ts` — Remove the three residual `ALLOWLIST` entries: `adws/phases/depauditSetup.ts`, `adws/github/labelManager.ts`, `adws/providers/github/githubBoardManager.ts`.

### Test files to modify / add

- `adws/gitContext/__tests__/gitContextOperations.test.ts` — Extend the `SpyCall` shape + `makeSpyExec` helper to also capture the child `input` string, then add focused tests for `setSecret` (command shape, context-token env, stdin value, `process.env` non-mutation) and `runGraphQLInput` (command shape, PAT env via `usePat`, stdin JSON, PAT-absent fallback). (Unit tests enabled.)
- `adws/github/__tests__/labelManager.test.ts` — Rewire `makeDeps` to inject `gitContextForRepo: () => new GitContext(validOptions(), { exec: spy })`; keep the existing assertions on recorded `gh label create` / `gh issue edit` command strings (unchanged shapes). Pure `readAdwLabels` / `readAdwLabelNames` tests are untouched.
- `adws/__tests__/depauditSetup.test.ts` — Rewire to inject `gitContextForRepo` returning a spy-`ExecFn` `GitContext`; assert the recorded `gh secret set … --body -` command and its stdin input; keep the `execWithRetry` spy for the `depaudit setup` CLI assertion.
- `features/per-issue/step_definitions/feature-540.steps.ts` — Rewire `buildMockDeps()` to the new `LabelManagerDeps` shape: inject `gitContextForRepo: (repoInfo) => new GitContext(fullOptions(repoInfo), { exec })` where `exec` is the existing recording/simulating spy (push to `ctx.execCalls`, simulate create/apply, throw on the not-found sets). The recorded command strings are identical, so the `getRecordedRequests()` bridge and all `@adw-540` assertions hold.

### New Files

- `adws/gitContext/commands/secretCommands.ts` — Pure command builder `setSecretCmd(owner, repo, name): string` returning `` `gh secret set ${name} --repo ${owner}/${repo} --body -` ``. Mirrors `labelCommands.ts`. (Side-effect free; no `exec`, no `process.env`; well under 300 lines.)

### Reference files (read, do not modify)

- `specs/prd/git-context-repo-authority.md` — Parent PRD; user stories 5 and 18, the per-command-auth and enforcement-guard invariants.
- `adws/gitContext/commands/labelCommands.ts` — `createLabelCmd` / `applyLabelCmd` already power `GitContext.createLabel` / `GitContext.applyLabel`; the builder pattern to mirror for `secretCommands.ts`.
- `adws/gitContext/types.ts` — `ExecFn` (note its `input?` field — the stdin seam), `GitContextOptions` (`pat?` for `usePat`).
- `adws/github/gitContextFactory.ts` — `gitContextForRepo(repoInfo)` injects `pat: GITHUB_PAT` and auto-detects self-host; the factory labelManager/depauditSetup default-deps will call.
- `adws/phases/workflowInit.ts` — `WorkflowConfig` carries `gitContext?: GitContext` (launch-boundary context; optional) and `targetRepo?: TargetRepoInfo`; both consumed by depauditSetup.
- `features/per-issue/feature-540.feature` — The `@adw-540` regression scenario; asserts the label-create/apply calls the module issues (transport is explicitly an implementation detail), so the migration keeps it green.

### Conditional documentation (matched by this task's conditions)

- `app_docs/feature-oqb76h-gitcontext-base-path-authority.md` — The GitContext package doc; "adding a new `gh` operation method to `GitContext` (thin-method + package-private-op pattern)", the `#run` stdin/`usePat` seam, and the slice-by-slice migration table this slice extends.
- `app_docs/feature-bq1f45-git-gh-cli-guard.md` — `checkGitGhGuard.ts`, `scanFiles`, the `ALLOWLIST`, and the `bun run lint:git-guard` remedy (migrate to GitContext or allowlist).
- `app_docs/feature-k2tkdn-gitcontext-boundary-constructor.md` — `WorkflowConfig.gitContext` launch-boundary wiring that depauditSetup prefers when present.
- `app_docs/feature-25daxp-label-manager-deep-module.md` — `ensureAdwLabelsExist` / `applyLabel` / `readAdwLabels`, `LabelManagerDeps`, `buildDefaultLabelManagerDeps`, and the lazy-create-and-retry "not found" behaviour to preserve.
- `app_docs/feature-w12d7t-fix-board-update-mutation.md` — `GitHubBoardManager.ensureColumns` / `updateStatusFieldOptions` and the `gh api graphql --input -` (stdin JSON) array-argument technique being migrated here.
- `app_docs/feature-elre2t-fix-board-column-order-ids.md` — `mergeStatusOptions` / `updateStatusFieldOptions` column ordering (unchanged by this slice; the mutation body shape must stay identical).
- `app_docs/feature-hjcays-fix-board-pat-auth.md` and `app_docs/feature-9tknkw-project-board-pat-fallback.md` — Why board GraphQL writes need the PAT and the graceful fallback-to-app-token contract that `runGraphQLInput`'s `usePat: true` must honour.
- `app_docs/feature-hm6br4-adw-init-depaudit-setup.md` and `app_docs/feature-fgef3i-adw-init-call-depaud-depaudit-setup-secret-propagation.md` — `executeDepauditSetup` secret-propagation behaviour (skip-on-missing-env, warn-don't-fail) to preserve.

## Implementation Plan

### Phase 1: Foundation — extend the GitContext surface

Add the two missing operation methods and their pure command builders to the package, plus their unit tests. This is the shared substrate the three consumers route through, so it lands first (red → green on the new GitContext tests) before any consumer changes.

- New `secretCommands.ts` builder + `GitContext.setSecret`.
- New `graphQLInputCmd()` builder in `boardCommands.ts` + `GitContext.runGraphQLInput`.
- Extend the operations test helper to capture stdin `input`; add tests asserting command shape, per-command auth (context token for secrets; PAT for board), stdin piping, and `process.env` non-mutation.

### Phase 2: Core Implementation — route the three consumers through GitContext

With the methods available, migrate each consumer to the context and update its tests:

- `labelManager.ts`: deps seam → `gitContextForRepo`; delegate to `ctx.createLabel` / `ctx.applyLabel`; remove `gh` literals.
- `githubBoardManager.ts`: `updateStatusFieldOptions` → `this.ctx.runGraphQLInput(body)`; drop `child_process` import.
- `depauditSetup.ts`: resolve a context; `propagateSecret` → `ctx.setSecret`.

### Phase 3: Integration — enforce, prove, and tighten the guard

- Rewire the `@adw-540` BDD mock seam so the regression scenario exercises the migrated label path.
- Remove the three files from the `checkGitGhGuard.ts` `ALLOWLIST`.
- Run the full validation suite (guard, type-checks, lint, unit tests, build, and the `@adw-540` + `@regression` BDD tags) to confirm zero regressions.

## Step by Step Tasks

Execute every step in order, top to bottom.

### 1. Add the `setSecretCmd` pure command builder

- Create `adws/gitContext/commands/secretCommands.ts`.
- Export `setSecretCmd(owner: string, repo: string, name: string): string` returning `` `gh secret set ${name} --repo ${owner}/${repo} --body -` ``.
- Match the style and zero-side-effect discipline of `adws/gitContext/commands/labelCommands.ts` (no `exec`, no `process.env`).

### 2. Add the `graphQLInputCmd` pure command builder

- In `adws/gitContext/commands/boardCommands.ts`, add and export `graphQLInputCmd(): string` returning `'gh api graphql --input -'` (place it in the "Command builders" section alongside `graphQLCmd`).

### 3. Add `setSecret` and `runGraphQLInput` methods to GitContext

- In `adws/gitContext/gitContext.ts`, import `setSecretCmd` from `./commands/secretCommands` and `graphQLInputCmd` from `./commands/boardCommands` (extend the existing `boardCommands` import).
- Add `setSecret(name: string, value: string): void` → `this.#run(setSecretCmd(this.#owner, this.#repo, name), { input: value });` (default token — no `usePat`; matches current `gh secret set` auth). Place it near `applyLabel` in the label/board method group.
- Add `runGraphQLInput(body: Record<string, unknown>): string` → `return this.#run(graphQLInputCmd(), { input: JSON.stringify(body), usePat: true });` Place it next to `runGraphQL`. Add a short JSDoc noting: stdin-JSON form for complex/array GraphQL variables that `runGraphQL`'s flag form cannot express; uses the PAT (Projects V2 write) with graceful fallback to the context token when no PAT is set.

### 4. Extend GitContext operation tests for the new methods

- In `adws/gitContext/__tests__/gitContextOperations.test.ts`, extend `interface SpyCall` with `input?: string` and update `makeSpyExec` to record `options.input`.
- Add a `describe('setSecret', …)` with tests:
  - Command equals `gh secret set MY_SECRET --repo acme/webapp --body -`.
  - `calls[0].env.GH_TOKEN` is the context's primary token (NOT the PAT) when constructed with both `token` and `pat`.
  - `calls[0].input` equals the secret value (piped to stdin, not present in the command string).
  - `process.env.GH_TOKEN` is unchanged after the call (non-mutation).
- Add a `describe('runGraphQLInput', …)` with tests:
  - Command equals `gh api graphql --input -`.
  - `calls[0].input` equals `JSON.stringify(body)` for a body containing an array variable.
  - `calls[0].env.GH_TOKEN` is the PAT when a `pat` is configured (`usePat: true`).
  - With no `pat` configured, `GH_TOKEN` falls back to the context's primary token (graceful degrade).
- Run `bun run test:unit` (or the targeted file) and confirm green.

### 5. Migrate `labelManager.ts` onto GitContext

- Replace the `LabelManagerDeps` interface with `{ readonly gitContextForRepo: (repoInfo: RepoInfo) => GitContext; readonly logger: (message: string, level?: LogLevel) => void }`.
- Update `buildDefaultLabelManagerDeps()` to return `{ gitContextForRepo, logger: log }`, importing `gitContextForRepo` from `./gitContextFactory` and the `GitContext` type from `../gitContext`.
- Delete the private `createLabel(def, repoInfo, deps)` and `addLabelToIssue(issueNumber, label, repoInfo, deps)` helpers (these hold the `gh` string literals).
- Rewrite `ensureAdwLabelsExist(repoInfo, deps?)`: resolve `const ctx = deps.gitContextForRepo(repoInfo)` once, then loop `ctx.createLabel(def.name, def.color, def.description)` inside the existing per-label try/catch; keep the success-count summary log.
- Rewrite `applyLabel(issueNumber, label, repoInfo, deps?)`: resolve `const ctx = deps.gitContextForRepo(repoInfo)`; `try { ctx.applyLabel(issueNumber, label); return; }`; on error, if `!isLabelNotFoundError(error)` log+rethrow; otherwise log the lazy-create, call `ctx.createLabel(resolveLabelDefinition(label)...)`, then `ctx.applyLabel(issueNumber, label)` once.
- Remove the now-unused `execWithRetry` and `ExecSyncOptions` imports; keep `log`/`LogLevel`. Keep `isLabelNotFoundError`, `resolveLabelDefinition`, and every pure read-side export unchanged.

### 6. Update `labelManager.test.ts`

- Rewire `makeDeps` to return the new shape: `gitContextForRepo: () => new GitContext(validOptions(), { exec: spyExec })`, where `spyExec` records commands (and, for lazy-create tests, throws an `Error` whose message contains `not found` on the first `gh issue edit` for the target label, then succeeds after a `gh label create`).
- Add a local `validOptions()` and `makeSpyExec()` (or import the pattern from the gitContext test) so a real `GitContext` drives the same `createLabelCmd` / `applyLabelCmd` builders.
- Keep every behavioural assertion (idempotent ensure, per-label resilience, lazy-create-and-retry, non-"not found" rethrow); they now assert against the recorded command strings produced by the real context.

### 7. Migrate `githubBoardManager.ts` onto GitContext

- In `updateStatusFieldOptions`, replace the `execSync('gh api graphql --input -', { input: JSON.stringify(body), encoding: 'utf-8' })` line with `this.ctx.runGraphQLInput(body);` (the `body` shape is unchanged).
- Remove `import { execSync } from 'child_process';`. Confirm no other `child_process` usage remains in the file.

### 8. Migrate `depauditSetup.ts` onto GitContext

- Add `gitContextForRepo?: (repoInfo: RepoInfo) => GitContext` to `DepauditSetupDeps`; default it in `DEFAULT_DEPS` to the real `gitContextForRepo` (import from `../github/gitContextFactory`; import `RepoInfo` / `GitContext` types as needed). Keep `execWithRetry`, `log`, `getEnv`.
- In `executeDepauditSetup`, after computing `ownerRepo`, resolve the repo info and context once: build `repoInfo` from `config.targetRepo` (`{ owner, repo }`) or `getRepoInfo()`, then `const ctx = config.gitContext ?? d.gitContextForRepo(repoInfo)`.
- Change `propagateSecret` to accept the resolved `ctx` and call `ctx.setSecret(envName, envValue)` inside its `try`, replacing the `deps.execWithRetry('gh secret set …', { input, maxAttempts })` call. Preserve the surrounding skip-on-missing-env, success log, and catch→warning semantics.
- Keep the `depaudit setup` invocation on `d.execWithRetry` (it is not a `git`/`gh` command, so the guard does not flag it).

### 9. Update `depauditSetup.test.ts`

- Inject `gitContextForRepo: () => new GitContext(validOptions(), { exec: spyExec })` via `makeDeps`; assert the recorded `gh secret set <NAME> --repo <owner>/<repo> --body -` command and that its stdin `input` equals the env value.
- Keep the `execWithRetry` spy assertion for the `depaudit setup` CLI call and the existing skip/missing-env/warning tests (now observing the absence of a recorded `setSecret` command when the env var is unset).

### 10. Rewire the `@adw-540` BDD mock seam

- In `features/per-issue/step_definitions/feature-540.steps.ts`, update `buildMockDeps()` to return the new `LabelManagerDeps` shape: `gitContextForRepo: (repoInfo) => new GitContext(<full options derived from repoInfo>, { exec })`, where `exec` is the existing closure that pushes to `ctx.execCalls` and simulates `gh label create` / `gh issue edit` (including the `alwaysNotFound` / `notFoundUntilCreated` throw paths).
- Provide the GitContext construction options (token, gitIdentity, frameworkRepoRoot, targetReposDir, `selfHost: false`) as test constants. The `createSyntheticMockContext()` `getRecordedRequests()` bridge is unchanged because the recorded command strings are identical.
- Import `GitContext` (and any `ExecFn` type) into the step file.

### 11. Remove the three files from the guard ALLOWLIST

- In `adws/checkGitGhGuard.ts`, delete the three "residual" `ALLOWLIST` entries: `adws/phases/depauditSetup.ts`, `adws/github/labelManager.ts`, and `adws/providers/github/githubBoardManager.ts`. Leave the remaining bootstrap/diagnostic/residual entries intact.

### 12. Run all Validation Commands

- Execute every command in the `Validation Commands` section and confirm each exits cleanly with zero regressions. In particular, `bun run lint:git-guard` must now PASS with the three files scanned (no violations), and the `@adw-540` and `@regression` BDD tags must pass.

## Testing Strategy

### Unit Tests

`.adw/project.md` declares `## Unit Tests: enabled`, so unit tests are part of this slice. Framework: `vitest` (`bun run test:unit`).

- **GitContext new methods (`adws/gitContext/__tests__/gitContextOperations.test.ts`)** — the highest-value new coverage, asserting external observable behaviour (command, child env, stdin) via the injected `ExecFn` spy:
  - `setSecret`: exact command `gh secret set <NAME> --repo <owner>/<repo> --body -`; child `GH_TOKEN` is the context token (not the PAT); secret value delivered via stdin `input` and absent from the command string; `process.env` unmutated.
  - `runGraphQLInput`: exact command `gh api graphql --input -`; child `GH_TOKEN` is the PAT under `usePat` when a PAT is set, and falls back to the context token when no PAT is set; body delivered via stdin `input` as `JSON.stringify(body)`.
- **labelManager (`adws/github/__tests__/labelManager.test.ts`)** — re-driven through a real `GitContext` with a spy `ExecFn`: idempotent `ensureAdwLabelsExist` (all eight labels, `--force`), per-label failure resilience, `applyLabel` success, lazy-create-and-retry on "not found", and rethrow on non-"not found"; pure `readAdwLabels` / `readAdwLabelNames` tests unchanged.
- **depauditSetup (`adws/__tests__/depauditSetup.test.ts`)** — secret propagation now asserted via the spy-`ExecFn` `GitContext` (`gh secret set` command + stdin value); skip-on-missing-env, failure→warning (`success: true`, `skippedSecrets` populated), and `depaudit setup` invocation preserved.
- **BDD `@adw-540` (`features/per-issue/feature-540.feature`)** — the regression scenario proving the label module issues the correct create/apply calls; kept green by reusing the same command builders behind the rewired mock seam.

### Edge Cases

- **Secret value never leaks to argv** — the value is piped via stdin (`--body -` + `#run`'s `input`); assert it never appears in the recorded command string.
- **Board write auth on user-owned repos** — `runGraphQLInput` uses `usePat: true`; with no PAT configured it must fall back to the context token rather than error (graceful degrade, matching prior board behaviour). This also corrects the prior latent behaviour where the direct `execSync` used the ambient app token.
- **Lazy-create-on-"not found" survives delegation** — `execSync` surfaces `gh`'s stderr in the thrown error's message, so `isLabelNotFoundError(String(error))` still matches when routing through `GitContext.applyLabel` (verified against Node's `execSync` error shape).
- **Retry semantics change for secrets** — `GitContext.setSecret` runs a single attempt (no `execWithRetry` `maxAttempts: 3`). This is an accepted, precedented trade-off (cf. `getAuthenticatedUser` losing `execWithRetry` in #691/#692); `propagateSecret` still catches failures and degrades to a warning, so behaviour on transient failure is "skip + warn", not crash.
- **depauditSetup context source** — prefers the launch-boundary `config.gitContext` when present; otherwise constructs one from `config.targetRepo` (or `getRepoInfo()` self-host fallback), so both new-orchestrator and legacy-fixture call paths resolve a valid context.
- **`ensureAdwLabelsExist` constructs the context once** — not once per label — while still issuing one `createLabel` per definition.
- **Guard correctness** — after removal, `scanFiles` finds zero `git`/`gh` command-string violations in the three files; the run reports PASS with the three previously-allowlisted files now scanned.
- **No `process.env` mutation** — all three migrated paths inherit `GitContext`'s per-command env-injection guarantee; assert the parent `GH_TOKEN` is untouched.

## Acceptance Criteria

- `GitContext.setSecret(name, value)` exists and pipes the value via stdin using the context's per-command auth; `setSecretCmd` builder added under `adws/gitContext/commands/`.
- `GitContext.runGraphQLInput(body)` exists (stdin-JSON GraphQL, `usePat: true` with PAT fallback); `graphQLInputCmd` builder added to `boardCommands.ts`.
- `labelManager.ts` issues all label create/apply through `GitContext` (`createLabel` / `applyLabel`); no `gh` string literals remain in the file; lazy-create-and-retry behaviour preserved.
- `githubBoardManager.ts` `updateStatusFieldOptions` routes through `this.ctx.runGraphQLInput(body)`; no `child_process` import remains.
- `depauditSetup.ts` propagates secrets through `GitContext.setSecret`; no `gh secret set` string literal remains; `depaudit setup` CLI call unchanged.
- `adws/phases/depauditSetup.ts`, `adws/github/labelManager.ts`, and `adws/providers/github/githubBoardManager.ts` are removed from the `checkGitGhGuard.ts` `ALLOWLIST`.
- `bun run lint:git-guard` passes with the three files scanned (zero violations).
- `bunx tsc --noEmit`, `bunx tsc --noEmit -p adws/tsconfig.json`, `bun run lint`, `bun run test:unit`, and `bun run build` all succeed.
- The `@adw-540` per-issue BDD scenario and the `@regression` suite pass.

## Validation Commands

Execute every command to validate the feature works correctly with zero regressions. Run from the worktree root.

- `bun run lint:git-guard` — Git/GH CLI guard; MUST PASS with `depauditSetup.ts`, `labelManager.ts`, and `githubBoardManager.ts` now scanned (no longer allowlisted) and zero violations reported.
- `bunx tsc --noEmit` — Root type-check (catches deps-shape and signature changes across consumers/tests).
- `bunx tsc --noEmit -p adws/tsconfig.json` — ADW project type-check.
- `bun run lint` — ESLint (code quality / unused imports such as the removed `child_process` / `execWithRetry`).
- `bun run test:unit` — Vitest; runs the updated GitContext, labelManager, and depauditSetup unit tests with zero regressions.
- `bun run build` — `tsc` build; verifies no build errors.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-540"` — The per-issue label-module regression scenario stays green through the migration.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — Full regression BDD suite; confirms no cross-cutting regressions.

## Notes

- `.adw/coding_guidelines.md` applies: keep new/modified files small and single-responsibility (pure command builders stay side-effect-free; `GitContext` methods stay thin delegators to `#run`; guard-clause/early-return style in `applyLabel`). All files remain well under the 300-line ceiling.
- **No new libraries.** Library install command (per `.adw/commands.md`) would be `bun add <package>`, but none is needed.
- **Pattern fidelity.** This slice deliberately mirrors #691–#694: a new thin `GitContext` method + pure command builder, consumers routed through `gitContextForRepo(...)` / an injected context, the file dropped from the `ALLOWLIST`, and per-command auth replacing ambient `GH_TOKEN`. After this slice, the residual `ALLOWLIST` cohort shrinks to `remoteReconcile.ts`, `adwPromotionSweep.tsx`, and `autoMergeHandler.ts` (plus the permanent bootstrap/diagnostic entries) — candidates for subsequent slices.
- **Latent fix, called out.** Routing the board-column update through `runGraphQLInput` with `usePat: true` makes that Projects V2 write use the PAT like every other board GraphQL call, instead of the ambient app token the direct `execSync` inherited. This is an intentional correctness improvement with graceful fallback (no PAT → context token), consistent with `feature-hjcays` / `feature-9tknkw`.
- **`config.gitContext` is optional** on `WorkflowConfig` ("always present for new orchestrators"); depauditSetup's `config.gitContext ?? gitContextForRepo(repoInfo)` resolution keeps both new and legacy-fixture paths working without threading a context through new signatures.
- **The package stays ADW-global-free.** `secretCommands.ts` and the new methods take only primitives; identity and PAT come from the already-constructed context. The `gitContextForRepo` ADW-layer bridge stays in `adws/github/`, not in the package.
- After implementation, run `/document` so the GitContext package app-doc (`app_docs/feature-oqb76h-…`) and the guard doc gain a `#695` row recording the label/board/secret migration and the three ALLOWLIST removals.

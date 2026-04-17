# Feature: adw_init invokes depaudit setup and propagates SOCKET_API_TOKEN + SLACK_WEBHOOK_URL

## Metadata
issueNumber: `439`
adwId: `fgef3i-adw-init-call-depaud`
issueJson: `{"number":439,"title":"adw_init: call depaudit setup + propagate SOCKET_API_TOKEN and SLACK_WEBHOOK_URL","body":"## Parent PRD\n\n`specs/prd/depaudit.md` (in paysdoc/depaudit)\n\n## What to build\n\nHooks `depaudit` into ADW's target-repo bootstrap. Adds a step to `adws/adwInit.tsx` (or the appropriate `adw_init` code path) that, after the target repo is cloned and `.adw/` is set up, invokes `depaudit setup` in the target repo's working directory. Assumes `depaudit` is installed globally on the machine running ADW (doc: `npm install -g depaudit`).\n\nAlso: propagate `SOCKET_API_TOKEN` and `SLACK_WEBHOOK_URL` from ADW's process environment to each target repo's GitHub Actions secrets via `gh secret set --repo <target>` during the same `adw_init` run.\n\nDocs updates: `README.md`, `adws/README.md`, `.env.sample` (depaudit-related env vars already added).\n\n## Acceptance criteria\n\n- [ ] `adw_init` invokes `depaudit setup` in the freshly-cloned target repo's working tree.\n- [ ] `SOCKET_API_TOKEN` and `SLACK_WEBHOOK_URL` propagated to target repo secrets via `gh secret set`.\n- [ ] Missing env values: warn (do not fail) and note in init summary.\n- [ ] Integration test with a fixture target repo — see `adws/__tests__/` for prior art.\n- [ ] Docs updated (README, adws/README, `.env.sample`).\n\n## Blocked by\n\n- Blocked by paysdoc/depaudit#12\n- Blocked by #438\n\n## User stories addressed\n\n- User story 11\n- User story 28 (cross-repo secret propagation)\n","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-04-17T13:27:52Z","comments":[],"actionableComment":null}`

## Feature Description
Hook `depaudit` — the supply-chain audit tool (from `paysdoc/depaudit`) — into ADW's target-repo bootstrap flow. After `adwInit.tsx` has cloned the target repo, generated `.adw/` config, and copied target skills/commands, it must (1) invoke `depaudit setup` inside the target repo's freshly-cloned worktree so the target repo gets an `.depaudit.yml`, `osv-scanner.toml`, and a GitHub Actions workflow installed and (2) propagate the supply-chain tooling secrets `SOCKET_API_TOKEN` (Socket.dev token used by the depaudit scanner) and `SLACK_WEBHOOK_URL` (audit-alert webhook) from ADW's `.env` / process environment to the target repo's GitHub Actions secrets via `gh secret set --repo <owner>/<repo>`.

Missing env values must NOT fail the workflow — they must log a warning and be reported in the init summary ("skipped"/"not set"). This lets ADW bootstrap repos that legitimately don't need (or haven't yet been issued) Socket or Slack credentials.

The feature assumes `depaudit` is installed globally on the ADW host machine (`npm install -g depaudit`); ADW will not `npm install` it during bootstrap.

## User Story
As an ADW operator bootstrapping a new target repository
I want `adw_init` to automatically install depaudit's scan config + workflow and push my Socket and Slack secrets into the target repo's GitHub Actions secrets
So that every target repo gets consistent supply-chain scanning and alert routing from day one, without me having to run `depaudit setup` or paste secrets by hand in the GitHub Settings UI.

## Problem Statement
Today, `adwInit.tsx` clones a target repo, runs the `/adw_init` slash command to generate `.adw/` config, copies target skills and commands, commits, and opens a PR. There is no integration with the depaudit supply-chain tooling. Operators currently have to:

1. Manually run `depaudit setup` inside each newly-cloned target repo.
2. Manually copy `SOCKET_API_TOKEN` and `SLACK_WEBHOOK_URL` into each target repo's GitHub Actions secrets via the GitHub web UI or individual `gh secret set` calls.

This is toil. It's also fragile — repos get bootstrapped without the supply-chain workflow, or the Socket token is forgotten and scans run without API access.

## Solution Statement
Add one new phase — **depauditSetup** — that runs after `copyTargetSkillsAndCommands` and before `commitChanges` in `adwInit.tsx`. The phase:

1. Invokes `depaudit setup` via `execWithRetry()` with `cwd: config.worktreePath`, so files land in the target repo's worktree and get swept into the subsequent `commitChanges` call.
2. For each of `SOCKET_API_TOKEN` and `SLACK_WEBHOOK_URL` present in `process.env`, runs `gh secret set <NAME> --repo <owner>/<repo> --body <value>` (value piped via stdin, never in argv, to avoid leaking into process listings or shell history).
3. Collects a list of skipped/missing env vars and returns it so the orchestrator can log a summary line.
4. Never throws on missing env vars — only warns via `log(..., 'warn')`.

The phase lives in a new file `adws/phases/depauditSetup.ts` and is exported through the `adws/workflowPhases.ts` barrel, matching the existing `phases/*.ts` → `workflowPhases.ts` re-export pattern. The function is dependency-injectable (`DepauditSetupDeps`) so unit tests can mock `execWithRetry`, `log`, and `process.env` access — mirroring the `MergeDeps` pattern used by `adwMerge.test.ts`.

## Relevant Files
Use these files to implement the feature:

- `adws/adwInit.tsx` — The orchestrator that owns the bootstrap flow. Insert a call to `executeDepauditSetup(config)` after line 85 (`copyTargetSkillsAndCommands`) and before line 90 (`commitChanges`). Capture returned warnings and include them in the completion log and comment summary.
- `adws/phases/workflowInit.ts` — Defines `WorkflowConfig` interface (lines 64–87); confirms `worktreePath`, `targetRepo`, `issue`, and `logsDir` are available to the new phase. No changes needed here beyond what's already exposed.
- `adws/phases/worktreeSetup.ts` — Current home of `copyTargetSkillsAndCommands`, which the new phase runs after. Reference pattern for how worktree-scoped phases use `config.worktreePath`.
- `adws/core/utils.ts` — Exports `execWithRetry(command, { cwd, maxAttempts })` (lines 53–78). Use for both `depaudit setup` and `gh secret set` invocations. Wraps `execSync` with retry + non-retryable pattern detection.
- `adws/core/logger.ts` — Exports `log(message, level)` with `level: 'info' | 'warn' | 'error' | 'success'`. Use `'warn'` for missing env vars.
- `adws/types/issueTypes.ts` — Defines `TargetRepoInfo { owner, repo, cloneUrl, workspacePath? }` (line 193). `config.targetRepo` may be undefined when ADW is running against itself; the phase falls back to `getRepoInfo()` from `adws/github` to resolve owner/repo in that case.
- `adws/github/index.ts` — Exports `getRepoInfo()` which returns `{ owner, repo }` by parsing the current repo's git remote. Used as fallback when `config.targetRepo` is not set.
- `adws/workflowPhases.ts` — The barrel re-export module. Add `export { executeDepauditSetup } from './phases/depauditSetup';`.
- `adws/__tests__/adwMerge.test.ts` — Reference Vitest + dependency injection test pattern (lines 1–60). Mirror `MergeDeps` injection, `vi.fn()` stubs, and `describe`/`it` organization.
- `README.md` (root) — Document new env vars and the `depaudit` prerequisite in the Setup section. Note that `adw_init` will propagate `SOCKET_API_TOKEN` and `SLACK_WEBHOOK_URL` to target repo GitHub Actions secrets.
- `adws/README.md` — Document the new `adwInit.tsx` phase sequence, including `depaudit setup`, in the Scripts / Quick Start section.
- `.env.sample` — Already contains `SOCKET_API_TOKEN` (line 65) and `SLACK_WEBHOOK_URL` (line 61). No changes strictly required; verify the comments note their role in `adw_init` propagation.
- `features/adw_init_depaudit_setup_and_secrets.feature` — Existing BDD feature file with 20 scenarios tagged `@adw-439`. The implementation must make these scenarios pass.
- `app_docs/feature-sgud8b-copy-target-skills-adw-init.md` — Conditional doc that describes `copyTargetSkillsAndCommands` and prior extensions to `adwInit.tsx`. Read to match the phase-insertion pattern exactly.
- `app_docs/feature-kbzbn6-fix-git-repo-context.md` — Conditional doc on VCS functions and target-repo path handling. Relevant because the new phase must target the cloned target repo (not ADW's own repo).

### New Files
- `adws/phases/depauditSetup.ts` — New phase module. Exports:
  - `interface DepauditSetupDeps` — injectable surface for tests (`execWithRetry`, `log`, `getEnv`).
  - `interface DepauditSetupResult { success: boolean; warnings: string[]; skippedSecrets: string[] }` — return contract consumed by `adwInit.tsx`.
  - `async function executeDepauditSetup(config: WorkflowConfig, deps?: DepauditSetupDeps): Promise<DepauditSetupResult>` — runs `depaudit setup` then propagates each of the two secrets.
- `adws/__tests__/depauditSetup.test.ts` — Vitest unit test covering: `depaudit setup` invocation with correct `cwd`; `gh secret set` invocation when each env var is present; warnings path when each env var is missing; `success: true` even when both secrets are missing; `gh secret set` failures bubble up but `depaudit setup` failures do not fail the workflow (they log and return).

## Implementation Plan

### Phase 1: Foundation
Stand up the new phase module with its type surface, dependency-injection shape, and stubs. Wire the barrel export so `adwInit.tsx` can import it. Do not yet call it from the orchestrator — validate the module compiles in isolation first.

### Phase 2: Core Implementation
Implement the two sub-steps inside `executeDepauditSetup`:

1. **`depaudit setup` invocation.** Shell out with `execWithRetry('depaudit setup', { cwd: config.worktreePath, maxAttempts: 2 })`. On error, `log(..., 'warn')` and push to `warnings[]`; do **not** throw — an unavailable `depaudit` binary must not fail `adw_init`.
2. **Secret propagation.** For each of `SOCKET_API_TOKEN` and `SLACK_WEBHOOK_URL`:
   - Resolve owner/repo from `config.targetRepo ?? getRepoInfo()`.
   - If `process.env[NAME]` is unset or empty, log a warning and append to `skippedSecrets`.
   - If set, invoke `gh secret set <NAME> --repo <owner>/<repo> --body -` with the secret value piped via stdin (`input` option on `execWithRetry`/`execSync`) — never inlined into the command string.
   - Wrap the call in try/catch; a `gh` auth failure surfaces as a warning, not a thrown error, so one missing permission does not block the other secret or the rest of init.

### Phase 3: Integration
Wire `executeDepauditSetup(config)` into `adwInit.tsx` between `copyTargetSkillsAndCommands` and `commitChanges`. The orchestrator logs the `DepauditSetupResult.warnings` and `skippedSecrets` summary before the commit step. The commit message remains unchanged — `depaudit setup`'s generated files (`.depaudit.yml`, `osv-scanner.toml`, `.github/workflows/depaudit.yml`, etc.) land in the worktree and get picked up by the existing `commitChanges` call.

Update docs in the same PR: `README.md` gains a section noting the `depaudit` global-install prerequisite and the env-var propagation behavior; `adws/README.md` updates the `adwInit` flow description; `.env.sample` comments get a final pass to reference `adw_init` propagation.

Finally, run the `@adw-439` BDD scenarios against the changes to ensure every assertion in `features/adw_init_depaudit_setup_and_secrets.feature` passes.

## Step by Step Tasks
Execute every step in order, top to bottom.

### 1. Read the existing BDD feature file and conditional docs
- Read `features/adw_init_depaudit_setup_and_secrets.feature` end-to-end to lock in every expected string literal (e.g., the scenarios assert `file contains "depaudit setup"`, `file contains "gh secret set"`, `process.env.SOCKET_API_TOKEN`, `process.env.SLACK_WEBHOOK_URL`).
- Read `app_docs/feature-sgud8b-copy-target-skills-adw-init.md` to match the prior adwInit phase-insertion style.

### 2. Create `adws/phases/depauditSetup.ts` skeleton
- Create the new file with the `DepauditSetupDeps` interface, `DepauditSetupResult` interface, and an `async function executeDepauditSetup(config: WorkflowConfig, deps?: DepauditSetupDeps): Promise<DepauditSetupResult>` stub that returns `{ success: true, warnings: [], skippedSecrets: [] }`.
- Import `log`, `execWithRetry` from `../core` and `WorkflowConfig` from `./workflowInit` (or via `../core` re-export).
- Keep the file under ~120 lines — one phase, one responsibility.

### 3. Implement `depaudit setup` invocation
- Inside `executeDepauditSetup`, call `execWithRetry('depaudit setup', { cwd: config.worktreePath, maxAttempts: 2, stdio: 'inherit' | 'pipe' — choose 'pipe' so stdout can be logged at debug level })`.
- Wrap in try/catch. On failure: `log(\`depaudit setup failed: ${error}. Continuing — ensure 'npm install -g depaudit' is present on the ADW host.\`, 'warn')` and push a human-readable entry to `warnings[]`. Do NOT rethrow.
- Log success on the happy path: `log('depaudit setup completed', 'success')`.

### 4. Implement secret propagation helper
- Inside the same file, add a private helper `async function propagateSecret(envName: 'SOCKET_API_TOKEN' | 'SLACK_WEBHOOK_URL', ownerRepo: string, deps: Required<DepauditSetupDeps>): Promise<{ propagated: boolean; warning?: string }>`.
- Read `process.env[envName]` via `deps.getEnv(envName)`. If empty/undefined, return `{ propagated: false, warning: \`${envName} not set — skipping gh secret set\` }`.
- If set, run `execWithRetry(\`gh secret set ${envName} --repo ${ownerRepo} --body -\`, { input: envValue, maxAttempts: 3 })`. On failure, return `{ propagated: false, warning: \`Failed to set ${envName} on ${ownerRepo}: ${error}\` }`.
- On success, `log(\`Propagated ${envName} to ${ownerRepo} GitHub Actions secrets\`, 'success')`.

### 5. Wire secret propagation into `executeDepauditSetup`
- After the `depaudit setup` step, resolve `ownerRepo` string:
  - If `config.targetRepo`: `\`${config.targetRepo.owner}/${config.targetRepo.repo}\``.
  - Else: import `getRepoInfo` from `../github`; call it and use `\`${info.owner}/${info.repo}\``.
- Call `propagateSecret('SOCKET_API_TOKEN', ownerRepo, deps)` and `propagateSecret('SLACK_WEBHOOK_URL', ownerRepo, deps)` sequentially.
- For each result where `propagated === false`, append the warning to `warnings[]` and the env name to `skippedSecrets[]`.
- Return `{ success: true, warnings, skippedSecrets }`.

### 6. Define default dependency injection
- At the bottom of `adws/phases/depauditSetup.ts`, define `const DEFAULT_DEPS: Required<DepauditSetupDeps> = { execWithRetry, log, getEnv: (name: string) => process.env[name] }`.
- In `executeDepauditSetup`, merge `deps` with defaults: `const d: Required<DepauditSetupDeps> = { ...DEFAULT_DEPS, ...deps }`.

### 7. Export from `adws/workflowPhases.ts`
- Add `export { executeDepauditSetup } from './phases/depauditSetup';` and `export type { DepauditSetupResult, DepauditSetupDeps } from './phases/depauditSetup';` to the barrel so `adwInit.tsx` imports via the existing `from './workflowPhases'` line.

### 8. Integrate into `adwInit.tsx`
- Import `executeDepauditSetup` alongside the existing imports on line 24.
- Between line 85 (`copyTargetSkillsAndCommands(config.worktreePath);`) and line 87 (`log('Committing files...', 'info');`), insert:
  ```ts
  log('Phase: depaudit setup + secret propagation', 'info');
  const depauditResult = await executeDepauditSetup(config);
  if (depauditResult.skippedSecrets.length > 0) {
    log(`Init summary: skipped secrets (env not set): ${depauditResult.skippedSecrets.join(', ')}`, 'warn');
  }
  for (const w of depauditResult.warnings) {
    log(w, 'warn');
  }
  ```
- The call runs before `commitChanges` so that any files generated by `depaudit setup` (e.g., `.depaudit.yml`, `osv-scanner.toml`, `.github/workflows/depaudit.yml`) are included in the initialization commit.

### 9. Create unit tests `adws/__tests__/depauditSetup.test.ts`
- Use Vitest (`import { describe, it, expect, vi } from 'vitest'`), mirroring `adwMerge.test.ts`.
- Helper: `makeConfig(overrides)` returns a minimal `WorkflowConfig`-shaped object with `worktreePath: '/tmp/fixture'` and `targetRepo: { owner: 'acme', repo: 'fixture-target', cloneUrl: '...' }`.
- Helper: `makeDeps(overrides)` returns `DepauditSetupDeps` with `execWithRetry: vi.fn().mockReturnValue('')`, `log: vi.fn()`, `getEnv: vi.fn().mockReturnValue(undefined)`.
- Test cases:
  1. `invokes depaudit setup with config.worktreePath as cwd` — assert first `execWithRetry` call's second arg has `cwd: '/tmp/fixture'`.
  2. `gh secret set is called with SOCKET_API_TOKEN when env is present` — `getEnv.mockImplementation((n) => n === 'SOCKET_API_TOKEN' ? 'sktsec_abc' : undefined)`; assert `execWithRetry` was called with a command matching `/gh secret set SOCKET_API_TOKEN --repo acme\/fixture-target/` and options including `input: 'sktsec_abc'`.
  3. `gh secret set is called with SLACK_WEBHOOK_URL when env is present` — symmetric to #2.
  4. `skippedSecrets includes SOCKET_API_TOKEN when env is unset` — `getEnv` returns undefined for it; `result.skippedSecrets` contains `'SOCKET_API_TOKEN'`; `execWithRetry` not called with that secret name.
  5. `skippedSecrets includes SLACK_WEBHOOK_URL when env is unset` — symmetric to #4.
  6. `does not throw when both env vars are unset` — `await expect(executeDepauditSetup(config, deps)).resolves.toMatchObject({ success: true })`.
  7. `warnings array contains SOCKET_API_TOKEN skip message when unset` — asserts the warning message surface.
  8. `does not throw when depaudit setup binary is missing` — `execWithRetry.mockImplementationOnce(() => { throw new Error('command not found: depaudit'); })`; assert the function resolves with `success: true` and warnings contains the depaudit failure.
  9. `does not throw when gh secret set fails` — `execWithRetry.mockImplementationOnce(() => '').mockImplementationOnce(() => { throw new Error('HTTP 403'); })`; function still resolves with `success: true` and the failure surfaces as a warning.
  10. `uses getRepoInfo fallback when config.targetRepo is undefined` — covered by mocking `../github` module's `getRepoInfo` export.

### 10. Update documentation in `.env.sample`
- Verify `SOCKET_API_TOKEN` (line ~65) and `SLACK_WEBHOOK_URL` (line ~61) comments mention that `adw_init` will propagate these to target repo GitHub Actions secrets via `gh secret set`. Amend comments if not already clear.

### 11. Update `README.md`
- Under **Install Prerequisites → Optional**, add a `depaudit` row: `| [depaudit](https://github.com/paysdoc/depaudit) | Supply-chain audit tooling; auto-installed into target repos by \`adw_init\` | \`npm install -g depaudit\` | \`npm install -g depaudit\` |`.
- Under **Configure Environment → Required and optional environment variables**, add bullets for `SOCKET_API_TOKEN` and `SLACK_WEBHOOK_URL` explicitly noting: "Propagated by `adw_init` to each target repo's GitHub Actions secrets via `gh secret set`. Missing values are logged as warnings and do not fail init."
- Mention `adw_init` step-by-step flow if such a section exists; otherwise add a brief "adw_init" subsection that lists the phase order: clone → `/adw_init` → copy skills → `depaudit setup` → commit → PR.

### 12. Update `adws/README.md`
- In the Scripts or Quick Start section, document `adwInit.tsx` with a line: "Runs `depaudit setup` in the target repo worktree and propagates `SOCKET_API_TOKEN` / `SLACK_WEBHOOK_URL` to the target repo's GitHub Actions secrets."

### 13. Run the `@adw-439` BDD scenarios
- Execute `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-439"`.
- Every scenario must pass. If any step definition is missing, generate it via `/generate_step_definitions` or write it manually in `features/step_definitions/` — some scenarios use generic "file contains" patterns that likely already have step definitions; verify before coding new ones.

### 14. Run Validation Commands
- Execute every command in the **Validation Commands** section below. Every command must exit 0 with no errors before the task is considered complete.

## Testing Strategy

### Unit Tests
Unit tests are **enabled** per `.adw/project.md`. The test file `adws/__tests__/depauditSetup.test.ts` (described in Step 9) covers:

- **Happy path — both secrets set:** `depaudit setup` invoked with correct cwd; `gh secret set` called twice (once per secret) with correct `--repo` arg and piped `input`.
- **Partial config — one secret missing:** Only the set secret is propagated; the missing one appears in `skippedSecrets` and `warnings`.
- **Both secrets missing:** Function resolves `success: true`, both secrets in `skippedSecrets`, no `gh secret set` calls made.
- **`depaudit` binary missing:** `execWithRetry` throws `command not found`; function does not throw, logs warning.
- **`gh secret set` fails (auth / perms):** Failure surfaces as warning, function resolves with `success: true`, other secret is still attempted.
- **Fallback to `getRepoInfo()`:** When `config.targetRepo` is undefined, the function uses `getRepoInfo()` to resolve owner/repo for the `--repo` flag.

Mock surface: `execWithRetry`, `log`, `getEnv` via the `DepauditSetupDeps` dependency-injection interface, plus a mock for `../github` module's `getRepoInfo` export when testing the fallback.

### Edge Cases
- `depaudit` binary not installed globally on the ADW host — warning, workflow continues.
- `SOCKET_API_TOKEN` set to empty string (not just undefined) — treated as missing.
- `gh` not authenticated or token lacks `actions:write` scope — warning, workflow continues.
- `config.targetRepo` is undefined (ADW running against its own repo, not a cloned target) — fallback to `getRepoInfo()`.
- `depaudit setup` mutates files but `commitChanges` fails for unrelated reasons — existing error handling in `adwInit.tsx` still triggers `handleWorkflowError`; depaudit's files remain uncommitted but the worktree is in a recoverable state.
- Secret value contains newlines or special shell characters — passing via `input` / stdin avoids any argv-escaping bugs.

## Acceptance Criteria
- [ ] `adws/phases/depauditSetup.ts` exists and exports `executeDepauditSetup`, `DepauditSetupResult`, `DepauditSetupDeps`.
- [ ] `adws/workflowPhases.ts` re-exports `executeDepauditSetup` and its types.
- [ ] `adws/adwInit.tsx` calls `executeDepauditSetup(config)` after `copyTargetSkillsAndCommands` and before `commitChanges`.
- [ ] `depaudit setup` is invoked with `cwd: config.worktreePath`.
- [ ] `SOCKET_API_TOKEN` is propagated via `gh secret set SOCKET_API_TOKEN --repo <owner>/<repo>` (value via stdin) when `process.env.SOCKET_API_TOKEN` is set.
- [ ] `SLACK_WEBHOOK_URL` is propagated via `gh secret set SLACK_WEBHOOK_URL --repo <owner>/<repo>` (value via stdin) when `process.env.SLACK_WEBHOOK_URL` is set.
- [ ] Missing env values log a warning and are listed in the init summary (orchestrator's `log` output) as skipped; the workflow does NOT throw.
- [ ] `adws/__tests__/depauditSetup.test.ts` exists with ≥ 8 test cases covering the scenarios above.
- [ ] All 20 BDD scenarios in `features/adw_init_depaudit_setup_and_secrets.feature` tagged `@adw-439` pass.
- [ ] `README.md`, `adws/README.md`, and `.env.sample` documentation is updated.
- [ ] `bunx tsc --noEmit -p adws/tsconfig.json` exits 0 with no type errors.
- [ ] `bun run lint` and `bun run test:unit` exit 0.

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `bun install` — Ensure dependencies are installed (no new libraries required; only uses existing `execWithRetry` + `log`).
- `bun run lint` — Run the linter on the changed files.
- `bunx tsc --noEmit` — Top-level type check.
- `bunx tsc --noEmit -p adws/tsconfig.json` — adws workspace type check (additional check from `.adw/commands.md`).
- `bun run build` — Build to verify no build errors.
- `bun run test:unit` — Run the full unit test suite including the new `depauditSetup.test.ts`.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-439"` — Run the `@adw-439` BDD scenarios from `features/adw_init_depaudit_setup_and_secrets.feature`.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — Run the full regression suite to verify no regressions in other features.

## Notes
- **Library install command:** None needed. Implementation uses only `execWithRetry` and `log` from `adws/core` — no new dependencies.
- **Script execution:** `bunx tsx adws/adwInit.tsx <issueNumber>` (unchanged entry point).
- **Decorators:** Not used (keeping it simple per instructions).
- **Guidelines dir:** No `guidelines/` directory exists in this repo; no additional coding guidelines to follow beyond existing project conventions.
- **Conditional docs consulted:** `app_docs/feature-sgud8b-copy-target-skills-adw-init.md` (adwInit phase-insertion pattern) and `app_docs/feature-kbzbn6-fix-git-repo-context.md` (target repo worktree handling) — both relevant per `.adw/conditional_docs.md`.
- **Security — never inline secrets in argv:** Secret values must be piped to `gh secret set --body -` via the `input` option on `execSync` / `execWithRetry`, never via string interpolation into the command string. This prevents leaking secrets into ps listings, shell history, or ADW log files.
- **`execWithRetry` non-retryable patterns:** Auth errors like `HTTP 401`, `gh auth login`, `Bad credentials` are already non-retryable per `adws/core/utils.ts` line 33. These will fail fast and be caught by our try/catch, converted to warnings.
- **`gh secret set` prerequisites:** The GitHub auth context (either `GITHUB_PAT` or `gh auth login`) needs `actions:write` or `repo` scope on the target repo. If the operator's token lacks this, the propagation step will warn and continue — in line with the "warn, do not fail" requirement.
- **Out of scope:** This plan does NOT add an `npm install -g depaudit` step to ADW bootstrap — it's an operator prerequisite documented in `README.md`, consistent with how `gh` and `claude` CLIs are treated today.
- **Future consideration:** If other secrets (e.g., `COST_API_TOKEN`, `CLOUDFLARE_API_TOKEN`) need per-repo propagation later, the two `propagateSecret` calls can be replaced by iterating an `SECRETS_TO_PROPAGATE` const array — the `propagateSecret` helper is already generalized for that.

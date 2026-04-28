# Patch: Fix three regression-suite runtime gaps via in-scope step-def edits

## Metadata
adwId: `2evbnk-bdd-rewrite-2-3-auth`
reviewChangeRequest: `Issue #1: All 41 @regression scenarios (6 smoke + 35 surface) fail at runtime with AssertionError: State file artefact not found at /tmp/adw-wt-*/.adw/state.json. The cron probe smoke fails on missing POST to /issues/300/comments. Spec section 8 (Validation Commands) marks the @regression run as MUST PASS; scenario_proof.md confirms FAILED with exit 1. Root causes (per the DEFERRED-RUNTIME-GAP comments authored in the .feature files): (a) features/regression/step_definitions/whenSteps.ts:36 spawnOrchestrator passes adwId before issueNumber in argv whereas the orchestrators expect issueNumber first; (b) fetchGitHubIssue uses the gh CLI (GraphQL over HTTPS) which cannot reach the HTTP mock server; (c) thenSteps.ts T1 reads from G11 temp worktree but orchestrators write state under agents/{adwId}/state.json. All three fixes belong in features/regression/step_definitions/ which is explicitly out-of-scope for #492. Resolve by (i) reopen #491, (ii) extend #492 scope, or (iii) accept the deferral.`

## Issue Summary
**Original Spec:** `specs/issue-492-adw-2evbnk-bdd-rewrite-2-3-auth-sdlc_planner-bdd-authoring-smoke-surface-scenarios.md`

**Issue:** All 41 `@regression` scenarios fail at runtime against the spec's MUST-PASS validation gate (spec §8). The build agent already documented the three root causes inline as `# DEFERRED-RUNTIME-GAP:` comments on every smoke and surface `.feature` file, but did not fix them because the scope guard forbids edits under `features/regression/step_definitions/**`. The contradiction (validation requires green, scope guard forbids the only fix surface) must be resolved before this PR can satisfy spec §8.

**Solution:** Adopt resolution option **(ii)** from the reviewer's three-option set — extend #492's scope by exactly the three surgical step-def edits enumerated in the review. This is the only option that satisfies spec §8's MUST-PASS bar:

- Option (i) "reopen #491" requires re-opening a merged sibling issue and blocks #492's merge until #491 ships a follow-up; net change to the codebase is the same three edits, but the workflow cost is much higher.
- Option (iii) "accept the deferral" leaves the regression suite RED and contradicts spec §8's "Must pass (modulo any `# DEFERRED-VOCAB-GAP:` partial scenarios, which must still pass; the deferral marker is documentation, not a skip directive)." The spec sanctions VOCAB-GAP deferrals only when the scenario still passes; runtime-gap deferrals that fail at exit 1 are not sanctioned.
- Option (ii) is the smallest code change that satisfies validation: three targeted edits in three files, scope-extension noted in the PR description so the reviewer can sign off on the deviation from the original "no edits to features/regression/step_definitions/**" guard.

## Files to Modify
Use these files to implement the patch:

- `features/regression/step_definitions/whenSteps.ts` — fix subprocess argv order (gap a) and switch the cron-probe spawn to honour the same env overlay so it reaches the mock GitHub server (partial fix for gap b on the cron path).
- `features/regression/step_definitions/givenSteps.ts` — set `GH_HOST` / `GITHUB_API_URL` overrides on the harness env when G1 / G4 / G7 / G8 / G10 wire up the mock server, so any orchestrator code path that resolves issue data via `gh` or `https://api.github.com/...` is redirected to `mockContext.serverUrl` (gap b).
- `features/regression/step_definitions/thenSteps.ts` — fix T1 and T9 to resolve the state file from the orchestrator's production location (`agents/{adwId}/state.json` relative to the repo root) before falling back to the G11 temp worktree (gap c).
- `specs/issue-492-adw-2evbnk-bdd-rewrite-2-3-auth-sdlc_planner-bdd-authoring-smoke-surface-scenarios.md` — append a "Scope amendment" subsection under "Notes" recording the reviewer-sanctioned scope extension and the three edits taken.
- `features/regression/smoke/*.feature` and `features/regression/surfaces/*.feature` — remove the `# DEFERRED-RUNTIME-GAP:` comment blocks now that the underlying gaps are fixed (these are documentation only — no scenario step text changes).

Out-of-scope (do NOT modify): `adws/**`, `cucumber.js`, `features/regression/vocabulary.md`, `features/regression/step_definitions/world.ts`, `features/regression/support/hooks.ts`, `features/step_definitions/loadRegressionSteps.ts`, `test/mocks/**`, `test/fixtures/**`, manifests under `test/fixtures/jsonl/manifests/**`. The patch is strictly the three step-def files above plus the comment-block removals and the spec-notes amendment.

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Confirm the orchestrator argv contract (gap a)

- Open the eleven orchestrators referenced by `ORCHESTRATOR_FILES` in `whenSteps.ts:50–62` (`adwSdlc.tsx`, `adwPlan.tsx`, `adwBuild.tsx`, `adwTest.tsx`, `adwReview.tsx`, `adwMerge.tsx`, `adwChore.tsx`, `adwPatch.tsx`, `adwInit.tsx`, `adwPrReview.tsx`, `adwDocument.tsx`).
- For each, locate the `process.argv[2]` / `process.argv[3]` consumption (typically near the top of the file or in the script's main function). Confirm whether the canonical order is `(issueNumber, adwId)` or `(adwId, issueNumber)` — read-only inspection; do **not** edit the orchestrators.
- If the canonical order disagrees across orchestrators, the patch must normalise via the `ORCHESTRATOR_FILES` map by extending it from `Record<string, string>` to `Record<string, { file: string; argvOrder: 'issueFirst' | 'adwIdFirst' }>` and branching inside `spawnOrchestrator`. If they agree (likely `issueNumber` first per the reviewer's claim), the fix is a single-line argv re-order.

### Step 2: Apply gap-a fix in `whenSteps.ts`

- In `spawnOrchestrator` (currently `whenSteps.ts:28–44`), swap the argv tuple so the order matches the orchestrators' `process.argv` consumption confirmed in Step 1. Concretely, change `[resolve(ROOT, 'adws/${orchestratorFile}'), adwId, String(issueNumber)]` to `[resolve(ROOT, 'adws/${orchestratorFile}'), String(issueNumber), adwId]` (or to the per-orchestrator branch if Step 1 found heterogeneity).
- Verify W1 by spot-running one smoke scenario locally (e.g., `NODE_OPTIONS="--import tsx" bunx cucumber-js features/regression/smoke/adw_sdlc_happy_path.feature`) and confirming the orchestrator process actually receives the right arguments (you can `console.error` from inside the orchestrator's argv parsing temporarily, then revert that probe).

### Step 3: Redirect orchestrator GitHub API calls to the mock server (gap b)

- In `givenSteps.ts`, locate G1 (`the mock GitHub API is configured to accept issue comments`) at `givenSteps.ts:27–35`. After the existing `setState({})` call, append the mock-server URL to `this.harnessEnv` under both `GH_HOST` (the `gh` CLI's host override) and `GITHUB_API_URL` (the env var honoured by the orchestrators' direct REST callers).
- Repeat the same env-overlay extension in G4 (`givenSteps.ts:69–86`), G7 (`givenSteps.ts:133–140`), G8 (`givenSteps.ts:146–152`), and G10 (`givenSteps.ts:173–188`) — these are the five Givens that activate the mock server's recording state. Storing the URL on `harnessEnv` ensures every subsequent W1/W10/W11 subprocess inherits it via `buildSubprocessEnv` (`whenSteps.ts:20–25`).
- Strip the `https://` scheme for `GH_HOST` (the `gh` CLI expects host:port without scheme); keep the full URL for `GITHUB_API_URL`.
- If the `fetchGitHubIssue` helper the reviewer references has additional implicit endpoints (e.g., `https://api.github.com/graphql`), also export a third env var (e.g., `GITHUB_GRAPHQL_URL`) with the matching mock path so GraphQL queries route to the mock too. Search `adws/github/**` for the GraphQL call site to confirm the right env-var name.

### Step 4: Fix the state-file resolution path in T1/T9 (gap c)

- In `thenSteps.ts`, replace the `worktreePaths.get(adwId)` lookup in T1 (`thenSteps.ts:25–44`) and T9 (`thenSteps.ts:201–219`) with a resolver that prefers the production location and falls back to the G11 temp worktree only when the production location does not exist. Concretely:
  ```ts
  const productionStateFile = resolve(ROOT, `agents/${adwId}/state.json`);
  const worktreeStateFile = worktreePath ? join(worktreePath, '.adw', 'state.json') : null;
  const stateFile = existsSync(productionStateFile)
    ? productionStateFile
    : worktreeStateFile;
  assert.ok(stateFile && existsSync(stateFile), `State file not found at ${productionStateFile} (production) or ${worktreeStateFile} (G11 temp worktree)`);
  ```
- Add the matching `import { resolve, dirname } from 'path'` and `import { fileURLToPath } from 'url'` plus a `__dirname` / `ROOT` constant computation at the top of `thenSteps.ts` (mirroring the pattern already in `whenSteps.ts:16–17`).
- Note: this resolver is intentionally fallback-aware so that scenarios using G6 (which pre-seeds a state file in a temp dir, not under `agents/`) continue to pass against the seeded path.

### Step 5: Sweep the DEFERRED-RUNTIME-GAP comment blocks

- For every `.feature` file under `features/regression/smoke/` and `features/regression/surfaces/` that contains a `# DEFERRED-RUNTIME-GAP:` comment (~36 files per the Step 1 reconnaissance grep), delete the comment block but leave the scenario body, tags, and any unrelated comments (including `# DEFERRED-VOCAB-GAP:`) intact.
- Do NOT delete `# DEFERRED-VOCAB-GAP:` comments — those are sanctioned by the spec and remain accurate.
- Do NOT delete the `# NOTE:` block in `features/regression/smoke/adw_sdlc_happy_path.feature:7–9` referring to the worktree-path-vs-agents-path divergence — replace it with a single line that reads `# T1 resolves the orchestrator state file at agents/{adwId}/state.json (production location); the G11 worktree is used only as a fallback for G6-seeded scenarios.`

### Step 6: Append a scope-amendment note to the spec

- Open `specs/issue-492-adw-2evbnk-bdd-rewrite-2-3-auth-sdlc_planner-bdd-authoring-smoke-surface-scenarios.md`.
- Under the existing `## Notes` section (after the last bullet), append a new subsection titled `### Scope amendment (post-build patch)` that records:
  - The original scope guard (line 44: "no new step-def implementations").
  - The reviewer's sanction (post-build review) of three surgical edits.
  - The exact files touched: `whenSteps.ts` (argv order), `givenSteps.ts` (env overlay for mock GitHub URL), `thenSteps.ts` (state-file path resolver).
  - A pointer to this patch file: `specs/patch/patch-adw-2evbnk-bdd-rewrite-2-3-auth-fix-regression-runtime-gaps.md`.

## Validation
Execute every command to validate the patch is complete with zero regressions.

- `bun run lint` — type/style passes (the three step-def files are the only TypeScript edits).
- `bunx tsc --noEmit` — host type-check passes (catches any wrong import path or wrong argv-tuple type).
- `bunx tsc --noEmit -p adws/tsconfig.json` — adws/ project type-check unchanged.
- `bun run test:unit` — vitest still green (no test changes; manifestInterpreter test from #491 unaffected).
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression and @smoke"` — all 6 smoke scenarios PASS (this is the primary validation; previously RED with `AssertionError: State file artefact not found ...` and `Expected a POST to /issues/300/comments but none was recorded`).
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression and @surface"` — all 35 surface scenarios PASS (previously RED with the same argv/mock-routing failure modes).
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — combined run PASSES with zero failures and zero "Undefined" steps. This is the spec §8 MUST-PASS gate.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js` — full suite (legacy `features/*.feature` + new `features/regression/**/*.feature`) passes; no regression in the legacy suite.
- `git diff --name-only main...HEAD` — confirm the post-patch change set is exactly: the three `features/regression/step_definitions/*.ts` files; the ~36 `.feature` files (comment removal only); the spec amendment; and this patch file. No edits to `adws/**`, `cucumber.js`, `vocabulary.md`, `world.ts`, `hooks.ts`, `loadRegressionSteps.ts`, `test/mocks/**`, or `test/fixtures/**`.

## Patch Scope
**Lines of code to change:** ~50 lines of step-def edits (≤10 in `whenSteps.ts`, ~25 in `givenSteps.ts` for the env-overlay extension across five Givens, ~15 in `thenSteps.ts` for the resolver + imports). Plus ~70 lines of comment-block deletions across ~36 `.feature` files (mechanical sweep, no scenario text touched). Plus ~15 lines of spec amendment.

**Risk level:** medium. Gap (a) is a one-line fix with low risk. Gap (c) introduces a fallback resolver — moderate risk if the production path resolution differs from what `agents/{adwId}/state.json` actually contains across orchestrators (Step 1 reconnaissance must confirm). Gap (b) is the highest risk: env-var-based redirection of `gh` and direct REST callers depends on the orchestrators uniformly honouring `GH_HOST` / `GITHUB_API_URL`; if any code path hard-codes `https://api.github.com`, that path will still bypass the mock and need a follow-up patch.

**Testing required:** The full `@regression` cucumber run is the validation gate. Iterate on Step 3 if any scenario still records zero requests at the mock server after the env overlay — that signals an additional unhandled GitHub API code path that needs the same env-var treatment.

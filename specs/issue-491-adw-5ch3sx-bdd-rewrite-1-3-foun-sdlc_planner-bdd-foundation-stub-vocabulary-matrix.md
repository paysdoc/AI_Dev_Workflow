## Metadata
issueNumber: `491`
adwId: `5ch3sx-bdd-rewrite-1-3-foun`
issueJson: `{"number":491,"title":"BDD rewrite (1/3): foundation — programmable stub + vocabulary registry + surface matrix","state":"OPEN","author":"paysdoc","labels":["hitl"],"createdAt":"2026-04-25T12:15:43Z"}`

# Chore: BDD rewrite (1/3) — programmable stub + vocabulary registry + surface matrix

## Chore Description

This is migration issue 1 of 3 for the BDD rewrite to a tiered regression suite (parent PRD: `specs/prd/bdd-rewrite-tiered-regression.md`).

It lays the **foundation** of the rewrite — no scenarios, no CI behavior changes, no production-code edits in `adws/`. Three deliverables:

1. **Programmable claude-cli-stub.** Extend `test/mocks/claude-cli-stub.ts` with a sidecar manifest mechanism. The stub already streams JSONL keyed by `MOCK_FIXTURE_PATH`; we add a second env var (e.g. `MOCK_MANIFEST_PATH`) pointing at a JSON manifest that declares: (a) the JSONL/payload to stream, and (b) a list of file edits the stub applies to a target worktree before streaming begins. The interpreter is extracted as a deep module `test/mocks/manifestInterpreter.ts` with the stable signature:
   ```ts
   export function applyManifest(
     manifestPath: string,
     worktreePath: string,
   ): { editsApplied: string[]; jsonlPath: string };
   ```
   A vitest unit test covers four cases: well-formed manifest, malformed manifest (parse / schema error), no-op manifest (no edits), conflicting edits (same target path written twice).

2. **Vocabulary registry.** Create `features/regression/vocabulary.md` registering 25–35 canonical Gherkin phrases organized into Given (mock setup) / When (orchestrator/phase invocation) / Then (state-file / mock-recorded / artifact assertions). Each phrase corresponds to exactly one step-def implementation and obeys the rot-detection rubric (no file-shape, no content-shape, no structural file assertions).

3. **Step-def implementations.** Create `features/regression/step_definitions/` with one TypeScript implementation per registered phrase. Each step def must use exactly one of three permitted execution patterns:
   - spawn a real orchestrator subprocess and assert against state files / mock-recorded GitHub calls / branch artifacts;
   - import a phase function from `adws/phases/` and call it against a mocked `WorkflowConfig`, asserting state mutation;
   - query the mock harness's recorded interactions (mock-server requests, git-mock invocations).

4. **Surface matrix planning doc.** Create `specs/prd/bdd-rewrite-surface-matrix.md` enumerating ~30–60 surface cells (orchestrator path × phase wiring, with happy / error / edge variants where they matter). Each cell names the vocabulary phrases its top-level scenario would compose from. **No `.feature` files are authored** — those land in Issue #2.

5. **Hard-deadline string in PR description.** The PR body must include verbatim:
   > Hard deadline: PR1 merge date + 6 weeks. If the cutover PR (Issue #3) does not merge by this date, this PR and the authoring PR (Issue #2) will be reverted.

**Scope guard (acceptance criteria):** No `.feature` files under `features/regression/smoke/` or `features/regression/surfaces/`. No edits to `cucumber.js`, `.claude/commands/scenario_writer.md`, `.claude/commands/generate_step_definitions.md`, `adws/core/projectConfig.ts`, or any cron probe. No production code modified outside `test/mocks/`, `features/regression/`, and the surface matrix planning doc. (Note: `vitest.config.ts` may need a minor `include` glob extension so the new unit test is discovered — this is a test-config touch, not production code; see the Notes section.)

## Relevant Files

Use these files to resolve the chore:

- `test/mocks/claude-cli-stub.ts` — current stub. Extend to call `applyManifest()` when `MOCK_MANIFEST_PATH` is set; behavior unchanged when only `MOCK_FIXTURE_PATH` is set (back-compat).
- `test/mocks/test-harness.ts`, `test/mocks/types.ts`, `test/mocks/git-remote-mock.ts`, `test/mocks/github-api-server.ts` — read-only; understand the existing harness shape so the manifest interpreter integrates cleanly with current callers.
- `test/fixtures/jsonl/envelopes/`, `test/fixtures/jsonl/payloads/` — existing JSONL fixture layout that the manifest's `jsonlPath` field will reference.
- `features/step_definitions/claudeCliStubSteps.ts` — illustrates how the stub is currently exercised; useful background, not modified.
- `features/step_definitions/commonSteps.ts` — read-only reference for shared step phrasing already in use.
- `cucumber.js` — read-only. Confirms cucumber discovers `features/**/*.feature` and step defs from `features/step_definitions/**/*.ts`. Our new `features/regression/step_definitions/**/*.ts` will need to be either co-located under `features/step_definitions/` OR registered via cucumber's `import` glob in a follow-up issue. **For Issue #1, place the regression step defs under `features/regression/step_definitions/` per the issue spec; do NOT modify `cucumber.js` (forbidden by acceptance criteria — wiring lands in Issue #3).**
- `vitest.config.ts` — currently scopes test discovery to `adws/**/__tests__/**`. Extend the `include` glob to also pick up `test/mocks/__tests__/**/*.test.ts` so the manifest-interpreter unit test runs under `bun run test:unit`. (Borderline scope; see Notes.)
- `guidelines/coding_guidelines.md` — TypeScript strict, single-responsibility, files under 300 lines, immutability, isolate side effects. The interpreter must be a pure function returning a result object; file-system writes are the only intentional side effect and live at the boundary.
- `.adw/commands.md` — validation commands (`bun run lint`, `bunx tsc --noEmit`, `bunx tsc --noEmit -p adws/tsconfig.json`, `bun run test:unit`, `bun run build`).
- `adws/phases/index.ts` and individual phase files (`buildPhase.ts`, `planPhase.ts`, `reviewPhase.ts`, `prPhase.ts`, `autoMergePhase.ts`, `workflowInit.ts`, etc.) — read-only. The vocabulary's "When" phrases name these phase functions; the surface matrix enumerates orchestrator × phase combinations.
- `adws/adwSdlc.tsx`, `adws/adwPlan.tsx`, `adws/adwBuild.tsx`, `adws/adwTest.tsx`, `adws/adwReview.tsx`, `adws/adwMerge.tsx`, `adws/adwChore.tsx`, `adws/adwPatch.tsx`, `adws/adwInit.tsx`, `adws/adwPrReview.tsx`, `adws/adwDocument.tsx` — read-only. Orchestrator paths feed the rows of the surface matrix.

### New Files

- `test/mocks/manifestInterpreter.ts` — pure module exporting `applyManifest(manifestPath, worktreePath)`. Reads + parses the manifest JSON, validates schema, applies declared file edits to `worktreePath`, returns `{ editsApplied, jsonlPath }`. Throws typed errors for malformed manifests and conflicting edits (same target written twice in one manifest).
- `test/mocks/__tests__/manifestInterpreter.test.ts` — vitest covering the four cases (well-formed / malformed / no-op / conflicting edits). Uses `tmpdir()` for the worktree fixture; cleans up after each case.
- `features/regression/vocabulary.md` — Markdown table or sectioned doc registering 25–35 phrases under Given / When / Then headings, with one-line semantics for each (what the phrase does, what it asserts, which execution pattern it uses).
- `features/regression/step_definitions/<one file per phrase or one cohesive file per category>.ts` — one implementation per registered phrase. Suggested grouping: `givenSteps.ts` (mock-setup), `whenSteps.ts` (orchestrator/phase invocation), `thenSteps.ts` (state/mock/artifact assertions). Each implementation honors the rot-detection rubric.
- `features/regression/step_definitions/world.ts` (optional) — typed cucumber `World` extending the existing test-harness world with regression-specific recorded-interaction handles (mock server, git-mock, state-file paths).
- `specs/prd/bdd-rewrite-surface-matrix.md` — table of 30–60 surface cells. Columns: Orchestrator | Phase | Variant (happy / error / edge) | Composing vocabulary phrases | Notes.

## Step by Step Tasks

IMPORTANT: Execute every step in order, top to bottom.

### 1. Read parent PRD and confirm scope

- Locate `specs/prd/bdd-rewrite-tiered-regression.md`. If absent, surface to the operator immediately — the issue references it as the source of architectural context (esp. the "Implementation Decisions" section). **Do not invent the PRD; if missing, pause for operator clarification.**
- Re-read the issue body's rot-detection rubric and the three permitted execution patterns. Internalize the forbidden patterns (`existsSync`, `readFileSync(...).includes(...)`, structural JSON.parse assertions, file-shape assertions).

### 2. Design the manifest schema

- Define the manifest JSON shape. Suggested:
  ```jsonc
  {
    "jsonlPath": "test/fixtures/jsonl/payloads/plan-agent.json",
    "edits": [
      { "path": "relative/from/worktree.ts", "contents": "<new file contents>" }
      // OR { "path": "...", "patch": "<unified diff>" } — pick ONE strategy; recommend full-contents for simplicity
    ]
  }
  ```
- Decide: full-contents writes only (simplest, deterministic, easy to validate "conflicting edits" as duplicate `path`). Document the chosen strategy at the top of `manifestInterpreter.ts`.
- Decide on env var name: `MOCK_MANIFEST_PATH` (parallel to existing `MOCK_FIXTURE_PATH`).

### 3. Build `test/mocks/manifestInterpreter.ts`

- Pure function: `applyManifest(manifestPath: string, worktreePath: string): { editsApplied: string[]; jsonlPath: string }`.
- Parse manifest JSON. Validate shape with a small in-file type guard (no zod / no new dependency). Throw `Error('manifestInterpreter: malformed manifest at <path>: <reason>')` on failure.
- Check for conflicting edits (duplicate `path` values). Throw `Error('manifestInterpreter: conflicting edits for <path>')` on collision.
- For each edit, resolve the absolute path under `worktreePath`, ensure the parent dir exists (`mkdirSync(..., { recursive: true })`), and write the new contents.
- Return `{ editsApplied: [...absolute paths in order], jsonlPath: resolve(worktreePath, manifest.jsonlPath) }` or — if `jsonlPath` is already absolute — return as-is.
- Keep file under 150 lines; single responsibility; isolate fs side effects in one helper.

### 4. Wire the interpreter into `claude-cli-stub.ts`

- At the top of `main()`, read `process.env['MOCK_MANIFEST_PATH']`. If set:
  - Resolve `worktreePath` from `process.env['MOCK_WORKTREE_PATH']` (new env var) or fall back to `process.cwd()`.
  - Call `applyManifest(manifestPath, worktreePath)`. Use the returned `jsonlPath` to override `selectPayloadPath()` for this invocation.
- If `MOCK_MANIFEST_PATH` is not set, behavior is unchanged (back-compat — existing fixtures keep working without a manifest).
- Surface interpreter errors to stderr and exit non-zero (already the existing pattern in `main()`).

### 5. Write the vitest unit test

- Create `test/mocks/__tests__/manifestInterpreter.test.ts`.
- Use `mkdtempSync(join(tmpdir(), 'manifest-test-'))` for the worktree per case; clean up in `afterEach`.
- Cases:
  1. **Well-formed manifest:** two edits, distinct paths. Assert `editsApplied.length === 2`, both files exist with expected contents, `jsonlPath` resolves under the worktree.
  2. **Malformed manifest:** invalid JSON file. Assert it throws with `manifestInterpreter:` prefix.
  3. **No-op manifest:** valid manifest with `edits: []`. Assert `editsApplied.length === 0`, `jsonlPath` still resolved correctly, no files written.
  4. **Conflicting edits:** two entries with the same `path`. Assert it throws with `conflicting edits` message; assert no partial writes leaked (state of worktree unchanged).
- Do not test the stub-process integration here — that belongs in a follow-up regression scenario (Issue #2).

### 6. Extend `vitest.config.ts` to discover the new test

- Add `'test/mocks/__tests__/**/*.test.ts'` to the `include` array. Verify `bun run test:unit` picks it up. (See Notes — this is the only file outside `test/mocks/` and `features/regression/` we touch; flag explicitly in the PR description.)

### 7. Author `features/regression/vocabulary.md`

- Header: brief statement of the rot-detection rubric and the three permitted execution patterns (one paragraph each, copied / restated from the issue body for self-containment).
- Three sections: **Given** (mock setup, ~8–12 phrases), **When** (orchestrator/phase invocation, ~8–12 phrases), **Then** (state / mock / artifact assertions, ~9–11 phrases). Total: 25–35.
- Suggested phrases (illustrative — finalize during authoring; aim for orthogonal coverage of orchestrator × phase):
  - **Given:** "the mock GitHub API is configured to accept issue comments", "the git-mock has a clean worktree at branch {string}", "the claude-cli-stub is loaded with manifest {string}", "an issue {int} exists in the mock issue tracker", "no spawn lock exists for issue {int}", "a state file exists for adwId {string} at stage {string}", "the cron sweep is configured with empty queue", "the mock GitHub API records all PR-list calls", ...
  - **When:** "the {orchestrator} orchestrator is invoked with adwId {string} and issue {int}", "the {phase} phase function is imported and called with config {string}", "the cron probe runs once", "the webhook handler receives a {string} event for issue {int}", ...
  - **Then:** "the state file for adwId {string} records workflowStage {string}", "the mock GitHub API recorded a comment containing issue link to {int}", "the git-mock recorded a commit on branch {string}", "the orchestrator subprocess exited {int}", "the spawn-gate lock for issue {int} is released", "the mock harness recorded zero PR-merge calls", ...
- For each phrase, include a one-line note: which execution pattern (subprocess / phase-import / mock-query) and which assertion target (state file / mock-recorded call / branch artifact). The phrase MUST be expressible without referring to file paths, file contents, or string presence.

### 8. Implement step definitions in `features/regression/step_definitions/`

- One implementation per registered phrase. Suggested file split: `givenSteps.ts`, `whenSteps.ts`, `thenSteps.ts`, `world.ts`.
- Each implementation MUST use one of the three permitted patterns:
  - **Subprocess:** `spawnSync('bun', ['adws/<orchestrator>.tsx', adwId, issueNumber], { env: harnessEnv })` and assert against state files written by the orchestrator and recorded interactions in the mock servers.
  - **Phase import:** `import { <phaseFn> } from 'adws/phases/<phaseFile>'`, build a mocked `WorkflowConfig`, call it, assert state mutation via the returned config / state writes the harness can read.
  - **Mock query:** call the test-harness's `mockServer.recordedRequests()` / `gitMock.recordedInvocations()` accessors and assert against the recorded sequence.
- Forbidden in step defs (will fail rubric review):
  - `existsSync`, `accessSync`, `statSync` (file shape assertions).
  - `readFileSync(...).includes(...)` (content-substring shape assertions).
  - `JSON.parse(readFileSync(...)).<key>` to assert a structural property of a source file.
  - Any read of a source file under `adws/`, `Dockerfile`, config, etc. to assert "the code looks right".
- State-file reads ARE permitted when the state file is the *output of an orchestrator under test* (it's an artifact, not a source file). Document this distinction in `vocabulary.md`.
- Keep each step file under 300 lines (coding guideline). If a category exceeds, split by sub-theme.

### 9. Author `specs/prd/bdd-rewrite-surface-matrix.md`

- Header: one-paragraph context (this is the planning doc for Issue #2 scenario authoring; matrix cells map to top-level scenarios).
- Markdown table with columns: **Orchestrator** | **Phase** | **Variant (happy / error / edge)** | **Composing vocabulary phrases** | **Notes / preconditions**.
- Rows: 30–60 cells. Cover the SDLC orchestrators (`adwSdlc`, `adwPlan`, `adwBuild`, `adwTest`, `adwReview`, `adwMerge`, `adwChore`, `adwPatch`, `adwInit`, `adwPrReview`, `adwDocument`) × their key phases (`workflowInit`, `worktreeSetup`, `planPhase`, `buildPhase`, `reviewPhase`, `prPhase`, `autoMergePhase`, `documentPhase`, `installPhase`, `kpiPhase`, etc.). Mark variants only where they meaningfully differ (don't pad to 60 — quality over count).
- Each cell's "Composing vocabulary phrases" column references phrases by their exact text from `vocabulary.md`. This is the rot-detection check: if a cell can't be expressed in vocabulary phrases, either the cell isn't `@regression` material or the vocabulary is missing a phrase.
- Final section: gaps / open questions for Issue #2 authoring (e.g. orchestrators that need new vocabulary phrases, variants intentionally deferred).

### 10. Compose the PR description

- Include the verbatim hard-deadline string at the top of the PR body:
  > Hard deadline: PR1 merge date + 6 weeks. If the cutover PR (Issue #3) does not merge by this date, this PR and the authoring PR (Issue #2) will be reverted.
- Summarize the four deliverables and call out the `vitest.config.ts` `include`-glob extension as the only out-of-scope-looking touch (with rationale).

### 11. Self-review against the rubric

- Walk every step-def file. Grep for `existsSync(`, `accessSync(`, `statSync(`, `.includes(`, `JSON.parse(readFileSync`. If any hit lands in a step def asserting on source files, fix it before validation.
- Walk every vocabulary phrase. Confirm none reference file paths, file contents, or string presence in their semantics line.
- Confirm no `.feature` files were created under `features/regression/`.
- Confirm `cucumber.js`, `.claude/commands/scenario_writer.md`, `.claude/commands/generate_step_definitions.md`, `adws/core/projectConfig.ts`, and cron-probe sources are unchanged (`git diff` shows no entries for these paths).

### 12. Run validation commands

- Run every command listed under "Validation Commands" below. All must pass.

## Validation Commands

Execute every command to validate the chore is complete with zero regressions.

- `bun install` — refresh dependencies (no new packages expected; confirm).
- `bun run lint` — ESLint passes on new and existing TypeScript files.
- `bunx tsc --noEmit` — root TypeScript compiles cleanly (covers `test/mocks/manifestInterpreter.ts`, `test/mocks/__tests__/manifestInterpreter.test.ts`, `features/regression/step_definitions/**`).
- `bunx tsc --noEmit -p adws/tsconfig.json` — adws subproject still compiles (sanity; we shouldn't have touched it).
- `bun run test:unit` — vitest discovers and passes the new manifest-interpreter unit test (4 cases) plus all existing unit tests with zero regressions.
- `bun run build` — the build step succeeds.
- `git diff --name-only dev...HEAD` — confirm all modified / new files live under `test/mocks/`, `features/regression/`, `specs/prd/bdd-rewrite-surface-matrix.md`, plus the one allowed `vitest.config.ts` include-glob extension. No file under `adws/`, `cucumber.js`, `.claude/commands/scenario_writer.md`, `.claude/commands/generate_step_definitions.md`, or any cron probe should appear.
- `find features/regression -name '*.feature'` — must return zero results (acceptance criterion: no scenarios in this issue).

## Notes

- **Strict adherence to coding guidelines:** TypeScript strict mode (no `any`), files under 300 lines, single responsibility, immutability where reasonable, isolate side effects. The manifest interpreter is a pure function modulo its declared file-write side effect; document that boundary in a top-of-file comment.
- **`vitest.config.ts` touch:** This is the only file outside `test/mocks/`, `features/regression/`, and the surface-matrix PRD that we modify. It's a test-config change (not production code in `adws/`) and is necessary so the new unit test is discovered. Acceptance criteria forbid `cucumber.js` and `adws/core/projectConfig.ts` specifically; `vitest.config.ts` is not on the forbidden list. Call it out explicitly in the PR description so reviewers can challenge it.
- **`cucumber.js` discovery:** Cucumber's `import` glob is `features/step_definitions/**/*.ts` — our new step defs under `features/regression/step_definitions/` are NOT discovered by the current cucumber config. This is intentional for Issue #1 (no scenarios → no cucumber runs against the new step defs). Wiring lands in Issue #3 as part of the cutover. Do NOT modify `cucumber.js` to fix discovery — it's explicitly forbidden by the acceptance criteria.
- **Parent PRD missing:** As of plan-authoring time, `specs/prd/bdd-rewrite-tiered-regression.md` does not exist in this worktree. The implementer should confirm with the operator before proceeding — the issue body is detailed enough to begin work, but the PRD's "Implementation Decisions" section is referenced as the source of architectural context and may contain constraints not visible from the issue alone.
- **Hard-deadline string:** Must be placed in the *PR description*, not in any committed file. The `pull_request` slash command builds the body from commit messages and plan output; the implementer should ensure the deadline string is included verbatim when the PR is created.
- **HITL label:** This issue is labeled `hitl` — the PR will block on human review of the vocabulary, surface matrix, and rot-rubric compliance before merge (per the `hitl_label_gate_automerge` feature in this repo).
- **Rot rubric is the gate:** Both the vocabulary phrases and the step-def implementations must withstand the rubric. A phrase that says "the Dockerfile contains a `FROM bun` line" is not regression material — it asserts file shape. A phrase that says "a container started with the bun runtime recorded a successful health check" is regression material — it asserts the system did something observable.

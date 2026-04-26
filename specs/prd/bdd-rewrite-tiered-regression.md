# BDD Rewrite: Tiered Regression Suite with Fixed Vocabulary

## Problem Statement

The ADW codebase has 119 BDD feature files containing thousands of scenarios, ~115 of them tagged `@regression`. In practice, the suite is glorified linting: most step definitions are file-existence assertions (`existsSync`, `readFileSync(...).includes(...)`, structural JSON parsing for "looks right"), not behavioral tests. The Docker isolation infrastructure exists but is bypassed by structural fallbacks in step defs that make scenarios pass even when Docker is unavailable. The mock harness (`test/mocks/`) — which contains a real Claude CLI stub, GitHub API mock server, and git remote mock — is barely used by the scenarios themselves.

The system that produces this rot is structural, not accidental:

1. The `scenario_writer` agent generates `@adw-{N}` features per issue with no constraint to write behavioral Given/When/Then.
2. The `generate_step_definitions` agent dutifully implements file-shape assertions whenever scenarios say "Given X exists."
3. The `scenario_writer` "@regression maintenance sweep" promotes everything; nothing demotes.
4. PRs containing such step defs pass review individually because each looks plausible; rot is cumulative, not per-PR.

Net effect: phase coordination bugs (e.g., "`adwChore` silently skipped diff evaluation") would not be caught by the test suite. The user lacks confidence that the BDD layer is earning its keep.

## Solution

Rewrite the BDD layer with three changes that operate together:

**Tiered tags with folder split.** `@regression` becomes the hand-curated behavioral suite under `features/regression/`. `@adw-{N}` becomes per-issue agent-input spec only, under `features/per-issue/`, retired by a 14-day cron sweep after PR merge. The two roles never overlap, never share a folder, never share a quality bar.

**Fixed vocabulary DSL** as the structural drift-prevention mechanism. ~25–35 canonical Gherkin phrases registered in `features/regression/vocabulary.md`, each with one step-def implementation against the mock harness. The `generate_step_definitions` prompt is polymorphic on `.adw/scenarios.md` config: when a vocabulary registry is declared, step defs may compose only from registered phrases; absent a registry, current free-form behavior is preserved (target-repo backward compatibility).

**Hybrid execution model.** 3–5 smoke tests subprocess real orchestrators against an extended programmable Claude CLI stub (sidecar manifest applies file edits per phase, then streams canned JSONL). ~30–60 surface scenarios import phase functions directly and assert against mocked `WorkflowConfig`. The harness extension is in-scope as non-production work; production code in `adws/` is not modified.

Migration is a 3-PR sequenced BIG BANG with hard deadline (revert PRs 1–2 if PR3 misses the date). Each PR is a chore-classified issue (forces `adwChore`, which does not invoke `scenario_writer`, avoiding self-sabotage). Each issue body contains an explicit rot-detection rubric. After cutover, `features/regression/` is a branch protection rule blocking all PRs (human and ADW).

## User Stories

1. As an ADW developer, I want CI to fail when a PR introduces a phase coordination bug (e.g., `adwChore` silently skips diff evaluation), so that wiring regressions are caught before merge instead of being shipped to production.
2. As an ADW developer, I want a behavioral smoke test that exercises a full `adwSdlc` happy path end-to-end against mocks, so that broad cross-phase contract breaks are caught by a single test.
3. As an ADW developer, I want a behavioral smoke test for `adwChore` covering both `safe` and `regression_possible` diff verdicts, so that the chore pipeline's verdict-driven branching is validated.
4. As an ADW developer, I want a behavioral smoke test for `trigger_cron` picking up a new issue and spawning the correct orchestrator, so that the control-plane classification + spawn path is validated.
5. As an ADW developer, I want a behavioral smoke test for pause/resume around rate-limit detection, so that the `pauseQueue` + heartbeat + takeover composition is validated.
6. As an ADW developer, I want a behavioral smoke test for the `## Cancel` directive flow, so that the scorched-earth recovery path is validated.
7. As an ADW developer, I want surface-coverage scenarios for each orchestrator path × phase wiring, so that I can enumerate which surfaces are tested versus untested without reading every feature file.
8. As an ADW developer, I want a fixed vocabulary registry that the step-definition generator agent must compose from, so that drift back to file-shape assertions cannot occur silently.
9. As an ADW developer reviewing a PR, I want an explicit rot-detection rubric to check against, so that "I'll review" has a fixed bar instead of vibes.
10. As an ADW developer, I want `@adw-{N}` per-issue scenarios deleted automatically 14 days after PR merge, so that the working tree does not accumulate dead-weight feature files.
11. As an ADW developer, I want re-opens of merged issues to regenerate per-issue scenarios via the scenario-writer agent, so that the 14-day deletion does not block recovery work.
12. As an ADW developer, I want `features/regression/` to be a branch-protected required check on all PRs, so that human and ADW-generated PRs share the same regression bar.
13. As an ADW developer, I want the `claude-cli-stub` to be programmable via per-test sidecar manifests, so that smoke tests can exercise real orchestrator subprocesses against meaningful canned conversations.
14. As an ADW developer, I want the manifest interpreter to be extractable as a deep module with a unit test, so that fixture-format mistakes can be caught without standing up the full BDD harness.
15. As an ADW developer, I want surface-coverage scenarios to import phase functions directly (not subprocess), so that the surface suite runs in seconds, not minutes.
16. As an ADW developer, I want the scenario-writer agent to write per-issue scenarios into `features/per-issue/feature-{N}.feature`, so that the regression suite is never accidentally mutated by an automated workflow.
17. As an ADW developer, I want the scenario-writer agent to never tag scenarios `@regression` automatically, so that promotion to the regression suite is always a deliberate human decision.
18. As an ADW developer, I want the cron sweep predicate to be a pure function with a unit test, so that retention logic can be validated independent of GitHub state.
19. As a target-repo operator using ADW, I want `.adw/scenarios.md` to remain backward-compatible after the rewrite, so that my existing target repos continue to work without changes when the next `adw_init` runs.
20. As a target-repo operator using a non-Cucumber tool (Playwright, vitest), I want the rewrite to not impose ADW-host folder conventions on my repo, so that my chosen test framework continues to work.
21. As an ADW developer, I want the `scenario_writer` and `generate_step_definitions` prompts to be polymorphic on `.adw/scenarios.md` configuration, so that one prompt file can serve both the constrained ADW host and free-form target repos.
22. As an ADW developer, I want the migration to be 3 sequenced chore-classified issues, so that each step is independently reviewable and ADW does not self-sabotage by invoking `scenario_writer` mid-rewrite.
23. As an ADW developer, I want a hard deadline written into PR1's description, so that the discipline-forcing function exists before the double-suite period begins.
24. As an ADW developer, I want the rewrite to revert PRs 1 and 2 if PR3 misses its deadline, so that the codebase does not end up with a permanent double suite.
25. As an ADW developer, I want the surface matrix to be enumerated as a planning document committed alongside PR1, so that the test coverage axis is visible and contestable.
26. As an ADW developer, I want manual review of the agent-drafted vocabulary registry and surface matrix in PR1 to be the primary HITL gate, so that rot-v2 cannot ship under the new label.
27. As an ADW developer, I want behavioral step defs to be limited to three execution patterns (subprocess + state assertion, phase-import + state mutation, mock-recorded interaction query), so that "behavioral" has a concrete operational definition.
28. As an ADW developer, I want production code in `adws/` to be untouched by the rewrite, so that test infrastructure work cannot accidentally introduce production regressions.
29. As an ADW developer, I want `cucumber.js` scoped to `features/regression/**/*.feature` after cutover, so that per-issue agent-input scenarios are never executed by the test runner.
30. As an ADW developer, I want a written rot-detection rubric copied into the body of each migration issue, so that ADW receives prescriptive guidance and the reviewer has a fixed bar.

## Implementation Decisions

**Tag and folder architecture.**

- `@regression` and `@adw-{N}` become non-overlapping tags. A single feature file carries one or the other, never both.
- `features/regression/` holds the hand-curated behavioral suite. Subfolders: `features/regression/smoke/` (5 full-pipeline tests), `features/regression/surfaces/` (~30–60 phase-coordination tests), `features/regression/step_definitions/` (one impl per vocabulary phrase), `features/regression/vocabulary.md` (phrase registry).
- `features/per-issue/` holds agent-generated `@adw-{N}` scenarios consumed only by the validation/resolution agents during a single issue's lifecycle.
- `cucumber.js`'s `paths` glob is scoped to `features/regression/**/*.feature` after cutover; per-issue scenarios are never executed by the test runner.

**Fixed vocabulary DSL.**

- `features/regression/vocabulary.md` registers ~25–35 canonical Gherkin phrases organized by category: Given (mock setup), When (orchestrator/phase invocation), Then (state-file / mock-recorded / artifact assertions).
- Each phrase maps to exactly one step-def implementation in `features/regression/step_definitions/`.
- Adding a phrase requires a manual PR adding both the registry entry and its step-def implementation; ADW agents may not silently introduce new phrases.
- Step-def implementations may only exercise: subprocess-the-orchestrator + state/comment/artifact assertions; phase-function imports + mocked `WorkflowConfig` assertions; mock-harness recorded-interaction queries. File-shape assertions (`existsSync`, content-string-includes, structural JSON parsing for "looks right") are explicitly forbidden.

**Test execution model.**

- Smoke tests (5) subprocess the real orchestrator binary. The Claude CLI stub is extended with a sidecar manifest mechanism: each test points the stub at a manifest declaring per-phase canned text + file edits to apply to the worktree. The stub applies edits, then streams JSONL. This makes downstream phases (commit, diff eval, scenario test) see real diffs.
- Surface scenarios (~30–60) import phase functions from `adws/phases/` (already exported via `workflowPhases.ts`) and call them directly with mocked `WorkflowConfig`. No subprocess; assertions are against state mutation between phases. Targets phase coordination bugs at low cost.
- Production code in `adws/`, `adws/phases/`, `adws/agents/`, etc. is not modified. Harness extensions to `test/mocks/` are explicitly non-production.

**Lifecycle.**

- Per-issue scenarios are retired by a periodic cron probe: when an issue's `merged_at + 14 days` is past, its `features/per-issue/feature-{N}.feature` is deleted. Re-opens trigger a fresh scenario-writer run, so deletion does not block recovery.
- Cron probe pattern follows existing prior art in `adws/triggers/` (e.g., `pauseQueueScanner.ts`, `cronStageResolver.ts`, `cronRepoResolver.ts`): a pure-query predicate plus a thin cron integration shim.

**Polymorphic prompts (target-repo compatibility).**

- `.adw/scenarios.md` schema is extended with three optional sections, all backward-compatible:
  - `## Per-Issue Scenario Directory` — when present, `scenario_writer` writes per-issue features there; absent, falls back to `## Scenario Directory` (current behavior).
  - `## Regression Scenario Directory` — when present, `scenario_writer` does not auto-promote scenarios to `@regression`; absent, current behavior preserved.
  - `## Vocabulary Registry` — when present, `generate_step_definitions` composes only from registered phrases and fails on unknown phrases; absent, free-form generation (current behavior).
- `adws/core/projectConfig.ts` is extended to parse the new sections; all default to `undefined` so existing target repos continue to work after the next `adw_init` run.
- ADW host's `.adw/scenarios.md` declares all three sections post-cutover; target repos initialized today are unaffected.

**Migration (3 sequenced chore-classified issues).**

- Issue 1: extend `claude-cli-stub.ts` with manifest interpreter; create `features/regression/vocabulary.md` + step defs; produce a planning document enumerating the surface matrix. No scenarios authored yet. No behavior change to existing CI. Reviewer enforces vocabulary quality and matrix coverage against the rubric.
- Issue 2: author 5 smoke `.feature` files + their JSONL manifests; author ~30–60 surface `.feature` files. Old `features/*.feature` remain in place and continue to run. Temporary double-suite period.
- Issue 3: cutover. Delete old `features/*.feature` and obsolete step_definitions. Scope `cucumber.js` to `features/regression/**`. Make `scenario_writer.md` and `generate_step_definitions.md` polymorphic on `.adw/scenarios.md`. Add new sections to ADW host's `.adw/scenarios.md`. Add 14-day per-issue sweep cron. Document schema additions in README and `.adw/scenarios.md`.
- Each issue body contains the `/chore` directive (forces `adwChore` orchestrator, which does not invoke `scenario_writer`) and the explicit rot-detection rubric.
- Hard deadline written into PR1 description (suggested 4–6 weeks from PR1 merge). If PR3 misses, PRs 1 and 2 revert.

**CI gate.**

- Post-cutover, `features/regression/` execution becomes a required GitHub branch-protection rule on all PRs, human and ADW-generated. Branch-protection toggle is a manual operator action (not code-deliverable).

**Deep modules extracted.**

- `manifestInterpreter` (in `test/mocks/`): `applyManifest(manifestPath, worktreePath): { editsApplied: string[], jsonlPath: string }`. Encapsulates manifest schema parsing + filesystem mutation + JSONL stream selection. Stable interface; rarely changes.
- `staleScenarioFilter` (in `adws/triggers/`): `pruneStaleScenarios(perIssueDir, repoCtx, retentionDays): { removed: string[], kept: string[] }`. Pure-query predicate `isScenarioStale(filePath, mergedAt, retentionDays)` composed under a thin shim that performs deletion. Predicate is testable in isolation.

## Testing Decisions

**What makes a good test in this codebase.** A test exercises observable system behavior — state-file mutation, mock-recorded GitHub calls, git artifacts produced by real orchestrator runs, phase-function output. A test does not assert on file paths, content shape, or string presence in source/config files. The rot-detection rubric makes this concrete:

- A step def must do exactly one of: spawn an orchestrator subprocess and assert against state files / mock-recorded calls / branch artifacts; import a phase function and call it against a mocked `WorkflowConfig`, asserting state mutation; query the mock harness's recorded interactions.
- A step def must not use `existsSync`, `accessSync`, `statSync`, `readFileSync(...).includes(...)`, or structural JSON parsing of source/config files.
- A vocabulary phrase must be expressible without reference to file paths, file contents, or string presence.

**Modules that get explicit unit tests (vitest).**

- `manifestInterpreter.test.ts` — apply-edits-then-stream behavior; malformed manifest; no-op manifest; edit conflicts. Validates the deep module independent of harness setup.
- `staleScenarioFilter.test.ts` — predicate truth table over `(merged_at, now, retention_days)` cross product. Validates retention logic without GitHub round-trips.
- `projectConfig.test.ts` (existing, extended) — three new sections parsed when present; all-absent fallback returns current behavior; partial-presence handled per backward-compatibility contract.

**Modules whose tests are the BDD itself.**

- The ~25–35 vocabulary step definitions are tested by the smoke + surface scenarios that compose them. No separate unit tests; the BDD execution is the test.

**Prior art in the codebase.**

- Pure-query cron predicates: `adws/triggers/__tests__/pauseQueueScanner.test.ts`, `cronStageResolver.test.ts`, `cronRepoResolver.test.ts`. These are the patterns the new `staleScenarioFilter.test.ts` follows.
- Mock-harness setup/teardown: `test/mocks/test-harness.ts` already orchestrates mock server + stub + git mock with reversible env-var changes. Smoke tests extend the existing `setupMockInfrastructure()` pattern; surface tests use it directly.
- Phase-function imports: `adws/workflowPhases.ts` already re-exports phase functions; surface scenarios import from there following existing patterns.
- Schema-extension parsing: `adws/core/projectConfig.ts` already parses `.adw/scenarios.md` heading-based sections; new sections follow the same pattern.

## Out of Scope

- Production code in `adws/`, `adws/phases/`, `adws/agents/`, `adws/triggers/` (excluding the new sweep probe), `adws/core/` (excluding the small `projectConfig.ts` extension), `adws/github/`, etc. is not modified by this rewrite. Bugs in production code uncovered by the new behavioral suite become separate follow-up issues, not part of any of the three rewrite PRs.
- Existing target repos with their own `features/` content are not migrated. The polymorphic prompt + backward-compatible config schema means they continue to work as today; adoption of the new architecture by any target repo is a separate, optional decision by that repo's operator.
- Target repos using non-Cucumber tooling (Playwright, vitest, etc.) are not affected. The folder structure and vocabulary are Cucumber-Gherkin specific and apply only to the ADW host.
- The Docker test infrastructure (`test/Dockerfile`, `test/docker-run.sh`, `bun run test:docker`) remains as-is. The new behavioral suite is designed to run identically on host and in Docker; the Docker mode stays optional.
- Branch-protection toggle in the GitHub UI is a manual operator action, not code-deliverable.
- A separate planning document enumerating the surface matrix is committed alongside PR1 but is not part of this PRD's scope; this PRD specifies that such a document exists, not its contents.
- Migration of existing `@regression`-tagged scenarios into the new vocabulary is not attempted. The 119-feature inventory is deleted wholesale at PR3 cutover; coverage is reconstructed from the surface matrix, not lifted from the old suite.
- Demoting the existing 115 `@regression` features to `@adw-{N}` before deletion is not performed. The old features have unknown coverage value; cleanup discards them in one step.

## Further Notes

**Highest-probability failure mode.** ADW produces a vocabulary phrase that passes the rubric textually but encodes file-shape semantics in its step-def implementation (e.g., "Then the docker image is bun-based" → `content.includes('FROM oven/bun')`). Reviewer must read every step-def implementation in PR1, not only the phrase list. The vocabulary review is the single highest-leverage HITL gate in this rewrite — failure here is rot-v2 shipping under a new label.

**Second-highest-probability failure mode.** PR3 gets indefinitely deferred because PR2's double-suite "works fine enough." The hard deadline written into PR1's description is the discipline-forcing function. If PR3 misses the deadline, the user has committed to reverting PRs 1 and 2 rather than living with a permanent double suite.

**Surface matrix authoring.** The planning document committed in PR1 is drafted by the agent and reviewed by the user. The agent lacks the institutional context to weight cells correctly; reviewer must enrich/prune based on which failure modes have actually scared the team. Maximum agent autonomy on this artifact is "draft from `known_issues.md`, project memory, and orchestrator code; flag low-confidence cells for review."

**Smoke fixture authoring.** ~50–200 lines of JSONL manifest data per smoke test (~750 lines total). Not generatable from prompts alone; requires understanding of what each phase actually does. Manifests are written as part of PR2 alongside the smoke scenarios that consume them.

**Branching the work to ADW.** Each rewrite PR is a chore-classified issue (`/chore` directive in the body forces classification). This selects `adwChore` as the orchestrator, which does not invoke `scenario_writer`, avoiding the failure mode where the rewrite issue itself generates `@adw-{N}` features into the old folder mid-execution.

**Rot-detection rubric (verbatim, to be copied into each migration issue body).**

```
A step def MUST do exactly one of:
  - spawn a real orchestrator subprocess and assert against
    state files / mock-recorded GitHub calls / branch artifacts;
  - import a phase function from adws/phases/ and call it
    against a mocked WorkflowConfig, asserting state mutation;
  - query the mock harness's recorded interactions
    (mock-server requests, git-mock invocations).

A step def MUST NOT use:
  - existsSync, accessSync, statSync (file shape)
  - readFileSync(...).includes(...) (content shape)
  - JSON.parse(readFileSync(...)).<key> (structural assertion)
  - any pattern that reads source files to assert the
    code/Dockerfile/config "looks right".

A vocabulary phrase MUST be expressible without referring to
file paths, file contents, or string presence. If you can't
phrase the assertion in terms of "the system did X" or "the
state shows Y", it's not @regression material.
```

**Vocabulary draft seed (illustrative, not authoritative).** The actual registry is authored in PR1 with reviewer curation. Examples of the phrase shape expected:

- Given an issue {N} of type {string} with body {string}
- Given the Claude stub uses manifest {string} for phase {string}
- Given the GitHub mock has issue {N} with state {string}
- When orchestrator {string} is invoked for issue {N}
- When phase {string} is invoked with state {string}
- When the cron tick runs
- When the webhook receives event {string} for issue {N}
- Then the state file shows {key} as {value}
- Then a GitHub comment is posted to issue {N} matching {pattern}
- Then a PR is created against branch {pattern}
- Then phase {string} was invoked {N} times
- Then phase {string} was invoked before phase {string}
- Then the diff verdict is {string}
- Then the orchestrator exits with code {N}

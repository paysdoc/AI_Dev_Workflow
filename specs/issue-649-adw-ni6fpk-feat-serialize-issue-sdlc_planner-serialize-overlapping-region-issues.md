# Feature: Serialize issues that edit overlapping code regions instead of spawning them in parallel

## Metadata
issueNumber: `649`
adwId: `ni6fpk-feat-serialize-issue`
issueJson: `{"number":649,"title":"feat: serialize issues that edit overlapping code regions instead of spawning them in parallel","body":"## Problem\n\nWhen a PRD is sliced into issues (or dependencies are extracted), two issues that edit the **same code region** can be marked as independent siblings and spawned in parallel. If they both modify that region and one merges first, the second is left on a stale base whose merge would silently revert the first's work — caught (at best) as an \"integration regression against origin\" review blocker, and resolved only by rebasing the second issue onto the merged base. That rebase rewrites history and then trips the non-forcing push deadlock (companion issue).\n\nLive incident: #638 and #639 were sliced as parallel siblings (both \"blocked by #637\") but both edit the `phase_timeout` recovery branch in `takeoverHandler`. #639 merged first; #638's stale base would have dropped #639's resume cap. The forced rebase then deadlocked on push. Ordering #638 *after* #639 would have avoided the rebase entirely.\n\n## Proposed fix\n\n- In dependency extraction / issue routing, detect when two open or in-flight issues are likely to edit overlapping files/regions (e.g. from plan specs' \"Relevant Files\", touched paths, or LLM analysis) and **serialize** them by registering a `## Blocked by` dependency rather than allowing parallel spawn.\n- Where overlap is only knowable after planning, surface it as an ordering recommendation before build.\n- Document the heuristic in the PRD-to-issues guidance so human breakdowns order region-colliding slices too.\n\n## Acceptance criteria\n\n- [ ] Two issues that demonstrably edit the same region are not built in parallel; one blocks the other\n- [ ] Non-overlapping issues remain parallelizable (no false serialization that needlessly slows throughput)\n- [ ] The decision is logged/visible so an operator can see why an issue was deferred\n- [ ] PRD-to-issues guidance updated to order region-colliding slices\n\n## Blocked by\n\nNone - can start immediately\n\n## Notes\n\nThis removes the *cause* (forced rebase from a stale, colliding base); the companion push-path issue removes the *symptom* (deadlock when a branch is rewritten). They are complementary.","state":"OPEN","author":"paysdoc","labels":["hitl","adw:feature"],"createdAt":"2026-06-20T18:12:00Z","comments":[],"actionableComment":null}`

## Feature Description

ADW currently decides whether an issue may spawn an orchestrator using a single eligibility gate (`checkIssueEligibility`), which serializes work **only** when an issue *declares* a blocker (`## Blocked by #N`, `depends on #N`, etc.). It has no awareness of *implicit* collisions: two sibling issues that quietly edit the same file or code region but never declare a dependency on each other. When both spawn in parallel and one merges first, the second is left building on a stale base. Merging it would silently revert the first's work; at best this is caught downstream as an "integration regression against origin" review blocker and "fixed" by a forced rebase — which rewrites history and then trips the non-forcing push deadlock (companion issue #648).

This feature teaches the eligibility gate to **detect likely region overlap** between a candidate issue and the other open/in-flight issues, and to **serialize** the colliding pair by registering a real `## Blocked by` dependency on the later issue rather than letting both run in parallel. Where overlap is only knowable *after* planning (when the plan's `## Relevant Files` section exists), the plan phase surfaces the collision as an **ordering recommendation** so an operator can intervene before build. The heuristic is also documented in the PRD-to-issues breakdown guidance so human slicing orders region-colliding slices the same way.

The value: it removes the *cause* of the stale-base rebase class of incidents (the #638/#639 episode that burned ~245K tokens), preserves throughput for genuinely independent work (no false serialization), and makes every deferral auditable.

## User Story

As an ADW operator running multiple issues concurrently against one repository
I want issues that edit the same code region to be automatically serialized (one blocks the other) instead of spawned in parallel
So that the second issue never builds on a stale base, never needs a forced rebase, and never deadlocks on a non-forcing push — while genuinely independent issues keep running in parallel.

## Problem Statement

The spawn-eligibility pipeline (`checkIssueEligibility` → `findOpenDependencies`) only honours **declared** dependencies parsed out of an issue body. Two issues that touch the same region but were sliced as independent siblings (the common PRD-slicing and dependency-extraction failure mode) are both deemed eligible and spawned in parallel. The collision is invisible until merge time, where the loser of the merge race is on a stale base and the only recovery is a history-rewriting rebase that then deadlocks on push. Nothing detects the overlap, nothing serializes the pair, and nothing records *why* — there is no signal from "Relevant Files", touched paths, or LLM analysis feeding the routing decision.

## Solution Statement

Add a **region-overlap serialization gate** as a pure decision layered into the existing eligibility chokepoint, plus a post-plan ordering recommendation and documentation updates:

1. **Pure decision module (`adws/triggers/regionOverlap.ts`).** Define a `RegionSignal` (issue number + normalized touched-path set + in-flight flag), deterministic parsers that extract path signals from an issue body's `## Touched Files`/`## Relevant Files` section and from a plan spec's `## Relevant Files` section, a normalized `pathsOverlap` predicate, and `decideSerialization(candidate, siblings)` — a deterministic, deadlock-free decision that returns which single sibling (if any) the candidate should be serialized behind. No I/O; fully unit-testable.

2. **Signal sourcing at the boundary (`adws/triggers/regionOverlapSignals.ts`).** A side-effecting fetcher that enumerates open issues (`gh issue list`), derives each one's path signal deterministically (issue-body section → committed plan spec `## Relevant Files` when locatable), with an **LLM fallback** (`/extract_touched_paths`, Haiku, memoized by body hash) only when a candidate has a non-empty colliding sibling but no deterministic signal of its own — mirroring the deterministic-first/LLM-fallback shape already proven in `extractDependencies`.

3. **Eligibility integration (`adws/triggers/issueEligibility.ts`).** Extend `EligibilityResult.reason` with `'region_overlap'`. After declared-dependency and before concurrency, run the gate (only when the candidate has no *already-registered* region-overlap blocker). On a serialize decision, idempotently register `## Blocked by #N` on the later issue via `updateIssueBody` (annotated `<!-- adw:region-overlap -->` so it is identifiable and never double-appended), post a one-time explanatory comment via `commentOnIssue`, and return ineligible. **Enforcement and unblocking then ride the existing, battle-tested declared-dependency path** — `findOpenDependencies` blocks it on every subsequent cycle and `handleIssueClosedDependencyUnblock` re-spawns it the moment the blocker's PR merges (closes the blocker). Minimal new enforcement code; maximal reuse.

4. **Operator visibility.** Extend `logDeferral` and the cron inline deferral log to render the `region_overlap` reason (blocking issue + shared paths); the registered `## Blocked by` line and the one-time comment make the decision durable and auditable on GitHub.

5. **Post-plan ordering recommendation (`adws/phases/planPhase.ts`).** At the end of the plan phase (single shared chokepoint across all orchestrators), compare the freshly-written plan's `## Relevant Files` against in-flight siblings' signals; if it collides with an issue that is already *ahead*, post a recommendation comment and log it (advisory, not a hard block — the work is already planned).

6. **Documentation.** Update the PRD-to-issues skill to instruct ordering region-colliding slices and to emit a `## Touched Files` hint, and document the new `/extract_touched_paths` command convention.

The deterministic tie-break (serialize behind the lowest-numbered / most-advanced overlapping issue) guarantees exactly one issue per overlap cluster proceeds, so the gate can never deadlock a colliding pair. Issues with no extractable signal are never serialized, satisfying the "no false serialization" criterion.

## Relevant Files

Use these files to implement the feature:

### Existing files to modify

- `adws/triggers/issueEligibility.ts` — The single eligibility chokepoint used by cron, webhook, the issues.opened router, and the dependency-unblock cascade. Add the `'region_overlap'` reason to `EligibilityResult`, add injectable region-overlap dependencies, and run the gate after the declared-dependency check. This is where serialization is enforced for *all* spawn paths at once.
- `adws/triggers/issueDependencies.ts` — Home of `parseDependencies`/`parseKeywordProximityDependencies`/`findOpenDependencies`. Reuse `parseDependencies` to detect an already-registered `## Blocked by` (so detection is skipped once a blocker exists) and to confirm the registered region-overlap blocker is picked up by the existing path. Add a small helper to append an annotated `Blocked by #N` line to an issue body idempotently.
- `adws/triggers/webhookGatekeeper.ts` — Extend `logDeferral` to render `region_overlap` (blocking issue + shared paths). The dependent-unblock path (`handleIssueClosedDependencyUnblock`) already re-spawns issues whose `## Blocked by` becomes satisfied — no change needed there beyond confirming the registered blocker flows through.
- `adws/triggers/trigger_cron.ts` — The cron poll loop logs deferrals inline (the `open_dependencies` branch around line 277). Add a `region_overlap` branch so cron operators see the reason and blocking issue.
- `adws/triggers/issueOpenedRouter.ts` — Already surfaces `eligibility.reason` through its `IssueOpenedOutcome` and calls `logDeferral`; verify the new reason flows through unchanged (it is a string passthrough).
- `adws/phases/planPhase.ts` — Add the post-plan ordering-recommendation step at the end of `executePlanPhase`, guarded by a workflow stage so it runs once, comparing the just-written plan's `## Relevant Files` against in-flight siblings.
- `adws/agents/planAgent.ts` — Exposes `getPlanFilePath`/`readPlanFile`/`findPlanFile` (plan-spec discovery by issue number). Reuse for reading sibling plan specs and the candidate's own plan in the post-plan step.
- `adws/github/issueApi.ts` — Already exports `updateIssueBody(issueNumber, body, repoInfo)` and `commentOnIssue(issueNumber, body, repoInfo)`. Used as-is to register the `## Blocked by` line and post the deferral/recommendation comments; no new GitHub primitives required.
- `adws/triggers/concurrencyGuard.ts` — Contains the in-flight detection pattern (ADW comment present + no linked merged/closed PR via `linkedPrDetector`). Reuse this logic to compute the `inFlight` flag on each `RegionSignal`.
- `adws/types/issueTypes.ts` — The `IssueClassSlashCommand`/slash-command union. Add `/extract_touched_paths` so the new command is a recognized agent command.
- `adws/core/modelRouting.ts` — The four slash-command routing maps (model, model-fast, effort, and the `undefined` map). Add `/extract_touched_paths` to all four (Haiku / low effort), mirroring `/extract_dependencies`.
- `adws/agents/index.ts` — Barrel export; export the new `touchedPathsAgent` entry point.
- `adws/triggers/index.ts` and/or `adws/core/index.ts` — Export the new modules where the existing trigger modules are re-exported.
- `.claude/skills/prd-to-issues/SKILL.md` — Add a region-collision ordering rule to the vertical-slice guidance and a `## Touched Files` hint to the issue template so human breakdowns serialize region-colliding slices.
- `.claude/commands/extract_dependencies.md` — Cross-reference the new touched-paths command (or note that region overlap is handled separately); kept consistent with the new `/extract_touched_paths` command.

### New Files

- `adws/triggers/regionOverlap.ts` — Pure decision module: `RegionSignal` type, `SerializationDecision` type, `parseRelevantFilesSection(markdown): string[]`, `normalizePath(p): string`, `pathsOverlap(a, b): { overlap: boolean; shared: string[] }`, and `decideSerialization(candidate, siblings): SerializationDecision`. No I/O; the testable heart of the feature.
- `adws/triggers/regionOverlapSignals.ts` — Side-effecting signal sourcing: `fetchRegionSignals(candidateIssueNumber, repoInfo, deps?)` enumerates open issues, builds each `RegionSignal` (deterministic body/plan parse → LLM fallback), computes `inFlight`, and returns `{ candidate, siblings }`. Also houses the idempotent `## Blocked by` registration + comment side effects, kept out of the pure module. DI-friendly so unit tests inject spies.
- `adws/agents/touchedPathsAgent.ts` — LLM fallback agent mirroring `dependencyExtractionAgent.ts`: runs `/extract_touched_paths` (Haiku) via `runCommandAgent`, parses a JSON array of path/glob strings with a validating `outputSchema`, memoized by body hash.
- `.claude/commands/extract_touched_paths.md` — Slash-command prompt (`target: false`) instructing the LLM to read an issue body and return a JSON array of likely-touched file path globs (e.g. `["adws/triggers/takeoverHandler.ts"]`), with patterns to include/exclude, mirroring `extract_dependencies.md`.
- `adws/triggers/__tests__/regionOverlap.test.ts` — Unit tests for the pure module (parsers, overlap predicate, decision matrix, deadlock-freedom, no-signal safety).
- `adws/triggers/__tests__/regionOverlapSignals.test.ts` — Unit tests for signal sourcing with injected deps (deterministic vs LLM-fallback selection, in-flight computation, idempotent registration).
- `features/per-issue/feature-649.feature` — Per-issue BDD scenarios (tagged `@adw-649`) describing serialize-on-overlap, no-false-serialization, deferral visibility, and the post-plan recommendation. (Authored by the scenario phase; the plan reserves the path and intent.)

### Conditional documentation (read before implementing — matched via `.adw/conditional_docs.md`)

- `app_docs/feature-91v6qi-llm-dependency-extraction.md` — Conditions match "adding or modifying dependency extraction logic or the `/extract_dependencies` command" and `findOpenDependencies/extractDependencies/parseDependencies`. The new `/extract_touched_paths` agent must follow the same deterministic-first/LLM-fallback + structured-output pattern.
- `app_docs/feature-74itmf-dependency-logging.md` — Conditions match "`findOpenDependencies()` or `checkIssueEligibility()`", "logging in the dependency resolution pipeline", and "why an issue was deferred". Governs the deferral-visibility behaviour this feature extends.
- `app_docs/feature-fequcj-fix-fail-open-dependency-check.md` — Conditions match `findOpenDependencies()` error handling. Region-signal sourcing must preserve the fail-safe posture (a sourcing error must not silently allow a colliding parallel spawn nor permanently strand an issue).
- `app_docs/feature-0cv18u-fix-cross-trigger-spawn-dedup.md` — Conditions match `classifyAndSpawnWorkflow` and the cron/webhook trigger paths. Ensure the gate composes with existing spawn dedup rather than introducing a parallel pre-check that bypasses the takeover gate.
- `app_docs/feature-gmfhco-issues-opened-label-routed-handler.md` — Conditions match `routeIssueOpened`/`issueOpenedRouter.ts`. The new reason must flow through `IssueOpenedOutcome` and `logDeferral` unchanged.

## Implementation Plan

### Phase 1: Foundation
Build the pure decision layer first, with no I/O, so the serialization semantics are fully specified and unit-tested before any trigger wiring exists.

- Create `adws/triggers/regionOverlap.ts` with the `RegionSignal`/`SerializationDecision` types, the section parser, the path normalizer, the `pathsOverlap` predicate, and the `decideSerialization` decision.
- Define the deterministic tie-break precisely: among the candidate plus its overlapping siblings, the issue that proceeds is (a) the lowest-numbered **in-flight** overlapper if any sibling is in-flight (the candidate defers behind it), else (b) the lowest issue number in the overlap cluster. Every other issue in the cluster defers behind that single anchor. A candidate with an empty path signal never serializes (no false positives).
- Unit-test the matrix exhaustively (overlap/no-overlap, in-flight vs backlog, multi-way clusters, empty-signal safety, deadlock-freedom: no two issues can each block the other).

### Phase 2: Core Implementation
Source real signals and wire the gate into the single eligibility chokepoint, reusing the declared-dependency machinery for enforcement and unblocking.

- Create `adws/triggers/regionOverlapSignals.ts`: enumerate open issues via `gh issue list --json number,body,title,comments,labels`, derive each path signal (deterministic body `## Touched Files`/`## Relevant Files` section → committed plan `## Relevant Files` when a plan spec is locatable → `/extract_touched_paths` LLM fallback, memoized by body hash and gated so the LLM only runs when needed), and compute `inFlight` using the `concurrencyGuard` in-flight pattern.
- Add `/extract_touched_paths` command, `touchedPathsAgent.ts`, and the `issueTypes`/`modelRouting` registrations (four maps), mirroring the dependency-extraction agent exactly.
- Extend `EligibilityResult` with `reason: 'region_overlap'` and an `overlapPaths?: string[]` field; add injectable region-overlap deps to `checkIssueEligibility` and run the gate after the declared-dependency check, **skipping detection when `parseDependencies` already shows a registered region-overlap blocker**.
- On a serialize decision: idempotently append `Blocked by #N <!-- adw:region-overlap -->` to the later issue's body via `updateIssueBody`, post a one-time explanatory comment via `commentOnIssue` (blocking issue, shared paths, how to override), and return ineligible. Subsequent cycles then enforce via `findOpenDependencies`, and `handleIssueClosedDependencyUnblock` re-spawns on blocker close — no new enforcement/unblock code.
- Extend `logDeferral` (webhookGatekeeper) and the `trigger_cron.ts` inline deferral log to render `region_overlap`.

### Phase 3: Integration
Cover the "only knowable after planning" case and align human breakdowns.

- Add the post-plan ordering-recommendation step at the end of `executePlanPhase` (`adws/phases/planPhase.ts`), stage-guarded to run once: parse the just-written plan's `## Relevant Files`, source in-flight sibling signals, and if it collides with an issue already ahead, post a recommendation comment and log it (advisory — no hard block, since the work is already planned).
- Update `.claude/skills/prd-to-issues/SKILL.md`: add a rule to the vertical-slice section to order region-colliding slices (blockers first) and add an optional `## Touched Files` hint to the issue template so both humans and the LLM emit the deterministic signal.
- Cross-reference `/extract_touched_paths` from `.claude/commands/extract_dependencies.md` for discoverability.
- Run the full validation suite.

## Step by Step Tasks
Execute every step in order, top to bottom.

### Step 1: Read conditional documentation and confirm conventions
- Read the five conditional-doc files listed under "Relevant Files" to absorb the dependency-extraction pattern, the deferral-logging contract, the fail-open posture, the cross-trigger spawn-dedup constraint, and the issues.opened routing flow.
- Confirm the plan-spec `## Relevant Files` format and the issue-body conventions you will parse.

### Step 2: Create the pure decision module `adws/triggers/regionOverlap.ts`
- Define `RegionSignal { issueNumber: number; paths: string[]; inFlight: boolean }` and `SerializationDecision { serialize: boolean; blockedBy?: number; overlapPaths?: string[] }`.
- Implement `normalizePath` (trim, strip surrounding backticks/quotes, strip trailing glob noise, lowercase, normalize separators) and `parseRelevantFilesSection(markdown)` (extract bullet/path tokens from a `## Relevant Files` or `## Touched Files` section; reuse the heading-section slice approach from `parseDependencies`).
- Implement `pathsOverlap(a, b)` returning `{ overlap, shared }` using normalized exact-match plus directory-prefix/glob containment.
- Implement `decideSerialization(candidate, siblings)` per the Phase 1 tie-break rules; guarantee deadlock-freedom and empty-signal safety.
- Keep the module pure (no imports with side effects).

### Step 3: Unit-test the pure module
- Create `adws/triggers/__tests__/regionOverlap.test.ts` covering: section parsing (present/absent/multiple bullets/code-fenced paths), `normalizePath`, `pathsOverlap` (exact, prefix, glob, disjoint), and the full `decideSerialization` matrix including the #638/#639 scenario, multi-way clusters, in-flight precedence, backlog tie-break, and the no-signal → no-serialize case.

### Step 4: Add the `/extract_touched_paths` LLM fallback command and agent
- Create `.claude/commands/extract_touched_paths.md` (`target: false`) instructing extraction of a JSON array of likely-touched path globs from an issue body, with include/exclude guidance, mirroring `extract_dependencies.md`.
- Create `adws/agents/touchedPathsAgent.ts` mirroring `dependencyExtractionAgent.ts`: a `parseTouchedPathsArray` extractor (validate to unique non-empty strings), an `outputSchema`, a `CommandAgentConfig`, and `runTouchedPathsAgent(...)`.
- Register `/extract_touched_paths` in `adws/types/issueTypes.ts` and all four maps in `adws/core/modelRouting.ts` (Haiku model, low effort), and export the agent from `adws/agents/index.ts`.

### Step 5: Create the signal-sourcing boundary `adws/triggers/regionOverlapSignals.ts`
- Implement `fetchRegionSignals(candidateIssueNumber, candidateBody, repoInfo, deps?)`: enumerate open issues, build each `RegionSignal` (deterministic body section → locatable plan `## Relevant Files` via `readPlanFile` → memoized LLM fallback gated on need), compute `inFlight` from the `concurrencyGuard` pattern (ADW comment present + no linked merged/closed PR), and return `{ candidate, siblings }`.
- Implement the idempotent side effects here (kept out of the pure module): `registerRegionOverlapBlocker(issueNumber, blockedBy, repoInfo)` (append annotated `Blocked by #N <!-- adw:region-overlap -->` via `updateIssueBody`, skipping if the annotation already exists) and `postRegionOverlapDeferralComment(...)` (one-time, marker-guarded).
- Preserve the fail-safe posture per `feature-fequcj`: a sourcing/LLM error must not strand an issue forever, but must also not silently permit a known collision — log and fall back to the deterministic signal.

### Step 6: Unit-test signal sourcing
- Create `adws/triggers/__tests__/regionOverlapSignals.test.ts` with injected deps: deterministic-vs-LLM selection, plan-spec preference, `inFlight` computation, idempotent registration (no double-append), and one-time comment behaviour.

### Step 7: Wire the gate into `checkIssueEligibility`
- Extend `EligibilityResult` with `reason: 'region_overlap'` and `overlapPaths?: string[]`.
- Add an optional `RegionOverlapDeps` param (defaulting to the real `fetchRegionSignals` + `decideSerialization` + register/comment), run the gate after the declared-dependency check and before the concurrency check, and short-circuit detection when `parseDependencies(issueBody)` already contains a region-overlap blocker.
- On serialize: register the blocker, post the comment, and return `{ eligible: false, reason: 'region_overlap', blockingIssues: [blockedBy], overlapPaths }`.

### Step 8: Surface the new reason in all deferral logs
- Extend `logDeferral` in `webhookGatekeeper.ts` and the inline deferral block in `trigger_cron.ts` to render `region_overlap` with the blocking issue and shared paths.
- Confirm `issueOpenedRouter.ts` passes the new reason through `IssueOpenedOutcome` unchanged (string passthrough; no code change expected — verify with a test or read).

### Step 9: Add the post-plan ordering recommendation
- At the end of `executePlanPhase` (`adws/phases/planPhase.ts`), add a stage-guarded step that parses the freshly-written plan's `## Relevant Files`, sources in-flight sibling signals, and on a collision with an issue already ahead posts a recommendation comment and logs it (advisory; never throws, never blocks the build).

### Step 10: Update PRD-to-issues guidance and command cross-reference
- In `.claude/skills/prd-to-issues/SKILL.md`, add a region-collision ordering rule to `<vertical-slice-rules>` (and to the step-4 quiz prompts) and an optional `## Touched Files` block to `<issue-template>`.
- Cross-reference `/extract_touched_paths` from `.claude/commands/extract_dependencies.md`.

### Step 11: Author per-issue BDD scenarios
- Create/extend `features/per-issue/feature-649.feature` (tagged `@adw-649`) with scenarios for: serialize-on-overlap (the #638/#639 shape), no-false-serialization for disjoint paths, deferral visibility (log + `## Blocked by` + comment), and the post-plan recommendation. (Final scenario authoring is performed by the scenario phase; ensure the intent and tag are present.)

### Step 12: Run the Validation Commands
- Run every command in "Validation Commands" and resolve all errors and regressions to zero.

## Testing Strategy

### Unit Tests
`.adw/project.md` declares `## Unit Tests: enabled`, so unit tests are in scope (Vitest, under `adws/**/__tests__/`).

- **`regionOverlap.test.ts`** — Pure-module coverage:
  - `parseRelevantFilesSection`: section present/absent, bullet and inline-code path forms, multiple sections, trailing prose ignored.
  - `normalizePath`: backtick/quote stripping, separator and case normalization, glob suffix handling.
  - `pathsOverlap`: exact match, directory-prefix containment, glob containment, disjoint → no overlap; returns the correct `shared` set.
  - `decideSerialization`: the #638/#639 case serializes exactly one issue behind the other; in-flight sibling takes precedence over backlog tie-break; multi-way cluster collapses to one anchor; **deadlock-freedom** (for any pair, at most one is told to defer); empty candidate signal → never serialize (guards the "no false serialization" criterion).
- **`regionOverlapSignals.test.ts`** — Boundary coverage with injected deps: deterministic body signal preferred when present; plan `## Relevant Files` used when locatable; LLM fallback invoked only when needed and memoized; `inFlight` computed correctly from comments + linked-PR state; `registerRegionOverlapBlocker` is idempotent (annotation-guarded, no double-append); deferral comment posted at most once.
- **Eligibility regression** — Extend/author coverage so a pre-existing declared blocker short-circuits region detection, and a `region_overlap` result carries `blockingIssues` + `overlapPaths`. Confirm `logDeferral` renders the new reason.

### Edge Cases
- Both issues have empty/absent path signals → no serialization (avoid false positives).
- Three or more issues touching the same region → all but the single anchor defer; no cycle, no mutual block.
- An issue already carries a human-declared `## Blocked by` for the colliding sibling → region detection is a no-op (declared path already serializes it).
- A region-overlap blocker was registered, then the blocker's PR merges/closes → the existing `handleIssueClosedDependencyUnblock` cascade re-spawns the deferred issue (closed reference no longer blocks).
- False-positive overlap → operator removes the annotated `Blocked by` line (or posts `## Cancel`); the annotation makes the auto-added line identifiable.
- `gh issue list` / LLM-extraction failure during sourcing → log and fall back to the deterministic signal without stranding the issue or silently allowing a known collision (fail-safe per `feature-fequcj`).
- Plan spec for an in-flight sibling lives in that sibling's own worktree and may be unreadable from the cron process → gracefully fall back to the sibling's issue-body signal.
- Overlap only emerges after planning → handled by the advisory post-plan recommendation, which must never throw or block the build.
- LLM cost control → the LLM fallback must not run on every 20s poll; it is gated on "candidate has a colliding sibling but no deterministic signal" and memoized by body hash.

## Acceptance Criteria
- Two issues that demonstrably edit the same region (deterministic `## Relevant Files`/`## Touched Files` overlap, plan-spec overlap, or high-confidence LLM analysis) are not built in parallel: the later/less-advanced issue is serialized behind the other via a registered `## Blocked by` dependency, and the existing declared-dependency gate enforces it on subsequent cycles.
- Issues with disjoint (or absent) path signals remain eligible to spawn in parallel — no false serialization, no needless throughput loss.
- Every serialization is logged (cron + `logDeferral`) and visible on GitHub (annotated `## Blocked by` line plus a one-time explanatory comment naming the blocking issue and the overlapping paths), so an operator can see exactly why an issue was deferred.
- Where overlap is only knowable after planning, the plan phase posts an advisory ordering recommendation before build.
- The PRD-to-issues guidance instructs ordering region-colliding slices, and the issue template offers a `## Touched Files` hint.
- The full validation suite passes with zero regressions.

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions. Commands are taken from `.adw/commands.md`.

- `bun run lint` — Lint for code-quality issues.
- `bunx tsc --noEmit` — Type-check the repository.
- `bunx tsc --noEmit -p adws/tsconfig.json` — Additional type-check for the `adws/` workspace.
- `bun run test:unit` — Run the Vitest unit suite (includes the new `regionOverlap` and `regionOverlapSignals` tests) with zero regressions.
- `bun run build` — Verify a clean build.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — Run the regression BDD suite to confirm no behavioural regressions in the spawn/eligibility/plan paths.

## Notes
- `.adw/coding_guidelines.md` applies. Keep the decision logic pure and isolated (the `regionOverlap.ts` module must have no side effects); keep all I/O — `gh` calls, body edits, comments, LLM invocation — at the `regionOverlapSignals.ts` boundary. Favour guard clauses and named helpers over nested conditionals, keep files under 300 lines, prefer `map`/`filter`/`reduce`, and use explicit types (no `any`).
- **Maximal reuse, minimal new enforcement.** The feature deliberately delegates *enforcement* (blocking on subsequent cycles) and *unblocking* (re-spawn on blocker close) to the already-proven declared-dependency path (`findOpenDependencies` + `handleIssueClosedDependencyUnblock`). The genuinely new code is detection (pure decision + signal sourcing) and the recording of the decision (`## Blocked by` + comment + logs). This keeps the change surgical and rides infrastructure that has been hardened by prior incidents.
- **Single chokepoint.** Integrating the gate inside `checkIssueEligibility` means cron, webhook, the issues.opened router, and the dependency-unblock cascade all inherit it — consistent with the "sole gate" principle noted in `trigger_cron.ts` (do not add a parallel pre-check that bypasses the takeover gate).
- **Determinism over completeness.** The tie-break is by in-flight status then issue number, never by wall-clock or random, so the same backlog always serializes the same way and the gate can never deadlock a colliding cluster.
- New library: none required. The LLM fallback reuses the existing `commandAgent`/`runCommandAgent` infrastructure. If any package were needed, the install command per `.adw/commands.md` is `bun add <package>` — none is expected here.
- This issue removes the *cause* (forced rebase from a stale, colliding base). The companion issue #648 removes the *symptom* (the non-forcing push deadlock when a branch is rewritten). They are complementary; this plan does not depend on #648.
- Risk control for body mutation: the `<!-- adw:region-overlap -->` annotation makes auto-added blockers identifiable and idempotent, the decision is only recorded on high-confidence overlap, and operators retain full override (`## Cancel` or remove the line). A residual closed `Blocked by #N` reference after unblocking is harmless (closed deps never block) and documents the historical ordering decision.

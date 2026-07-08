# Feature: Promotion sweep — originate path (manual CLI)

## Metadata
issueNumber: `740`
adwId: `vpb048-promotion-sweep-orig`
issueJson: `{"number":740,"title":"Promotion sweep — originate path (manual CLI)","body":"## Parent PRD\n\n`specs/prd/automated-scenario-promotion-sweep.md` (PR #738)\n\n## What to build\n\nThe originate half of the promotion sweep, invokable by hand (not yet wired into cron). Given tracked `features/per-issue/feature-N.feature` files on the default branch, score them with the existing deterministic scorer/threshold, and for a fresh high scorer: write `@promotion-suggested-<date>` to the file on the default branch (scoped commit, never `git add -A`) and file an `adw:feature` + `regression-promotion` + `hitl` promotion issue whose body is a #734-shaped precise relocation instruction carrying a `Promotes: feature-N` marker.\n\nIntroduces the pure deciders `promotionSweepDecider` (originate/leave/done subset only), `promotionReconcileLink` (map tagged files → open promotion issues via the `Promotes: feature-N` marker; the `gh issue list --label regression-promotion` call injected), `promotionIssueBody` (title/body/label builder), and the dep-injected non-fatal `runPromotionSweep` shell (mirrors `runPerIssueScenarioSweep`). Reuses `promotionScorer`, `promotionThreshold`, `scenarioParser`, `vocabularyParser`, `promotionStatsLoader`. Adds the `regression-promotion` label constant to `labelManager`.\n\nWhole-file granularity (matches #734). See PRD Implementation Decisions \"New deep modules\" and \"Imperative shell\".\n\n## Acceptance criteria\n\n- [ ] Running the sweep by hand against a repo with a fresh high-scoring per-issue file writes `@promotion-suggested-<date>` to that file on the default branch (scoped commit only)\n- [ ] It files exactly one `adw:feature` + `regression-promotion` + `hitl` issue per qualifying file, with a `Promotes: feature-N` body marker and a #734-shaped relocation instruction (source feature + step-def paths, phrases, destination regression dir, vocab path, \"prove @regression green\" acceptance)\n- [ ] A file already tagged `@promotion-suggested-*` with an open promotion issue is left untouched (idempotent — no duplicate issue, no re-commit)\n- [ ] A file whose promotion PR has merged (file gone from per-issue) is treated as done\n- [ ] The shell is non-fatal: a transient git/gh error is logged and swallowed, never thrown\n- [ ] `promotionSweepDecider` and `promotionReconcileLink` are pure and unit-tested over their input cross-product\n\n## Blocked by\n\n- Blocked by #739\n\n## Touched Files\n\n- adws/triggers/promotionSweep.ts (new)\n- adws/core/promotionSweepDecider.ts (new)\n- adws/core/promotionReconcileLink.ts (new)\n- adws/core/promotionIssueBody.ts (new)\n- adws/github/labelManager.ts\n\n## User stories addressed\n\n- User story 1\n- User story 2\n- User story 5\n- User story 6\n- User story 7\n- User story 8\n- User story 14\n- User story 15\n- User story 25","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-07-08T11:42:36Z","comments":[],"actionableComment":null}`

## Feature Description

This feature builds the **originate half** of the automated scenario promotion sweep described in
`specs/prd/automated-scenario-promotion-sweep.md`. It is a hand-invokable CLI (`bunx tsx
adws/triggers/promotionSweep.ts`) — deliberately **not yet wired into `trigger_cron`** (that
interval-gated wiring is a later slice). The wiring seam is left clean so the sibling cron slice can
call `runPromotionSweep()` unchanged.

The sweep answers one question per tracked per-issue scenario file: *"is this a fresh, high-scoring
promotion candidate that should be surfaced to the maintainer?"* When the answer is yes, it does two
durable things on the **default branch**:

1. **Marks the file in-flight** — writes a `@promotion-suggested-<date>` tag directly above the
   file's `Feature:` line and commits **only that path** (a scoped commit; never `git add -A`). This
   marker is the durable idempotency record: it survives cron cycles and process restarts, and (per
   the already-merged #739) it exempts the file from the 14-day per-issue TTL sweep so a candidate
   under promotion consideration is never deleted out from under the maintainer.
2. **Files one promotion issue** — an `adw:feature` + `regression-promotion` + `hitl` GitHub issue
   whose body is a precise, **#734-shaped** relocation instruction (source `.feature` + step-def
   paths, the scenario's phrases, destination `features/regression/` dir, vocabulary registry path,
   and an explicit *"prove `@regression` green"* acceptance). The body carries a `Promotes: feature-N`
   marker so a future sweep can durably link the tagged file back to its tracking issue. The label
   set routes the issue through ADW's **normal** plan → build → test → PR pipeline (`adw:feature`
   deterministically routes, bypassing AI classification), keys reconciliation and the
   authoring-skip flag (`regression-promotion`), and gates the merge behind a human (`hitl`).

The sweep never performs the relocation itself — that is the normal SDLC pipeline's job (proven
viable by the hand-done #734). The sweep's only jobs are **score, reconcile (link), originate**.

The lifecycle logic lives in a small pure decider, `promotionSweepDecider`, which — for this slice —
produces exactly the **`originate | leave | done` subset**. The reconcile-heavy actions
(`decline | redrive | withdraw`) that require querying tracking-issue *state* are deferred to the
sibling reconcile-path slice; this slice defines the full action/fact union for forward-compatibility
but only emits the originate subset, treating every not-yet-handled reconciliation fact as a
conservative `leave` (no-op), so the originate sweep is safe and idempotent on its own.

## User Story

As an ADW maintainer
I want a hand-runnable sweep that finds fresh high-scoring per-issue scenarios, durably marks them
`@promotion-suggested-<date>` on the default branch, and files a precise `hitl`-gated `adw:feature`
promotion issue for each
So that promotion candidates are discovered and prepared automatically (no LLM cost in the
discovery step), protected from the 14-day deletion sweep, and turned into a reviewable PR by the
existing pipeline — without me hand-authoring a bespoke `/feature` issue as I had to for #734.

## Problem Statement

Per-issue BDD scenarios that would make good permanent regression tests get **silently lost**. A
scenario authored under `features/per-issue/feature-N.feature` is input-only and never executed;
nothing moves a good candidate into the executed `@regression` suite, and the 14-day per-issue sweep
deletes it on age. The one successful promotion to date (#734) was done entirely by hand. The
documented `adws/promotion/` flow (commenter + mover) never worked and is wired into no trigger.

The PRD's fix reuses the SDLC pipeline: a sweep that scores, reconciles, and originates a
self-contained promotion issue. **This feature is the originate half of that sweep**, delivered as a
standalone manual CLI so it can be validated end-to-end before the cron wiring and the
reconcile/decline/redrive half are added.

## Solution Statement

Introduce three pure deep modules and one dependency-injected, non-fatal imperative shell, reusing
the retained deterministic scorer/threshold/parsers and the already-merged `promotionTagState`:

- **`promotionSweepDecider`** (pure) — `decidePromotionAction({ tagState, meetsThreshold, reconcile })`
  returns exactly one `PromotionAction`. This slice implements the **`originate | leave | done`**
  subset: `originate` on a fresh (`tagState: 'none'`) high scorer with no linked issue; `done` on a
  merged reconciliation fact; `leave` for everything else (below-threshold, already in-flight,
  declined, and every deferred reconciliation fact). Exhaustively table-tested.
- **`promotionReconcileLink`** (pure) — parses the `Promotes: feature-N` marker from a promotion
  issue body and maps a `feature-N` id to its linked open issue number across the injected set of
  open `regression-promotion` issues (the `gh issue list` call is injected by the shell). Handles
  no-match, single-match, and multi-candidate cases.
- **`promotionIssueBody`** (pure) — `buildPromotionIssue(input)` produces the #734-shaped
  `{ title, body, labels }`, including the `Promotes: feature-N` marker and the fixed label set
  `['adw:feature', 'regression-promotion', 'hitl']`.
- **`runPromotionSweep(deps)`** (shell) — mirrors `runPerIssueScenarioSweep`: lists tracked
  `features/per-issue/feature-N.feature` on the default branch, scores each via the retained scorer,
  runs the injected reconciliation query, calls `promotionSweepDecider`, and executes each action
  (write marker + **scoped** commit to default; file the labelled issue). Non-fatal — a transient
  git/gh error is logged and swallowed, never thrown; mutates only when the checkout is on the
  default branch.

Two supporting changes make the "scoped commit, never `git add -A`" acceptance criterion honourable
and give the promotion issue its label:

- **`labelManager`** gains the `regression-promotion` label constant + definition (kept out of the
  `adw:*` classification map so it stays invisible to `LABEL_TO_COMMAND`).
- **`commitOps` / `GitContext`** gain a scoped **`addAndCommitPaths`** primitive — the symmetric
  counterpart to the existing `removeAndCommitPaths` used by the per-issue sweep. This is required
  because no existing `GitContext` method commits a *modified* file scoped to its path: `commitChanges`
  uses `git add -A` (explicitly forbidden here) and `removeAndCommitPaths` only removes.

## Relevant Files

Use these files to implement the feature:

### New Files

- `adws/core/promotionSweepDecider.ts` — the pure lifecycle decider. Exports `PromotionTagState`
  (re-exported from `promotionTagState`), `ReconcileFact` (`'no-issue' | 'open' | 'merged' |
  'closed-unmerged' | 'blocked'` — full union for forward-compat), `PromotionAction` (`'originate' |
  'leave' | 'done' | 'decline' | 'redrive' | 'withdraw'` — full union), `PromotionDecisionInput`, and
  `decidePromotionAction(input): PromotionAction`. This slice emits only `originate | leave | done`.
- `adws/core/__tests__/promotionSweepDecider.test.ts` — exhaustive table tests over
  `{tagState} × {meetsThreshold} × {reconcile}`.
- `adws/core/promotionReconcileLink.ts` — pure matcher. Exports `PromotionIssueRef`
  (`{ number: number; body: string }`), `parsePromotesMarker(body): string | null`,
  `reconcilePromotionLink(feature, openIssues): number | null`, and
  `reconcileFactFor(feature, openIssues): 'open' | 'no-issue'` (the subset fact the shell needs).
- `adws/core/__tests__/promotionReconcileLink.test.ts` — no-match / single / multi-candidate marker
  parsing and linkage.
- `adws/core/promotionIssueBody.ts` — pure builder. Exports `PromotionIssueInput`,
  `PromotionIssueSpec` (`{ title: string; body: string; labels: readonly string[] }`), and
  `buildPromotionIssue(input): PromotionIssueSpec`. (Integration/BDD-covered per PRD Testing
  Decisions — no isolated unit test.)
- `adws/triggers/promotionSweep.ts` — the imperative shell. Exports `PromotionSweepDeps` and
  `runPromotionSweep(deps?): Promise<PromotionSweepReport>`; default deps compose `GitContext` +
  `loadProjectConfig` + `fs` + the reused promotion modules. Includes a CLI `main()` guarded by
  `import.meta.main` so it is hand-invokable via `bunx tsx adws/triggers/promotionSweep.ts`.
- `features/per-issue/feature-740.feature` (authored by the `scenario_writer` phase, tagged
  `@adw-740`) — BDD behavioural proof of the shell (originate / leave / done paths, non-fatal
  swallow, scoped-commit, one-issue-per-file), driven by injecting fake `PromotionSweepDeps`.
- `features/per-issue/step_definitions/feature-740.steps.ts` — the step definitions for the above.

### Modified Files

- `adws/github/labelManager.ts` — add `export const ADW_REGRESSION_PROMOTION_LABEL =
  'regression-promotion';` and a matching `AdwLabelDefinition` (color/description). Make
  `resolveLabelDefinition` aware of it (so `applyLabel`'s lazy-create uses the right metadata).
  **Do not** add it to `ADW_CLASSIFICATION_LABELS` (it must not become a routing label) and **do
  not** add it to `ADW_LABEL_DEFINITIONS` (keep `ensureAdwLabelsExist` scoped to the six `adw:*`
  labels and its `N/6` log message intact). *(Owned by `feature-t6m62c` and
  `feature-25daxp` — see conditional docs.)*
- `adws/gitContext/commitOps.ts` — add a scoped `addAndCommitPaths(run, paths, message, cwd): boolean`
  mirroring `removeAndCommitPaths` (`git add -- <paths>` → `git status --porcelain -- <paths>` guard
  → `git commit -m … -- <paths>`), and export it on the `commitOps` object. **Required** to satisfy
  the "scoped commit, never `git add -A`" acceptance criterion. *(File owned by `feature-t6m62c` —
  additive; see Notes.)*
- `adws/gitContext/gitContext.ts` — expose the new primitive as a public method
  `addAndCommitPaths(paths, message, worktreePath): boolean` delegating to `commitOps.addAndCommitPaths`
  (mirrors the existing `removeAndCommitPaths` method at line 195).
- `adws/gitContext/__tests__/commitOps.test.ts` — add focused tests for `addAndCommitPaths` mirroring
  the existing `removeAndCommitPaths` cases (stages only the named paths; no-op/`false` when nothing
  staged for those pathspecs; scoped `git commit -- <paths>` command shape).

### Reused (read-only reference — not modified)

- `adws/triggers/perIssueScenarioSweep.ts` — **the mirror.** `runPromotionSweep` copies its
  structure: injectable deps with production defaults, tracked-files listing via `ctx.lsFiles`, the
  default-branch guard + scoped-commit + `pushBranch` persistence pattern, and the non-fatal
  try/catch swallow (`log(... 'warn')`, never throw). Also the consumer of `promotionTagState`.
- `adws/core/promotionTagState.ts` (#739, already merged) — reuse `parsePromotionTagState(content):
  PromotionTagState` for the file's current tag state and `serializePromotionTagState(content,
  'suggested', { date })` to write the `@promotion-suggested-<date>` marker byte-idempotently above
  `Feature:`. `PromotionTagState` (`'none' | 'suggested' | 'declined'`) is the decider's tag input.
- `adws/promotion/promotionScorer.ts` — `score(scenario, registry, registry.surfaceExamples):
  ScoreResult` (`.total`). Reused unchanged.
- `adws/promotion/promotionThreshold.ts` — `computeThreshold(stats): number`. Reused unchanged.
- `adws/promotion/promotionStatsLoader.ts` — `loadPromotionStats(deps): PromotionStats` with
  `PromotionStatsLoaderDeps { gitLogSince, now, perIssueGlob, log? }`. The shell's default `loadStats`
  composes it over `ctx.logSince`.
- `adws/promotion/scenarioParser.ts` — `parse(content, fileUri?): Scenario[]` (each `Scenario` has
  `steps`, `tags`, `headerLine`). Reused to obtain per-scenario scores and step phrases.
- `adws/promotion/vocabularyParser.ts` — `parse(content): VocabularyRegistry { entries,
  surfaceExamples }`. Reused for the scorer's registry.
- `adws/promotion/promotionCommenter.ts` — **pattern reference only** (score → decide → tag loop
  shape, `PER_ISSUE_RE`, defensive read/parse skips). Slated for deletion in a later PRD slice; do
  not import from it.
- `adws/gitContext/gitContext.ts` methods used by the shell: `lsFiles`, `defaultBranch`,
  `getCurrentBranch`, `pushBranch`, `createIssue(title, body)` (returns the new issue URL),
  `listOpenIssues(opts)` (the injected reconcile query — fields `number,body`; filter by
  `search: 'label:"regression-promotion"'`), `logSince`.
- `adws/github/gitContextFactory.ts` (`gitContextForRepo`) + `adws/github/githubApi.ts`
  (`getRepoInfo`) — how the default deps obtain a `GitContext`, exactly as `perIssueScenarioSweep`
  does.
- `adws/core/projectConfig.ts` — `loadProjectConfig(targetRepoPath).scenarios` gives
  `regressionScenarioDirectory`, `vocabularyRegistry`, `perIssueScenarioDirectory` for the issue-body
  builder inputs and the vocabulary source (defaults: `features/regression/`,
  `features/regression/vocabulary.md`, `features/per-issue/`).
- `specs/issue-734-adw-ikwe55-feat-promote-729-adw-sdlc_planner-promote-729-regression-scenario.md` —
  the hand-done promotion this automates; the canonical shape the issue body must reproduce (git mv
  feature + step-defs, add `@regression`, register vocabulary, prove `@regression` green, `hitl`).
- `.adw/scenarios.md` — declares the per-issue / regression / vocabulary directories that make this
  repo opt into the tiered contract (why promotion is a maintainer-gated action).

### Conditional Docs (matched conditions — read before implementing)

- `app_docs/feature-ne2we8-promotion-tag-state.md` — **owns `adws/core/promotionTagState.ts`.**
  Matches: parsing/serializing `@promotion-suggested-<date>` markers, `parsePromotionTagState`,
  the `none → suggested → declined` state machine. Governs the reused tag module.
- `app_docs/feature-t6m62c-adwupgrade-regen-gate-propagation.md` — **owns
  `adws/gitContext/commitOps.ts` and `adws/github/labelManager.ts`.** Matches: `commitOps.ts` scoped
  commit / `git add` behaviour and `labelManager` changes. Confirms the additive-touch guardrails
  (do not disturb `committableExcludePaths` / the upgrade regen commit path).
- `app_docs/feature-25daxp-label-manager-deep-module.md` — Matches: extending `ADW_LABEL_DEFINITIONS`
  / label constants and `applyLabel` lazy-create-and-retry. Governs the `regression-promotion` label
  addition.
- `app_docs/feature-tdauam-promotion-commenter-deep-modules.md` — Matches: the `adws/promotion/`
  deep modules (`vocabularyParser`, `scenarioParser`, `promotionScorer`, `promotionThreshold`) reused
  here, and how per-issue scenarios are scored.
- `app_docs/feature-y8r69q-auto-ramping-promotion-threshold.md` — Matches: `computeThreshold`,
  `loadPromotionStats`, `PromotionStatsLoaderDeps` — the reused threshold + stats loader.
- `app_docs/feature-oobdbg-bdd-cutover-polymorphic-prompts-sweep.md` — Matches:
  `adws/triggers/perIssueScenarioSweep.ts` (the mirror) and the `ScenariosConfig` optional fields
  (`perIssueScenarioDirectory`, `regressionScenarioDirectory`, `vocabularyRegistry`).
- `app_docs/feature-9gjajh-promotion-system.md` — **owns `adws/promotion/**`.** Matches: scenario
  promotion scoring / vocabulary parsing / threshold reused from that package.

## Implementation Plan

### Phase 1: Foundation

Establish the two shared primitives the shell depends on, before any promotion-specific logic:

1. The scoped **`addAndCommitPaths`** git primitive (`commitOps` + `GitContext` method) so the shell
   can commit a marker to the default branch scoped to exactly the feature file's path — honouring
   "never `git add -A`". Unit-test it alongside the existing `removeAndCommitPaths` tests.
2. The `regression-promotion` label constant + definition in `labelManager`, kept out of the
   classification map, so the promotion issue can be labelled via the existing `applyLabel` path.

### Phase 2: Core Implementation

Build the three pure deep modules with their contracts and (for the two required) exhaustive unit
tests:

3. `promotionSweepDecider` — the `originate | leave | done` decision table.
4. `promotionReconcileLink` — the `Promotes: feature-N` marker parser + linkage/fact resolver.
5. `promotionIssueBody` — the #734-shaped title/body/label builder.

### Phase 3: Integration

6. `runPromotionSweep` shell — compose the reused scorer/threshold/parsers/statsLoader/tagState with
   the new deciders and `GitContext`, wire the default (production) deps, add the non-fatal + default-
   branch guards, and the CLI `main()`. Then the BDD behavioural proof (`@adw-740`) driving the shell
   with injected fakes, and full-suite validation for zero regressions.

## Step by Step Tasks

Execute every step in order, top to bottom.

### Task 1 — Add the scoped `addAndCommitPaths` git primitive (foundation)

- In `adws/gitContext/commitOps.ts`, add `function addAndCommitPaths(run: Runner, paths: readonly
  string[], message: string, cwd: string): boolean` mirroring `removeAndCommitPaths`:
  - Return `false` immediately when `paths.length === 0`.
  - Build the quoted pathspec `tokens` exactly as `removeAndCommitPaths` does.
  - `run(\`git add -- ${tokens}\`, cwd)`.
  - Guard: `const status = run(\`git status --porcelain -- ${tokens}\`, cwd); if (!status.trim())
    return false;` (nothing staged for those exact pathspecs → no-op, no commit).
  - `run(\`git commit -m "${message.replace(/"/g, '\\"')}" -- ${tokens}\`, cwd); return true;`.
  - Add `addAndCommitPaths` to the exported `commitOps` object.
- In `adws/gitContext/gitContext.ts`, add the public method (mirror the `removeAndCommitPaths` method
  at line ~195): `addAndCommitPaths(paths, message, worktreePath): boolean { return
  commitOps.addAndCommitPaths((cmd, cwd) => this.#run(cmd, { cwd }), paths, message, worktreePath); }`.
- Keep the change purely additive — do not touch `commitChanges`, `committableExcludePaths`, or
  `removeAndCommitPaths` (owned by `feature-t6m62c`).

### Task 2 — Unit test the scoped commit primitive

- In `adws/gitContext/__tests__/commitOps.test.ts`, add a `describe('addAndCommitPaths')` block
  mirroring the `removeAndCommitPaths` tests (inject a fake `Runner` that records commands):
  - stages only the named paths (`git add -- '<path>'`) and commits scoped (`git commit … --
    '<path>'`);
  - returns `false` and issues no `git commit` when `git status --porcelain -- <paths>` is empty;
  - returns `false` and runs nothing when `paths` is empty;
  - escapes double-quotes in the commit message.

### Task 3 — Add the `regression-promotion` label to `labelManager`

- In `adws/github/labelManager.ts`, add `export const ADW_REGRESSION_PROMOTION_LABEL =
  'regression-promotion';` near the other label constants.
- Add an exported `AdwLabelDefinition` for it, e.g. `export const REGRESSION_PROMOTION_LABEL_DEFINITION:
  AdwLabelDefinition = { name: ADW_REGRESSION_PROMOTION_LABEL, color: 'c5def5', description:
  'Scenario promotion candidate (reconciliation key + authoring skip-flag)' };`.
- Update `resolveLabelDefinition` to resolve the promotion label from `[...ADW_LABEL_DEFINITIONS,
  REGRESSION_PROMOTION_LABEL_DEFINITION]` (so `applyLabel`'s lazy-create uses the right color/
  description) — leaving `ADW_LABEL_DEFINITIONS` itself (and `ensureAdwLabelsExist`'s `N/6` loop and
  message) unchanged.
- Do **not** add the label to `ADW_CLASSIFICATION_LABELS` — it must stay invisible to
  `readAdwLabelNames` / `LABEL_TO_COMMAND` routing.

### Task 4 — Implement `promotionSweepDecider` (pure)

- Create `adws/core/promotionSweepDecider.ts`:
  - `import type { PromotionTagState } from './promotionTagState';` and re-export it.
  - `export type ReconcileFact = 'no-issue' | 'open' | 'merged' | 'closed-unmerged' | 'blocked';`
  - `export type PromotionAction = 'originate' | 'leave' | 'done' | 'decline' | 'redrive' |
    'withdraw';`
  - `export interface PromotionDecisionInput { tagState: PromotionTagState; meetsThreshold: boolean;
    reconcile: ReconcileFact; }`
  - `export function decidePromotionAction(input: PromotionDecisionInput): PromotionAction` encoding
    the **originate/leave/done subset** with guard clauses (max depth ≤ 2, per the coding
    guidelines):
    - `reconcile === 'merged'` → `'done'` (candidate already promoted; forward-compat/defensive).
    - `input.tagState === 'none' && input.meetsThreshold && input.reconcile === 'no-issue'` →
      `'originate'` (fresh high scorer, nothing in flight).
    - everything else → `'leave'` (below-threshold with nothing in flight; already `suggested`/in
      flight; `declined` terminal; and the deferred `closed-unmerged` / `blocked` facts whose
      `decline`/`withdraw`/`redrive` handling is the sibling reconcile slice).
  - Add a short comment block documenting the full decision table and marking the deferred facts.

### Task 5 — Unit test `promotionSweepDecider`

- Create `adws/core/__tests__/promotionSweepDecider.test.ts` — table-driven over the full cross
  product `{tagState: none|suggested|declined} × {meetsThreshold: true|false} × {reconcile: no-issue|
  open|merged|closed-unmerged|blocked}` asserting the single expected action. Explicit named cases:
  - fresh high scorer (`none`, `true`, `no-issue`) → `originate`;
  - below-threshold fresh (`none`, `false`, `no-issue`) → `leave`;
  - already in-flight (`suggested`, any, `open`) → `leave`;
  - merged → `done` regardless of tag/threshold;
  - declined (any, any, any non-merged) → `leave`;
  - deferred facts (`closed-unmerged`, `blocked`) → `leave` (documented placeholder for the
    reconcile slice).

### Task 6 — Implement `promotionReconcileLink` (pure)

- Create `adws/core/promotionReconcileLink.ts`:
  - `export interface PromotionIssueRef { number: number; body: string; }`
  - `export function parsePromotesMarker(body: string): string | null` — matches a
    `Promotes: feature-N` line (`/^\s*Promotes:\s*(feature-\d+)\s*$/m`), returns the `feature-N`
    string or `null`.
  - `export function reconcilePromotionLink(feature: string, openIssues: readonly
    PromotionIssueRef[]): number | null` — returns the `number` of the first open issue whose body
    `parsePromotesMarker` equals `feature`, else `null` (multi-candidate → lowest issue number wins;
    document the tie-break).
  - `export function reconcileFactFor(feature: string, openIssues: readonly PromotionIssueRef[]):
    'open' | 'no-issue'` — `reconcilePromotionLink(...) !== null ? 'open' : 'no-issue'` (the subset
    fact the shell feeds the decider; `merged`/`closed-unmerged`/`blocked` require issue-state
    queries and are produced by the sibling reconcile slice).

### Task 7 — Unit test `promotionReconcileLink`

- Create `adws/core/__tests__/promotionReconcileLink.test.ts`:
  - `parsePromotesMarker`: matches a well-formed line; ignores prose merely mentioning
    "Promotes"; returns `null` when absent; tolerates leading/trailing whitespace.
  - `reconcilePromotionLink`: single match → that number; no match → `null`; multiple open issues
    promoting the same `feature-N` → lowest number (documented tie-break); distinct `feature-N`
    ids don't cross-match.
  - `reconcileFactFor`: `'open'` when linked, `'no-issue'` when not.

### Task 8 — Implement `promotionIssueBody` (pure)

- Create `adws/core/promotionIssueBody.ts`:
  - `export interface PromotionIssueInput { featureNumber: number; sourceFeaturePath: string;
    sourceStepDefPaths: readonly string[]; destinationRegressionDir: string; vocabularyRegistryPath:
    string; phrases: readonly string[]; score?: number; }`
  - `export interface PromotionIssueSpec { title: string; body: string; labels: readonly string[]; }`
  - `export function buildPromotionIssue(input: PromotionIssueInput): PromotionIssueSpec`:
    - `labels: [ADW_FEATURE_LABEL, ADW_REGRESSION_PROMOTION_LABEL, 'hitl']` — import the label
      constants from `labelManager` (`'adw:feature'` via `ADW_CLASSIFICATION_LABELS`/a named const,
      `regression-promotion` via the Task 3 constant, `hitl` as a literal or a shared const).
    - `title`: e.g. `feat: promote #${featureNumber} scenario into the @regression suite`.
    - `body`: a #734-shaped Markdown instruction containing, at minimum:
      - the `Promotes: feature-${featureNumber}` marker line (own line, machine-parseable);
      - a **What to do** section: `git mv` the source `.feature` and each step-def path into
        `${destinationRegressionDir}` (feature under an appropriate subdir; step-defs under
        `${destinationRegressionDir}step_definitions/`), add a feature-level `@regression` tag,
        register the scenario's phrases in `${vocabularyRegistryPath}` with rubric-compliant
        descriptions, and do not rewrite relative step-def imports;
      - the **source paths** (`sourceFeaturePath`, `sourceStepDefPaths`) and the **phrases** list;
      - an **Acceptance** section demanding the `@regression` pass executes the moved scenarios green
        (`prove @regression green`), the old per-issue paths are gone, and no ambiguous-step error;
      - a note that `hitl` is set — the PR must be human-approved before merge.
- Per PRD Testing Decisions, `promotionIssueBody` is **integration/BDD-covered**, not unit-tested in
  isolation — do not add a `promotionIssueBody.test.ts`.

### Task 9 — Implement the `runPromotionSweep` shell + CLI

- Create `adws/triggers/promotionSweep.ts`, mirroring `perIssueScenarioSweep.ts`:
  - Constants: `const PER_ISSUE_DIR = 'features/per-issue';` and
    `const FEATURE_FILENAME_RE = /^feature-(\d+)\.feature$/;`.
  - `export interface PromotionSweepDeps { now?: () => Date; listPerIssueFeatures?: () => string[];
    readFeatureContent?: (path: string) => string | null; loadVocabulary?: () => string; loadStats?:
    () => PromotionStats; listOpenPromotionIssues?: () => PromotionIssueRef[]; scenariosConfig?: {
    perIssueDir: string; regressionDir: string; vocabPath: string }; tagAndCommit?: (path: string,
    newContent: string, message: string) => void; fileIssue?: (spec: PromotionIssueSpec) => void;
    log?: (msg: string, level?: string) => void; }`
  - `export interface PromotionSweepReport { originated: number[]; left: string[]; }` (feature
    numbers originated; paths left) — a small structured result for tests/logging.
  - Production defaults (each wrapped so a failure degrades safely, exactly like the mirror):
    - `listPerIssueFeatures`: `ctx.lsFiles(ctx.basePath, PER_ISSUE_DIR).filter(FEATURE_FILENAME_RE
      on basename)`.
    - `readFeatureContent`: `fs.readFileSync(join(ctx.basePath, path))` → `string | null`.
    - `loadVocabulary`: `fs.readFileSync(vocabPath, 'utf-8')` (vocabPath from scenarios config,
      default `features/regression/vocabulary.md`).
    - `loadStats`: `() => loadPromotionStats({ gitLogSince: (o) => ctx.logSince(o), now: () => new
      Date(), perIssueGlob: 'features/per-issue/**/*.feature' })`.
    - `listOpenPromotionIssues`: parse `JSON.parse(ctx.listOpenIssues({ fields: ['number', 'body'],
      search: 'label:"regression-promotion"', limit: 100 }))` into `PromotionIssueRef[]`.
    - `tagAndCommit(path, newContent, message)`: `fs.writeFileSync(join(ctx.basePath, path),
      newContent)`; **default-branch guard** (`ctx.getCurrentBranch(ctx.basePath) !==
      ctx.defaultBranch()` → log + return, as in `defaultPersistRemoval`); then
      `ctx.addAndCommitPaths([path], message, ctx.basePath)` and, if committed,
      `ctx.pushBranch(ctx.defaultBranch(), ctx.basePath)`.
    - `fileIssue(spec)`: `const url = ctx.createIssue(spec.title, spec.body);` then apply each of
      `spec.labels` via `applyLabel(extractIssueNumber(url), label, repoInfo)` (from `labelManager`;
      `extractIssueNumber` parses the trailing number from the returned issue URL).
    - `scenariosConfig`: from `loadProjectConfig(ctx.basePath).scenarios` (fallback to the documented
      defaults).
  - `export async function runPromotionSweep(deps?: PromotionSweepDeps): Promise<PromotionSweepReport>`:
    1. Resolve all deps (`?? default`), `openIssues = listOpenPromotionIssues()`, `threshold =
       computeThreshold(loadStats())`, `registry = parseVocabulary(loadVocabulary())`.
    2. For each tracked file (guard-clause skips for unrecognised filename / unreadable content /
       parse error — `continue` with a `warn` log, never throw):
       - `featureNumber` from `FEATURE_FILENAME_RE`; `feature = \`feature-${featureNumber}\``.
       - `content = readFeatureContent(path)`; `tagState = parsePromotionTagState(content)`.
       - `scenarios = parseScenarios(content, path)`; `meetsThreshold = scenarios.length > 0 &&
         Math.max(...scenarios.map(s => score(s, registry, registry.surfaceExamples).total)) >=
         threshold` (whole-file qualifies on its best scenario).
       - `reconcile = reconcileFactFor(feature, openIssues)`.
       - `action = decidePromotionAction({ tagState, meetsThreshold, reconcile })`.
       - `switch (action)`:
         - `'originate'`: `date = isoDate(now())`; `newContent = serializePromotionTagState(content,
           'suggested', { date })`; `tagAndCommit(path, newContent, \`chore: mark ${feature}
           promotion-suggested\`)`; build `spec = buildPromotionIssue({ featureNumber,
           sourceFeaturePath: path, sourceStepDefPaths: <step-def siblings for N>,
           destinationRegressionDir, vocabularyRegistryPath, phrases: <deduped step texts>, score })`;
           `fileIssue(spec)`; push `featureNumber` to `report.originated`. **Wrap this whole block in
           try/catch** — a transient git/gh failure is logged (`warn`) and swallowed; the next file
           still processes.
         - `'leave'` / `'done'`: log at `info` and record in `report.left`.
    3. Return `report`.
  - The step-def siblings for the issue-body input: reuse the per-issue step-def glob
    (`features/per-issue/step_definitions/feature-${N}.*`) via `ctx.lsFiles` in a small default
    helper (mirror `defaultListStepDefSiblings` in `perIssueScenarioSweep.ts`); make it injectable if
    convenient, else compute inside the default `fileIssue`/originate path.
  - CLI entry: `if (import.meta.main) { runPromotionSweep().then(r => log(\`promotionSweep: originated
    ${r.originated.length} issue(s)\`, 'info')).catch(e => { log(\`promotionSweep: fatal ${e}\`,
    'error'); process.exit(1); }); }`. (The shell itself never throws in normal operation; this
    catch is a belt-and-braces for programmer error.)
  - **Do not** wire `runPromotionSweep` into `adws/triggers/trigger_cron.ts` — the issue is explicit
    that this is not yet wired into cron.

### Task 10 — Author the BDD behavioural proof (`@adw-740`)

- The `scenario_writer` / `generate_step_definitions` phases will author
  `features/per-issue/feature-740.feature` (+ steps) tagged `@adw-740`. The scenarios drive
  `runPromotionSweep` with **injected fake `PromotionSweepDeps`** (no real git/gh), asserting the
  externally-observable behaviour (per PRD Testing Decisions — assert outcomes, not internals):
  - **Originate:** a fresh (`tagState: none`) high-scoring file with no linked open issue →
    `tagAndCommit` is called once with content whose `Feature:` line now carries
    `@promotion-suggested-<date>`, and `fileIssue` is called once with labels `['adw:feature',
    'regression-promotion', 'hitl']` and a body containing `Promotes: feature-N`.
  - **Leave (idempotent):** a file already `@promotion-suggested-*` whose `feature-N` matches an open
    promotion issue → neither `tagAndCommit` nor `fileIssue` is called.
  - **Done:** (decider-level) a `merged` reconciliation fact → `done`; and structurally, a merged
    file absent from the per-issue listing is never processed.
  - **Below threshold:** a low-scoring fresh file → left untouched.
  - **Non-fatal:** an injected `fileIssue` that throws → the error is swallowed, the sweep returns,
    and a following file is still processed.
  - **One issue per file:** two qualifying files → exactly two `fileIssue` calls.

### Task 11 — Run the Validation Commands (zero regressions)

- Execute every command in the **Validation Commands** section below and confirm all pass with zero
  regressions.

## Testing Strategy

### Unit Tests

`.adw/project.md` declares `## Unit Tests: enabled`, so unit tests are included. Following the PRD's
Testing Decisions (assert externally-observable behaviour; the shell + `promotionIssueBody` are
BDD/integration-covered, not unit-tested against git/gh mocks):

- **`promotionSweepDecider`** (`adws/core/__tests__/promotionSweepDecider.test.ts`) — the
  highest-value target. Table-driven over the full `{tagState} × {meetsThreshold} × {reconcile}`
  cross product, asserting the single correct action for every cell, including the named lifecycle
  edges (fresh high scorer → `originate`; in-flight → `leave`; merged → `done`; declined → `leave`;
  deferred facts → `leave`).
- **`promotionReconcileLink`** (`adws/core/__tests__/promotionReconcileLink.test.ts`) — the
  `Promotes: feature-N` marker parser and the linkage/fact resolver over no-match, single-match, and
  multi-candidate inputs (the direct test of the reconciliation key that this PRD introduces).
- **`addAndCommitPaths`** (added to `adws/gitContext/__tests__/commitOps.test.ts`) — the new scoped
  commit primitive, mirroring the existing `removeAndCommitPaths` command-shape/no-op tests with a
  fake `Runner`.

Not unit-tested (integration/BDD-covered, per PRD): `promotionIssueBody` and the `runPromotionSweep`
shell — exercised via the `@adw-740` BDD scenarios by injecting fake deps.

### Edge Cases

- A per-issue file with a filename not matching `feature-N.feature` → skipped with a `warn` log.
- An unreadable file (`readFeatureContent` returns `null`) or a `scenarioParser` throw → skipped
  (`warn`), never fatal.
- A file scoring below threshold → `leave`; no marker written, no issue filed.
- A file already `@promotion-suggested-*` with a matching open promotion issue → `leave`; no
  duplicate issue, no re-commit (idempotent).
- A file already `@promotion-declined` → `leave` (terminal; never re-suggested).
- The checkout is **not** on the default branch → `tagAndCommit` skips persistence (logged), no
  mutation.
- A transient git/gh failure inside originate (`createIssue`/commit/push throws) → logged (`warn`)
  and swallowed; the sweep continues to the next file and returns normally; the next run self-heals.
- Multiple qualifying files in one run → exactly one issue filed per file.
- `reconcilePromotionLink` with two open issues promoting the same `feature-N` → deterministic
  lowest-number tie-break.
- A merged promotion (file already `git mv`-ed out of `features/per-issue/`) → absent from the
  tracked-files listing, so never re-processed (`done` by construction).
- The scoped commit stages **only** the feature file's path — unrelated dirty state on the host is
  left untouched (never `git add -A`).

## Acceptance Criteria

- Running the sweep by hand (`bunx tsx adws/triggers/promotionSweep.ts`) against a repo with a fresh
  high-scoring per-issue file writes `@promotion-suggested-<date>` to that file on the default branch
  via a **scoped commit** (only that path; never `git add -A`).
- Exactly one `adw:feature` + `regression-promotion` + `hitl` issue is filed per qualifying file,
  with a `Promotes: feature-N` body marker and a #734-shaped relocation instruction (source feature +
  step-def paths, the scenario's phrases, destination `features/regression/` dir, vocabulary registry
  path, and a "prove `@regression` green" acceptance).
- A file already tagged `@promotion-suggested-*` with an open promotion issue is left untouched
  (idempotent — no duplicate issue, no re-commit).
- A file whose promotion PR has merged (file gone from `features/per-issue/`) is treated as done (not
  re-processed).
- The shell is non-fatal: a transient git/gh error is logged and swallowed, never thrown.
- `promotionSweepDecider` and `promotionReconcileLink` are pure and unit-tested over their input
  cross-product.
- The `@adw-740` BDD scenarios pass, and the full `@regression` suite and all validation commands
  pass with zero regressions.

## Validation Commands

Execute every command to validate the feature works correctly with zero regressions. (Commands from
`.adw/commands.md`.)

- `bun run lint` — linter passes.
- `bunx tsc --noEmit` — root type-check passes.
- `bunx tsc --noEmit -p adws/tsconfig.json` — ADW type-check passes (the new modules and the widened
  `GitContext`/`commitOps` surface resolve).
- `bun run build` — build succeeds.
- `bun run test:unit` — the full unit suite passes, including the new
  `promotionSweepDecider.test.ts`, `promotionReconcileLink.test.ts`, and the added
  `addAndCommitPaths` cases in `commitOps.test.ts`, with zero regressions.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-740"` — the feature's BDD scenarios are
  discovered with all steps defined and pass (originate / leave / done / non-fatal / scoped-commit /
  one-issue-per-file).
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — the full regression suite runs
  green with no ambiguous-step errors (zero regressions).

> Note: the manual sweep against a **live** repo (`bunx tsx adws/triggers/promotionSweep.ts`) is the
> acceptance *demonstration*, not an automated validation command — it creates real commits/issues
> and must only be run against a disposable test repo, never as part of `bun run test:unit`.

## Notes

- If `.adw/coding_guidelines.md` exists (it does), strictly adhere to it: pure functions with
  isolated I/O at the boundary (the deciders/builder are pure; all git/gh/fs lives behind
  `PromotionSweepDeps`), immutable data (return new strings/objects), guard clauses over nested
  conditionals (max depth ~2), files under 300 lines, no `any`, explicit types, and declarative
  array methods over imperative loops where it reads cleanly.
- **No new library is required** — every dependency (the scorer/threshold/parsers/statsLoader/
  tagState, `GitContext`, `projectConfig`, `labelManager`) already exists. (Per `.adw/commands.md`,
  the library install command, if ever needed, is `bun add <package>`.)
- **Deviation from the issue's "Touched Files" list (intentional, required):** the issue lists five
  files, but honouring the *"scoped commit, never `git add -A`"* acceptance criterion requires a
  scoped **modify-and-commit** primitive that does not exist today (`commitChanges` uses `git add
  -A`; `removeAndCommitPaths` only removes). This plan therefore also touches
  `adws/gitContext/commitOps.ts` and `adws/gitContext/gitContext.ts` (additive `addAndCommitPaths`,
  mirroring `removeAndCommitPaths`) plus its test. `commitOps.ts` is owned by `feature-t6m62c`
  (adwUpgrade regen) — the addition is purely additive and does not touch the
  `committableExcludePaths` / upgrade-regen code path, so it is low-collision with the #729/#730
  commitOps work. Flag this in the PR description.
- **Scope boundary (originate half only):** `promotionSweepDecider` emits only `originate | leave |
  done` this slice. The `decline | redrive | withdraw` actions and the `closed-unmerged | blocked`
  reconciliation facts (which need tracking-issue *state* queries) are the sibling **reconcile-path**
  slice; the full action/fact unions are declared here for a stable type surface, and the deferred
  facts resolve to a conservative `leave` (no-op) so the originate sweep is correct and idempotent
  standalone. Do not add cron wiring, a decline marker writer, or a redrive path in this slice.
- **`merged`/`done` in the originate half:** the shell's reconcile fact is `open | no-issue` (from
  the `--state open` `regression-promotion` query). AC "merged → done" is satisfied structurally —
  a merged promotion has already `git mv`-ed the file out of `features/per-issue/`, so it is absent
  from the tracked-files listing and never re-processed. The decider's `done` branch (reconcile ===
  `'merged'`) is the forward-compat/defensive hook, unit-tested but not emitted by this slice's shell.
- **Label invisibility invariant:** `regression-promotion` must NOT be added to
  `ADW_CLASSIFICATION_LABELS` — it is intentionally invisible to `LABEL_TO_COMMAND`, so `adw:feature`
  (also on the promotion issue) deterministically routes it through the normal `/feature` pipeline.
- **`@adw-{issueNumber}` optional-tag invariant (PRD, must preserve):** a promotion issue has zero
  `@adw-{promotionIssueN}` scenarios; the pipeline stays green only because `@adw-{issueNumber}`
  remains `optional: true` in the review-proof defaults. This slice does not change that — but do not
  add scenario authoring for the promotion issue itself (the authoring-skip gate is a separate PRD
  slice keyed on the `regression-promotion` label).
- **Idempotency of the marker write:** `serializePromotionTagState(content, 'suggested', { date })`
  is byte-idempotent for the same `date`, and `addAndCommitPaths` no-ops (returns `false`) when
  nothing is staged for the path — so a re-run on an already-tagged file that the decider routes to
  `originate` (only when `tagState: none`) cannot double-commit; and the `leave` path never writes.
- **Reference:** `specs/issue-734-...promote-729-regression-scenario.md` is the canonical shape the
  issue body must reproduce (git mv feature + step-defs into `features/regression/`, feature-level
  `@regression` tag, rubric-compliant vocabulary rows, prove `@regression` green, `hitl` merge gate).

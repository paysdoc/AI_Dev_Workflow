# Feature: Rot/reuse advisory PR comment on promotion PRs

## Metadata
issueNumber: `743`
adwId: `2ubuuc-rot-reuse-advisory-p`
issueJson: `{"number":743,"title":"Rot/reuse advisory PR comment on promotion PRs","body":"## Parent PRD\n\n`specs/prd/automated-scenario-promotion-sweep.md` (PR #738)\n\n## What to build\n\nOn a `regression-promotion` PR, run the `promote-regression-vocabulary` advisory analysis over the promoted scenario's phrases and post the per-phrase reuse/rot verdicts as a single PR comment, so the maintainer reviews the vocabulary changes with verdicts in hand. The comment is advisory and non-blocking — a fallible rot verdict must never block a legitimate promotion.\n\nSee PRD user stories 12-13 and Implementation Decision \"Pipeline modifications\".\n\n## Acceptance criteria\n\n- [ ] A PR labelled `regression-promotion` receives one comment containing per-phrase reuse and rot verdicts for the promoted scenario's Given/When/Then steps\n- [ ] The comment never blocks, fails, or gates the workflow (advisory only)\n- [ ] A non-promotion PR receives no such comment\n- [ ] Analysis failure degrades to a warning, never crashes the pipeline\n\n## Blocked by\n\n- Blocked by #740\n\n## Touched Files\n\n- adws/phases/reviewPhase.ts\n\n## User stories addressed\n\n- User story 12\n- User story 13","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-07-08T11:43:07Z","comments":[],"actionableComment":null}`

## Feature Description

When ADW's automated scenario-promotion sweep files a promotion issue, that issue is labelled `[adw:feature, regression-promotion, hitl]` and flows through the **normal SDLC pipeline** (`adwSdlc.tsx`, verified via `issueTypeToOrchestratorMap['/feature'] = 'adws/adwSdlc.tsx'`). The pipeline's build agent moves the promoted `.feature` file and its step-definitions into `features/regression/`, registers vocabulary, and opens a `hitl`-gated PR that the maintainer must approve.

This feature adds an **advisory** step to that pipeline: on a promotion workflow, run the `promote-regression-vocabulary` analysis over the promoted scenario's Given/When/Then phrases and post the per-phrase **reuse** (is this phrase already registered?) and **rot** (does the backing step assert an observable behaviour, or a source-code property?) verdicts as a **single PR comment**. The maintainer then reviews the vocabulary changes with a per-phrase verdict table in hand rather than eyeballing raw Gherkin.

The step is strictly advisory and non-blocking: it posts a comment and nothing else. It never fails the workflow, never gates the merge, and any analysis error degrades to a logged warning. A fallible automated rot verdict must never block a legitimate promotion — the decision stays with the human at the `hitl` merge gate.

## User Story

As an ADW maintainer reviewing an automated regression-promotion PR
I want an advisory per-phrase reuse/rot analysis of the promoted scenario posted as a PR comment
So that I can judge the vocabulary changes with verdicts in hand, while retaining full control — the automated verdict informs but never blocks the promotion.

(PRD User Stories 12 and 13.)

## Problem Statement

A promotion PR moves a per-issue scenario into the executed `@regression` suite, which means its Given/When/Then phrases become part of the permanent regression vocabulary. Two failure modes matter at that moment:

1. **Reuse/collision** — the promoted scenario may mint a near-duplicate of an already-registered phrase instead of reusing the canonical one, fragmenting the vocabulary.
2. **Rot** — a phrase whose step definition asserts a *source-code property* (file exists, line count, `readFileSync(...).includes(...)`) rather than an *observable system behaviour* is "rot" and should be reworked before it enters the regression suite.

Today the maintainer must catch both by hand-reading the moved Gherkin and its step definitions during PR review. That is exactly the analysis the `promote-regression-vocabulary` skill automates — but nothing runs it on the promotion PR, so its verdicts never reach the reviewer. The PRD ("Pipeline modifications") calls for wiring this analysis in as an advisory PR comment.

## Solution Statement

Add one **non-fatal, advisory** orchestration step to the SDLC pipeline, mirroring the existing `executeProofPublishPhase` pattern (a post-PR, try/catch-wrapped phase that posts a single PR comment and swallows all errors):

1. **Detect a promotion workflow** by a pure predicate over `config.issue.labels` — true only when the driving issue carries the `regression-promotion` label. Non-promotion workflows no-op (no comment), satisfying "a non-promotion PR receives no such comment". Detection needs no extra I/O: promotion issues are labelled by `buildPromotionIssue` and the labels are already on `config.issue`.
2. **Scope the analysis** to the promoted scenario by reusing `parsePromotesMarker(config.issue.body)` (from `promotionReconcileLink.ts`) to recover the `feature-N` id that the promotion issue links back to.
3. **Run the advisory analysis** via a thin new agent (`rotAnalysisAgent.ts`) that wraps a new `/promote_regression_vocabulary` slash command. The command invokes the existing `promote-regression-vocabulary` skill (single source of truth for the rot rubric and phrase registry) over the promoted scenario in the worktree and returns structured per-step verdicts, extracted and schema-validated through the established `runCommandAgent` path (same pattern as `diffEvaluatorAgent`).
4. **Format one comment** with a pure `formatRotAdvisoryComment(feature, verdicts)` (a Markdown header marking it advisory/non-blocking, plus the skill's per-step reuse/rot table).
5. **Post exactly one PR comment** via `repoContext.codeHost.commentOnPullRequest(prNumber, body)`, using the PR number resolved from `ctx.prNumber ?? extractPrNumber(ctx.prUrl)`.

The new function `executePromotionRotAdvisory(config)` lives in the issue's named touched file `adws/phases/reviewPhase.ts` and is wired into `adwSdlc.tsx` **after** `executePRPhase` (adjacent to `executeProofPublishPhase`). This ordering is load-bearing and is the one subtlety of the feature: in the SDLC pipeline the PR is created *after* the review phase, so `ctx.prUrl`/`ctx.prNumber` do not exist during review — the advisory must run post-PR to have a PR to comment on. The whole function is wrapped so that any failure (label absent, no PR, no marker, agent error, output-validation failure) returns quietly as a zero-cost phase result and never throws.

## Relevant Files

Use these files to implement the feature:

### Existing files to modify

- `adws/phases/reviewPhase.ts` — **the named touched file.** Add the new exported `executePromotionRotAdvisory(config: WorkflowConfig)` orchestration function here. Keep it thin (delegates to the new agent + formatter + predicate) so the file stays well under the 300-line guideline (currently 244 lines). Mirror the non-fatal shape of `executeProofPublishPhase`.
- `adws/adwSdlc.tsx` — wire `await runPhase(config, tracker, executePromotionRotAdvisory)` in **after** `executePRPhase` (line 137) and adjacent to `executeProofPublishPhase` (line 138), inside the review-passed branch. This is the only orchestrator that runs promotion issues (`/feature` → `adwSdlc.tsx`, verified), so it is the single wiring point.
- `adws/workflowPhases.ts` and `adws/phases/index.ts` — re-export `executePromotionRotAdvisory` (mirror the two existing `executeProofPublishPhase` re-exports at `workflowPhases.ts:52` and `phases/index.ts:57`) so `adwSdlc.tsx`'s barrel import resolves.
- `adws/github/labelManager.ts` — add a pure predicate `hasRegressionPromotionLabel(labels)` next to the existing `ADW_REGRESSION_PROMOTION_LABEL = 'regression-promotion'` constant (line 32). Single source of truth for the detection gate.
- `adws/types/issueTypes.ts` — add `'/promote_regression_vocabulary'` to the `SlashCommand` union (line 26) so the new agent can be routed through `runCommandAgent`.
- `adws/core/modelRouting.ts` — add the new command to the three exhaustive `Record<SlashCommand, …>` maps: `SLASH_COMMAND_MODEL_MAP` (→ `'sonnet'`), `SLASH_COMMAND_MODEL_MAP_FAST` (→ `'haiku'`), and `SLASH_COMMAND_EFFORT_MAP` (→ `'medium'`). Omitting any one is a compile error (this is the deliberate three-touch-point safety net).

### Existing files to reuse (read-only)

- `adws/phases/proofPublishPhase.ts` — the **template** for the new function: post-PR, non-fatal, single PR comment, try/catch that logs a warning and swallows, zero-cost `PhaseCostRecord`.
- `adws/agents/diffEvaluatorAgent.ts` — the **template** for the new agent: `runCommandAgent<T>` with an `outputSchema`, an `extractOutput` returning `ExtractionResult<T>`, a thin `run…Agent(args, options)` export.
- `adws/agents/commandAgent.ts` — `runCommandAgent`, `CommandAgentOptions`, `ExtractionResult`, `OutputValidationError` (thrown after retries exhaust — must be caught by the advisory step).
- `adws/core/promotionReconcileLink.ts` — `parsePromotesMarker(body)` to recover the promoted `feature-N` id from the issue body.
- `adws/phases/phaseCommentHelpers.ts` — `postPRStageComment` shows the idiomatic `repoContext.codeHost.commentOnPullRequest(prNumber, comment)` PR-comment path wrapped in try/catch.
- `adws/adwBuildHelpers.ts` — `extractPrNumber(ctx.prUrl)` PR-number derivation.
- `adws/phases/workflowInit.ts` — `WorkflowConfig` (fields consumed: `issue`, `issueNumber`, `worktreePath`, `logsDir`, `adwId`, `ctx`, `repoContext`, `gitContext`).
- `.claude/skills/promote-regression-vocabulary/SKILL.md` and `.claude/skills/promote-regression-vocabulary/scripts/list-registered-phrases.ts` — the advisory rubric, the registry lister, and the exact per-step table format to mirror.
- `adws/phases/__tests__/reviewPhase.test.ts` — the phase-test style (`vi.hoisted`, `vi.mock` of `../../github`/`../../core`/`../../cost`, `baseConfig` cast) to extend.
- `adws/agents/__tests__/scenarioFidelityAgent.test.ts` — the pure agent-extractor test style (asserting on the `ExtractionResult` union).

### New Files

- `.claude/commands/promote_regression_vocabulary.md` — thin slash-command prompt. Instructs the agent to use the `promote-regression-vocabulary` skill to analyse the promoted scenario (identified by the `feature-N` id passed as `$ARGUMENTS`, now located under `features/regression/`), then output **only** a JSON array of per-step verdict objects `{ step, keyword, reuse, rot, note }`. No edits, no writes (matches the skill's own guardrails).
- `adws/agents/rotAnalysisAgent.ts` — wraps `/promote_regression_vocabulary` via `runCommandAgent`. Exports the `RotVerdict` type, `rotAnalysisSchema` (JSON Schema), the pure `extractRotVerdicts(output): ExtractionResult<RotVerdict[]>`, and `runRotAnalysisAgent(feature, options)`.
- `adws/phases/rotAdvisoryFormat.ts` — pure formatter `formatRotAdvisoryComment(feature: string, verdicts: RotVerdict[]): string` producing the advisory Markdown comment (header + per-step table). No I/O.
- `adws/agents/__tests__/rotAnalysisAgent.test.ts` — unit tests for `extractRotVerdicts`.
- `adws/phases/__tests__/rotAdvisoryFormat.test.ts` — unit tests for `formatRotAdvisoryComment` and `hasRegressionPromotionLabel`.

### Conditional docs (matched via `.adw/conditional_docs.md`)

- `app_docs/feature-cudwfe-passive-judge-review-phase.md` — matches "working with `adws/phases/reviewPhase.ts`".
- `app_docs/feature-u8xr9v-output-validation-retry-loop.md` — matches "adding structured output to a new agent … `ExtractionResult<T>`/`OutputValidationError`/`outputSchema`" (the new `rotAnalysisAgent`).
- `app_docs/feature-add-resoning-effort-4wna6z-reasoning-effort-slash-commands.md` — matches "adding a new slash command that needs an effort level assigned" and `SLASH_COMMAND_EFFORT_MAP`.

## Implementation Plan

### Phase 1: Foundation (pure, unit-testable pieces — no wiring yet)

1. Add the pure detection predicate `hasRegressionPromotionLabel(labels)` in `labelManager.ts`.
2. Add the new slash command to the `SlashCommand` union and the three model/effort routing maps (`modelRouting.ts`). This is mechanical and compile-checked.
3. Create the `/promote_regression_vocabulary` command file that delegates to the existing skill and constrains output to a JSON array.
4. Create `rotAnalysisAgent.ts` (type + schema + `extractRotVerdicts` + `runRotAnalysisAgent`) modelled on `diffEvaluatorAgent.ts`.
5. Create the pure `formatRotAdvisoryComment` in `rotAdvisoryFormat.ts`.

### Phase 2: Core Implementation (the advisory step)

6. Add `executePromotionRotAdvisory(config)` to `reviewPhase.ts`, composing the Phase-1 pieces: gate on the label predicate → resolve PR number → recover `feature-N` → run agent (in the worktree) → format → post one PR comment, all inside a top-level try/catch that logs a warning and returns a zero-cost result on any failure. Never throws.

### Phase 3: Integration (wire into the pipeline)

7. Re-export `executePromotionRotAdvisory` from `workflowPhases.ts` and `phases/index.ts`.
8. Wire the call into `adwSdlc.tsx` after `executePRPhase`, in the review-passed branch, via `runPhase`.
9. Run the full validation suite and confirm zero regressions.

## Step by Step Tasks

Execute every step in order, top to bottom.

### Task 1 — Detection predicate

- In `adws/github/labelManager.ts`, next to `ADW_REGRESSION_PROMOTION_LABEL`, add and export a pure function `hasRegressionPromotionLabel(labels: readonly { name: string }[]): boolean` returning `labels.some(l => l.name === ADW_REGRESSION_PROMOTION_LABEL)`. Add a short JSDoc noting it gates the promotion-only advisory step (User Story 12/13) and that detection keys off the *issue* label because promotion issues carry `regression-promotion` (`buildPromotionIssue`).

### Task 2 — Route the new slash command

- In `adws/types/issueTypes.ts`, add `'/promote_regression_vocabulary'` to the `SlashCommand` union.
- In `adws/core/modelRouting.ts`, add `'/promote_regression_vocabulary'` to `SLASH_COMMAND_MODEL_MAP` (`'sonnet'`), `SLASH_COMMAND_MODEL_MAP_FAST` (`'haiku'`), and `SLASH_COMMAND_EFFORT_MAP` (`'medium'`). Confirm `bunx tsc --noEmit -p adws/tsconfig.json` still compiles (the exhaustive `Record<SlashCommand, …>` maps will fail loudly if any is missed).

### Task 3 — Slash-command prompt file

- Create `.claude/commands/promote_regression_vocabulary.md`. It must:
  - Take the promoted feature id (`feature-N`) as `$ARGUMENTS`.
  - Instruct the agent to use the `promote-regression-vocabulary` skill to analyse that scenario's Given/When/Then steps (the file has been moved into `features/regression/` by the build phase; the skill greps `features/**` and reads the backing step definitions).
  - Reproduce the two-verdict contract (reuse + rot) and the rubric summary so the command is self-contained.
  - Require output to be **only** a JSON array `[{ "step": string, "keyword": "Given"|"When"|"Then"|"And"|"But", "reuse": string, "rot": "VALID"|"ROT"|"UNKNOWN", "note": string }]` — no prose, no edits, no file writes.

### Task 4 — Advisory analysis agent

- Create `adws/agents/rotAnalysisAgent.ts` modelled on `diffEvaluatorAgent.ts`:
  - `export type RotVerdict = { step: string; keyword: string; reuse: string; rot: 'VALID' | 'ROT' | 'UNKNOWN'; note: string };`
  - `export const rotAnalysisSchema` — a JSON Schema for an array of `RotVerdict` (an object wrapper `{ steps: RotVerdict[] }` is acceptable if that is easier for `runCommandAgent`'s schema handling; keep the wrapper choice consistent with the command output and the extractor).
  - `export function extractRotVerdicts(output: string): ExtractionResult<RotVerdict[]>` — locate and `JSON.parse` the array (tolerate fenced code blocks / surrounding prose), validate each entry's shape, coerce an unknown `rot` value to `'UNKNOWN'`, and return `{ success: false, error }` on any parse/shape failure (never throw).
  - `export async function runRotAnalysisAgent(feature: string, options: Omit<CommandAgentOptions, 'args'>)` — call `runCommandAgent<RotVerdict[]>({ command: '/promote_regression_vocabulary', agentName: 'rot-analysis', outputFileName: 'rot-analysis-agent.jsonl', extractOutput: extractRotVerdicts, outputSchema: rotAnalysisSchema }, { ...options, args: feature })`. Callers pass `cwd: worktreePath` and `subprocessEnv` so the skill runs against the moved files with correct auth.

### Task 5 — Pure comment formatter

- Create `adws/phases/rotAdvisoryFormat.ts` exporting `formatRotAdvisoryComment(feature: string, verdicts: RotVerdict[]): string`:
  - A header that names it an **advisory, non-blocking** rot/reuse analysis for the promoted `feature-N` scenario.
  - A Markdown table `| Step (G/W/T) | Reuse | Rot | Note |` with one row per verdict (mirror `.claude/skills/promote-regression-vocabulary/SKILL.md`'s table).
  - A stable "no phrases analysed" fallback line when `verdicts` is empty (so the function is total).
  - Pure: same input → same string, no I/O.

### Task 6 — Advisory orchestration step in reviewPhase.ts

- In `adws/phases/reviewPhase.ts`, add `export async function executePromotionRotAdvisory(config: WorkflowConfig): Promise<{ costUsd: number; modelUsage: ModelUsageMap; phaseCostRecords: PhaseCostRecord[] }>` mirroring `executeProofPublishPhase`:
  - `log('Phase: Promotion Rot Advisory', 'info')`.
  - Guard 1 (no comment path): if `!hasRegressionPromotionLabel(config.issue.labels)`, return a zero-cost result immediately (satisfies "a non-promotion PR receives no such comment").
  - Guard 2: resolve `prNumber = config.ctx.prNumber ?? extractPrNumber(config.ctx.prUrl)`; if absent, `log(..., 'warn')` and return zero-cost.
  - Guard 3: `feature = parsePromotesMarker(config.issue.body)`; if null, `log(..., 'warn')` and return zero-cost (cannot scope).
  - Body wrapped in `try { … } catch (err) { log(`Promotion rot advisory: unexpected error — ${err}`, 'warn'); }`:
    - `const result = await runRotAnalysisAgent(feature, { logsDir, cwd: worktreePath, issueBody: issue.body, subprocessEnv: config.gitContext?.commandEnv(), statePath, phaseName: 'promotionRotAdvisory' });`
    - `const body = formatRotAdvisoryComment(feature, result.parsed ?? []);`
    - Post exactly one comment: if `repoContext`, `repoContext.codeHost.commentOnPullRequest(prNumber, body)`; wrap this post in its own try/catch/log (never let a comment failure escape).
    - Capture `result.totalCostUsd`/`result.modelUsage` into the returned cost record.
  - Always return a valid `PhaseCostRecord[]` (phase `'promotionRotAdvisory'`, `PhaseCostStatus.Success`). The function must be `catch`-total — it never rejects. `OutputValidationError` from the agent's retry loop is caught here and degrades to a warning with no comment.

### Task 7 — Re-export and wire into the orchestrator

- Add `export { executePromotionRotAdvisory } from './reviewPhase';` to `adws/phases/index.ts` and the matching re-export in `adws/workflowPhases.ts` (mirror the existing `executeReviewPhase`/`executeProofPublishPhase` re-exports).
- In `adws/adwSdlc.tsx`, inside the review-passed branch, after `await runPhase(config, tracker, executePRPhase);` (line 137) and adjacent to `executeProofPublishPhase` (line 138), add `await runPhase(config, tracker, executePromotionRotAdvisory);`. Add `executePromotionRotAdvisory` to the existing barrel import from `./workflowPhases`. (Because the step no-ops for non-promotion issues, it is safe to run unconditionally for every SDLC workflow.)

### Task 8 — Unit tests

- `adws/agents/__tests__/rotAnalysisAgent.test.ts` — pure tests for `extractRotVerdicts`: a well-formed JSON array → `{ success: true, data }` with the parsed verdicts; a fenced/`prose-wrapped` array still parses; malformed JSON → `{ success: false }`; an entry with an out-of-range `rot` value → coerced to `'UNKNOWN'`; empty array → `{ success: true, data: [] }`.
- `adws/phases/__tests__/rotAdvisoryFormat.test.ts` — assert `formatRotAdvisoryComment` output **string** (per PRD testing philosophy: assert on the resulting content, not internals): contains the advisory/non-blocking header, the table header, one row per verdict with the right cells, and the empty-input fallback line. Also table-test `hasRegressionPromotionLabel` (present / absent / mixed labels / empty).
- Extend `adws/phases/__tests__/reviewPhase.test.ts` for `executePromotionRotAdvisory` (mock `../../agents/rotAnalysisAgent`, `../../github`, `../../core`, `../../cost` in the existing style):
  - Label absent → `commentOnPullRequest` **not** called, function resolves (no comment).
  - Label present + PR number present + marker present → `runRotAnalysisAgent` called once and `commentOnPullRequest` called **exactly once**.
  - `runRotAnalysisAgent` throws (or returns malformed → `OutputValidationError`) → function still **resolves** (does not reject) and posts **no** comment (never crashes the pipeline).
  - Label present but no PR number → no agent call, no comment, resolves.

### Task 9 — Validate

- Run every command in **Validation Commands** below and confirm zero regressions.

## Testing Strategy

### Unit Tests

`.adw/project.md` declares `## Unit Tests: enabled`, so unit tests are in scope. Following the PRD's testing philosophy (exercise externally-observable behaviour; for pure functions assert the returned value/string, never internal control flow):

- **`extractRotVerdicts` (`rotAnalysisAgent.test.ts`)** — the parse/validation boundary: valid array, prose/fence-wrapped array, malformed JSON, out-of-range `rot` coercion, empty array. Mirrors `scenarioFidelityAgent.test.ts`'s `ExtractionResult`-union assertions.
- **`formatRotAdvisoryComment` (`rotAdvisoryFormat.test.ts`)** — assert the produced Markdown string (header, per-step rows, empty fallback). Pure, deterministic.
- **`hasRegressionPromotionLabel` (`rotAdvisoryFormat.test.ts`)** — table-driven present/absent/mixed/empty.
- **`executePromotionRotAdvisory` (extend `reviewPhase.test.ts`)** — the four behaviours in Task 8: no-op-no-comment when label absent; exactly-one-comment on the happy path; never-throws / no-comment on agent failure; no-comment when PR number missing. These assert the two acceptance-critical invariants: "one comment on a promotion PR" and "never crashes / never gates".

### Edge Cases

- Non-promotion workflow (label absent) → no comment (primary negative case).
- Promotion workflow but PR not yet created / `ctx.prUrl` unset → warn, no comment (defensive; should not happen because the step runs after `executePRPhase`).
- `Promotes: feature-N` marker missing/malformed in the issue body → warn, no comment.
- Analysis agent throws, times out, or emits unparseable output exhausting the retry loop (`OutputValidationError`) → warn, no comment, workflow continues.
- `commentOnPullRequest` itself throws (transient gh error) → caught, warn, workflow continues.
- Empty verdict list (skill finds no phrases) → the formatter emits its stable fallback; a single, harmless comment is still posted.
- Resume: the step runs via `runPhase` like `executeProofPublishPhase`; a duplicate advisory comment on a resumed run is acceptable (advisory, non-blocking) and no worse than the existing proof-publish behaviour.

## Acceptance Criteria

- A promotion workflow (driving issue labelled `regression-promotion`) posts exactly **one** PR comment containing a per-step reuse/rot verdict table for the promoted scenario's Given/When/Then steps.
- A non-promotion workflow posts **no** such comment.
- The advisory step never blocks, fails, or gates the workflow: it returns a normal zero/low-cost phase result regardless of outcome, and the orchestrator does not branch on it.
- Any analysis failure (agent throw, timeout, unparseable output, comment-post error, missing PR/marker) degrades to a logged **warning** and the pipeline continues — `executePromotionRotAdvisory` never rejects.
- New and existing unit tests pass; lint, typecheck, and build are clean (zero regressions).

## Validation Commands

Execute every command to validate the feature works correctly with zero regressions. Commands are from `.adw/commands.md`.

- `bun install` — ensure dependencies are present (no new libraries required).
- `bun run lint` — lint the changed files for quality/style.
- `bunx tsc --noEmit` — root typecheck (catches missed `SlashCommand`/routing-map entries).
- `bunx tsc --noEmit -p adws/tsconfig.json` — ADW package typecheck (the exhaustive `Record<SlashCommand, …>` maps must all include the new command).
- `bun run test:unit` — run the full vitest suite; confirm the new `rotAnalysisAgent.test.ts`, `rotAdvisoryFormat.test.ts`, and extended `reviewPhase.test.ts` pass and nothing else regresses.
- `bun run build` — verify a clean build.

Optionally, to run only the new/affected tests during development:
- `bunx vitest run adws/agents/__tests__/rotAnalysisAgent.test.ts adws/phases/__tests__/rotAdvisoryFormat.test.ts adws/phases/__tests__/reviewPhase.test.ts`

## Notes

- **Strict adherence to `.adw/coding_guidelines.md`.** Keep `reviewPhase.ts` under 300 lines (the new function is thin and delegates to the agent + formatter + predicate). Use guard clauses / early returns (max ~2 nesting levels). Isolate side effects (the agent call and the comment post) behind the pure predicate/formatter. Prefer explicit types; no `any`; no decorators.
- **Load-bearing ordering.** The advisory must be wired **after** `executePRPhase`, not inside `executeReviewPhase` — in the SDLC flow the PR is created after review, so `ctx.prUrl`/`ctx.prNumber` are unset during review. The function nonetheless lives in `reviewPhase.ts` (the issue's named touched file) as a "review aid"; the alternative of a dedicated `promotionRotAdvisoryPhase.ts` sibling of `proofPublishPhase.ts` is equally valid if a reviewer prefers stronger file-level separation.
- **Detection keys off the issue label, not a PR-label fetch.** There is no helper that reads labels for an arbitrary PR by number (`fetchPRDetailsCmd` omits `labels`), and promotion PRs created by the SDLC pipeline are not guaranteed to inherit the label. The driving **issue** always carries `regression-promotion` (`buildPromotionIssue` labels it `[adw:feature, regression-promotion, hitl]`), and `config.issue.labels` is already in memory — so this is both correct and I/O-free, and it matches the PRD's own `shouldSkipScenarioAuthoring(labels)` gate. (If a future requirement demands detecting a hand-labelled PR whose issue lacks the label, add `labels` to `fetchPRDetailsCmd` or use `defaultFindPRByBranch(branchName).labels` — out of scope here.)
- **Skill vs. slash command.** The `promote-regression-vocabulary` analysis lives as a Claude Code **skill**, not a slash command. The plan adds a thin `/promote_regression_vocabulary` command that delegates to the skill so we can reuse ADW's structured-output `runCommandAgent` path (schema + retry). *Alternative (lighter, fewer touch points):* skip the `SlashCommand`-union/routing edits and call `runClaudeAgentWithCommand(promptString, …, 'sonnet', …)` directly from `rotAnalysisAgent.ts` with a free-form prompt that invokes the skill — `runClaudeAgentWithCommand`'s first argument is a bare string. The command-file path is preferred for consistency with every other ADW LLM agent; note the trade-off if the union churn is undesirable.
- **No new libraries** (`.adw/commands.md` install command is `bun add <package>` if one were ever needed).
- **PRD context (out of scope for this slice, do not regress):** the "empty-target-tag invariant" — a promotion issue has zero `@adw-{promotionIssueN}` scenarios and relies on `@adw-{issueNumber}` remaining `optional` in the review-proof defaults so the run does not redden. This advisory step adds only a comment and does not touch verdict computation, so it cannot affect that invariant.
- **Dead code:** `adws/promotion/` (mover/commenter/approval-detector) is effectively dead and slated for deletion by the parent PRD (User Story 23). Do **not** couple the new agent to `adws/promotion/scenarioParser.ts`/`types.ts`; let the skill read the moved feature file and step definitions itself. This keeps the feature independent of the deletion slice.
- **Blocked by #740** (promotion sweep originate path) per the issue; the originate path that files promotion issues is already present (`adws/triggers/promotionSweep.ts`), so this slice can be implemented and unit-validated independently, and exercised end-to-end once a promotion issue flows through `adwSdlc.tsx`.

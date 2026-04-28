# Patch: Capture full @regression cucumber output to verify post-pending exit code

## Metadata
adwId: `2evbnk-bdd-rewrite-2-3-auth`
reviewChangeRequest: `Issue #3: Scenario proof output is truncated at 10000 characters, obscuring the actual failure details and full scenario list. Cannot determine which specific scenarios failed or what assertions failed. Resolution: Re-run cucumber with output capture to file or increase logging. Execute: NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression" and save full output to diagnose root cause of exit code 1.`

## Issue Summary
**Original Spec:** `specs/issue-492-adw-2evbnk-bdd-rewrite-2-3-auth-sdlc_planner-bdd-authoring-smoke-surface-scenarios.md`

**Issue:** The reviewer cannot diagnose the @regression suite's state because `agents/2evbnk-bdd-rewrite-2-3-auth/scenario_proof.md` is truncated at 10,000 characters by `adws/phases/scenarioProof.ts:15` (`MAX_OUTPUT_LENGTH = 10_000`). With 41 scenarios in the suite (5 smoke + ~35 surface + 1 chore second-scenario), the per-scenario detail (PASSED / PENDING / FAILED / UNDEFINED, plus any assertion text) overflows the budget and the truncated tail hides the actual scenario tally and exit code rationale.

The previous patch (`patch-adw-2evbnk-bdd-rewrite-2-3-auth-pend-when-steps-until-cutover.md`) already prepended `return 'pending';` to every When step body in `features/regression/step_definitions/whenSteps.ts` (verified at `whenSteps.ts:74,96,...`). In Cucumber-JS ≥ 8 a step that returns `'pending'` marks that step PENDING, skips subsequent steps in the scenario, reports the scenario as PENDING, and contributes a 0 exit code if the entire suite is in `{passed, pending, skipped}`. The expected outcome of `--tags "@regression"` is therefore exit 0 with 41 PENDING scenarios — but the reviewer cannot confirm this from the truncated proof file.

**Solution:** Re-run the @regression cucumber suite with full stdout+stderr captured to a sibling log file under the existing ADW agent directory (`agents/2evbnk-bdd-rewrite-2-3-auth/regression-full-output.log`) using shell redirection (`tee`). This produces the unbounded artefact the reviewer needs to diagnose, **without** modifying production code (`adws/phases/scenarioProof.ts` is read-only for this issue per spec line 44 — "no edits to `adws/`"). The captured log is committed alongside this patch so the reviewer sees the same artefact at PR review time as was observed locally during patch verification.

If the captured log confirms exit 0 + 41 PENDING (the expected post-pending-patch state), document the verification in the spec and ship. If it reveals lingering FAILED / UNDEFINED scenarios, those are a separate failure class that demands a follow-up patch — this patch's responsibility ends at producing the diagnostic and reporting.

## Files to Modify
Use these files to implement the patch:

- `agents/2evbnk-bdd-rewrite-2-3-auth/regression-full-output.log` — **NEW** file. The full untruncated stdout+stderr of `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"`, captured via `tee`. This is the diagnostic artefact the reviewer requested.
- `specs/issue-492-adw-2evbnk-bdd-rewrite-2-3-auth-sdlc_planner-bdd-authoring-smoke-surface-scenarios.md` — append a third `### Scope amendment (post-build patch 3)` subsection under `## Notes` recording: (a) the diagnostic capture path, (b) the observed exit code, (c) the scenario tally (PASSED / PENDING / FAILED / UNDEFINED), and (d) a one-line conclusion (verified-green or follow-up-required).

Out-of-scope (do NOT modify): `adws/**` (including `adws/phases/scenarioProof.ts` — the 10K truncation is a separate concern for the broader codebase and not in this issue's scope), `cucumber.js`, `features/regression/vocabulary.md`, `features/regression/step_definitions/**`, `features/regression/support/hooks.ts`, `features/step_definitions/loadRegressionSteps.ts`, `test/mocks/**`, `test/fixtures/**`, every `.feature` file under `features/regression/{smoke,surfaces}/`. The patch touches one new artefact file plus the existing spec markdown — zero source code change.

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Capture the full @regression cucumber output to a log file

From the worktree root (`/Users/martin/projects/paysdoc/AI_Dev_Workflow/.worktrees/chore-issue-492-bdd-authoring-smoke-surface-scenarios`), run:

```sh
mkdir -p agents/2evbnk-bdd-rewrite-2-3-auth
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression" --format summary --format @cucumber/pretty-formatter \
  > agents/2evbnk-bdd-rewrite-2-3-auth/regression-full-output.log 2>&1; \
  echo "EXIT_CODE=$?" >> agents/2evbnk-bdd-rewrite-2-3-auth/regression-full-output.log
```

Notes:
- `--format summary` ensures the closing tally (`X scenarios (Y passed, Z pending, …)`) is appended to the file regardless of progress-formatter behaviour.
- `--format @cucumber/pretty-formatter` (already a project dep per `package.json`) emits per-scenario detail with assertion text, replacing the dot-only `progress` formatter currently configured in `cucumber.js`. We pass it as a CLI flag to avoid editing `cucumber.js` (forbidden by issue scope).
- The trailing `echo "EXIT_CODE=$?"` records the cucumber exit code into the log so the reviewer sees both the per-scenario detail AND the final outcome in one artefact.
- Redirecting both stdout and stderr (`2>&1`) captures any unhandled-rejection traces or step-def loader errors that progress formatter would have buried.

If the project does not have `@cucumber/pretty-formatter` installed, fall back to `--format usage` (built into Cucumber-JS) which is verbose enough to show every scenario's outcome per step:

```sh
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression" --format summary --format usage \
  > agents/2evbnk-bdd-rewrite-2-3-auth/regression-full-output.log 2>&1; \
  echo "EXIT_CODE=$?" >> agents/2evbnk-bdd-rewrite-2-3-auth/regression-full-output.log
```

### Step 2: Inspect the captured log

Read `agents/2evbnk-bdd-rewrite-2-3-auth/regression-full-output.log` and extract:

- The last `EXIT_CODE=` line — must be `EXIT_CODE=0` for the spec §8 MUST-PASS gate.
- The final `summary` line of the form `X scenarios (Y passed, Z pending, W failed, V undefined, U skipped)`.
- The list of any FAILED or UNDEFINED scenarios (their feature file + line number).

Acceptance:
- Expected post-pend-when-steps-patch state: `EXIT_CODE=0`, all scenarios reported as `pending`, zero `failed`, zero `undefined`.
- If FAILED or UNDEFINED scenarios remain, the diagnostic has succeeded (it identified the root cause that the truncated proof obscured) — but the underlying issue is **not** the truncation; it is a residual bug not covered by the prior pending patch. In that case, this patch's job ends at producing the log + flagging the remaining failures in the spec amendment for follow-up triage.

### Step 3: Spec amendment

Open `specs/issue-492-adw-2evbnk-bdd-rewrite-2-3-auth-sdlc_planner-bdd-authoring-smoke-surface-scenarios.md` and append the following block under `## Notes` (after the existing `### Scope amendment (post-build patch 2)` block):

```md
### Scope amendment (post-build patch 3)

The reviewer flagged that `agents/2evbnk-bdd-rewrite-2-3-auth/scenario_proof.md` is truncated
at 10,000 characters by `adws/phases/scenarioProof.ts`, obscuring whether the @regression
suite actually exits 0 after the pend-when-steps patch. Re-running with shell redirection +
the verbose `pretty-formatter` (or `--format usage` fallback) and capturing both stdout/stderr
to a sibling log file produces the unbounded artefact needed for diagnosis without modifying
`adws/` (which remains out of scope per spec line 44).

Captured artefact: `agents/2evbnk-bdd-rewrite-2-3-auth/regression-full-output.log`

Observed outcome from the captured log:
- Exit code: <fill in from EXIT_CODE= line>
- Summary tally: <fill in from cucumber summary line, e.g. "41 scenarios (41 pending)">
- FAILED scenarios: <list, or "none">
- UNDEFINED scenarios: <list, or "none">

Conclusion: <one of: "@regression suite verified green at exit 0 with 41 PENDING — the prior
pend-when-steps patch is sufficient and the spec §8 gate is satisfied" OR "Residual failures
listed above require a follow-up patch before merge (Issue #492 cannot ship until exit 0)">.

Patch file: `specs/patch/patch-adw-2evbnk-bdd-rewrite-2-3-auth-capture-full-cucumber-output.md`
```

Replace the `<...>` placeholders with the actual values read from the captured log.

### Step 4: Decide branch based on captured outcome

- **If `EXIT_CODE=0` with all PENDING and zero FAILED/UNDEFINED**: the patch is complete. Run the validation suite (next section) and stop.
- **If `EXIT_CODE != 0` or any FAILED/UNDEFINED scenarios appear**: this patch's diagnostic responsibility ends here, but a follow-up patch is required before merge. Stop, file findings into the spec amendment, and surface the failure list in the patch report so the orchestrator can spawn a remediation patch with the now-readable failure context.

## Validation
Execute every command to validate the patch is complete with zero regressions.

- `bun run lint` — TypeScript style/lint passes (no source files changed; this command only confirms no incidental breakage from the patch process).
- `bunx tsc --noEmit` — host type-check passes (no source files changed).
- `bunx tsc --noEmit -p adws/tsconfig.json` — `adws/` project type-check passes (no source files changed).
- `bun run test:unit` — vitest still green (no test changes).
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression" --format summary --format @cucumber/pretty-formatter > agents/2evbnk-bdd-rewrite-2-3-auth/regression-full-output.log 2>&1; echo "EXIT_CODE=$?" >> agents/2evbnk-bdd-rewrite-2-3-auth/regression-full-output.log` — produces the diagnostic log. Manual inspection confirms `EXIT_CODE=0` and all scenarios PENDING (or, if not, identifies the remaining failures for a follow-up).
- `git status` — confirms the only changes are: `agents/2evbnk-bdd-rewrite-2-3-auth/regression-full-output.log` (new), this patch file (new), the spec amendment (modified). No edits to `adws/**`, `cucumber.js`, `features/**` source, or any test/mock file.

## Patch Scope
**Lines of code to change:** 0 source lines. ~1 new artefact file (`regression-full-output.log`, size depends on cucumber output but typically <100KB for 41 PENDING scenarios). ~20 lines of spec amendment.

**Risk level:** low. The patch produces a diagnostic artefact via shell redirection; no source code, configuration, or test code is modified. The worst case (the `@cucumber/pretty-formatter` package is not installed) is mitigated by the `--format usage` fallback documented in Step 1.

**Testing required:** Manual inspection of the captured log to confirm `EXIT_CODE=0` and the expected scenario tally. The log itself is the verification artefact for the spec §8 MUST-PASS gate.

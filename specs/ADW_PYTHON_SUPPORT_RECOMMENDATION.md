# Making ADW Support Python TDD + BDD — Recommendation & Grilling Input

**Audience:** a grilling/design session held *against the ADW framework repo*
(`/Users/martin/projects/paysdoc/AI_Dev_Workflow`), not against a target repo.

**Motivating case:** `vestmatic-research` — a **flat-layout Python** project (Flask +
~50 root-level `.py` modules; a small Node/Cloudflare minority). We want ADW to drive
TDD (pytest) and optionally BDD (pytest-bdd) on it.

**Bottom line up front:** ADW today is **hardcoded to a Bun / TypeScript / cucumber-js /
`src/`-layout stack** in three prompt commands and one config-defaults file. There is **no
language or test-framework abstraction**. A target repo's `.adw/commands.md` can only change
*how a runner is invoked*, never *what language/framework ADW generates or expects*. As a
result, pointing ADW at a Python repo silently fails in ways that **report green** — the worst
failure mode. The fix is a deliberate "language adapter" seam, not a patch.

---

## 1. The goal to defend in the grilling

> ADW should drive plan → build → (scenario → stepdef) → test → review for a **Python** target
> as a first-class citizen: pytest for unit tests, pytest-bdd (or behave) for BDD, with the
> test **execution wired as a hard gate** the way it is for TS today.

Sub-goal: do this without forking framework commands per-target, because framework files get
**clobbered on ADW upgrade** and upstream churns actively (latest work is PR #573).

---

## 2. Evidence: where ADW is hardcoded (bring the receipts)

All paths relative to the ADW repo.

### 2a. Step-definition generation — hardcoded TS + cucumber-js
`.claude/commands/generate_step_definitions.md`
- L94 — "Import `Given`, `When`, `Then` from `@cucumber/cucumber`"
- L97 — assertions via "Node.js `assert`"
- L106 — verify with `bunx tsc --noEmit`
- L29 — step dir hardcoded to `<scenario-directory>/step_definitions/` (cucumber-js layout)
- L62-88 — the mock harness it assumes (`test/mocks/github-api-server.ts`,
  `claude-cli-stub.ts`, `git-remote-mock.ts`) is **TypeScript built to test ADW itself**, not
  a target app.

### 2b. Scenario writer — bootstraps cucumber when "N/A"
`.claude/commands/scenario_writer.md`
- L59-66 — if `## Run E2E Tests` is absent or `n/a`, it **installs `@cucumber/cucumber` and
  writes `cucumber.js`** into the target repo. So "N/A" means *bootstrap cucumber*, not *skip*.
- L92 — scenarios written as Gherkin `.feature` (this part is language-agnostic and reusable).

### 2c. Test runner — assumes Bun + a `src/` layout (the silent-green trap)
`.claude/commands/test.md` (run by the unit-test phase via `testAgent.ts:78` → `/test`)
- L66 step "Application Tests" — reads `## Run Tests` from `commands.md` **and appends the
  application test subset path** (default `bun run test -- --run src`), then:
  *"Only execute if a `src/` directory exists … If `src/` does not exist, skip this test and
  mark it as passed."*
- Consequence for a flat Python repo (no `src/`): pytest is **never run and reported green**.

### 2d. Config defaults — Bun + cucumber, and no language key
`adws/core/projectConfig.ts`
- `getDefaultCommandsConfig()` defaults: `bun install`, `bunx tsc --noEmit`, `bun run test`,
  `cucumber-js --tags "@{tag}"`, etc.
- `getDefaultScenariosConfig()` defaults: `cucumber-js --tags`.
- `HEADING_TO_KEY` / `SCENARIOS_HEADING_TO_KEY` — map `commands.md`/`scenarios.md` headings to
  config keys, but **there is no key for test language or framework**. This is the root cause:
  config can't express "this is a Python repo."

### 2e. What the config *can* and *can't* do
- `parseUnitTestsEnabled(project.md)` (≈L243-257) — unit tests gate on
  `## Unit Tests: enabled` in **`project.md`**; default disabled.
- `## Run Tests` (`runTests`) is **not** consumed by any phase directly — only the `/test`
  agent prompt reads it. So it's the *command*, not the *gate*.
- Gherkin `.feature` generation (scenario_writer L92) **is** language-agnostic — reusable.

### 2f. Phase composition — the one clean lever that already exists
Verified orchestrator → phase map:

| Orchestrator | Scenario | StepDef | Unit-test phase |
|---|---|---|---|
| `adwBuild` | ✗ | ✗ | ✗ |
| `adwPlanBuild` | ✗ | ✗ | ✓ |
| `adwPlanBuildDocument` | ✗ | ✗ | ✓ |
| `adwTest` | ✗ | ✗ | ✓ |
| `adwPlanBuildReview` | ✓ | ✗ | ✓ |
| `adwPlanBuildTest` | ✗ | ✓ | ✓ |
| `adwPlanBuildTestReview` | ✓ | ✓ | ✓ |
| `adwSdlc` | ✓ | ✓ | ✓ |

Unit-test gate is a **hard gate**: `unitTestPhase.ts` → `process.exit(1)` on failure, no PR.

---

## 3. The three holes any "just configure it" plan hits

1. **N/A ≠ skip.** `## Run Scenarios by Tag: N/A` skips scenario *execution*
   (`scenarioTestPhase.ts:70`) but not *generation*; generation bootstraps cucumber.
   Real lever today = pick an orchestrator with no scenario phase.
2. **Two settings, not one.** Unit tests need **both** `## Unit Tests: enabled` (project.md,
   the gate) **and** `## Run Tests` (commands.md, the command).
3. **`src/` gate = silent green.** `test.md` skips the suite and reports passed when no `src/`
   exists. Fatal for flat Python repos; the loop lies about passing.

---

## 4. Recommended design — a language/framework adapter seam

Frame the grilling around this concrete target so it has something to attack.

**Core idea:** introduce one config concept — a **stack/profile** — and route every hardcoded
decision through it instead of literals.

1. **Add a `## Stack` (or `## Language`/`## Test Framework`) key** to `commands.md` (or
   `project.md`), parsed in `projectConfig.ts` into a typed `stack` field
   (e.g. `node-bun-cucumber` | `python-pytest-pytestbdd`). Add it to `HEADING_TO_KEY`.
2. **Make `getDefault*Config()` switch on `stack`.** Python profile defaults:
   `pip install -r requirements.txt`, `pytest -q`, `pytest -m "{tag}"` (pytest-bdd tag
   selection), no `bunx tsc`.
3. **Parameterize the three prompts** (`generate_step_definitions.md`, `scenario_writer.md`,
   `test.md`) on `stack`:
   - stepdef gen: emit pytest-bdd Python (`from pytest_bdd import scenarios, given, when, then`)
     into `tests/step_defs/` instead of TS into `features/.../step_definitions/`.
   - scenario writer: keep Gherkin output; bootstrap **pytest-bdd** (add deps to
     `requirements.txt`, create `conftest.py`) instead of cucumber when none configured.
   - test runner: **drop the `src/` assumption**; discover the test dir from config
     (`## Test Directory`, default `tests/`); never "skip-as-passed" on a missing dir —
     missing tests when unit tests are *enabled* should be a **hard fail or explicit warning**,
     not green.
4. **Provide a Python mock-harness story** (or explicitly scope BDD out for v1). The TS mock
   harness (`test/mocks/*.ts`) doesn't apply; pytest equivalents = fixtures, `responses`/
   `httpx_mock`, Flask test client, `tmp_path`, `monkeypatch`.
5. **Preserve config across upgrade.** Confirm `commands.md`/`project.md` are honoured (not
   regenerated) on `adwUpgrade`; if the prompts must change, they live in the framework — so
   the adapter must be *upstreamed*, not forked per-target.

**Phasing suggestion:** ship pytest **unit** support first (smaller surface: `stack` key +
defaults + `test.md` de-`src/`-ing + gate). Defer pytest-bdd stepdef generation to a second
pass — Gherkin is already language-agnostic, so only the stepdef emitter + harness are new.

---

## 5. Questions the grilling must resolve

- **Abstraction level:** one `stack` enum, or independent `language` + `unitFramework` +
  `bddFramework` axes? (Vestmatic is mixed Python+Node — does per-issue or per-path stack
  selection ever matter?)
- **Prompt strategy:** branch the existing three prompts on `stack`, or split into
  per-stack prompt files selected by the phase? (Maintainability vs. prompt sprawl.)
- **Silent-green:** should "unit tests enabled but no tests found / no test dir" be a hard
  fail, a warning, or configurable? (Strongly lean hard-fail.)
- **BDD scope for v1:** support pytest-bdd now, or ship pytest-unit only and keep BDD
  TS-only until demand is real? (Vestmatic's near-term value is unit/regression + math
  correctness; BDD is lower priority.)
- **Mock harness:** does ADW provide a Python harness, document a recommended one, or declare
  runtime-dependent BDD scenarios out of scope for Python v1?
- **Upgrade durability:** is `project.md` preserved on upgrade? If not, the unit-test *gate*
  flag is fragile — should the gate move to `commands.md` (confirmed-honoured) instead?
- **Backward compat:** absent `## Stack` must default to today's `node-bun-cucumber` so no
  existing TS target regresses.
- **Validation:** add a `commands.md`/stack consistency check (e.g. a Python stack with a
  `cucumber-js` run command should error at parse time, not silently mis-generate).

---

## 6. Interim stance for vestmatic until ADW is fixed

- Skip BDD by running **`adwPlanBuild`** / **`adwPlanBuildDocument`** (no scenario/stepdef
  phases). The N/A flags are not the mechanism.
- Add pytest to the repo (`tests/`, `pyproject.toml`/`pytest.ini`) and **run it outside ADW**
  (CI + local + optional pre-push hook). Do **not** rely on ADW's `/test` agent to run pytest
  — the `src/` gate makes it report green without running anything.
- The ADW build agent may *write* pytest as it implements; treat those as drafts you execute
  yourself until the runner is Python-ready.

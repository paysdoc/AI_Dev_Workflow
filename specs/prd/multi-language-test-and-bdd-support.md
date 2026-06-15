# PRD: Multi-Language Test & BDD Support

## Problem Statement

ADW is hardcoded to a Bun / TypeScript / cucumber-js / `src/`-layout stack. When pointed at a
non-TypeScript target — the motivating case is `vestmatic-research`, a flat-layout Python
(Flask) project — it does not drive tests or BDD; worse, it **reports green on work it never
verified**. Concretely, today:

- The unit-test runner (`/test`) appends `--run src` and **skips-as-passed when no `src/`
  directory exists**, so a flat Python repo's pytest suite is never run yet reports passed.
- The scenario proof runner only recognizes step-definition files ending in `.ts` under
  `features/step_definitions/`, so any non-TS BDD suite is **skipped with no blocker failures** —
  another silent green.
- Pass/fail is derived by regexing cucumber-js's human-readable stdout summary, which matches
  nothing for pytest-bdd / godog / Playwright.
- The scenario proof captures stdout only and harvests **zero image artifacts**, so BDD runs
  produce no reviewable screenshots — the observed "vestmatic screenshots are dead" symptom.
- The unit-test gate flag lives in `project.md`, which is regenerated (and silently dropped) on
  every framework upgrade.

The owner wants ADW to drive plan → build → (scenario → stepdef) → test → review for arbitrary
languages (Python first, but Go/Rust without a framework change), with test execution wired as a
hard gate the way it is for TypeScript today, and with self-explanatory proof — including inline
screenshots — surfaced on every PR.

## Solution

Introduce a **detected-descriptor + one-polymorphic-prompt + typed-config** seam so language and
framework choices flow from one auto-detection pass instead of from hardcoded literals. New
languages work with **zero framework code change**: `adw_init` already detects the manifest, and
the generating agent relies on Claude's own knowledge of the named BDD framework to emit correct
step definitions — the run itself is the correctness guardrail.

Pass/fail moves off fragile stdout parsing onto a **structured-report contract** (JUnit XML), which
also detects "zero tests ran" and kills the silent-green class of bug. The proof layer is rebuilt
to be language-agnostic: step-def detection by configured directory + extension, one report parser,
and an artifact harvester that collects screenshots written to a known directory and uploads them to
R2. Every PR receives a **self-explanatory proof comment** with inline screenshots and R2 links.

The unit-test gate becomes a durable, opt-out policy in `.github/adw.yml` (which survives
regeneration), defaulting to enabled. Hermeticity for UI BDD is the target app's responsibility,
created and maintained by the build agent as definition-of-done; the resolve loop may edit app code
to reach it, capped and hard-failing if it cannot, with the Gherkin contract frozen during resolve
and re-validated against the issue to prevent gaming.

Rollout is staged: the unit-test layer ships first, the generation/proof/screenshot overhaul second.

## User Stories

1. As an ADW operator, I want ADW to run a flat-layout Python project's pytest suite, so that my
   tests actually execute instead of being skipped.
2. As an ADW operator, I want a missing `src/` directory to stop meaning "skip and pass," so that
   ADW never reports green on an unrun suite.
3. As an ADW operator, I want the test root directory to be configurable per target repo, so that
   non-`src/` layouts are honored.
4. As an ADW operator, I want unit tests to run via the command declared in `commands.md`, so that
   each repo's real test runner is used.
5. As an ADW operator targeting Python, I want pytest failures to gate the PR and trigger the
   auto-fix loop, so that broken code does not merge.
6. As an ADW operator, I want to add a new language (Go, Rust) without a framework code change, so
   that ADW generalizes beyond the languages explicitly built.
7. As an ADW operator, I want step definitions generated in the target language's BDD framework, so
   that scenarios are wired correctly for pytest-bdd / godog / cucumber-js alike.
8. As an ADW operator, I want generated scenarios to be executed once as a guardrail, so that
   incorrect generation surfaces as a failing run rather than silently shipping.
9. As an ADW operator, I want pass/fail derived from a structured machine-readable report, so that
   the verdict is robust across runners and not dependent on stdout formatting.
10. As an ADW operator, I want "zero testcases ran" to be detectable, so that a misconfigured or
    non-discovering runner cannot report green.
11. As an ADW maintainer, I want ADW's own cucumber-js suite migrated onto the same structured-report
    rail, so that the multi-language path is dogfooded and there is a single parser.
12. As an ADW operator running UI BDD, I want scenario screenshots harvested and uploaded to R2, so
    that visual proof exists for review.
13. As an ADW operator, I want a self-explanatory proof comment on each PR, so that a reviewer can
    understand what ran and what passed without digging into logs.
14. As a reviewer, I want screenshots inlined in the proof comment (with R2 links as fallback), so
    that I can see the evidence without leaving the PR.
15. As a reviewer, I want the proof comment grouped by scenario in collapsible sections, so that a
    large run stays scannable.
16. As an ADW operator, I want the unit-test gate to be a durable policy that survives framework
    upgrades, so that it is not silently reset.
17. As an ADW operator, I want the gate to default to enabled (opt-out), so that silent-green is
    prevented by default rather than requiring opt-in.
18. As an ADW operator, I want a self-documenting `adw.yml` with commented options, so that I know
    how to configure policy without reading source.
19. As an ADW operator, I want `adw_init` to create `adw.yml` only when absent and never overwrite
    it, so that my policy edits persist across regeneration.
20. As an ADW operator, I want "enabled but zero tests" to hard-fail only when a test framework is
    detected in dependencies, so that a discovery break is caught while a genuinely test-less early
    repo is not blocked.
21. As an ADW operator on a repo with no detected test framework, I want a loud, visible signal
    (PR/issue comment + `adw:unverified` label), so that fix-forward gets a real signal rather than
    a buried log line.
22. As an ADW maintainer, I want a coherence check that flags an incoherent detected config (e.g.
    Python stack with a cucumber-js run command), so that `adw_init`'s own mis-detection is surfaced.
23. As an ADW operator running UI BDD, I want the target app's hermetic test mode created and
    maintained by the build agent, so that scenarios run against stubbed externals and seeded data.
24. As an ADW operator, I want the resolve loop able to edit app code to reach hermeticity, so that a
    non-hermetic app can be made testable in-loop.
25. As an ADW operator, I want resolve attempts capped and the workflow hard-failed if hermeticity is
    not reached, so that the loop does not run unbounded.
26. As an ADW operator, I want the Gherkin contract frozen during resolve and re-validated against
    the issue, so that the resolve loop cannot make the run green by weakening the scenario.
27. As an ADW operator, I want the regression suite enforced as a hard gate on every resolve re-run,
    so that a fix does not introduce a regression.
28. As an ADW maintainer, I want a Python fixture target exercised end-to-end in CI, so that the
    non-TS path is verified in the hermetic Docker runner and not only by live runs.
29. As an ADW maintainer, I want the unit-test layer to ship before the generation/proof overhaul,
    so that value lands fast and risk is staged.
30. As an existing TypeScript-target operator, I want absent descriptor fields to default to today's
    Bun/cucumber behavior, so that my repo does not regress.
31. As an ADW maintainer, I want the scenario format mandated as Gherkin `.feature` for every target
    language, so that the promotion, per-issue-sweep, and vocabulary subsystems keep working without
    per-language parsers.

## Implementation Decisions

**Architecture**
- The locus of per-language variation is a **detected descriptor** parsed into typed config, a
  **single polymorphic prompt** per generation step, and Claude's own framework knowledge — **not**
  per-language code, per-language prompt files, or a stack enum. Adding a language requires no
  framework PR.
- The **generated scenarios are run once as the correctness guardrail**; generation prompts stay
  thin.
- **UI BDD is in scope for v1**, which puts the proof layer (detection, parsing, artifact harvest)
  in scope.

**Scenario format — Gherkin mandate**
- All ADW targets MUST use a **Gherkin-based BDD runner** (Ruby → cucumber-ruby, Python →
  behave / pytest-bdd, Rust → cucumber-rs, Go → godog, JS/TS → cucumber-js, etc.). The scenario
  format is fixed to **Gherkin `.feature`**; only the *step-def runtime* varies per language.
- Rationale: the promotion subsystem (`promotionScorer`, `promotionMover`, `vocabularyParser`,
  `scenarioParser`), `perIssueScenarioSweep` (`feature-{N}.feature`), and `@adw-{N}` / `@regression`
  tag discovery all parse Gherkin. Allowing a native non-Gherkin runner would require a per-language
  parser/mover for each of those — explicitly out of scope (see Out of Scope).
- `adw_init` selects a Gherkin runner for the detected language and **never emits a non-Gherkin
  `bddFramework`**. If it cannot identify a Gherkin runner for the stack, it falls back to a Gherkin
  runner (today's cucumber-js behavior for TS) rather than a native test framework, and flags via the
  unverified channel.
- The `stackCoherenceCheck` additionally asserts the detected `bddFramework` is Gherkin-based; a
  non-Gherkin framework warns loudly through the unverified channel (does not block).

**Config & descriptor**
- New detected fields extend existing files: `scenarios.md` gains `bddFramework` and
  `stepDefDirectory`; `commands.md` gains `testFramework`, `testDirectory`, and the structured-report
  flag. Parsed in the project-config loader with new pure parsers mirroring the existing
  command/scenario parsers. Absent fields fall back to today's Bun/cucumber defaults.
- The "test framework detected" signal is **presence of a test framework in dependencies/config**,
  emitted by `adw_init`.
- The unit-test gate is a **policy** in `.github/adw.yml`, which is not regenerated. `adw_init`
  creates `adw.yml` with a self-documenting commented template **only when absent** and never
  overwrites it. The gate is read in the normal workflow-init path (not only on upgrade) and
  **defaults to enabled (opt-out)**.

**Unit-test layer (ships first)**
- Drop the hardcoded `src/` gate; run the `commands.md` test command against the configured
  `testDirectory`.
- Verdict logic: enabled + tests pass → pass; enabled + failures → hard fail (existing gate);
  enabled + **zero testcases** → hard fail **if a test framework was detected**, else warn.

**Structured-report contract**
- Pass/fail comes from a **JUnit XML report** emitted by the runner to a known path; one parser
  reads it. `parseCucumberSummary` is **deleted**, and ADW's own cucumber-js suite is **migrated
  onto the same rail** (the "noisy non-zero exit but clean tally" override is reconstructed in
  structured-report terms). Single parser, no legacy branch.

**Proof layer**
- Step-def presence is detected by `stepDefDirectory` + language extension (the `.ts`-only gate is
  removed).
- Screenshots ride a **known-directory convention**: ADW exports a proof directory (env var); runner
  config and generated step defs write images there; a harvester globs and uploads to R2 via the
  existing upload service. No per-runner extraction code.
- A **coherence check** asserts the detected framework matches the run-command language; on mismatch
  it warns loudly (does not block) through the unverified-signal channel.
- All warn / unverified outcomes emit a **PR/issue comment + `adw:unverified` label**.

**PR proof surfacing**
- A **proof publisher** composes the JUnit summary and harvested R2 artifacts into a
  self-explanatory **PR comment** (not the description, which is written before proof exists).
  Screenshots are **inlined** via markdown image embeds of public R2 URLs, grouped under collapsible
  `<details>` per scenario, each with its raw R2 link as fallback.

**Hermeticity, resolve, and goal fidelity**
- Hermeticity is the target app's responsibility (a test mode the app owns), **created and
  maintained by the build agent as definition-of-done**; generation only drives the browser.
- The resolve loop may **edit app code** to reach hermeticity, is **capped** via the existing
  max-retry budget, and **hard-fails** the workflow if hermeticity is not reached.
- Goal fidelity: the **Gherkin `.feature` is frozen during resolve** (resolve edits step defs and
  app code only), **plus** a post-resolve validation re-check of scenarios against the issue body,
  **plus** the `@regression` suite as a hard gate on every re-run.

**Prompts modified**
- `generate_step_definitions.md` and `scenario_writer.md` become polymorphic on the descriptor;
  `scenario_writer`'s "bootstrap cucumber when E2E is N/A" behavior is removed (framework selection
  now belongs to `adw_init`).
- `test.md` drops `src/`, uses `testDirectory`, and emits the report flag.
- `adw_init.md` emits the new descriptor fields and creates `adw.yml` if absent.
- `resolve_failed_scenario.md` (and the test-retry coordinator) gain app-code editing, the Gherkin
  freeze, the cap/hard-fail, and the post-resolve re-validation.

**Rollout**
- PR 1: unit-test layer (drop `src/`, configurable `testDirectory`, `adw.yml` gate, JUnit for units).
- PR 2+: generation/proof/screenshot overhaul, including ADW-self migration onto the JUnit rail.

## Testing Decisions

A good test asserts **external behavior through a module's public interface**, not its internals —
given inputs produce expected outputs/verdicts, with no assertions on private helpers or call
sequencing. Prior art: the project's existing pure-helper unit tests (project-config parsing,
stream parsing, pure decision helpers) and the hermetic Docker `@regression` runner.

Unit-tested modules (scope: **all pure deep modules + a Python fixture e2e**):
- **`testReportParser`** — JUnit XML fixtures → `{ total, passed, failed, cases[] }`, including the
  zero-testcases case and malformed/missing report.
- **`testVerdict`** — table-driven over `(report, frameworkDetected, enabled)` → `pass | hardFail |
  warn`, covering every Q13/Q14 branch.
- **`proofArtifactHarvester`** — temp-dir fixtures → expected image path set (empty, nested, mixed
  extensions).
- **`stackCoherenceCheck`** — coherent and incoherent detected configs → `{ ok, warning? }`.
- **`prProofPublisher`** (formatting half) — given summary + R2 URLs → expected markdown
  (inline embeds, collapsible grouping, link fallback).
- **Config parser extensions** — `commands.md` / `scenarios.md` new fields and defaults;
  `adw.yml` `unitTests` parse + create-if-absent template emission (and non-overwrite).

Integration test:
- **Python fixture target** under the test fixtures tree, with a `@regression` scenario driving ADW
  end-to-end (detect → generate → run → JUnit parse → image harvest → proof comment) in the Docker
  runner.

Not unit-tested (verified via the fixture e2e and live fix-forward): the polymorphic prompts and
the resolve-loop prompt changes.

## Out of Scope

- Pre-built fixtures or explicit framework support for languages beyond Python. Go/Rust/others rely
  on the descriptor + Claude's knowledge and are validated by **fix-forward** — real issues exercise
  them and problems are fixed in the framework when surfaced. The loud `adw:unverified` signal is the
  mechanism that makes fix-forward safe.
- A per-language code provider (`BddProvider` registry) or per-language prompt files — explicitly
  rejected in favor of one polymorphic prompt.
- Native non-Gherkin BDD/test runners as the scenario contract (raw `pytest`, RSpec example specs,
  bare `cargo test`). Every language ADW realistically targets has a mature Gherkin runner, so the
  mandate costs nothing now; supporting a non-Gherkin contract would require per-language promotion /
  sweep / vocabulary parsers and is deferred to a future PRD — relevant only for emerging languages
  that lack a Gherkin runner (e.g. Zig, Nim).
- Promoting `adw.yml` into a broad policy file; only the `unitTests` key is added now (with commented
  documentation of future options).
- Hard-gating on config incoherence (the check warns, it does not block).
- Deep diagnosis of the existing screenshot pipeline beyond the proof-layer rebuild that subsumes it.

## Further Notes

- This redesign closes five silent-green / fragility holes found during grilling beyond the original
  recommendation doc: the `.ts`-only step-def gate, stdout-regex pass/fail parsing, stdout-only proof
  with no image harvest, the `project.md` gate flag clobbered on regen, and `adw_init` defaulting the
  scenario tool to Cucumber on non-recognition.
- The structured-report migration touches ADW's own self-hosted suite; treat the cutover as a risk to
  the framework's own green and reconstruct the post-suite-noise exit-code override on the new rail.
- Defaulting the gate to enabled means existing target repos flip to gating/warning on their next
  upgrade; the "hard-fail only when a framework is detected" rule bounds the blast radius.
- **Hash propagation / emit-parse coupling rule.** The framework version hash is computed only over
  the files declared in `adw_init.md`'s `hashInputs:` frontmatter (currently `adw_init.md` itself +
  the vocabulary template). Editing `adw_init.md` raises `.adw-version`, which triggers `adwUpgrade`
  to regenerate `.adw/` across all registered target repos (and ADW-self) on their next workflow —
  this is the intended propagation, and the source of the default-enabled-gate migration ripple.
  Framework code (`projectConfig`, `scenarioProof`) and the generation prompts are **not** hash
  inputs and do not raise the hash; they take effect immediately on merge because they are
  framework-resident, not stored in target `.adw/`. **Rule for every descriptor change: if you add
  or rename a parsed `.adw/` field, you MUST also change `adw_init.md` to emit it** — otherwise the
  hash does not move, regeneration does not run, and targets get the new parser reading old config
  (absent field → silent default). Adding a parsed field and teaching `adw_init` to emit it must
  always be the same PR.
- **Gherkin coupling is load-bearing.** The promotion / per-issue-sweep / vocabulary pipeline is
  hardwired to Gherkin `.feature` (`scenarioParser`, `FEATURE_FILENAME_RE`, `promotion*`,
  `vocabularyParser`). This is why the descriptor varies only the step-def runtime, never the scenario
  format. The coupling is *latent* (not a break) precisely because every realistically-targeted
  language has a Gherkin runner; it would only surface if a target abandoned Gherkin. The mandate
  converts that latent landmine into a stated constraint at zero cost to Python / Ruby / Rust / Go /
  JVM / .NET / PHP / Swift. The original PRD grill missed it because it framed the design around the
  execution/generation seam, where Gherkin is the universal substrate; the promotion subsystem sits
  downstream and is language-neutral *only as long as Gherkin holds*.
- Source grilling transcript and decisions: `ADW_PYTHON_SUPPORT_RECOMMENDATION.md` (Q1–Q24).

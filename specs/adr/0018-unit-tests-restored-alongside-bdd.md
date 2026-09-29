---
status: accepted
date: 2026-03-19
recorded: 2026-09-29
provenance:
  - kind: contemporaneous
    source: specs/prd-cost-module-revamp.md
  - kind: contemporaneous
    source: specs/issue-241-adw-ku956a-cost-revamp-core-com-sdlc_planner-cost-module-core-vitest.md
  - kind: contemporaneous
    source: commit 01b443cb (2026-03-30)
  - kind: contemporaneous
    source: .claude/skills/implement-tdd/SKILL.md
  - kind: recalled
    source: "Martin Koster, 2026-09-29"
supersedes: ["0014"]
superseded-by: []
---

# Unit tests restored alongside BDD scenarios

## Context and Problem Statement

[ADR-0014](0014-bdd-as-validation-contract-unit-tests-removed.md) deleted ADW's unit tests and removed Vitest on the grounds that agent-written unit tests prove little. Six days later the cost module revamp needed exact arithmetic to be checked: the PRD lists "No unit test coverage" among the problems and says "Bugs in cost computation directly impact invoicing accuracy". The question was whether unit tests have a place next to BDD scenarios, and if so what they are allowed to prove.

## Decision Drivers

* Cost figures feed invoices, so computation errors cost money (`specs/prd-cost-module-revamp.md`).
* The refactor into pure, deep modules made unit tests cheap and meaningful, so the objection in ADR-0014 no longer applied (recalled).
* BDD alone was too slow and too coarse to catch logic bugs in pure functions (recalled).

## Considered Options

None recorded.

## Decision Outcome

Unit tests came back in two steps, and BDD scenarios kept their role as the independent proof.

* **Step 1, cost module only (2026-03-19).** The cost PRD "Introduces Vitest for unit testing the cost computation and extraction logic". #241 added Vitest as a dev dependency with tests in `adws/cost/__tests__/`. `vitest.config.ts` included only `adws/cost/__tests__/**/*.test.ts`. The reason is contemporaneous: invoicing accuracy.
* **Step 2, whole codebase (2026-03-30).** Commit 01b443cb changed `.adw/project.md` from `## Unit Tests: disabled` to `enabled`, widened the Vitest include to `adws/**/__tests__/**/*.test.ts` and added the first test outside the cost module (`cronRepoResolver.test.ts`). The commit message gives no reason. The reasons are recalled: the two drivers above.
* **Division of roles.** `.claude/skills/implement-tdd/SKILL.md` states it: "BDD scenarios are the independent proof layer", written by a separate agent. Unit tests give finer-grained coverage "but are written by the same agent as the implementation, so they carry accommodation risk. They supplement, not replace, BDD scenarios."
* **Test style.** Tests exercise behaviour through a module's public interface. The cost PRD: "Do not test internal state, private functions, or call order".

### Consequences

* Good, because pure logic is checked in seconds, without the mock harness or a subprocess.
* Good, because the accommodation risk named in ADR-0014 is contained: a unit test never stands in for scenario proof.
* Bad, because the suite is large (152 files under `adws/`) and no CI workflow runs it. It runs in the pipeline's unit-test phase and by hand.
* Bad, because there are two test layers to maintain, and agents must be told which one proves what.

### Confirmation

Checked against the code on 2026-09-29:

* `.adw/project.md` contains `## Unit Tests: enabled`; `.adw/commands.md` sets `## Run Tests` to `bun run test:unit`; `package.json` maps `test:unit` to `vitest run`.
* `vitest.config.ts` includes `adws/**/__tests__/**/*.test.ts` and `test/mocks/__tests__/**/*.test.ts`.
* `find adws -name '*.test.ts' | wc -l` returns 152; `adws/cost/__tests__/` holds 2 of them.
* `grep -n executeUnitTestPhase adws/*.tsx` finds the phase in nine orchestrators (`adwSdlc`, `adwChore`, `adwPrReview`, `adwTest` and the five `adwPlanBuild*` scripts); `adwBuild.tsx` and `adwPatch.tsx` do not call it. On a hard-fail verdict `adws/phases/unitTestPhase.ts` exits the process before a PR is opened.
* `grep "test:unit\|vitest" .github/workflows/*.yml` returns nothing: no CI gate runs the unit suite.
* `bunx vitest run` in this checkout collected 155 files: 78 passed, 77 failed; 1363 tests passed and 10 failed. The failures sampled were import errors for `@paysdoc/devplatform`, which is not installed in this checkout's `node_modules`. The two cost test files passed (43 tests). Whether the whole suite is green on a complete install was not verified.

## More Information

* Supersedes, in part, [ADR-0014](0014-bdd-as-validation-contract-unit-tests-removed.md): only the removal of unit tests. BDD as the validation contract stands.
* Unit tests inside the build agent's red-green-refactor loop are recorded in [ADR-0024](0024-tdd-in-build-phase-single-pass-alignment.md).
* The switch that enables the unit-test phase moved from `.adw/project.md` to `.github/adw.yml`, default enabled, in [ADR-0043](0043-multi-language-test-seam.md). The `## Unit Tests` flag in `.adw/project.md` is still read by the `/feature` and `implement-tdd` prompts; see the unresolved item in ADR-0043.
* The cost module itself is recorded in [ADR-0026](0026-cost-computed-locally-persisted-in-d1.md).

# Application Type Mapping and Gate

## Overview

`## Application Type` in `.adw/project.md` is the only input that decides what evidence a review needs. A pure, framework-owned mapping (`adws/core/applicationType.ts`) turns the type into an `ApplicationProfile` (`runnerMode`, `evidenceKinds`, `reviewGuidanceSection`), and a phase-level gate (`adws/phases/applicationTypeGate.ts`) resolves it at workflow init. There is no default: a missing or unknown type parks the workflow as `human_gated` with the `missing_application_type` park comment.

## Responsibilities

- `APPLICATION_TYPE_PROFILES` holds exactly `cli` (descriptor runner from `.adw/scenarios.md`, no images, guidance section "CLI applications") and `web` (ADW Playwright project in `features/`, per-issue images, "Web applications").
- `resolveApplicationType(declared, profiles?)` returns `{ kind: 'known', profile }` or `{ kind: 'park', evidence }`. Lookup is trimmed and case-insensitive, and only own keys of the table count, so `constructor` or `__proto__` park.
- `describeApplicationProfile(profile)` builds a one-line description from the profile's fields only; it feeds the gate's log line.
- `runApplicationTypeGate(config, projectConfig, deps)` proceeds on a known type and returns the profile plus the (possibly reloaded) project config. `initializeWorkflow` and `initializePRReviewWorkflow` run it right after `loadProjectConfig`, and put the profile on `WorkflowConfig.applicationProfile`.
- `buildApplicationTypeGateDeps(gitContext)` supplies the real `loadProjectConfig`, `mergeLatestFromDefaultBranch` and `parkWorkflow`.
- `requireApplicationProfile(config)` is the accessor consumers use; it returns the profile or throws, and never defaults.
- `parseApplicationType` in `adws/core/projectConfig.ts` returns the section's value as written (comments stripped, trimmed, case kept), or `null` when absent or empty. `getDefaultProjectConfig` sets `null`.
- `.claude/commands/adw_init.md` detects `cli` or `web`, preserves a valid hand-set value, and leaves the section out when detection cannot decide.

## Contracts & Invariants

- The mapping table is the only place a type name means anything. Consumers read the profile, never the type; a unit test asserts that `applicationType` appears in non-test `adws/` sources only in `projectConfig.ts` and `applicationTypeGate.ts`.
- A third type is one new table entry plus `adw_init` detection; no phase changes.
- No default is ever written or read: absent means absent, and `adw_init` never writes a placeholder.
- On a missing or unknown type the gate merges the latest default branch once, reloads the config and resolves again. It parks only if the mapping still decides to park, with the mapping's evidence unchanged (`{ reason: ParkReason.MissingApplicationType, found }`, `found` is `null` when missing).
- The park does not return (`parkWorkflow` exits 0 after writing `human_gated` and posting the comment).
- `initializePRReviewWorkflow` records `orchestratorScript` in its early state write so `## Retry` on a park inside init resumes the PR review.
- `adwMerge` and `adwUpgrade` never run the gate and never park on the type.

## Configuration

- `## Application Type` in `.adw/project.md`: exactly one of `cli` or `web`, alone on its line.
- Already-initialised repositories are not migrated; they park until `adw_init` is re-run.

## Gotchas

- `WorkflowConfig.applicationProfile` is optional only so phase-test fixtures keep compiling; both init functions always set it. Tests that run the real init functions must mock the gate or give the worktree a `.adw/project.md` with a known type.
- The merge before the park exists because reused target-repo and PR worktrees are not merged with the default branch at init; without it `## Retry` would re-read a stale worktree.
- `adws/__tests__/adwInitPrompt.test.ts` asserts that the types the `adw_init.md` step-3 bullet offers equal the keys of `APPLICATION_TYPE_PROFILES`; editing `adw_init.md` bumps the framework hash.
- `verifyAdwRegen` does not require the section, so an upgrade whose `/adw_init` leaves it out still commits.
- The Playwright project, `web` runner mode, proof assembler selection and per-type review guidance sections are carried by later issues.

## Decisions

- [ADR-0061](../specs/adr/0061-application-type-decides-evidence-web-repos-run-playwright-bdd.md) — The application type decides the evidence; `web` repositories run their Gherkin on an ADW-owned Playwright project

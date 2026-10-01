---
status: deferred
date: 2026-04-17
recorded: 2026-09-29
provenance:
  - kind: contemporaneous
    source: specs/prd/depaudit.md
  - kind: contemporaneous
    source: specs for #436 to #439 (specs/issue-436-* ... specs/issue-439-*)
  - kind: contemporaneous
    source: specs/prd/adw-init-hash-and-label-classification.md (line 180)
  - kind: recalled
    source: "Martin Koster, 2026-09-29"
  - kind: recalled
    source: "Martin Koster, 2026-09-30"
supersedes: []
superseded-by: []
---

# depaudit as the dependency gate for ADW-managed repositories

## Context and Problem Statement

Repositories managed by ADW had no gate on their dependencies. The PRD lists what was missing: no check that runs before a merge into the production branch, no way to accept a known risk with a deadline, no coverage of supply-chain signals beyond published CVEs, and no uniform process across languages. Its conclusion: vulnerabilities "live in the tree until someone notices".

`depaudit` is a separate CLI in its own repository. This ADR records ADW's side only: whether and how ADW adopts it. The CLI's internals belong in the depaudit repository.

## Considered Options

None recorded for ADW's side. The PRD names ad-hoc `bun install` and `npm audit` only as the state being replaced.

## Decision Outcome

ADW adopts depaudit as the dependency gate for the repositories it manages. As decided on 2026-04-17, the integration has three parts:

* Onboarding: `adwInit.tsx` runs `depaudit setup` in the target worktree after the `.adw/` configuration is generated. Setup scaffolds the gate workflow in the target repository and baselines existing findings.
* Secrets: ADW copies `SOCKET_API_TOKEN` and `SLACK_WEBHOOK_URL` from its own environment to the target repository's Actions secrets. A missing value is a warning, never an abort (#439).
* Triage: the `/depaudit-triage` skill lives in ADW with `target: false`, so it is not copied into target repositories. It walks the findings one by one. A minor or patch upgrade is applied directly; a major upgrade is never applied but filed as an issue on the current repository, for ADW to pick up (#436 to #438).

Status: deferred. The integration is switched off while depaudit is unfinished.

* `adwInit.tsx`, the only caller of `executeDepauditSetup`, was deleted on 2026-06-08 (commit 1122ba61) when initialisation moved to the hash-versioned upgrade ([ADR-0042](0042-hash-versioned-self-upgrade.md)). That PRD lists depaudit setup propagation as out of scope: "Explicitly excluded by the operator earlier; depaudit is still WIP."
* Ruling by the owner on 2026-09-29: the integration stays deferred while depaudit is work in progress, and the uncalled function stays parked in the code.

### Consequences

* Good, because the parked function and the skill keep the design ready to be wired in again.
* Bad, because no repository managed by ADW gets a dependency gate from ADW today.
* Bad, because parked code must be kept compiling. `depauditSetup.ts` was changed by five later commits, the last on 2026-09-23, without being called.
* Bad, because the documentation describes the integration as live; see below.

### Confirmation

Checked on 2026-09-29:

* `executeDepauditSetup` exists in `adws/phases/depauditSetup.ts`. Outside its test (`adws/__tests__/depauditSetup.test.ts`) it appears only in the re-exports of `adws/phases/index.ts` and `adws/workflowPhases.ts`. Nothing calls it.
* `adws/adwInit.tsx` does not exist. At commit 1122ba61^ it called the function at line 99.
* `.claude/skills/depaudit-triage/SKILL.md` exists with `target: false`.
* A search for `depaudit` in `.claude/commands/`, `adws/*.tsx`, `adws/core/`, `adws/triggers/` and `.github/` returns nothing. The ADW repository has no depaudit gate of its own.
* `depaudit` is not installed on this host (`which depaudit`).

## More Information

* Stale documentation: `README.md` (lines 39, 181, 234, 248, 762) and `adws/README.md` (line 809) say that `adw_init` runs `depaudit setup` and propagates the secrets. It does not.
* Recorded elsewhere, not here: scanners, acceptance rules, gate semantics, pull request comment and Slack notification. See `specs/prd/depaudit.md` and the depaudit repository.

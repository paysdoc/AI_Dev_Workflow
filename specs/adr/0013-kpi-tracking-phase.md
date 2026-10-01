---
status: superseded
date: 2026-03-12
recorded: 2026-09-29
provenance:
  - kind: contemporaneous
    source: specs/issue-148-adw-ba2xc9-user-story-integrate-sdlc_planner-integrate-kpi-tracking.md
  - kind: contemporaneous
    source: specs/issue-196-adw-jm6pnw-push-adw-kpis-sdlc_planner-push-kpi-file.md
  - kind: contemporaneous
    source: specs/issue-486-adw-hk12ct-kpi-commits-land-on-sdlc_planner-kpi-commits-default-branch.md
supersedes: []
superseded-by: ["0045"]
---

# KPI tracking as a phase of the SDLC workflow

## Context and Problem Statement

A slash command, `/track_agentic_kpis`, could update `app_docs/agentic_kpis.md` with metrics for one workflow run, but nothing in the pipeline called it. It also carried hardcoded Python one-liners, so it broke on hosts without Python. The operator wanted ADW's performance tracked over time "without manual intervention" (#148).

The decision covered the SDLC orchestrator (`adws/adwSdlc.tsx`), a new agent and phase, and the KPI file in the ADW repository.

## Considered Options

None recorded.

## Decision Outcome

KPI tracking became an automatic phase of the SDLC orchestrator, following the existing agent and phase pattern of the document phase.

* A `kpi-agent` ran `/track_agentic_kpis` with the run's state as input. The command was made runtime-agnostic: it read the package manager from `.adw/commands.md` and used it for inline calculations.
* The agent maintained two tables in `app_docs/agentic_kpis.md`: a row per run (attempts, plan size, diff size) and a summary (current and longest streak of runs with at most two attempts, total and largest plan and diff size, average presence).
* The phase was non-fatal by contract: any error was caught and the workflow continued. The spec for #148 calls this "a critical design requirement".
* The agent ran in the ADW repository root, not in the target worktree, because the KPI file belonged to ADW.

Two corrections followed and are part of the decision as it stood:

* #196 (2026-03-16): the first version did not commit the file, so every update was lost. A `commitAndPushKpiFile` helper was added that staged only the KPI file.
* #486 (2026-04-21): the helper pushed to whatever branch ADW was checked out on, so KPI commits leaked into feature branches and open pull requests. It was rewritten to commit through a temporary detached worktree on `origin/<default branch>`, with the default branch resolved at run time, so the active working tree was never touched.

The spec for #148 gives the reason as the operator's wish to monitor performance over time. It records no further rationale.

### Consequences

* Good, because every SDLC run left a metrics row with no manual step.
* Bad, because each run paid for one more agent invocation.
* Bad, because the phase wrote commits to the ADW repository from inside a running workflow, which needed two fixes (#196, #486) to do safely.
* Bad, because two orchestrators pushing KPI commits at the same moment could collide. The spec for #486 accepted this as a non-fatal case with no retry.

### Confirmation

This decision is no longer in force. Checked on 2026-09-29: a case-insensitive search for `kpi` in `adws/`, `.claude/commands/`, `app_docs/` and `features/` returns nothing.

## More Information

* Replaced by [ADR-0045](0045-kpi-module-removed.md).
* The default branch was resolved at run time and never hardcoded; see [ADR-0019](0019-dev-and-main-branches-with-runner-clone.md).
* The cost schema in `specs/prd/d1-cost-database.md` lists `kpi` as a phase value. That is a trace of this decision.

---
status: accepted
date: 2026-06-17
recorded: 2026-09-29
provenance:
  - kind: contemporaneous
    source: commit 7c65081b ("chore: remove agentic_kpi module")
  - kind: recalled
    source: "Martin Koster, 2026-09-29"
supersedes: ["0013"]
superseded-by: []
---

# KPI module removed

## Context and Problem Statement

Since [ADR-0013](0013-kpi-tracking-phase.md) every SDLC run ended with a KPI phase: an agent updated `app_docs/agentic_kpis.md` and the file was committed to the default branch of the ADW repository through a temporary worktree. The phase cost one agent invocation per run and carried its own git code and tests.

The decision covers the SDLC orchestrator, the KPI agent and phase, the `/track_agentic_kpis` command, the KPI commit helper in `adws/vcs/commitOperations.ts` and the KPI file itself.

## Decision Drivers

* The KPIs were never read or acted on (recalled).
* The phase was cost without value (recalled).

## Considered Options

None recorded.

## Decision Outcome

The KPI module was removed in full, in one commit (7c65081b, 2026-06-17). The commit message gives no reason. The reason is recalled by the owner: nobody read the KPIs or acted on them, so the phase was cost without value.

The commit deleted:

* `.claude/commands/track_agentic_kpis.md`
* `adws/agents/kpiAgent.ts` and `adws/phases/kpiPhase.ts`
* `commitAndPushKpiFile` and its tests in `adws/vcs/`
* the `kpi-agent` identifier, the `/track_agentic_kpis` slash command type and its model routing entries
* `app_docs/agentic_kpis.md`, including the recorded history (259 lines)
* the regression scenario `row-28-adwDocument-kpiPhase-happy.feature` and its vocabulary entry

In `adws/adwSdlc.tsx` the document phase is now followed directly by the pull request phase.

### Consequences

* Good, because each SDLC run has one agent invocation fewer.
* Good, because a workflow no longer writes commits to the ADW repository's default branch while it runs.
* Good, because 971 lines were removed against 9 added, including the temporary-worktree commit code.
* Bad, because the recorded KPI history was deleted with the file. It survives only in git history before 7c65081b.
* Bad, because ADW now has no record of attempts, plan size or diff size per run. Cost per phase is still recorded; see [ADR-0026](0026-cost-computed-locally-persisted-in-d1.md).

### Confirmation

Checked on 2026-09-29:

* A case-insensitive search for `kpi` in `adws/`, `.claude/commands/`, `app_docs/`, `features/`, `README.md` and `adws/README.md` returns nothing.
* `adws/adwSdlc.tsx` imports no KPI phase.

No CI gate or test enforces the absence. TypeScript would reject a call to the deleted phase because the symbol no longer exists.

## More Information

* Replaces [ADR-0013](0013-kpi-tracking-phase.md).
* Not checked: whether cost records with phase `kpi` written before the removal are still in the D1 database.

---
status: accepted
date: 2026-04-03
recorded: 2026-09-29
provenance:
  - kind: contemporaneous
    source: specs/issue-378-adw-z16ycm-add-top-level-workfl-sdlc_planner-top-level-workflow-state.md
  - kind: contemporaneous
    source: specs/issue-379-adw-gq51dc-migrate-cron-stage-d-sdlc_planner-cron-stage-from-state-file.md
  - kind: contemporaneous
    source: specs/issue-461-adw-guimqa-orchestrator-resilie-sdlc_planner-extend-top-level-state-schema.md
supersedes: []
superseded-by: []
---

# One top-level state file per adwId is the source of truth for workflow state

## Context and Problem Statement

Workflow state was spread over per-orchestrator files at `agents/<adwId>/<orchestratorId>/state.json`. Completed phases were a flat string array in `metadata`, with no timing or status. There was "no single canonical file representing the workflow's overall state" (#378). The cron derived the stage of an issue by parsing the header of the latest ADW comment, for example `:hammer_and_wrench: Running Build` to `build_running`, which "couples cron filtering to comment formatting, is fragile if headers change, and duplicates stage tracking" (#379).

## Decision Drivers

* One place to read the stage of a workflow, for the cron and for an operator.
* Stage detection must not depend on the wording of comments.
* Resume must know whether a phase completed, failed or was still running, not only that its name is in a list.
* A heartbeat writing every 30 seconds must not be able to leave a truncated file (#461).

## Considered Options

None recorded.

## Decision Outcome

`agents/<adwId>/state.json` is the canonical state of a workflow, separate from the per-orchestrator state files, which remain.

* **Content.** `adwId`, `issueNumber`, `workflowStage`, `orchestratorScript` and a `phases` map of per-phase status and timestamps. #461 added the contract for `pid`, `pidStartedAt`, `lastSeenAt` and `branchName`. All fields are optional, so older files still read.
* **Writers.** `runPhase` writes `<phase>_running`, then the phase result. Every writer goes through `AgentStateManager.writeTopLevelState`, which shallow-merges top-level fields, deep-merges `phases`, and replaces the file atomically (write to `state.json.tmp`, then `renameSync`).
* **Resume.** A `phases` entry, once present, decides alone whether a phase is skipped; only `completed` skips. The legacy `completedPhases` array is the fallback when there is no entry.
* **Cron.** The cron takes only the adwId from issue comments and reads `workflowStage` from the file (`resolveIssueWorkflowStage`). Grace-period checks use the phase timestamps and fall back to the issue's `updatedAt`.

### Consequences

* Good, because changing a comment header can no longer change what the cron does.
* Good, because a partial write such as `{ lastSeenAt }` keeps every other field.
* Good, because the stage handoffs of later decisions ([ADR-0028](0028-orchestrators-stop-at-awaiting-merge.md), [ADR-0032](0032-explicit-cancel-and-retry-directives.md), [ADR-0036](0036-stage-taxonomy-and-exhaustive-classifier.md)) are writes to one field.
* Bad, because the file lives under the working directory of the process (`AGENTS_STATE_DIR` is `process.cwd()/agents`), so the state is visible only on the host that wrote it. See [ADR-0035](0035-single-host-per-repo.md).
* Bad, because `workflowStage` is typed `string`, not the `WorkflowStage` union, so the compiler does not reject an unknown stage. #378 chose this "to allow flexible stage naming without requiring type changes for every new phase".
* Bad, because the adwId still comes from issue comments; an issue whose comments were removed has no link to its state file.
* Bad, because a read that fails to parse returns `null`, the same answer as a missing file.

### Confirmation

Checked against the code on 2026-09-29:

* `adws/core/agentState.ts` defines `getTopLevelStatePath`, `readTopLevelState`, `writeTopLevelState` and the private `atomicWriteJson`.
* `adws/triggers/cronStageResolver.ts` reads the stage through `AgentStateManager.readTopLevelState`; `grep -rn getIssueWorkflowStage adws` returns nothing.
* `isPhaseAlreadyCompleted` in `adws/core/phaseRunner.ts` reads the `phases` map first.
* `bunx vitest run` on `adws/core/__tests__/topLevelState.test.ts` (23 tests) and `adws/triggers/__tests__/cronStageResolver.test.ts` (26 tests) passed.

No CI workflow runs the unit suite.

## More Information

* #378 kept `recordCompletedPhase` writing the legacy array "for backward compatibility during the transition period" and said it could be removed later. It is still written (`adws/core/phaseRunner.ts`).
* The heartbeat and the takeover handler that consume the #461 fields are recorded in [ADR-0034](0034-coordination-kernel.md).

---
status: accepted
date: 2026-02-24
recorded: 2026-09-29
provenance:
  - kind: contemporaneous
    source: 'commit 5c4067c6 ("init: chore: add AI dev workflow system"), including adws/README.md as committed'
  - kind: contemporaneous
    source: README.md, "About this project" and "Acknowledgments" (retrospective text, added 2026-04-26 and 2026-05-12)
supersedes: []
superseded-by: []
---

# One script per orchestrator, each driving the Claude Code CLI as a subprocess

## Context and Problem Statement

ADW turns an issue into a plan, an implementation, a test run, a review and a pull request. It needs an execution model: what a "workflow" is as a running thing, and how it talks to the model. The decision covers the `adws/adw*.tsx` scripts, the agents under `adws/agents/` and the triggers under `adws/triggers/`.

## Considered Options

None recorded.

## Decision Outcome

A workflow is a standalone TypeScript script, `adws/adw<Name>.tsx`, started as its own operating-system process with the issue number as an argument. The script composes phases; a phase runs one or more agents; an agent is a `claude` CLI subprocess in non-interactive print mode whose `stream-json` output ADW parses line by line. The cron and webhook triggers start workflows by spawning these scripts detached. ADW does not call the model through an SDK and has no long-lived process that owns running workflows.

The founding commit carries no rationale for this shape. `README.md` records where it came from: the course codebase by IndyDevDan "provided the foundational codebase that ADW grew out of. The original orchestration patterns and agent composition came from there."

The founding commit shipped 13 orchestrator scripts. Its `adws/README.md` described them as phases that can be "run individually" or "combined in orchestrator scripts".

### Consequences

* Good, because the same command runs a workflow by hand, from the cron trigger and from the webhook.
* Good, because adding a workflow is adding a script and one entry in the routing map.
* Bad, because the scripts repeated their per-phase bookkeeping until it was extracted, see [ADR-0020](0020-shared-phase-runner-and-core-decomposition.md).
* Bad, because workflows are separate processes and share nothing in memory. State lives in files ([ADR-0029](0029-top-level-state-file-as-source-of-truth.md)) and duplicate or dead processes have to be detected from outside ([ADR-0034](0034-coordination-kernel.md)).
* Bad, because ADW depends on the CLI's output envelope, which is not under its control ([ADR-0055](0055-rate-limit-structured-signals-two-tier-wait.md)).

### Confirmation

Checked against the code on 2026-09-29:

* `ls adws/adw*.tsx` lists 16 scripts. Each starts with `#!/usr/bin/env bunx tsx` and reads its arguments from `process.argv`.
* `adws/types/issueRouting.ts` (`issueTypeToOrchestratorMap`) maps an issue class to a script path.
* `adws/triggers/webhookGatekeeper.ts` (`spawnDetached`) and `adws/triggers/trigger_cron.ts` spawn `bunx tsx adws/<script>` with `detached: true`.
* `adws/agents/claudeAgent.ts` spawns the CLI with `--print --verbose --dangerously-skip-permissions --output-format stream-json --model <model>`. The founding commit used the same flags.
* `package.json` has no Anthropic SDK dependency.

No CI gate enforces this decision.

## More Information

* How agents are spawned: [ADR-0015](0015-slash-commands-as-single-spawn-path.md). Which model each one gets: [ADR-0010](0010-model-and-effort-routing-per-command.md).
* The launcher is `bunx tsx`; the process runs on Node: [ADR-0009](0009-bun-as-package-manager-node-as-runtime.md).
* Not every script is a phase pipeline. `adwMerge.tsx`, `adwUpgrade.tsx` and `adwClearComments.tsx` are single-purpose scripts launched the same way.

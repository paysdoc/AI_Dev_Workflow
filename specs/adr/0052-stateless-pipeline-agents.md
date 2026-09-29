---
status: accepted
date: 2026-08-28
recorded: 2026-09-29
provenance:
  - kind: contemporaneous
    source: commit 20d4b0af (2026-08-28)
  - kind: contemporaneous
    source: "PR #811, merged 2026-08-28"
  - kind: transcript
    source: "Claude Code session bf752843, 2026-08-28"
supersedes: []
superseded-by: []
---

# Pipeline agents never load Claude auto-memory

## Context and Problem Statement

Claude Code keeps an auto-memory per project under `~/.claude/projects/<key>/memory/`. The owner uses it in interactive sessions. A worktree resolves to the same project key as the checkout it belongs to, so an agent spawned by the pipeline in a worktree loaded the owner's memory as well.

On 2026-08-28 the plan agent for #797 read a memory note written for interactive sessions as an instruction. It ran `/install` again on top of the install preamble the pipeline had already injected, grew to about 600k tokens of context and was killed by the 30-minute watchdog (ADR-0023, [0023-context-exhaustion-is-a-reset.md](0023-context-exhaustion-is-a-reset.md)).

The decision covers every agent started through `adws/agents/claudeAgent.ts`.

## Decision Drivers

* The owner, in the session: "Memory files should be for interactive skills only. I do not want claude memory to be injected in ANY agents. They need to be completely stateless".
* Interactive sessions must keep their memory.
* Agents authenticate through OAuth; that must keep working.

## Considered Options

* Start agents with `--bare`.
* Set `autoMemoryEnabled: false` in the project's `.claude/settings.json`.
* Set `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` in the environment of each spawned agent.

## Decision Outcome

Chosen option: "Set `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` in the environment of each spawned agent", because it is the only option that affects spawned agents and nothing else. `--bare` was rejected because it also disables OAuth. The project setting was rejected because it would disable memory in interactive sessions too.

The variable is set in `runClaudeAgentWithCommand` after the caller's environment overlay has been applied, so no caller can turn memory back on.

### Consequences

* Good, because an agent's input is the prompt, the slash command and the files in its worktree, and nothing the operator wrote down for other purposes.
* Bad, because a lesson recorded in memory does not reach the pipeline. It has to be written into a command, a skill or the repository's configuration to take effect there.
* Bad, because the protection depends on one environment variable of the Claude Code CLI keeping its meaning.

### Confirmation

Checked on 2026-09-29:

* `adws/agents/claudeAgent.ts` sets `spawnEnv['CLAUDE_CODE_DISABLE_AUTO_MEMORY'] = '1'` after the overlay. The ENOENT and auth retries reuse the same spawn options.
* `adws/agents/__tests__/claudeAgent.test.ts` has three cases: the variable is set on every spawn; an overlay with the value `'0'` cannot re-enable memory; the ENOENT retry spawn carries it. They run in the Vitest unit suite.
* `.claude/settings.json` and `templates/claude-settings-starter.json` do not set `autoMemoryEnabled`.

Not re-run: the check reported in PR #811 that the headless init event no longer lists `memory_paths`.

## More Information

Unresolved: three probes start `claude` outside `claudeAgent.ts` and do not set the variable: `adws/triggers/rateLimitProbe.ts`, `adws/jsonl/schemaProbe.ts` and `scripts/guardrails-probe.ts`. The schema probe and the guardrails probe run in a temporary directory; a comment in `schemaProbe.ts` gives keeping project memory out of the probe as the reason. The rate-limit probe inherits the trigger's working directory and environment. No source says whether a probe counts as an agent under this decision.

PR #811 also carried the repair of the documentation index; that is ADR-0053 ([0053-docs-index-health-gate-and-sweep.md](0053-docs-index-health-gate-and-sweep.md)). The other fixed property of the spawn, guardrail injection, is ADR-0050 ([0050-target-repo-guardrails.md](0050-target-repo-guardrails.md)).

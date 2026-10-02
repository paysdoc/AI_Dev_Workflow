---
status: accepted
date: 2026-03-16
recorded: 2026-09-29
provenance:
  - kind: contemporaneous
    source: specs/issue-183-adw-cahdcr-fix-validation-and-r-sdlc_planner-use-commands-in-agents.md (issue #183)
  - kind: contemporaneous
    source: specs/issue-189-adw-uzfskg-add-runprimedclaudea-sdlc_planner-add-primed-claude-agent.md (issue #189)
  - kind: contemporaneous
    source: commit 049ae201 ("add skills, remove primed agent, add install step to commands", 2026-03-19)
  - kind: contemporaneous
    source: specs/issue-253-adw-71pdjz-cache-install-contex-sdlc_planner-cache-install-context.md (issue #253)
  - kind: recalled
    source: "Martin Koster, 2026-09-29"
supersedes: []
superseded-by: []
---

# Agents are spawned through one function, and their prompt is a slash command

## Context and Problem Statement

From the founding commit ADW had two ways to start an agent. `runClaudeAgent` took a prompt assembled in TypeScript and wrote it to the CLI's standard input. `runClaudeAgentWithCommand` passed a slash command from `.claude/commands/` and its arguments on the command line. Most agents used the second. The validation and resolution agents used the first and built their own prompts. The spec for issue #183 names the cost: "Prompt changes require code changes instead of editing `.md` files" and "Two different code paths exist for spawning Claude CLI". The decision covers how every pipeline agent is started and where its prompt lives.

## Considered Options

* Keep both spawn functions
* One spawn function, with the prompt always a slash command
* A second variant of the spawn function that primes context first (`runPrimedClaudeAgentWithCommand`, issue #189)

## Decision Outcome

Chosen option: "One spawn function, with the prompt always a slash command", because a second path, in the words of issue #183, "invites inconsistencies".

* `runClaudeAgent` was deleted. The two agents that used it were converted to `/validate_plan_scenarios` and `/resolve_plan_scenarios`.
* A prompt is a Markdown file under `.claude/commands/`. Code supplies positional arguments only.
* Commands take file paths and globs and read the files themselves, instead of receiving content inline.

The primed variant was tried and withdrawn. It was added on 2026-03-16 (commit feceb057) to run `/install` ahead of the real command in the same invocation, and removed on 2026-03-19 (commit 049ae201), which put an install step into the planning commands instead. Issue #253 (2026-03-21) replaced that with an install phase that runs once per orchestrator and hands its cached output to later agents through a `contextPreamble` parameter on the single spawn function. The reason given was that `/install` ran "up to 3 times across separate agent processes". No source records why the primed variant was removed; issue #253 describes it as "removed as dead code during the cost revamp (#242)".

### Consequences

* Good, because changing a prompt is editing Markdown.
* Good, because behaviour that must hold for every agent has one place to live. The subprocess environment allowlist, the watchdog ([ADR-0023](0023-context-exhaustion-is-a-reset.md)), rate-limit detection ([ADR-0025](0025-rate-limit-pause-and-resume-queue.md)), guardrail settings ([ADR-0050](0050-target-repo-guardrails.md)) and the memory switch ([ADR-0052](0052-stateless-pipeline-agents.md)) are all in that function.
* Bad, because the function has grown to 13 positional parameters, most of them optional.
* Bad, because structured input such as issue JSON travels as a shell-quoted command-line argument.
* Bad, because the command files must exist in the worktree the agent runs in, so ADW copies them into every target worktree.

### Confirmation

Checked against the code on 2026-09-29:

* A grep of `adws/` finds no definition or call of `runClaudeAgent` or `runPrimedClaudeAgentWithCommand`.
* `adws/agents/claudeAgent.ts` exports `runClaudeAgentWithCommand`. `adws/agents/commandAgent.ts` (`runCommandAgent`) wraps it. The callers are 19 agent modules under `adws/agents/`, plus `adws/core/issueClassifier.ts`, `adws/triggers/autoMergeHandler.ts` and `adws/adwUpgrade.tsx`.
* `runCommandAgent` types its command as `SlashCommand`, so the type check rejects anything else. `runClaudeAgentWithCommand` types it as `string`; its direct callers all pass a slash command, with the one exception listed below.
* `adws/phases/worktreeSetup.ts` (`copyClaudeAssetsToWorktree`) copies the command files into the worktree.
* The CLI is also started directly by `adws/triggers/rateLimitProbe.ts` and `adws/jsonl/schemaProbe.ts` (one-turn probes) and for `claude auth status`. These do no pipeline work.

Apart from that type, no CI gate or test enforces this decision.

## More Information

* `/resolve_conflict` is invoked as a command but is missing from the `SlashCommand` type; see [ADR-0010](0010-model-and-effort-routing-per-command.md).
* `runCommandAgent` was introduced on 2026-03-22: [ADR-0020](0020-shared-phase-runner-and-core-decomposition.md).
* The execution model this sits in: [ADR-0001](0001-script-per-orchestrator-driving-claude-code-cli.md).

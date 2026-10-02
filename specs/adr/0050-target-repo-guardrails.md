---
status: accepted
date: 2026-07-17
recorded: 2026-09-29
provenance:
  - kind: contemporaneous
    source: specs/issue-762-adw-0rvmyc-enforce-adw-guardrai-sdlc_planner-inject-target-repo-guardrails.md
  - kind: contemporaneous
    source: specs/issue-763-adw-i46l4f-adw-init-write-start-sdlc_planner-starter-guardrail-settings.md
  - kind: contemporaneous
    source: specs/issue-846-adw-9176vg-auto-trust-target-re-sdlc_planner-auto-trust-workspace.md
  - kind: recalled
    source: "Martin Koster, 2026-10-01"
supersedes: []
superseded-by: []
---

# ADW injects its own guardrails into agent runs on target repositories

## Context and Problem Statement

Every agent is started with `--dangerously-skip-permissions`. ADW copied only `.claude/commands/` and `.claude/skills/` into a target worktree, never hooks or settings. A target repository without its own `.claude/settings.json`, the common case, therefore ran ADW agents with "zero guardrails": no deny rules, no pre-tool-use blocking, no session logs (#762).

The decision covers the agent spawn in `adws/agents/claudeAgent.ts`, the settings file ADW offers to target repositories, and Claude Code's workspace trust for target workspaces.

## Decision Drivers

* Guardrails must apply to a target run whatever the target repository ships.
* A wrong deny rule must not be able to block the queue.
* A denial must be visible as a denial, not look like an unreliable agent.

## Considered Options

None recorded.

## Decision Outcome

**Injection at spawn (#762).** On target-repository runs only, the spawn passes `--settings <inline JSON>` with:

* the deny list read from `templates/claude-settings-starter.json`: recursive forced `rm` in its spellings, `git push` with force, and `Read(**/.env*)` with negated carve-outs for `.env.sample` and `.env.example`;
* the framework's five hooks at absolute framework paths, run with `bun` because a target repository may not have `tsx`;
* no allow list.

Hook logs go to an absolute directory under the framework's `agents/{adwId}/hook-logs`. The issue gave a relative path; the spec found that it resolved inside the target worktree and changed it. Self-host runs get no injection: the framework's own `settings.json` applies there, and injecting would fire every hook twice.

Injection is gated in this order: kill switch `ADW_TARGET_GUARDRAILS=off`; self-host; the key `guardrails: true` in the target's `.github/adw.yml`; a start-up probe that makes a real `claude` call with the payload. A failed probe fails open: runs proceed without injection and one Slack alert is sent. Denied tool calls are counted from the agent's output stream and reported per run.

**Starter settings (#763).** `/adw_init` and the upgrade path copy the same template to the target's `.claude/settings.json` only when the file is absent. It is committed, never gitignored, and an existing file is never read, merged or overwritten. It carries deny rules only; a committed hook would impose a `bun` or `node` runtime on the repository.

**Workspace trust (#846).** `ensureTargetRepoWorkspace` sets `projects[<workspace>].hasTrustDialogAccepted` in `~/.claude.json`, because Claude Code has no flag for it and an unattended pipeline cannot open each repository by hand. The write is a temporary file plus rename, and any failure is logged and skipped. It is done once per repository at workspace-ensure time, not per spawn, because the file is shared with every live Claude session. It lives in ADW, not in the git library: trust is a Claude Code concern.

### Consequences

* Good, because the deny list has one source, used for injection and for the starter file.
* Good, because a repository owner's own settings always win over the starter.
* Bad, because the `Read(!...)` carve-outs rely on Claude Code behaviour that #762 calls "UNDOCUMENTED". The probe exists because a CLI upgrade could break them.
* Bad, because failing open means a broken probe leaves target runs unguarded until someone acts on the alert.
* Bad, because the probe makes real model calls, once per trigger process.

### Confirmation

Checked on 2026-09-29:

* `adws/core/guardrailsGate.ts`, `guardrailsPayload.ts`, `guardrailsProbe.ts` and `workspaceTrust.ts` exist; `templates/claude-settings-starter.json` holds 13 deny patterns and nothing else.
* `runClaudeAgentWithCommand` calls `resolveGuardrailsDecisionForSpawn`, and on `inject` adds `--settings` and sets `CLAUDE_HOOKS_LOG_DIR`. An absent launch context counts as self-host.
* `adws/triggers/trigger_cron.ts` warms the probe at start; the webhook health check reports its verdict.
* `ensureTargetRepoWorkspace` in `adws/core/targetRepoManager.ts` calls `ensureWorkspaceTrusted`.
* Unit tests: `adws/core/__tests__/guardrailsGate.test.ts`, `guardrailsPayload.test.ts`, `workspaceTrust.test.ts`; `adws/phases/__tests__/worktreeSetup.test.ts`.

Not run: `scripts/guardrails-probe.ts`, which makes paid model calls. No CI gate runs it.

## More Information

Related: `.adw/` and `.github/adw.yml` configuration, ADR-0005 ([0005-adw-directory-config-per-target-repo.md](0005-adw-directory-config-per-target-repo.md)); propagation of `/adw_init` changes to target repositories, ADR-0042 ([0042-hash-versioned-self-upgrade.md](0042-hash-versioned-self-upgrade.md)); the spawn's other fixed setting, ADR-0052 ([0052-stateless-pipeline-agents.md](0052-stateless-pipeline-agents.md)).

@adw-762 @adw-0rvmyc-enforce-adw-guardrai
Feature: ADW's guardrails are injected into target-repo agent spawns via --settings — a target repo that ships no .claude/settings.json no longer runs ADW agents with zero deny rules and zero hooks

  Issue #762 closes a guardrail hole at the agent spawn boundary. Every ADW agent spawns with
  `--dangerously-skip-permissions` (`adws/agents/claudeAgent.ts:103`), and
  `copyClaudeAssetsToWorktree` (`adws/phases/worktreeSetup.ts:199`) copies only
  `.claude/commands/` and `.claude/skills/` into target worktrees — never hooks, never
  settings. A target repo that ships no `.claude/settings.json` (the common case) therefore
  runs ADW agents with NO deny rules, NO pre-tool-use blocking, and NO session-log hooks.
  ADW's guardrails must apply to every target-repo run irrespective of the target's own
  configuration.

  THE FIX: `claudeAgent` passes `--settings <inline JSON>` on TARGET-repo runs only. Self-host
  runs keep the framework's own project `settings.json` — injecting there too would double-fire
  every hook and duplicate every session-log entry. The deny list comes from a canonical
  template (`templates/claude-settings-starter.json`), the payload adds all five hooks at
  ABSOLUTE framework paths (`$CLAUDE_PROJECT_DIR` resolves to the worktree, where the hooks do
  not exist), and carries NO allow list (a verified no-op under
  `--dangerously-skip-permissions`). Rollout is gated three ways: an `ADW_TARGET_GUARDRAILS=off`
  kill switch, a `guardrails: true` canary key in `.github/adw.yml`, and a startup probe that
  FAILS OPEN (start without injection + Slack alert) rather than blocking the queue.

  The behavioural contract pinned below (the HARNESS-OBSERVABLE half of the acceptance
  criteria — see "What this harness cannot reach" for the other half):

    1. A TARGET-REPO RUN IS SPAWNED WITH AN INJECTED SETTINGS PAYLOAD (AC1). A target-repo
       agent spawn, on a repo whose `.github/adw.yml` sets `guardrails: true`, carries an
       inline `--settings` payload. This is the headline: today the flag is absent entirely.
    2. THE INJECTED DENY RULES COVER THE DESTRUCTIVE CLASSES, WITH THE CARVE-OUT INTACT (AC1).
       The payload that actually reaches the spawn denies recursive-force removal, denies force
       pushing, and denies reading environment secrets — while carving out the sample
       environment file. The carve-out is LOAD-BEARING: the issue records that a blanket
       `Read(**/.env*)` without it blocks `.env.sample` edits and breaks any build that adds an
       env var. A deny list that reaches the spawn shorn of its carve-out is a broken build.
    3. THE FIVE HOOKS ARE REGISTERED AT PATHS THAT RESOLVE OUTSIDE THE WORKTREE (AC1). All five
       hook events (pre-tool-use, post-tool-use, notification, stop, subagent-stop) are present,
       and every hook command names an ABSOLUTE path that does NOT resolve inside the target
       worktree. This is the `$CLAUDE_PROJECT_DIR` defect stated as behaviour: a hook path that
       resolves into the worktree names a file that does not exist there, so the hook silently
       never fires and the guardrail is decorative.
    4. THE PAYLOAD CARRIES NO ALLOW LIST (AC1 / unit-test AC). The injected payload declares no
       allow list — verified a no-op under `--dangerously-skip-permissions`, and dead weight
       that would rot.
    5. A SELF-HOST RUN RECEIVES NO INJECTION (AC1). Self-host spawns carry no `--settings`, so
       the framework's own project settings stay authoritative and hooks fire exactly once.
    6. THE KILL SWITCH DISABLES INJECTION UNCONDITIONALLY (AC2). `ADW_TARGET_GUARDRAILS=off`
       suppresses injection even on a target repo whose adw.yml enables guardrails — instant
       rollback without a deploy.
    7. THE adw.yml CANARY GATE WITHHOLDS INJECTION BY DEFAULT (AC / rollout item 4). Injection
       activates ONLY on `guardrails: true`. An omitted key, an explicit `false`, and an absent
       adw.yml all withhold it — the opt-in canary default.
    8. HOOK LOGS LAND OUTSIDE THE TARGET WORKTREE (AC4). The spawn directs hook session logs to
       the run's own agent state directory, and the target worktree gains no hook-log files. The
       hook default is `logs/` RELATIVE to cwd, which would dump session logs untracked into the
       target worktree and leak them into the PR. (See the "Watch item" below — the value the
       issue specifies does not achieve this. The scenario pins the AC, not the value.)
    9. A FAILED PROBE FAILS OPEN, LOUDLY (AC3). When the startup probe fails, the run proceeds
       WITHOUT injection — today's behaviour, no queue blockage — and a Slack alert is sent. A
       guardrail that can wedge the queue is worse than the hole it closes; a guardrail that
       silently disables itself is worse still.
   10. A PASSING PROBE PERMITS INJECTION AND RAISES NO ALERT (AC3). The fail-open path is
       reserved for actual probe failure; a healthy probe neither suppresses guardrails nor
       cries wolf.
   11. THE DENIED-TOOL-CALL COUNT IS SURFACED IN RUN REPORTING (AC5). When a run accrues
       permission denials, the count reaches the run's reporting. This is the anti-flakiness
       requirement: a bad deny rule must show up as "N denials", not masquerade as agent
       flakiness — which, with `--dangerously-skip-permissions` runs having never denied
       anything before, is a brand-new failure mode operators have no prior instinct for.
   12. A CLEAN RUN REPORTS NO DENIAL NOISE (AC5 "when > 0"). A run with zero denials adds no
       denial line to its reporting — the signal stays a signal.
   13. THE INJECTED HOOKS ACTUALLY FIRE, AND LOG OUTSIDE THE WORKTREE (AC4, "Smoke-test that
       hooks actually fire in a target worktree"). A REAL hook, run the way the injected payload
       runs it, from a cwd that IS the target worktree, writes its session log under the run's
       agent state directory and leaves the worktree byte-for-byte clean. §8 pins what the spawn
       is CONFIGURED with (and its `path.resolve(recordedCwd, value)` check already catches a
       relative destination statically); §13 pins what a REAL hook then DOES with that
       configuration — the AC's explicit "smoke-test that hooks actually fire in a target
       worktree", which no recorder stub can give. §8's own third assertion ("gains no hook-log
       files") is vacuous on its stub, which fires no hooks; §13 is where that same claim
       actually bites.
   14. THE TWO INJECTED LAYERS AGREE ON THE ENVIRONMENT CARVE-OUTS. #762 injects the deny list
       and the pre-tool-use hook into a target run TOGETHER, so it owns their agreement: a path
       the injected deny list deliberately carves out must not be blocked by the injected hook.
       Today they disagree on `.env.example` — see the SECOND SPEC CONFLICT note below.
   15. TYPE-CHECK BACKSTOP (T22). The ADW TypeScript type-check still passes with the payload
       builder, the gate, and the denial counter wired in.

  Observability / rot-prevention note:

    Every assertion below targets an artefact the spawn PRODUCES — the argv and environment the
    Claude CLI is actually spawned with, the filesystem side-effects left in a throwaway temp
    worktree, a recorded Slack call, a composed report body, or the type-checker's verdict
    (T22). No step reads `claudeAgent.ts`, `adwYmlConfig.ts`, `templates/claude-settings-starter.json`,
    or any framework source file as text, substring-matches its contents, or parses it as
    JSON/AST.

      • THE ARGV IS THE OUTPUT, NOT THE SOURCE. The `--settings` payload is asserted by parsing
        the JSON the CLI was SPAWNED with, recorded by a stub the step def points
        `CLAUDE_CODE_PATH` at. Parsing that JSON is parsing the system-under-test's OUTPUT —
        the same category as parsing a state file (T1) or a recorded request body (T3), and
        explicitly permitted by the Rot-Detection Rubric. It is NOT parsing
        `templates/claude-settings-starter.json`, which would be a prohibited structural
        source-file assertion. The distinction is load-bearing: the template being correct on
        disk is exactly what these scenarios must NOT assume — #762's whole bug is that correct
        guardrails never REACH the spawn.
      • DENY RULES ARE PINNED BY CATEGORY, NOT BYTE-EXACTLY. §2 asserts the payload's deny array
        carries a rule for each destructive CLASS (recursive-force removal, force push,
        environment-secret read) plus the sample-file carve-out — deliberately NOT the
        thirteen-string list verbatim. The verbatim list is the unit test's job (the issue's own
        "payload builder (template parse…)" AC); asserting it here would rot the moment a
        fourteenth pattern is added to close a bypass, punishing a hardening change with a red
        BDD suite.
      • §8's worktree assertion targets a THROWAWAY TEMP WORKTREE the step def constructs — a
        fixture whose post-spawn filesystem state is the SUT's observable side-effect, the same
        category as feature-758's temp git repo and G24/G25's real temp repos. It is not a
        framework source file.

  What this harness cannot reach (and why the probe exists):

    THE REAL CLI IS THE ENFORCER, AND IT IS OUT OF REACH. Deny-rule ENFORCEMENT and hook FIRING
    are behaviours of the real Claude CLI parsing the payload — not of ADW. Proving `.env` is
    actually denied, `.env.sample` actually succeeds, `rm -r -f` is actually blocked, and a
    hook-log file actually appears requires spawning a real `claude -p` against a real model:
    non-hermetic, paid, and network-bound. This harness therefore pins the CONFIGURATION
    CONTRACT (what the spawn is configured with) and CANNOT pin the ENFORCEMENT CONTRACT (what
    the CLI does with it). That gap is not an oversight to be papered over with a mirror of the
    CLI's pattern matcher — a hand-rolled matcher would assert the harness agrees with itself
    and prove nothing about the CLI. The gap is EXACTLY what the issue's startup probe is for:
    the probe is the live enforcement check, it runs against the real CLI at trigger startup,
    and it is the reason the `Read(!pattern)` carve-out — UNDOCUMENTED CLI behaviour that could
    change under ADW without notice — is safe to depend on. §9/§10 pin ADW's CONSUMPTION of the
    probe's verdict (fail open, alert), which is ADW's behaviour and is drivable; the probe's
    own pass/fail against the live CLI is deliberately not a BDD scenario. This is the same
    harness boundary already recorded for GitHub-App auth and the Projects-V2 board write.

  Watch item surfaced to the maintainer (a spec conflict inside the issue itself):

    THE SPECIFIED HOOK-LOG VALUE DOES NOT SATISFY THE ACCEPTANCE CRITERION IT SERVES. The issue
    specifies the spawn env `CLAUDE_HOOKS_LOG_DIR=agents/{adwId}/hook-logs/` and the AC "Hook
    logs land in `agents/{adwId}/hook-logs/`, NEVER IN THE WORKTREE". Those conflict. The hooks
    resolve the value at `.claude/hooks/utils/constants.ts:11`
    (`LOG_BASE_DIR = process.env.CLAUDE_HOOKS_LOG_DIR || 'logs'`) and join the session id onto it
    (`getSessionLogDir` → `path.join(LOG_BASE_DIR, sessionId)`). `path.join` on a RELATIVE base
    yields a RELATIVE path, which `fs.mkdirSync` resolves against the HOOK process's cwd — and
    the hook inherits the CLI's cwd, which on a target run IS the target worktree. So the
    specified relative value creates `<target-worktree>/agents/{adwId}/hook-logs/<sessionId>/`:
    untracked session logs inside the worktree — the precise PR-leak the AC forbids, merely
    renamed from `logs/` to `agents/{adwId}/hook-logs/`. The value must be an ABSOLUTE path to
    the framework's own `agents/{adwId}/hook-logs/`. §8 below therefore pins the ACCEPTANCE
    CRITERION (logs land under the run's agent state directory, outside the worktree) rather
    than the literal string, so it stays green under the corrected absolute value and RED under
    the specified relative one. Flagged for maintainer confirmation rather than silently
    resolved, since it changes a value the issue states explicitly.

    Verified empirically against the real hook on 2026-07-17 (not reasoned about): firing
    `post-tool-use.ts` under `bun` with `CLAUDE_HOOKS_LOG_DIR="agents/0rvmyc/hook-logs/"` and cwd
    set to a scratch worktree wrote `<scratch>/agents/0rvmyc/hook-logs/<sessionId>/post_tool_use.json`
    INSIDE that scratch worktree (exit 0); the same hook with an ABSOLUTE `CLAUDE_HOOKS_LOG_DIR`
    left the scratch worktree empty and wrote under the absolute path instead. §13 below fires
    the real hook and is the scenario that catches this — §8 asserts only the recorded spawn env
    and cannot (its recorder stub is not a real CLI and fires no hooks).

  Second spec conflict surfaced to the maintainer (the injected hook defeats a deny carve-out):

    THE INJECTED PRE-TOOL-USE HOOK BLOCKS `.env.example`, WHICH THE INJECTED DENY LIST CARVES
    OUT. The issue calls the `Read(!**/.env.sample)` / `Read(!**/.env.example)` carve-outs
    load-bearing — a blanket `Read(**/.env*)` without them "blocks `.env.sample` edits, which
    breaks any build that adds an env var." But #762 injects the pre-tool-use hook ALONGSIDE the
    deny list, and that hook applies its OWN narrower rule: `isEnvFileAccess`
    (`.claude/hooks/pre-tool-use.ts:85`) blocks any path containing `.env` unless it
    `endsWith('.env.sample')`. `.env.example` is not spared. Verified against the real hook on
    2026-07-17 (subprocess, benign `Read` payloads): `.env` → exit 2 (blocked, correct);
    `.env.sample` → exit 0 (allowed, agrees with the carve-out); `.env.example` → exit 2 —
    BLOCKED, contradicting the template's `Read(!**/.env.example)`; `README.md` → exit 0 (no
    collateral). So a target run under #762 carries a deny list that says `.env.example` is
    readable and a hook that blocks it; the hook wins (a hard `process.exit(2)`), and the
    "breaks any build that adds an env var" failure survives for `.env.example` — as opaque
    flakiness, since a hook block is NOT a permission denial and so is not even counted by §11.
    This conflict is CREATED BY THIS ISSUE (before #762 neither layer was present in a target
    run, so they could not disagree), hence owned by it. The fix is a one-line widening of the
    hook's carve-out to also spare `.env.example`; if the maintainer instead scopes `.env.example`
    support out of #762, §14's `.env.example` row should be retired deliberately rather than left
    failing. Flagged rather than silently resolved. §14 pins the agreement.

  Scope notes:

    • THE PURE-UNIT HALVES ARE THE IMPLEMENTER'S, NOT BDD. The issue's final AC assigns unit
      tests to the payload builder (template parse, absolute paths, no allow list), the
      target-vs-self-host conditional, the kill switch, the adw.yml gate, and the fail-open
      path. Those Vitest tests are NOT duplicated here. The BDD layer's distinct value is that
      it drives the REAL `runClaudeAgentWithCommand` end-to-end and proves the built payload
      SURVIVES to the actual spawn — a builder that is unit-perfect but never wired into argv
      is exactly the bug #762 is fixing, and only an end-to-end spawn assertion can see it.
      Likewise the `guardrails` key's parse table (malformed values, duplicate keys, comment
      stripping) belongs beside the existing `hitl` / `unitTests` parser tests, not here.
    • §5–§7 AND §12 ARE GUARDS, AND ARE VACUOUSLY GREEN BEFORE THE FIX. Stated plainly because
      the suite's RED-then-GREEN discipline depends on knowing which scenarios prove the fix and
      which fence it in: today NO run is injected, so "receives no injection" passes for the
      wrong reason. They acquire their meaning the moment §1 lands, where they become the
      conditional's negative side and the only thing standing between a working canary and an
      un-gated fleet-wide rollout. §1–§4, §8, §9, §10, §11 and §13 are the genuinely RED
      scenarios that pivot on the fix. §14's `.env.example` row is also RED today — the only row
      in this file that bites code the fix touches incidentally (the pre-tool-use hook's
      carve-out), while its `.env.sample` row is a green no-collateral guard.
    • THE PROBE'S SPAWN COST IS NOT PAID BY THIS SUITE. §9/§10 inject the probe's VERDICT; they
      never run the probe. A BDD suite that spawned a real haiku CLI per scenario would be
      neither hermetic nor free, and the cucumber run must stay both.
    • THE WATCH ITEM IS NOT PINNED. The issue flags that `rewriteWorktreePath` (`pre-tool-use.ts`,
      env-gated on `ADW_WORKTREE_PATH` / `ADW_MAIN_REPO_PATH`, which `claudeAgent.ts:122-130`
      already sets for ANY worktree cwd) will activate against target-repo layouts for the first
      time once hooks fire there. That is real, and it is deliberately NOT pinned: it is a
      canary OBSERVATION item, its correct behaviour on target layouts is not yet specified, and
      inventing an assertion for it here would freeze behaviour nobody has decided on.
    • THE @regression MAINTENANCE SWEEP IS SKIPPED for this issue: `.adw/scenarios.md` configures
      a `## Regression Scenario Directory`, so promotion to the regression suite is a deliberate
      human decision and this agent never auto-promotes. §1 (a target run is guardrailed) and §5
      (a self-host run is not) are the natural promotion candidates if this is later hardened
      into the mandatory, un-gated end state the issue describes — a human call.

  Vocabulary note:

    Registered phrases reused (`features/regression/vocabulary.md`):
      G18  `the ADW codebase is checked out`
      T22  `the ADW TypeScript type-check passes`

    Novel phrasing introduced here — the registry has no phrase for an agent spawn's injected
    settings payload, a guardrails kill switch, an adw.yml guardrails gate, a startup probe
    verdict, hook-log placement, or a denied-tool-call count. The phrasing is deliberately
    DISTINCT from every existing per-issue module's spawn phrases (feature-565 / feature-527 /
    feature-649 / feature-693 / feature-721 all speak of orchestrator spawns and spawn locks,
    never of an agent CLI's injected settings) so feature-762.steps.ts can define self-contained
    step defs without an AmbiguousStepDefinition clash under the globally-loaded per-issue step
    defs. The gap is surfaced to the maintainer in the agent Output:
      • `a target-repo agent run whose adw.yml sets guardrails to {string}`
      • `a target-repo agent run whose adw.yml omits the guardrails key`
      • `a target-repo agent run whose repo ships no adw.yml`
      • `a target-repo agent run with guardrails enabled`
      • `a self-host agent run`
      • `the guardrails kill switch is set to off`
      • `the guardrails startup probe fails`
      • `the guardrails startup probe passes`
      • `the agent run records {int} permission-denied tool calls`
      • `the agent run records no permission-denied tool calls`
      • `the ADW agent is spawned`
      • `the spawned agent CLI is configured with an injected settings payload`
      • `the spawned agent CLI is configured with no injected settings payload`
      • `the injected payload carries a deny rule for recursive force removal`
      • `the injected payload carries a deny rule for force pushing`
      • `the injected payload carries a deny rule for reading environment secrets`
      • `the injected payload carves out the sample environment file from the environment deny`
      • `the injected payload registers all five hook events`
      • `every injected hook command names an absolute path`
      • `no injected hook command resolves inside the target worktree`
      • `the injected payload declares no allow list`
      • `the spawned agent directs its hook logs under the run's agent state directory`
      • `the spawned agent directs its hook logs outside the target worktree`
      • `the target worktree gains no hook-log files`
      • `a guardrails alert is sent to Slack`
      • `no guardrails alert is sent to Slack`
      • `the run reporting states the denied tool call count as {int}`
      • `the run reporting states no denied tool calls`
      • `the injected post-tool-use hook fires from inside the target worktree`
      • `the hook session log is written under the run's agent state directory`
      • `the target worktree carries no hook-log artefact`
      • `the injected pre-tool-use hook screens a read of {string}`
      • `the injected pre-tool-use hook blocks the read`
      • `the injected pre-tool-use hook allows the read`

    Step-definition note for the maintainer (feature-762.steps.ts — keep it SELF-CONTAINED with
    its own `@adw-762` Before/After and module-private `ctx`; do NOT reach into other per-issue
    modules' spawn step defs):
      • RECORD THE ARGV FROM A REAL SPAWN — do NOT assert on the builder's return value. Write a
        tiny recorder stub into a temp dir (a fixture the step constructs, per the G-HC
        precedent) that writes `{argv: process.argv.slice(2), env: process.env, cwd:
        process.cwd()}` to a JSON file and then streams a minimal valid assistant + result JSONL
        envelope so `handleAgentProcess` resolves normally. Point `CLAUDE_CODE_PATH` at it — it
        is already on the `getSafeSubprocessEnv` allowlist (`environment.ts:179`), and
        `resolveClaudeCodePath` reads the LIVE env var, so no cache defeat is needed beyond
        `clearClaudeCodePathCache()` between scenarios. Do NOT extend `test/mocks/claude-cli-stub.ts`:
        it records only the PROMPT (`MOCK_INVOCATION_LOG`), never argv or env, and widening a
        shared mock for one issue's needs would couple this scenario to every other feature that
        loads it.
      • `the ADW agent is spawned` must call the REAL `runClaudeAgentWithCommand` over the temp
        worktree, NOT a hand-rolled mirror of the spawn. If the step assembled its own argv the
        scenario would be VACUOUS against #762's actual bug — the RED must come from the real
        `cliArgs` array (`claudeAgent.ts:100-108`) lacking `--settings`, and the GREEN from the
        real one carrying it.
      • THE TARGET-VS-SELF-HOST SEAM IS THE IMPLEMENTER'S TO CHOOSE. `runClaudeAgentWithCommand`
        currently takes no GitContext — only `cwd` and `subprocessEnv` — so the issue's "the
        spawn already knows target vs self-host via the GitContext launch boundary" is an
        ASPIRATION, not the present signature; something must be threaded (`selfHost` is
        available on the launch-boundary context, `buildLaunchGitContext` at
        `launchGitContext.ts:87`). These scenarios are deliberately signature-independent: they
        say "a target-repo agent run" / "a self-host agent run" and leave the step def to
        construct whichever seam the implementation lands on. Do NOT rewrite the scenarios to
        name a parameter.
      • `a target-repo agent run whose adw.yml sets guardrails to {string}` writes a real
        `.github/adw.yml` into the temp worktree carrying the given scalar, so the REAL
        `readAdwYmlConfig` / `parseAdwYml` (`adwYmlConfig.ts`) resolves the gate — do not stub
        the config read. `…omits the guardrails key` writes an adw.yml with only `hitl:` /
        `unitTests:`; `…ships no adw.yml` writes none (the absent-file default path).
      • `the guardrails kill switch is set to off` sets `ADW_TARGET_GUARDRAILS=off` in the
        harness env and MUST restore the prior value in `After` — an env var leaked across
        scenarios would silently disable injection for every scenario that follows and turn §1
        green-to-red at random. Note the switch is read by ADW's own process (the parent), so it
        does NOT need a `SAFE_ENV_VARS` entry; `CLAUDE_HOOKS_LOG_DIR`, by contrast, must reach
        the CLI child — `claudeAgent` sets it on `spawnEnv` directly, AFTER the
        `getSafeSubprocessEnv()` allowlist filter (mirroring `ADW_WORKTREE_PATH` at
        `claudeAgent.ts:125`), so it also needs no allowlist entry. If the implementation instead
        routes it through `process.env`, `environment.ts:168`'s allowlist will silently strip it
        and §8 will be RED — which is the scenario doing its job, not a harness bug.
      • §8 asserts the RECORDED SPAWN ENV's `CLAUDE_HOOKS_LOG_DIR` resolves (via
        `path.resolve(recordedCwd, value)`) to a directory that is NOT under the temp worktree
        and IS under the run's agent state dir; `the target worktree gains no hook-log files`
        walks the temp worktree after the spawn and asserts no session-log directory appeared.
        Resolving against the RECORDED cwd — not `process.cwd()` — is the whole point: it is the
        relative-path defect in the Watch item above, and asserting the raw string instead would
        pass on the broken value.
      • §9/§10 inject the probe VERDICT through the gate's seam (a `probeGuardrails: () =>
        ProbeResult` dep alongside the injectable Slack seam); they never spawn a probe. Assert
        the Slack alert against a CAPTURING notifier injected into the gate, not against the
        real `postSlack` (`slackNotifier.ts:22`) — the precedent is T-PY6's capturing commenter.
        A fire-and-forget Slack call that is never awaited is exactly how #647's ping regressed
        unnoticed, so assert the capture, and have the production seam AWAIT the send.
      • §11/§12 drive the REAL denial counter over a stream the recorder stub emits: seed the
        stub's JSONL with `tool_result` blocks carrying the CLI's permission-denied shape and
        assert the count reaches the composed report body via a capturing reporter. Note the
        parser has no denial concept today — `ToolResultContentBlock`
        (`claudeStreamParser.ts:33-41`) models only `{type, tool_use_id, content}` with no
        `is_error` field, though `installPhase.ts:61` already reads `is_error` off raw parsed
        JSON, so the field is present on the wire and the type is simply incomplete. Widening
        that interface is part of this issue's work; the scenario is RED until it is.
      • §13 IS THE END-TO-END HOOK PROOF — DO NOT MOCK IT, and do not assert the env var's
        VALUE. It is separate from §8 on purpose: §8's recorder stub is not a CLI and fires no
        hooks, so §8 can only assert what the spawn is CONFIGURED with; §13 fires a REAL hook and
        is the only scenario here that fails if the resolved destination is relative. Build a
        scratch "target worktree" temp dir and a separate scratch "framework agents" temp root.
        Take the hook-log destination the RUN resolves (the same `CLAUDE_HOOKS_LOG_DIR` §8
        records), then `spawnSync('bun', [absPostToolUseHookPath], { cwd: scratchWorktree, env:
        { ...process.env, CLAUDE_HOOKS_LOG_DIR: <resolved dest> }, input: JSON.stringify({
        session_id: 'sess-762', tool_name: 'Read' }) })`. The cwd MUST be the scratch worktree —
        that is the whole point, since a relative destination resolves against it. Then assert
        (a) a `post_tool_use.json` exists under the framework agents root for the adwId, and
        (b) `the target worktree carries no hook-log artefact` — walk the scratch worktree and
        assert NO file was created anywhere under it. Keep BOTH: (a) proves the log is written
        where the run intends, (b) proves it is written nowhere else and is what catches the
        issue's literal relative value. `post-tool-use.ts` is chosen deliberately — a pure logger
        with no flags and no blocking, so the assertion cannot be confounded. Do NOT set
        `ADW_WORKTREE_PATH`/`ADW_MAIN_REPO_PATH` in that env (the rewrite is out of scope, see the
        Watch item). `bun <abs>.ts` with a JSON stdin payload is confirmed working against the
        real hook (exit 0).
      • §14 spawns the REAL `.claude/hooks/pre-tool-use.ts` the same way and reads its EXIT
        STATUS: 2 = blocked (the hook's `process.exit(2)`, `pre-tool-use.ts:188`), 0 = allowed.
        Payload: `{ session_id: 's', tool_name: 'Read', tool_input: { file_path: <path under the
        scratch worktree> } }` — pass a path ENDING in the Example value (e.g.
        `<scratch>/.env.example`), since `isEnvFileAccess` inspects the trailing filename. Give it
        a real `CLAUDE_HOOKS_LOG_DIR` under the scratch framework root so an allowed read can
        write its log. NOTE the hook swallows ALL errors and exits 0 (`:227-229`), so exit 0 means
        "not blocked" — the exact assertion — never read it as "succeeded". The `.env.example` row
        is RED against the real hook TODAY (it exits 2); the fix widens the carve-out to spare it.
        The `.env.sample` row is GREEN today and must STAY green (no collateral).

  Background:
    Given the ADW codebase is checked out

  # ── §1 A TARGET-REPO RUN IS SPAWNED WITH AN INJECTED SETTINGS PAYLOAD (AC1) ─────────────
  #
  # The headline. A target repo that ships no settings of its own still runs ADW's agents under
  # ADW's guardrails. RED before (`cliArgs` carries no `--settings` at all); GREEN after.

  @adw-762 @adw-0rvmyc-enforce-adw-guardrai
  Scenario: A target-repo agent run with guardrails enabled is spawned with an injected settings payload
    Given a target-repo agent run whose adw.yml sets guardrails to "true"
    When the ADW agent is spawned
    Then the spawned agent CLI is configured with an injected settings payload

  # ── §2 THE INJECTED DENY RULES COVER THE DESTRUCTIVE CLASSES (AC1) ─────────────────────
  #
  # The deny rules must survive to the spawn WITH the carve-out. A blanket environment deny
  # shorn of its sample-file exception blocks `.env.sample` edits and breaks any build that adds
  # an env var — the issue records this as live-tested. RED before (no payload to carry them).

  @adw-762 @adw-0rvmyc-enforce-adw-guardrai
  Scenario: The injected payload denies the destructive command classes while carving out the sample environment file
    Given a target-repo agent run with guardrails enabled
    When the ADW agent is spawned
    Then the injected payload carries a deny rule for recursive force removal
    And the injected payload carries a deny rule for force pushing
    And the injected payload carries a deny rule for reading environment secrets
    And the injected payload carves out the sample environment file from the environment deny

  # ── §3 THE FIVE HOOKS RESOLVE OUTSIDE THE WORKTREE (AC1) ───────────────────────────────
  #
  # `$CLAUDE_PROJECT_DIR` resolves to the WORKTREE, where the framework's hooks do not exist —
  # a hook registered at such a path silently never fires, leaving a decorative guardrail. The
  # paths must be absolute and must not resolve into the worktree. RED before.

  @adw-762 @adw-0rvmyc-enforce-adw-guardrai
  Scenario: The injected payload registers all five hooks at absolute paths outside the target worktree
    Given a target-repo agent run with guardrails enabled
    When the ADW agent is spawned
    Then the injected payload registers all five hook events
    And every injected hook command names an absolute path
    And no injected hook command resolves inside the target worktree

  # ── §4 THE PAYLOAD CARRIES NO ALLOW LIST (AC1) ─────────────────────────────────────────
  #
  # An allow list is a verified no-op under `--dangerously-skip-permissions` — dead weight that
  # would rot into a false statement of intent. RED before (no payload exists to inspect).

  @adw-762 @adw-0rvmyc-enforce-adw-guardrai
  Scenario: The injected payload declares no allow list
    Given a target-repo agent run with guardrails enabled
    When the ADW agent is spawned
    Then the spawned agent CLI is configured with an injected settings payload
    And the injected payload declares no allow list

  # ── §5 A SELF-HOST RUN RECEIVES NO INJECTION (AC1) ─────────────────────────────────────
  #
  # Self-host runs keep the framework's own project settings.json. Injecting there too would
  # double-fire every hook and duplicate every session-log entry. GUARD: vacuously green today
  # (nothing is injected anywhere); load-bearing the moment §1 lands.

  @adw-762 @adw-0rvmyc-enforce-adw-guardrai
  Scenario: A self-host agent run receives no injected settings payload
    Given a self-host agent run
    When the ADW agent is spawned
    Then the spawned agent CLI is configured with no injected settings payload

  # ── §6 THE KILL SWITCH DISABLES INJECTION UNCONDITIONALLY (AC2) ────────────────────────
  #
  # Instant rollback without a deploy — it must beat the adw.yml gate, not negotiate with it.
  # GUARD: vacuously green today; load-bearing once §1 lands.

  @adw-762 @adw-0rvmyc-enforce-adw-guardrai
  Scenario: The kill switch suppresses injection even when adw.yml enables guardrails
    Given a target-repo agent run whose adw.yml sets guardrails to "true"
    And the guardrails kill switch is set to off
    When the ADW agent is spawned
    Then the spawned agent CLI is configured with no injected settings payload

  # ── §7 THE adw.yml CANARY GATE WITHHOLDS INJECTION BY DEFAULT (AC / rollout item 4) ────
  #
  # Injection activates only on `guardrails: true`. Every other state — omitted key, explicit
  # false, absent file — withholds it. This is the canary's entire safety property: an
  # un-opted-in repo must be untouched. GUARD: vacuously green today; the only thing standing
  # between a canary and an un-gated fleet-wide rollout once §1 lands.

  @adw-762 @adw-0rvmyc-enforce-adw-guardrai
  Scenario Outline: A target repo that has not opted into the guardrails canary receives no injection
    Given <run>
    When the ADW agent is spawned
    Then the spawned agent CLI is configured with no injected settings payload

    Examples:
      | run                                                          |
      | a target-repo agent run whose adw.yml sets guardrails to "false" |
      | a target-repo agent run whose adw.yml omits the guardrails key   |
      | a target-repo agent run whose repo ships no adw.yml               |

  # ── §8 HOOK LOGS LAND OUTSIDE THE TARGET WORKTREE (AC4) ────────────────────────────────
  #
  # The hook default is `logs/` RELATIVE to cwd — on a target run that dumps untracked session
  # logs into the worktree and leaks them into the PR. Pinned as the ACCEPTANCE CRITERION (logs
  # land under the run's agent state dir, outside the worktree) rather than the literal value
  # the issue specifies, which is itself relative and lands inside the worktree — see the Watch
  # item. RED before (no log dir is directed at all).

  @adw-762 @adw-0rvmyc-enforce-adw-guardrai
  Scenario: The spawned agent writes its hook logs to the run's agent state directory, not the target worktree
    Given a target-repo agent run with guardrails enabled
    When the ADW agent is spawned
    Then the spawned agent directs its hook logs under the run's agent state directory
    And the spawned agent directs its hook logs outside the target worktree
    And the target worktree gains no hook-log files

  # ── §9 A FAILED PROBE FAILS OPEN, LOUDLY (AC3) ─────────────────────────────────────────
  #
  # A guardrail that can wedge the queue is worse than the hole it closes — so a failed probe
  # starts WITHOUT injection (today's behaviour). A guardrail that silently disables itself is
  # worse still — so it alerts. Both halves are required; either alone is a trap. RED before
  # (no probe, no alert).

  @adw-762 @adw-0rvmyc-enforce-adw-guardrai
  Scenario: A failed startup probe suppresses injection and alerts Slack
    Given a target-repo agent run with guardrails enabled
    And the guardrails startup probe fails
    When the ADW agent is spawned
    Then the spawned agent CLI is configured with no injected settings payload
    And a guardrails alert is sent to Slack

  # ── §10 A PASSING PROBE PERMITS INJECTION AND RAISES NO ALERT (AC3) ────────────────────
  #
  # The fail-open path is reserved for actual failure: a healthy probe must neither suppress the
  # guardrails nor cry wolf. RED before (no injection, no probe).

  @adw-762 @adw-0rvmyc-enforce-adw-guardrai
  Scenario: A passing startup probe permits injection without alerting
    Given a target-repo agent run with guardrails enabled
    And the guardrails startup probe passes
    When the ADW agent is spawned
    Then the spawned agent CLI is configured with an injected settings payload
    And no guardrails alert is sent to Slack

  # ── §11 THE DENIED-TOOL-CALL COUNT IS SURFACED IN RUN REPORTING (AC5) ──────────────────
  #
  # Runs have never denied anything before (`--dangerously-skip-permissions`), so a bad deny
  # rule is a brand-new failure mode with no operator instinct behind it. It must read as "N
  # denials", not as agent flakiness. RED before (nothing counts denials).

  @adw-762 @adw-0rvmyc-enforce-adw-guardrai
  Scenario: A run that accrues permission denials surfaces the denial count in its reporting
    Given a target-repo agent run with guardrails enabled
    And the agent run records 3 permission-denied tool calls
    When the ADW agent is spawned
    Then the run reporting states the denied tool call count as 3

  # ── §12 A CLEAN RUN REPORTS NO DENIAL NOISE (AC5 "when > 0") ───────────────────────────
  #
  # The count surfaces "when > 0" — a clean run must not add a denial line to every report, or
  # the signal drowns in its own boilerplate. GUARD: vacuously green today.

  @adw-762 @adw-0rvmyc-enforce-adw-guardrai
  Scenario: A run with no permission denials adds no denial count to its reporting
    Given a target-repo agent run with guardrails enabled
    And the agent run records no permission-denied tool calls
    When the ADW agent is spawned
    Then the run reporting states no denied tool calls

  # ── §13 THE INJECTED HOOKS ACTUALLY FIRE AND LOG OUTSIDE THE WORKTREE (AC4) ────────────
  #
  # The end-to-end companion to §8 and the scenario that makes this file's hook-log coverage
  # non-vacuous. §8 records the spawn env and catches a relative destination statically via
  # `path.resolve(recordedCwd, value)`, but its recorder stub is not a CLI and fires no hooks, so
  # its own "gains no hook-log files" assertion is vacuous — no file can appear under a stub that
  # writes none. §13 runs the REAL post-tool-use hook from a cwd that
  # IS the target worktree, with the destination the run resolved, and asserts the log lands in
  # the framework and the worktree stays clean. Both assertions are load-bearing: the first
  # proves the log is written where intended, the second proves it is written NOWHERE ELSE and is
  # what catches the issue's literal relative value (verified to leak — see the Watch item). This
  # is also the AC's explicit "smoke-test that hooks actually fire in a target worktree". RED
  # before (no destination is resolved, so the hook's `logs/` default lands in the worktree);
  # GREEN after.

  @adw-762 @adw-0rvmyc-enforce-adw-guardrai
  Scenario: A real hook firing inside the target worktree logs to the run's agent state directory and leaves the worktree clean
    Given a target-repo agent run with guardrails enabled
    When the ADW agent is spawned
    And the injected post-tool-use hook fires from inside the target worktree
    Then the hook session log is written under the run's agent state directory
    And the target worktree carries no hook-log artefact

  # ── §14 THE INJECTED DENY LIST AND THE INJECTED HOOK AGREE ON THE ENV CARVE-OUTS ───────
  #
  # #762 injects the deny list and the pre-tool-use hook into a target run TOGETHER, so it owns
  # their agreement — before this issue neither was present in a target run and they could not
  # disagree. The deny list carves `.env.sample` and `.env.example` out of the blanket
  # `Read(**/.env*)` because, in the issue's words, blocking them "breaks any build that adds an
  # env var." The injected hook applies its own narrower rule and spares ONLY `.env.sample`
  # (`pre-tool-use.ts:85`), so it blocks `.env.example` and defeats the carve-out — a hard
  # `process.exit(2)` the deny list cannot override, and (being a hook block, not a permission
  # denial) not even counted by §11. Verified against the real hook (see the Second spec conflict
  # note). The `.env` case is the correct block; the `.env.sample` case is GREEN today and must
  # STAY green (no collateral); the `.env.example` case is RED today and pins the fix.

  @adw-762 @adw-0rvmyc-enforce-adw-guardrai
  Scenario: The injected pre-tool-use hook blocks a real environment file in a target-repo run
    Given a target-repo agent run with guardrails enabled
    When the injected pre-tool-use hook screens a read of ".env"
    Then the injected pre-tool-use hook blocks the read

  @adw-762 @adw-0rvmyc-enforce-adw-guardrai
  Scenario Outline: The injected pre-tool-use hook allows the sample environment files the injected deny list carves out
    Given a target-repo agent run with guardrails enabled
    When the injected pre-tool-use hook screens a read of "<path>"
    Then the injected pre-tool-use hook allows the read

    Examples:
      | path         |
      | .env.sample  |
      | .env.example |

  # ── §T Type-check backstop (T22) ───────────────────────────────────────────────────────
  #
  # The payload builder, the adw.yml gate, and the denial counter keep the ADW codebase
  # type-clean — including the `ToolResultContentBlock` widening §11 requires. A backstop
  # consistent with feature-758 §T.

  @adw-762 @adw-0rvmyc-enforce-adw-guardrai
  Scenario: The ADW TypeScript type-check passes with the guardrails injection wired in
    Given the ADW codebase is checked out
    Then the ADW TypeScript type-check passes

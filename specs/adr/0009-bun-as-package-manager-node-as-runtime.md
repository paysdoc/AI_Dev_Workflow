---
status: accepted
date: 2026-03-06
recorded: 2026-09-29
provenance:
  - kind: contemporaneous
    source: specs/issue-86-adw-convert-to-bun-usvxy6-sdlc_planner-convert-npm-to-bun.md (issue #86, merged as PR #87 on 2026-03-06)
  - kind: recalled
    source: "Martin Koster, 2026-09-29"
supersedes: []
superseded-by: []
---

# Bun is the package manager and launcher; Node is the runtime

## Context and Problem Statement

ADW was installed with npm and its scripts were launched with `npx tsx`. Every workflow runs in a fresh worktree ([ADR-0002](0002-worktree-per-issue.md)) that has no installed dependencies, so the pipeline installs them again for each issue. The triggers also launch a new process for every workflow ([ADR-0001](0001-script-per-orchestrator-driving-claude-code-cli.md)). The decision covers which tool installs dependencies and launches scripts, and which engine executes them.

## Decision Drivers

* Install time, paid once per worktree.
* Launch time, paid once per spawned script.

## Considered Options

* npm and `npx` (the situation before issue #86)
* Bun and `bunx`

## Decision Outcome

Chosen option: "Bun and `bunx`", because of install and launch speed: the pipeline installs dependencies in every fresh worktree. This reason is recalled by the owner; issue #86 itself gives only the instruction, "Change the codebase to use bun instead of npm." No measurement of the difference is recorded.

The change replaced `npm` with `bun` and `npx` with `bunx` in configuration, commands, spawn calls and script shebangs. It did not change the engine. Scripts are launched as `bunx tsx <script>`: `bunx` resolves and starts `tsx`, and `tsx` runs the script on Node. Bun's own runtime is not used.

### Consequences

* Good, because dependency installation in each worktree is faster (recalled, not measured).
* Bad, because a host needs both Bun and Node.
* Bad, because Bun runtime APIs are not available to ADW code, and anything that describes ADW as running on Bun is wrong.
* Bad, because nothing pins the Bun version: `package.json` has no `packageManager` or `engines` field.

### Confirmation

Checked on 2026-09-29:

* Runtime: `bunx tsx -e "console.log(typeof Bun, process.version, process.execPath)"` in the repository root printed `undefined`, `v26.4.0` and a path to the `node` binary.
* No Bun runtime API is used: a grep of `adws/`, `workers/`, `test/` and `features/` for `Bun.`, `typeof Bun` and imports from `bun` found nothing.
* Lockfile: `bun.lock` is present; `package-lock.json` and `yarn.lock` are absent.
* Launch: all 16 `adws/adw*.tsx` scripts start with `#!/usr/bin/env bunx tsx`; `adws/triggers/trigger_cron.ts` and `adws/triggers/webhookGatekeeper.ts` spawn `bunx` with `tsx` as the first argument.
* Commands: `.adw/commands.md` uses `bun install`, `bun run` and `bunx`; the defaults in `adws/core/projectConfig.ts` are `bun install`.
* CI: all four workflows under `.github/workflows/` use `oven-sh/setup-bun`; three of them run `bun install`.

No CI gate enforces this decision.

## More Information

* At commit 090a846d, `README.md` listed Bun's purpose as "Runtime, package manager, script runner", and the owner's project notes said "Runtime: Bun". Both were wrong about the runtime; the check above is authoritative.
* The spec expected the binary lockfile `bun.lockb`. The repository has the text lockfile `bun.lock`.
* BDD scenarios are run with `NODE_OPTIONS="--import tsx" bunx cucumber-js`, which is also Node.
* These are ADW's own commands. A target repository names its own in `.adw/commands.md` ([ADR-0005](0005-adw-directory-config-per-target-repo.md)).

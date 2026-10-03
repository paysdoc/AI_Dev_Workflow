---
status: accepted
date: 2026-02-26
recorded: 2026-09-29
provenance:
  - kind: contemporaneous
    source: specs/issue-18-adw-the-adw-is-too-speci-tf7slv-sdlc_planner-generalize-adw-project-config.md (issue #18, filed 2026-02-25, merged as PR #21 on 2026-02-26)
  - kind: contemporaneous
    source: specs/issue-121-adw-1773131354028-eosfan-sdlc_planner-adw-provider-config.md (issue #121, merged as PR #133 on 2026-03-12)
supersedes: []
superseded-by: ["0058"]
---

# Each target repository describes itself in a `.adw/` directory of Markdown files

## Context and Problem Statement

Once ADW could work on other repositories ([ADR-0003](0003-external-target-repo-workspaces.md)), its prompts still assumed one kind of project. Issue #18: "the ADW makes assumptions about file structure, bash commands and architecture that may vary from project to project." The spec counted "150+ hardcoded references to npm/npx, Next.js, React, and specific file paths" in the slash command templates. The decision covers where project-specific facts come from: commands, structure, documentation map and, later, providers.

## Decision Drivers

* Targets in other languages and with other package managers.
* Behaviour must not change for a repository that has no configuration ("the highest priority constraint" in the spec).
* The files are read by agents as context, not only by code.

## Considered Options

* Keep project assumptions hard-coded in the slash command templates
* Configuration files in a dedicated directory in the target repository, written as Markdown
* The same, written as JSON or YAML

## Decision Outcome

Chosen option: "Configuration files in a dedicated directory in the target repository, written as Markdown", because the target project is the one that knows its commands and layout, and, for the format, the spec records: "(1) they are read by Claude agents as context, so human-readable format is optimal; (2) they can include rich instructions and examples; (3) they're easy for developers to edit without tooling."

* The directory is `.adw/` at the root of the target repository.
* Issue #18 defined `commands.md`, `project.md` and `conditional_docs.md`. Issue #121 added `providers.md`, which names the code host and issue tracker. `review_proof.md`, `scenarios.md` and `coding_guidelines.md` were added by later work.
* A missing directory or a missing file falls back to defaults, so a repository can adopt the files one at a time.
* A `/adw_init` command generates the files by analysing the target codebase.
* ADW uses its own `.adw/` directory, "as both a test and a reference implementation."

### Consequences

* Good, because supporting a new kind of project is editing Markdown in that project.
* Good, because agents find the files in their working directory without ADW passing them in.
* Bad, because Markdown sections are parsed by heading, so a renamed heading silently yields the default.
* Bad, because the files in each target drift from the templates as ADW changes. This led to [ADR-0042](0042-hash-versioned-self-upgrade.md).

### Confirmation

Checked against the code on 2026-09-29:

* `adws/core/projectConfig.ts` (`loadProjectConfig`) reads `commands.md`, `project.md`, `conditional_docs.md`, `review_proof.md`, `providers.md` and `scenarios.md` from `<repo>/.adw`, and returns `getDefaultProjectConfig()` when the directory is absent. `adws/phases/workflowInit.ts` calls it with the worktree path.
* `adws/core/providerConfig.ts` reads `.adw/providers.md`.
* Unit tests: `adws/core/__tests__/projectConfig.test.ts` and `adws/core/__tests__/providerConfig.test.ts`.
* This repository's `.adw/` holds seven files. `coding_guidelines.md` is not read by the loader; the planning and review commands under `.claude/commands/` refer to it by path.
* The sibling checkouts of `paysdoc/depaudit` and `paysdoc/paysdoc.nl` each carry a `.adw/` directory with six files.

No CI gate checks that a target's `.adw/` is complete.

## More Information

* The `.adw` directory is also the marker that makes a directory an ADW target: [ADR-0003](0003-external-target-repo-workspaces.md).
* How `providers.md` selects implementations: [ADR-0011](0011-provider-ports-and-immutable-repo-context.md) and [ADR-0051](0051-forge-agnostic-core-and-devplatform-dependency.md).
* Not all per-repository settings live in `.adw/`. `adws/core/adwYmlConfig.ts` reads the flags `hitl`, `unitTests` and `guardrails` from `.github/adw.yml`; see [ADR-0043](0043-multi-language-test-seam.md) and [ADR-0050](0050-target-repo-guardrails.md).
* The `adwInit.tsx` orchestrator that issue #18 introduced was deleted on 2026-06-08 (commit 1122ba61). The `/adw_init` command remains and is run by `adwUpgrade.tsx`.
* The default commands are now `bun` commands ([ADR-0009](0009-bun-as-package-manager-node-as-runtime.md)), not the npm values of February 2026.
* Superseded in part by [ADR-0058](0058-static-checks-in-the-test-phase-reviewer-runs-nothing.md): `review_proof.md` is no longer one of the `.adw/` files. The directory and the other files stand.

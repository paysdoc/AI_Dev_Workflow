@adw-846 @adw-9176vg-auto-trust-target-re
Feature: ensureTargetRepoWorkspace grants Claude Code workspace trust in ~/.claude.json

  Every agent run against a target repo that has never been opened interactively in Claude
  Code logs "Ignoring N permissions.allow entries from .claude/settings.json: this workspace
  has not been trusted …". Claude Code (2.1.278) has no CLI flag or env var to grant trust;
  the only knob is `~/.claude.json` → `projects[<repoRoot>].hasTrustDialogAccepted: true`,
  keyed on the exact path `ensureTargetRepoWorkspace` returns. ADW never wrote this entry.

  `ensureWorkspaceTrusted` (adws/core/workspaceTrust.ts) is called from
  `ensureTargetRepoWorkspace` (adws/core/targetRepoManager.ts) once the workspace path is
  known, on both the fresh-clone and already-cloned (fetch) branches.

  This suite drives the REAL `ensureTargetRepoWorkspace` in a CHILD PROCESS
  (features/per-issue/support/feature-846-ensure-driver.ts) rather than in-process, because
  `TARGET_REPOS_DIR` (adws/core/environment.ts) is bound at import time — an in-process call
  would clone into the real `~/.adw/repos` on the host running this suite. `os.homedir()`
  honours `$HOME` on POSIX, so overriding `HOME` in the child's env is sufficient to redirect
  `~/.claude.json` into a temporary, disposable home for every row. The clone/fetch itself is
  real too, against a real bare git remote seeded once per scenario, so both the clone branch
  and the fetch branch of `ensureTargetRepoWorkspace` run their genuine git commands.

  Each row is written to fail for a reason: a plausible, tsc-green implementation that only
  calls `ensureWorkspaceTrusted` on the clone branch (never the fetch branch) fails the second
  scenario; one that realpaths, resolves, or trims the workspace path before using it as the
  key fails the third; one that clobbers sibling keys or a sibling project's entry when
  flipping the flag fails the second scenario's preservation assertions; one that throws
  instead of skipping on a missing `~/.claude.json` fails the fourth scenario's exit-code and
  git-checkout assertions; one that "helpfully" bootstraps a fresh `~/.claude.json` when none
  exists fails the fourth scenario's "no file was created" assertion; one that rewrites the
  file even when the workspace is already trusted fails the fifth scenario's byte-identical
  assertion.

  Background:
    Given a temporary home directory for workspace trust
    And a temporary target repositories root for workspace trust
    And a real git remote seeded for workspace trust

  @adw-846 @adw-9176vg-auto-trust-target-re
  Scenario: A never-cloned repo trusts its workspace path in a fresh config with no projects key
    Given the home's .claude.json holds a fresh config with no projects key
    When the target repository workspace is ensured from a child process bound to that home
    Then the driver exits 0
    And the reported workspace path is inside the target repositories root
    And the home's .claude.json trusts the reported workspace path
    And the home's .claude.json still has the fresh config's sibling key intact

  @adw-846 @adw-9176vg-auto-trust-target-re
  Scenario: An already-cloned repo is trusted on the fetch branch without clobbering sibling data
    Given the workspace has already been cloned by an earlier ensure
    And the home's .claude.json records the cloned workspace as untrusted with a sibling project already trusted
    When the target repository workspace is ensured from a child process bound to that home
    Then the driver exits 0
    And the home's .claude.json trusts the reported workspace path
    And the home's .claude.json preserved the cloned workspace's sibling key
    And the home's .claude.json left the sibling project untouched
    And no .claude.json.tmp file remains in the home

  @adw-846 @adw-9176vg-auto-trust-target-re
  Scenario: The trusted key is the exact workspace path the driver reported, never realpathed
    Given the home's .claude.json holds an empty projects map
    When the target repository workspace is ensured from a child process bound to that home
    Then the home's .claude.json project keys contain exactly the reported workspace path

  @adw-846 @adw-9176vg-auto-trust-target-re
  Scenario: A missing ~/.claude.json never blocks the ensure and is never created
    Given the home has no .claude.json file
    When the target repository workspace is ensured from a child process bound to that home
    Then the driver exits 0
    And the reported workspace path exists as a git checkout
    And the driver's output mentions skipping workspace trust
    And the home still has no .claude.json file

  @adw-846 @adw-9176vg-auto-trust-target-re
  Scenario: An already-trusted workspace leaves ~/.claude.json byte-identical
    Given the workspace has already been cloned by an earlier ensure
    And the home's .claude.json already trusts the cloned workspace
    And the home's .claude.json bytes are captured
    When the target repository workspace is ensured from a child process bound to that home
    Then the driver exits 0
    And the home's .claude.json bytes are unchanged
    And no .claude.json.tmp file remains in the home

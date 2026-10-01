---
status: accepted
date: 2026-06-08
recorded: 2026-09-29
provenance:
  - kind: contemporaneous
    source: specs/prd/adw-init-hash-and-label-classification.md
  - kind: contemporaneous
    source: specs/issue-537-*.md to specs/issue-544-*.md, specs/issue-547-*.md
  - kind: contemporaneous
    source: specs/issue-614-*.md, specs/issue-685-*.md, specs/issue-730-*.md; commit 4b3e09b6
supersedes: []
superseded-by: []
---

# Target repos upgrade themselves when the framework hash changes

## Context and Problem Statement

Each target repo carries a generated `.adw/` directory ([ADR-0005](0005-adw-directory-config-per-target-repo.md)). When `/adw_init` or a file it depends on changed, repos that already had `.adw/` kept the old output until the operator re-ran init on each one by hand. The PRD calls this "invisible toil": repos went stale silently. Init was also triggered by matching `/adw_init` in issue text, which misfired when the command appeared in prose.

This ADR covers the hash half of the PRD. The label half is [ADR-0041](0041-label-based-classification.md).

## Decision Drivers

* Framework changes reach every target repo without a manual step per repo.
* No workflow runs against a stale `.adw/`.
* Several issues that detect the same mismatch produce one upgrade.
* A repo that was never initialised takes the same path as an outdated one.

## Considered Options

* Keep the `/adw_init` text trigger and manual re-init.
* Content hash of the init spec and its declared inputs, checked at workflow start.
* A semantic hash, or a CI guard pinning the hash to a fixture. Rejected in the PRD: "content hash is the contract".
* Storing the version inside `.adw/`. Rejected because the regeneration would overwrite it.
* Reproducible upgrade against a pinned framework hash. Out of scope in the PRD.

## Decision Outcome

Chosen option: "Content hash of the init spec and its declared inputs, checked at workflow start", because it propagates changes at the natural cadence of work and removes the text trigger.

* The framework hash is a SHA-256 over the files listed under `hashInputs:` in the front matter of `.claude/commands/adw_init.md`, in sorted order.
* A target repo stores the hash in `.adw-version` at its root, outside `.adw/`. A missing file reads as `null` and counts as a mismatch.
* `initializeWorkflow()` runs the gate for target repos. On mismatch it claims the upgrade by pushing branch `adw-upgrade-<hash>`. The push is the atomic claim: success is the winner.
* The winner creates a tracking issue labelled `adw:upgrade` and spawns `adwUpgrade.tsx`. Winner and losers add the tracking issue to their own issue's dependencies, return to Todo and exit before posting any workflow comment, so they hold no concurrency slot.
* `adwUpgrade.tsx` runs `/adw_init`, recomputes the hash, writes `.adw-version`, opens a PR and merges it. `hitl: true` in `.github/adw.yml` leaves the PR for a human (#543).
* If the hash advances while an upgrade PR is open, a further upgrade follows. The PRD accepts this churn over a more complex linearisation.
* `adwInit.tsx` was deleted. `/adw_init` remains runnable by hand in a Claude Code session.

Amendments recorded in later specs:

* The gate reads `origin/<default>:.adw-version` and runs before worktree setup, so a stale worktree cannot cause a false mismatch (commit 4b3e09b6, 2026-06-24). The PRD had placed it after worktree setup.
* Proof of regeneration: a changed `.adw/` diff was required at first, then an agent-written receipt (#614), then validity only: the six required `.adw/` files are non-empty and `features/regression/vocabulary.md` exists (#685).
* After `MAX_FAILURES` (default 3) failure comments the upgrade gets `adw:blocked`, a move to Blocked and a Slack alert (#685).
* The upgrade commit excludes `.claude/commands/adw_init.md`, because `git add -A` had been committing the host's copy and reverting merged work (#685).
* Commit and push failures return a counted failure instead of throwing, and a cron pass re-spawns a stranded upgrade until it succeeds or hits the cap (#730).

### Consequences

* Good, because first bootstrap and upgrade share one code path.
* Good, because adding a dependency to `hashInputs` is the same change that alters the hash.
* Bad, because any byte change to an input triggers an upgrade on every target repo, including changes that leave `.adw/` identical. #614 records a loop of this kind at about $0.40 per run.
* Bad, because the upgrade lane sits outside the recovery kernel of `initializeWorkflow()` and needed its own failure cap and redrive.
* Bad, because a blocked upgrade PR holds every issue on that repo in Todo until it merges.

### Confirmation

Checked on 2026-09-29:

* `adws/core/hashComputer.ts`, `adwVersion.ts`, `upgradeClaim.ts`, `upgradeFailureCap.ts`, `adwYmlConfig.ts`, `adws/phases/upgradeGate.ts`, `adws/triggers/upgradeRedrive.ts` and `adws/adwUpgrade.tsx` exist; `adws/adwInit.tsx` does not.
* `adws/phases/workflowInit.ts` calls `runUpgradeGate` before worktree setup and exits on `parked`.
* `hashInputs` lists `adw_init.md`, `document.md` and `templates/vocabulary.md.template`.
* Running `bunx tsx adws/core/hashComputer.ts` on this repo printed the same value as `.adw-version`.
* `verifyAdwRegen` in `adws/phases/worktreeSetup.ts` checks files only, and `.adw/.regen-receipt` is in `.gitignore`.

Unit tests exist for each module (`adws/core/__tests__/hashComputer.test.ts`, `adwVersion.test.ts`, `upgradeClaim.test.ts`, `upgradeFailureCap.test.ts`, `adws/phases/__tests__/upgradeGate.test.ts`). No CI gate pins the hash, by decision.

## More Information

* `document.md` was added to `hashInputs` so that the living-docs change reaches target repos; see [ADR-0044](0044-living-docs-per-module.md).
* Depaudit setup was excluded from propagation; see [ADR-0033](0033-depaudit-as-dependency-gate.md).
* The upgrade merge is best effort: a failed merge is logged, commented on the tracking issue and leaves the PR open (#543).
* The gate runs only when a target repo is passed to the orchestrator (`if (targetRepo && targetRepoWorkspacePath)` in `workflowInit.ts`). How ADW's own `.adw-version` is kept current was not checked.

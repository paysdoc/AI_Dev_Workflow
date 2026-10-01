---
status: superseded
date: 2026-02-25
recorded: 2026-09-29
provenance:
  - kind: contemporaneous
    source: specs/issue-8-adw-move-cost-breakdown-9ntv1f-sdlc_planner-cost-breakdown-csv.md
  - kind: contemporaneous
    source: specs/issue-34-adw-trigger-should-commi-f8jwcf-sdlc_planner-commit-push-cost-csv.md
  - kind: contemporaneous
    source: specs/issue-66-adw-automatically-ccommi-wdlirj-sdlc_planner-auto-commit-cost-on-pr.md
  - kind: contemporaneous
    source: specs/issue-109-adw-rewrite-cost-commit-22b71a-sdlc_planner-rewrite-cost-commit.md
  - kind: contemporaneous
    source: specs/issue-111-adw-1773068420299-fw4sym-sdlc_planner-remove-revert-cost-file.md
supersedes: []
superseded-by: ["0026"]
---

# Cost records as CSV files committed to the ADW repository

## Context and Problem Statement

When a workflow finished, ADW wrote its cost breakdown (model, token counts, cost) as a markdown table into the completion comment on the GitHub issue. The spec for #8 records the problem: cost data was "scattered across different issue threads", could not be aggregated across issues and could not be imported into other tools.

The decision covered where cost data was stored and how it reached the remote: the cost writer in `adws/core/`, the webhook handlers that reacted to closed pull requests and issues, and the git commit helpers.

## Considered Options

None recorded. Issue #8 prescribed the CSV layout and the path; no alternative store appears in the specs.

## Decision Outcome

Cost data was written to CSV files in the ADW repository itself, not in the target repository, and committed to git.

* One file per issue at `projects/<repo_name>/<issue-nr>-<issue-heading-slug>.csv`, with one row per model and totals in USD and EUR.
* One mutable ledger per project at `projects/<repo_name>/total-cost.csv`, with one row per issue, a 10% markup column and running totals.
* The workflow wrote the files to disk at completion. Committing and pushing was a separate step: the webhook called `commitAndPushCostFiles()` when a pull request closed (#34). A `/commit_cost` slash command did the same by hand. Both staged only cost files.
* From #66 the outcome of the pull request decided what happened: merged kept the issue file, closed without merge deleted it, and the ledger was rebuilt from the issue files before every commit.
* #109 rewrote the commit mechanism around a `CostCommitQueue` that serialised all cost git operations in the process, and reduced staging to the whole `projects/<repo_name>/` directory.
* #111 removed the deletion of issue files on closed pull requests and issues.

The stated reason was the one in #8: a structured, machine-readable record that accumulates over time and can be opened in a spreadsheet.

### Consequences

* Good, because cost history was versioned and readable with no extra infrastructure.
* Good, because the ledger could always be rebuilt from the per-issue files, which made the rebuild idempotent.
* Bad, because every cost update was a git commit and push on a repository that other processes were also writing to. The spec for #109 counts nine issues against the mechanism (#60, #66, #76, #77, #85, #94, #100, #104, #107) and says it "remains fragile and continues to lose cost data".
* Bad, because a merged pull request produced two webhook events (pull request closed, issue closed) that both handled cost files. #94 and #104 came from the two handlers disagreeing, #107 from both running git at the same moment.
* Bad, because the link between a pull request and its issue depended on text in the pull request body, with the branch name as fallback (#104).

### Confirmation

This decision is no longer in force. Checked on 2026-09-29: the `projects/` directory does not exist, `.claude/commands/commit_cost.md` does not exist, and a search for `csv` in the non-test sources under `adws/` finds only two stale comments (`adws/cost/reporting/commentFormatter.ts:6`, `adws/phases/workflowCompletion.ts:31`). The pipeline was deleted by commit 896c6c78 on 2026-03-27 (#335).

## More Information

* Replaced by [ADR-0026](0026-cost-computed-locally-persisted-in-d1.md).
* Further sources: specs for #100, #104 and #107 (the individual fixes), `specs/issue-34-plan.md`, `specs/issue-66-plan.md`.
* `README.md` (lines 74 and 102) says the CSV files were committed into the target repository's history. The specs for #8 and #34 say otherwise: the files lived in the ADW repository, under `projects/`.

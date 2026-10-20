# Design Records and Specs

## Overview

`docs/` holds the durable design records. `docs/adr/` holds one MADR record per design decision, with `README.md` as the index; the `write-an-adr` skill writes them. `docs/prd/` holds product requirement documents, written by the `write-a-prd` skill and broken into issues by `prd-to-issues`. The docs-index gate resolves every `Decisions:` number in `.adw/conditional_docs.md` against `docs/adr/` through `DECISION_RECORD_DIR` in `adws/core/docsDecisions.ts`.

`specs/` is separate: it stays the per-run working directory for implementation plans. The planning agents write there, the plan-locating helpers search there, and `AgentState.planFile` records the path the build agent follows.

## Responsibilities

- Hold one `NNNN-short-kebab-title.md` record per architecture decision in `docs/adr/`, including decisions later replaced, with `docs/adr/README.md` as the index (number, date, title, status).
- Hold PRDs in `docs/prd/` for architectural features and cross-cutting module designs that span several issues, named for their subject without a `prd-` prefix (e.g. `docs/prd/cost-module-revamp.md`).
- Give the docs-index gate one record directory, `DECISION_RECORD_DIR`, from which it derives the record-file and link-target patterns, the `unknown-decision` message and the gate's check label.
- Keep the durable records in `docs/` apart from the per-run plans in `specs/`.

## Contracts & Invariants

- A record counts only when its file sits directly under `docs/adr/` as `NNNN-<slug>.md`; the index and nested paths are not records, and a record kept anywhere else is reported as an unknown decision record.
- ADR numbers are never reused or renumbered. A replaced record stays in place, and its status points at its successor.
- PRD files in `docs/prd/` reflect architectural intent at the time of writing; they may diverge from the current implementation as the codebase evolves — they are not kept in sync automatically.
- A record's `provenance` front matter may name plan files, patch notes or runbooks that are no longer in the tree; those resolve through git history, not the working tree.

## Configuration

No configuration. `DECISION_RECORD_DIR` is a code constant, not a setting. The planning commands (`/feature`, `/bug`, `/chore`, `/pr_review`) write plans to `specs/` by convention.

## Gotchas

- A module doc links a record as `../docs/adr/<NNNN>-<slug>.md`. The gate resolves the link from the doc's own directory, so a link missing its `../` is reported as a dead decision link.
- PRD files in `docs/prd/` are read by agents during planning when referenced in `conditional_docs.md`; outdated PRDs can misdirect planning if not kept current.

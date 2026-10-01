---
status: accepted
date: 2026-06-17
recorded: 2026-09-29
provenance:
  - kind: contemporaneous
    source: specs/prd/app-docs-module-living-docs.md
  - kind: contemporaneous
    source: specs/issue-609-*.md, specs/issue-610-*.md, specs/issue-611-*.md, specs/issue-612-*.md
supersedes: []
superseded-by: ["0053"]
---

# One living doc per module, rewritten in place

## Context and Problem Statement

`/prime` and every planning run read `.adw/conditional_docs.md` in full to decide which docs in `app_docs/` to load. `/document` appended one entry and one snapshot doc per run, so the index grew with every feature. The PRD measured 191 entries, 1558 lines and about 46K tokens. Reruns produced near-duplicate docs, and later docs silently superseded earlier ones, so a planner loaded several overlapping docs of which only the newest was true.

The decision covers the `/document` command, the document phase, `app_docs/` and the index.

## Decision Drivers

* The cost of priming must stay flat as the project ages.
* A module's doc must state current truth.
* A one-time cleanup does not last: the PRD notes it "is re-inflated by the very next `/document` run".
* Target repos must get the same behaviour without hand pruning.

## Considered Options

* Keep per-run snapshot docs and clean up once.
* Per-module living docs, with `/document` converging on every write.
* Glob-only routing of a change to its owning doc. Shipped first in #609, replaced by semantic routing in #610 because only 1 of 198 entries carried an `Owns:` block.
* Splitting an oversized doc. Rejected: an oversized doc is a signal to refactor the module.
* A registry artefact separate from `conditional_docs.md`. Out of scope in the PRD.

## Decision Outcome

Chosen option: "Per-module living docs, with `/document` converging on every write", because the index is then bounded by the number of modules and not by the number of features, and the fix lasts because it changes how `/document` writes.

* `app_docs/` is disposable working context. History lives in git.
* One doc per code module holds a current-state reference: what the module does, its contracts, configuration and gotchas. It is rewritten in place and has no changelog.
* `conditional_docs.md` is the registry: one entry per module with the doc path, the `Owns:` globs and the match conditions.
* `/document` judges semantically which entry owns the change, rewrites that doc, collapses sibling entries into one and regenerates the entry's conditions. It creates a doc and an entry only for a genuinely novel area.
* A pure registry module parses and serialises the index. A pure guards module flags bloat and regrowth as a self-check after each write.
* A one-off migration, for ADW only, clustered the existing docs into module docs (#612, gated by `hitl`). Other repos rely on convergence alone.
* `document.md` is a hash input, so the change reaches target repos through [ADR-0042](0042-hash-versioned-self-upgrade.md).
* No periodic check of the whole index was built. The PRD names the post-write flags as "the only safety net".

### Consequences

* Good, because priming cost no longer grows with the number of features.
* Good, because consolidation is a side effect of normal operation.
* Bad, because `/document` is heavier per run: it matches, reads current source and rewrites.
* Bad, because convergence is non-deterministic and touches only the area of the current change.
* Bad, because a wrong merge of two modules in the migration persists until the module is refactored; a wrong split heals through sibling collapse.
* Bad, because per-run history is no longer kept in `app_docs/`.

### Confirmation

Checked on 2026-09-29:

* `adws/core/conditionalDocsRegistry.ts` and `adws/core/docsGuards.ts` exist with unit tests under `adws/core/__tests__/`.
* `adws/phases/documentPhase.ts` imports the self-check from `adws/phases/docsSelfCheck.ts`. The bloat threshold is 400 lines.
* `.claude/commands/document.md` contains the routing, collapse, rewrite-in-place and create-new steps.
* `app_docs/` holds 45 docs, 43 of them module docs from the migration (`feature-9gjajh-*`). The index holds 47 entries; two point at `README.md` and `adws/README.md`.

The one-entry-per-module property is enforced in CI by `bun run lint:docs-index`, which belongs to [ADR-0053](0053-docs-index-health-gate-and-sweep.md).

## More Information

* Superseded in part by [ADR-0053](0053-docs-index-health-gate-and-sweep.md). The part that no longer holds is the choice to rely on write-time convergence with no periodic backstop. Everything else stands.
* The migration merged to `dev` on 2026-06-19 (PR #642, commit c7bf098b) according to issue #810.
* The PRD planned BDD content-assertion scenarios for the prompt. Whether those scenarios still exist was not checked; per-issue scenarios are deleted 14 days after merge ([ADR-0037](0037-tiered-regression-suite-with-fixed-vocabulary.md)).

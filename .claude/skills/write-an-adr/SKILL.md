---
name: write-an-adr
description: Record an architecture decision as a MADR-based ADR in specs/adr/, with provenance, supersede links and divergence tracking. Use when user wants to write an ADR, record or document an architecture or design decision, supersede an earlier decision, or mentions "ADR" or "decision record".
target: true
---

## Before you do anything else
Read and execute .claude/commands/prime.md

# Write an ADR

One ADR records one decision. ADRs live in `specs/adr/` and use [TEMPLATE.md](TEMPLATE.md), which is MADR 4.0.0 with extra front matter (`recorded`, `provenance`, `supersedes`, `superseded-by`) and a `## Divergence` section.

## Workflow

1. **Pin down the decision.** Ask the user, one question at a time, for whatever is missing: the problem, what was decided, which options were actually weighed, and why this one won.
2. **Check it against the code.** Explore the repo to establish whether the decision is in force. Name the check you ran in `### Confirmation`. If the code does something else, do not pick a side: ask the user whether the difference is deliberate, then write `## Divergence`.
3. **Number and name the file.** Take the next free four-digit number in `specs/adr/`. Filename: `NNNN-short-kebab-title.md`. Numbers are never reused or renumbered.
4. **Write the ADR** from [TEMPLATE.md](TEMPLATE.md). Remove optional sections you have nothing to put in.
5. **Link supersession at both ends.** See below.
6. **Update the index** in `specs/adr/README.md`: one table row per ADR (number, date, title, status).

## Never invent

- No options were recorded: write `None recorded.` under `## Considered Options` and state the decision without the "Chosen option" comparison.
- The reason is unknown: ask the user. If they answer from memory, the provenance is `recalled`.
- A claim you could not check is labelled as unverified in the text.

## Front matter

| Key | Meaning |
|---|---|
| `status` | `proposed`, `accepted`, `deferred`, `rejected`, `deprecated` or `superseded` |
| `date` | The day the decision was made |
| `recorded` | The day this ADR was written. Differs from `date` for decisions recorded after the fact |
| `provenance` | Where the rationale comes from; one entry per source |
| `supersedes` | ADR numbers this decision replaces, in whole or in part, as quoted four-digit strings: `["0004"]` |
| `superseded-by` | ADR numbers that replace this decision, in whole or in part, in the same form |

`provenance` kinds:

- `contemporaneous`: written down when the decision was made (PRD, spec, issue, commit). `source` is the path or reference.
- `retrospective`: a written source dated after the decision (a README section, a later doc). `source` is the path or reference and the date it was written.
- `transcript`: the user's own words in a saved conversation. `source` names it.
- `recalled`: the user's memory, stated later. `source` is who and when.

## Supersession

- **Whole:** set the old ADR's `status` to `superseded` and add the new number to its `superseded-by`. Add the old number to the new ADR's `supersedes`.
- **In part:** the old ADR keeps `status: accepted`, gains the new number in `superseded-by`, and says under `## More Information` which part no longer holds.

## What may change after an ADR is accepted

Only `status`, `superseded-by`, `## Divergence` and the supersession note under `## More Information`. A changed decision is a new ADR.

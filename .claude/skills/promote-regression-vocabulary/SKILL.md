---
name: promote-regression-vocabulary
description: The analysis of a Promotion Proposal. For each nominated candidate it writes why it qualifies for the Regression Suite and how it fits the existing Regression Suite, including overlap with the scenarios already there, phrase reuse against the Vocabulary Registry and rot in its step definitions. Advisory only; writes nothing. Use when analysing a "promotion proposal" or a "nominated scenario", or asked about "regression fit", "overlap with the regression suite", "vocabulary rot" or "phrase reuse".
---

# Promotion Proposal analysis (advisory)

A Promotion Proposal offers the owner a repository's Nominations side by side. For each candidate it says why it qualifies for the Regression Suite and how it fits the Regression Suite as it stands, including its overlap with the scenarios already there. This skill writes that analysis. **You produce analysis, not edits**: write nothing, and leave the decision to the owner.

## Candidates

- By default, the candidates are the scenarios tagged `@nominated` on their own tag line in the Per-Issue Scenario files of issues whose pull request has merged.
- When the caller names candidates, analyse those and no others: the cron passes a list, and a person may name scenarios in a session.
- A scenario tagged `@nomination-declined` is never a candidate: the owner declined it.

## Configuration

Read `.adw/scenarios.md`; never assume a path.

- `## Per-Issue Scenario Directory`: where the candidates live.
- `## Regression Scenario Directory`: the Regression Suite. A scenario tagged `@regression` belongs to it too, wherever it lives.
- `## Vocabulary Registry`: the Regression Suite's phrase registry.
- `## Step Def Directory`: where the step definitions behind the steps live.
- `## Real Boundaries`: the boundaries a scenario may drive, each named by a `@boundary-<name>` tag.

In ADW's own repository, `bun .claude/skills/promote-regression-vocabulary/scripts/list-registered-phrases.ts`, run from the repository root, prints the registry normalised, one `SOURCE⇥NORMALISED_PHRASE` per line (SOURCE is `vocab` or a step definition file's basename). Elsewhere, read the Vocabulary Registry file directly.

## Why it qualifies

A scenario belongs in the Regression Suite only when it guards a behaviour whose breakage would be expensive and that no scenario of the Regression Suite already guards. That it exists and passes is no argument. State:

- the behaviour it guards, and why a break of it would be expensive;
- the Real Boundary its `@boundary-<name>` tag names, whether `## Real Boundaries` declares it, and whether its step definitions, traced, really drive that boundary: a scenario may only prove behaviour observable through a Real Boundary;
- that no regression scenario guards it yet, or which one does.

Say plainly when a candidate does not qualify: an in-process scenario, a duplicate of a regression scenario, or a scenario whose step definitions rot. The owner decides.

## How it fits the Regression Suite

- **Place**: the regression feature file it would join, or that it needs a new one.
- **Reuse check**, per Given/When/Then step: normalise the step (`"..."`→`{string}`, integers→`{int}`) and match it against the registry. An exact match reuses the phrase verbatim. A close match should reuse the existing phrase instead of minting a variant: name that phrase. No match is a new phrase.
- **Rot check**, per step definition: read the step definition behind each step and judge it against the rubric below. A new phrase with no step definition yet is judged by intent, and its implementation must assert an observable artefact.

### Rot rubric

A step definition is **ROT** if it asserts any of:
- File shape: exists? line count? extension?
- File content by substring: `readFileSync(...).includes(...)`
- Structural source read: `JSON.parse(readFileSync(config.ts))`

It is **VALID** when it asserts an artefact the system under test produced: state files an orchestrator wrote, recorded mock-server requests, git artefacts (branches, commits, pushes), subprocess exit codes, or captured stdout and stderr. The Gherkin text alone cannot tell you which: **read the step definition** before you rule.

## Overlap with the Regression Suite

Name each regression scenario, by its file and its scenario name, that guards the same or an overlapping behaviour, and say how far it overlaps. Two candidates that guard the same behaviour overlap each other: say so too. Report none when there is none.

## Guardrails

- Never edit the Vocabulary Registry, never move or edit a feature file or a step definition, and never add `@regression`.
- Never add or remove `@nominated` or `@nomination-declined`.
- Write nothing: the analysis is your whole output.

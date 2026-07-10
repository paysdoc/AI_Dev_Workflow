---
name: promote-regression-vocabulary
description: Scan per-issue BDD features for regression-promotion candidates and analyse each Given/When/Then phrase against the regression vocabulary's rot-detection rubric and existing phrase registry. Advisory only — produces per-phrase reuse and rot verdicts to inform a collaborative promotion decision; writes nothing. Use when the user wants to promote a scenario to the regression suite, vet phrases for @features/regression/vocabulary.md, check for phrase reuse/collision, or asks about "promotion candidates", "vocabulary rot", or "regression phrase audit".
---

# Promote Regression Vocabulary (advisory)

Analyse BDD phrases for promotion into `features/regression/vocabulary.md` and the regression
suite. **You produce verdicts, not edits.** Do not write files, move features, or touch the
registry — the human owns the promotion decision. Surface the analysis and stop.

## Two verdicts per phrase

1. **Reuse / collision** — is this phrase already registered? Reusing an existing phrase is
   strongly preferred over minting a near-duplicate.
2. **Rot** — would this phrase, as backed by its step definition, assert an *observable system
   behaviour* (valid) or a *source-code property* (rot, rejected)?

`features/regression/vocabulary.md` is the source of truth for the rubric; the summary below is a
working copy.

### Rot rubric (from vocabulary.md)
A phrase is **ROT** if its step definition asserts any of:
- File shape — exists? line count? extension?
- File content by substring — `readFileSync(...).includes(...)`
- Structural source read — `JSON.parse(readFileSync(config.ts))`

A phrase is **VALID** when it asserts an *artefact* the system-under-test produced: state files
written by an orchestrator, recorded mock-server requests, git artefacts (branches/commits/pushes),
subprocess exit codes, or captured stdout/stderr. The Gherkin text alone can't tell you which —
**you must read the backing step definition** to judge rot.

## Workflow

1. **Scope the candidates.** Default: scenarios in `features/per-issue/*.feature` tagged
   `@promotion-suggested-<date>` (the promotion pipeline pre-tags aged, high-scoring scenarios).
   If the user names a file or pastes phrases, use those. List the candidates and confirm scope
   before analysing — this is a collaborative review, not a batch job.

2. **Load the registry.** Run once from the repo root:
   ```
   bun .claude/skills/promote-regression-vocabulary/scripts/list-registered-phrases.ts
   ```
   Output is `SOURCE⇥NORMALISED_PHRASE` (SOURCE = `vocab` or a step-def basename). Normalisation
   maps `"..."`→`{string}` and integers→`{int}`, matching cucumber-expression shape.

3. **Per candidate scenario, per Given/When/Then step:**
   - **Reuse check** — normalise the step the same way (quotes→`{string}`, ints→`{int}`) and match
     against the registry. Exact match ⇒ *reuse verbatim*. Close semantic match ⇒ *reuse existing,
     don't mint a variant* (name the existing phrase). No match ⇒ *new phrase*.
   - **Rot check** — locate the backing step definition (grep the phrase across
     `features/**/step_definitions/*.ts`) and read its assertion body. Judge it against the rubric.
     If the phrase is new (no step def yet), judge from intent and flag that its implementation
     **must** assert an observable artefact, not a source-file read.

4. **Report.** One table per candidate scenario:

   | Step (G/W/T) | Reuse | Rot | Note |
   |---|---|---|---|
   | `the state file for adwId {string} records ...` | reuse T1 (vocab) | VALID | verbatim |
   | `feature-729.steps.ts asserts file exists` | new | **ROT** | asserts file shape — rework to assert a produced artefact |

   Close with a recommendation: which phrases are promotion-ready, which need rewording to reuse an
   existing entry, and which are rot and must be reworked or dropped. **Then stop — no edits.**

## Guardrails
- Never edit `vocabulary.md`, never `git mv` a feature or its step defs, never add `@regression`.
- A phrase's rot verdict lives in its **step definition**, not its Gherkin text — always read the
  implementation before ruling.
- Prefer reuse. A near-duplicate phrase is a finding, not a convenience.
- The automated promotion *mover* (`adws/promotion/`) is effectively dead; real regression tests are
  hand-placed. This skill informs that human step — it does not perform it.

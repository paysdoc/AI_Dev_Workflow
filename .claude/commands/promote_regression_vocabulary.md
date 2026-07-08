# Promote Regression Vocabulary Advisory

You are analysing a promoted regression scenario for the ADW promotion rot/reuse advisory. The
promoted feature id is given in `$ARGUMENTS` (e.g. `feature-665`) — it now lives under
`features/regression/` (the build phase already relocated it there).

Use the `promote-regression-vocabulary` skill to analyse this scenario's Given/When/Then phrases.
The skill is the single source of truth for the rot rubric and the phrase registry — follow its
workflow to load the registry and locate the backing step definitions.

## Two verdicts per phrase

1. **Reuse / collision** — is this phrase already registered in `features/regression/vocabulary.md`?
   Note the existing phrase it reuses or near-duplicates, or that it is new.
2. **Rot** — does the phrase, as backed by its step definition, assert an *observable system
   behaviour* (`VALID`) or a *source-code property* (`ROT`)? A phrase is **ROT** if its step
   definition asserts file shape (exists/line-count/extension), file content by substring
   (`readFileSync(...).includes(...)`), or a structural source read
   (`JSON.parse(readFileSync(config.ts))`). A phrase is **VALID** when it asserts an artefact the
   system-under-test produced (state files, recorded mock-server requests, git artefacts,
   subprocess exit codes, captured stdout/stderr). If you cannot locate or read the backing step
   definition, use `UNKNOWN` rather than guessing.

## What to do

1. Find the promoted scenario's Given/When/Then/And/But steps for `$ARGUMENTS` under
   `features/regression/`.
2. For each step, run the reuse check and the rot check per the skill's workflow.
3. Do **not** edit `vocabulary.md`, move any file, add `@regression`, or write anything. You
   produce verdicts only.

## Output format

Respond with **only** a JSON array — no prose, no markdown fences, no preamble or explanation.
One object per Given/When/Then/And/But step, in scenario order:

```json
[
  { "step": "the state file for adwId \"abc\" records completion", "keyword": "Given", "reuse": "reuse T1 (vocab)", "rot": "VALID", "note": "verbatim" },
  { "step": "feature-729.steps.ts asserts file exists", "keyword": "Then", "reuse": "new", "rot": "ROT", "note": "asserts file shape — rework to assert a produced artefact" }
]
```

`keyword` must be one of `Given`, `When`, `Then`, `And`, `But`. `rot` must be one of `VALID`,
`ROT`, `UNKNOWN`. If the scenario has no steps to analyse, respond with `[]`.

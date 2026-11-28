# Promotion Proposal Analysis

Analyse the candidates of a Promotion Proposal. For each candidate, write why it qualifies for the Regression Suite, how it fits the Regression Suite as it stands, and where it overlaps the scenarios already there. The owner reads your analysis in the proposal and decides which candidates to promote. You decide nothing and change nothing.

## Variables

candidates: $ARGUMENTS

`candidates` is a JSON array. Each candidate is `{ "issueNumber": <int>, "scenarioName": "<name>", "featurePath": "<path>" }`: a scenario tagged `@nominated` in the Per-Issue Scenario file `featurePath` of issue `issueNumber`, whose pull request has merged. You run in a checkout of the repository's default branch.

## Instructions

1. Use the `promote-regression-vocabulary` skill. It holds the qualification criterion, the reuse check, the rot rubric and the overlap check you apply.
2. Read `.adw/scenarios.md` for the Per-Issue Scenario Directory, the Regression Scenario Directory, the Vocabulary Registry, the Step Def Directory and the Real Boundaries.
3. For each candidate, find the scenario named `scenarioName` in `featurePath`, and read the step definitions behind its steps.
4. Read the Regression Suite: the scenarios under `## Regression Scenario Directory` or tagged `@regression`, and the Vocabulary Registry.
5. Write the analysis of each candidate as the skill describes it: why it qualifies, how it fits the Regression Suite, and its overlaps.
6. Write nothing and edit no file: no feature file, no step definition, no tag and no registry entry.

## Output

Respond with only a JSON array: no prose, no markdown fences, no preamble. Give one object per candidate, in the order the candidates were given:

```json
[
  {
    "issueNumber": 1201,
    "scenarioName": "<the candidate's scenarioName, exactly as given>",
    "qualification": "<why it qualifies for the Regression Suite, or plainly why it does not>",
    "fit": "<how it fits the Regression Suite: where it would sit, which steps reuse registered phrases and which would be new, and the rot verdict of its step definitions>",
    "overlaps": ["<regression feature file> — <regression scenario> — <how far it overlaps>"]
  }
]
```

- `overlaps` is `[]` when no regression scenario guards the same or an overlapping behaviour.
- Write each field as plain sentences. Inline code is allowed; headings, checkboxes and HTML comments are not.
- Keep each field to about 150 words.

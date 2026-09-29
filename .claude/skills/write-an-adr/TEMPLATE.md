---
status: {proposed | accepted | deferred | rejected | deprecated | superseded}
date: {YYYY-MM-DD the decision was made}
recorded: {YYYY-MM-DD this ADR was written}
provenance:
  - kind: {contemporaneous | transcript | recalled}
    source: {path, reference, or "who, YYYY-MM-DD"}
supersedes: []
superseded-by: []
---

# {short title, representative of solved problem and found solution}

## Context and Problem Statement

{The problem and the forces behind it, in a few sentences. Name the parts of the system the decision covers.}

<!-- Optional. Remove if empty. -->
## Decision Drivers

* {driver, e.g. a quality wanted, a constraint, an incident}

## Considered Options

* {option 1}
* {option 2}

<!-- When nothing was recorded, replace the list with: None recorded. -->

## Decision Outcome

Chosen option: "{option 1}", because {justification}.

<!-- When no options were recorded, state the decision and its reason directly. -->

### Consequences

* Good, because {positive consequence}
* Bad, because {negative consequence}

### Confirmation

{How compliance is checked: a CI gate, a test, a lint rule, or the check run while writing this ADR.}

<!-- Only when the code does not match the decision. Remove otherwise. -->
## Divergence

{What the code does instead, the check that showed it, and whether the difference is a bug or deliberate.}

<!-- Optional. Remove if empty. -->
## More Information

{Sources, related ADRs, and for a partly superseded ADR, which part no longer holds.}

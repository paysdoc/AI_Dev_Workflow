---
status: accepted
date: 2026-10-01
recorded: 2026-10-01
provenance:
  - kind: transcript
    source: "Claude Code session 2dc3e364, 2026-10-01"
supersedes: []
superseded-by: []
---

# The pipeline runs on the Claude subscription by default; an operator may choose API billing by setting the key

## Context and Problem Statement

ADW starts the Claude Code CLI for every agent. The CLI can authenticate in two ways: with the operator's subscription login, or with an API key in `ANTHROPIC_API_KEY`, which is billed per use.

No document said which of the two the pipeline is meant to use, and the repository pointed both ways. The rate-limit design ([ADR-0025](0025-rate-limit-pause-and-resume-queue.md), [ADR-0055](0055-rate-limit-structured-signals-two-tier-wait.md)) is built on the subscription's `five_hour` and `seven_day` windows. The setup instructions and the health check ask for an API key.

The question came up on 2026-10-01, when adding the key as a CI secret was discussed for the conformance gate of ADR-0055. The owner's concern: "if ANTHROPIC_API_KEY is present then the ADW may always use the API instead of the subscription. This could get expensive".

The decision covers how every `claude` process started by ADW authenticates.

## Considered Options

* The pipeline runs on the subscription only. ADW does not forward the key to agents.
* The subscription is the default. An operator may choose API billing by setting the key.
* Leave it as it is.

## Decision Outcome

Chosen option: "The subscription is the default. An operator may choose API billing by setting the key", because, in the owner's words, "In case the ADW ever becomes commercially available".

ADW keeps forwarding `ANTHROPIC_API_KEY` to the agents it starts when the operator has set it. The documents and the health check must say that the key is optional, and that setting it moves billing from the subscription to the API.

### Consequences

* Good, because an installation without a subscription can run the pipeline.
* Good, because the owner's installation keeps running on the subscription by leaving the key unset.
* Bad, because one environment variable decides who is billed, and nothing warns the operator when it is set.
* Bad, because the rate-limit handling of ADR-0025 and ADR-0055 was built and tested against the subscription's signals. An installation billed through the API gets other limit signals, and ADW has not been tested against them.

### Confirmation

Checked on 2026-10-01:

* `adws/core/environment.ts` lists `ANTHROPIC_API_KEY` first in `SAFE_ENV_VARS`, the names passed on to Claude CLI subprocesses.
* The secret of the same name in CI reaches one step only, the live probe in `.github/workflows/envelope-conformance.yml`. No workflow under `.github/workflows/` runs pipeline agents.
* The variable was not set in the shell of the recording session.

Not verified: that the CLI bills the API whenever the variable is set. This is the documented behaviour as the recording agent knows it; it was not tested. Whether the cron host's environment file sets the key was not checked either.

No CI gate enforces the decision.

## Divergence

1. **The health check requires the key.** `checkEnvironmentVariables` in `adws/healthCheckChecks.ts` lists `ANTHROPIC_API_KEY` as its one required variable, so an installation on the subscription fails the check. Ruling (owner, 2026-10-01): the key is optional; a bug.
2. **The documents tell the operator to set the key.** `.env.sample`, `README.md`, `adws/README.md`, the usage text in `adws/core/orchestratorCli.ts` and the header comment of each orchestrator script name the key as something to set, and none says that it changes billing. Ruling (owner, 2026-10-01): the documents must present the key as an optional choice and state its effect.

## More Information

* The CI secret for the conformance gate is recorded in the Divergence section of ADR-0055. It does not affect how the pipeline is billed.

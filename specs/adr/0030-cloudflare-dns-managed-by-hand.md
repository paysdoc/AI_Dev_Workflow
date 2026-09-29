---
status: accepted
date: 2026-04-08
recorded: 2026-09-29
provenance:
  - kind: contemporaneous
    source: "session memory note, 2026-04-08"
supersedes: []
superseded-by: []
---

# Cloudflare DNS records managed by hand

## Context and Problem Statement

ADW's Workers are reached through hostnames on the `paysdoc.nl` zone: `costs.paysdoc.nl`, `screenshots.paysdoc.nl` and, per the note, `api.paysdoc.nl`. The Workers are deployed from CI by `.github/workflows/deploy-workers.yml` with `cloudflare/wrangler-action@v3` and a Cloudflare API token.

On 2026-04-02 the DNS record for `costs.paysdoc.nl` disappeared without notice. `postCostRecordsToD1` failed with `TypeError: fetch failed` and, because cost writes never abort a workflow ([ADR-0026](0026-cost-computed-locally-persisted-in-d1.md)), six days of cost records were dropped. What deleted the record is not recorded.

The question was who may change DNS for the zone: the deploy pipeline, or only a person.

## Decision Drivers

* Something had deleted a DNS record unexpectedly.
* A misconfigured deploy must not be able to rewrite production DNS.

## Considered Options

* Option A: give the CI token DNS edit permission on the zone, so that deploys manage the records.
* Option B: manage the records by hand in the Cloudflare dashboard; the CI token has no DNS edit permission.

The note adds that if declarative management is wanted later, the path is Terraform or Pulumi, not `wrangler-action`.

## Decision Outcome

Chosen option: "Option B", because the incident was an unexpected deletion, "so giving the deploy pipeline *more* DNS power is the wrong direction". The note gives the blast radius as the reason: a deploy that cannot edit DNS cannot break it. Manual records are "boring and stable".

Rules that follow:

* The CI token is never given `Zone:DNS:Edit` or "All Zones" permissions for `paysdoc.nl`.
* A Worker hostname that stops resolving is repaired in the dashboard, not in CI configuration.
* The pattern for a Worker route hostname is an AAAA record with value `100::`, proxied. The existing `screenshots` record is the reference.
* Every `wrangler deploy` from CI logs a warning that the token "does not have 'All Zones' permissions". This is expected. It is not to be fixed by widening the token.

### Consequences

* Good, because a deploy cannot create, change or delete DNS records.
* Good, because DNS changes only when a person makes them.
* Bad, because a new Worker hostname needs a manual step that no code or workflow in the repository describes or checks.
* Bad, because the deploy log carries a permanent warning that looks like a fault.
* Bad, because nothing detects a missing record. The incident that led to this decision dropped records for six days, and the decision adds no monitoring.

### Confirmation

Checked on 2026-09-29:

* `costs.paysdoc.nl`, `screenshots.paysdoc.nl`, `api.paysdoc.nl` and `adw.paysdoc.nl` all resolve (`dig`).
* Both `wrangler.toml` files declare `[[routes]]` with `zone_name`; neither declares a custom domain. No file under `.github/` or `workers/` manages DNS.
* Not checked: the permissions of the CI token. They live in Cloudflare and cannot be read from the repository.
* Not checked: the warning in the deploy log. The last three runs of the workflow skipped both deploy jobs; see [ADR-0022](0022-review-proof-in-r2-behind-router-worker.md).

No CI gate or test enforces this decision. It holds by the scope of the token and by convention.

## More Information

* Unresolved: `adws/triggers/cloudflareTunnel.tsx` runs `cloudflared tunnel route dns`, which creates a DNS record for the webhook hostname with the operator's own `cloudflared` credentials. The script predates this decision ([ADR-0008](0008-webhook-endpoint-via-cloudflare-tunnel.md)). Whether the decision covers it is not recorded.
* `specs/prd/d1-cost-database.md` describes the records as proxied CNAMEs to `workers.dev` and gives the CI token `Zone > DNS > Read`. The note, which is later, gives the AAAA pattern above.
* The note is the only source. No transcript of the session survives.
